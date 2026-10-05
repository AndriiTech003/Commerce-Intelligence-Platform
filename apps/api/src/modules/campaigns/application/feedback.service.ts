import { Inject, Injectable } from '@nestjs/common';
import {
  isDomainEventType,
  parseDomainEvent,
  parseTrackEvent,
  type DomainEvent,
  type TrackEvent,
} from '@cip/contracts';
import { PoisonMessageError } from '@cip/messaging';
import { counter } from '@cip/observability';
import { DEFAULT_SEGMENT } from '@cip/personalization';
import { createHash } from 'node:crypto';
import { DECISION_LOG, type DecisionLog } from '../../personalization';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import type { Campaign } from '../domain/campaign';
import {
  ATTRIBUTION_STORE,
  BANDIT_STORE,
  CAMPAIGN_REPOSITORY,
  TRACK_PUBLISHER,
  type Attribution,
  type AttributionStore,
  type BanditStore,
  type CampaignRepository,
  type TrackPublisher,
} from './ports';

const feedback = counter('bandit_feedback_total', 'Bandit feedback processed', ['event_type', 'outcome']);

export type FeedbackEvent = { kind: 'track'; event: TrackEvent } | { kind: 'domain'; event: DomainEvent };

export function parseFeedback(raw: unknown): FeedbackEvent {
  const type = (raw as { event_type?: unknown })?.event_type;
  if (typeof type === 'string' && isDomainEventType(type)) {
    const parsed = parseDomainEvent(raw);
    if (!parsed.ok) throw new PoisonMessageError(parsed.reason);
    return { kind: 'domain', event: parsed.event };
  }
  const parsed = parseTrackEvent(raw);
  if (!parsed.ok) throw new PoisonMessageError(parsed.reason);
  return { kind: 'track', event: parsed.event };
}

export const ATTRIBUTION_WINDOW_MS = 24 * 3600_000;

function derivedUuid(base: string, salt: string): string {
  const hex = createHash('sha1').update(`${base}:${salt}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

@Injectable()
export class FeedbackService {
  private readonly campaignCache = new Map<string, { campaign: Campaign | null; expires: number }>();

  constructor(
    @Inject(CAMPAIGN_REPOSITORY) private readonly repo: CampaignRepository,
    @Inject(BANDIT_STORE) private readonly bandit: BanditStore,
    @Inject(ATTRIBUTION_STORE) private readonly attribution: AttributionStore,
    @Inject(TRACK_PUBLISHER) private readonly track: TrackPublisher,
    @Inject(DECISION_LOG) private readonly decisions: DecisionLog,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  private async campaign(tenantId: string, id: string): Promise<Campaign | null> {
    const hit = this.campaignCache.get(id);
    if (hit && hit.expires > Date.now()) return hit.campaign;
    const campaign = await this.uow.runForTenant(tenantId, () => this.repo.find(id));
    this.campaignCache.set(id, { campaign, expires: Date.now() + 30_000 });
    return campaign;
  }

  private async context(tenantId: string, props: Record<string, unknown>) {
    const decisionId = String(props.decision_id);
    const record = await this.decisions.get(decisionId);
    if (record && record.tenantId !== tenantId) return null;
    const campaignId = record?.campaignId ?? (props.campaign_id as string | undefined);
    const creativeId = record?.creativeId ?? (props.creative_id as string | undefined);
    if (!campaignId || !creativeId) return null;
    return {
      decisionId,
      campaignId,
      creativeId,
      segmentKey: record?.segmentKey ?? String(props.segment_key ?? DEFAULT_SEGMENT),
      placement: record?.placement ?? String(props.placement ?? ''),
      policy: record?.policy ?? String(props.policy ?? 'thompson_sampling'),
    };
  }

  async handle(message: FeedbackEvent): Promise<void> {
    if (message.kind === 'track') return this.handleTrack(message.event);
    return this.handleDomain(message.event);
  }

  private async handleTrack(event: TrackEvent): Promise<void> {
    if (event.event_type !== 'ad_impression' && event.event_type !== 'ad_clicked') return;
    const ctx = await this.context(event.tenant_id, event.properties as Record<string, unknown>);
    if (!ctx) {
      feedback.inc({ event_type: event.event_type, outcome: 'unknown_decision' });
      return;
    }
    const learn = ctx.policy !== 'holdout_uniform';
    if (event.event_type === 'ad_impression') {
      const counted =
        learn &&
        (await this.bandit.impression(ctx.campaignId, ctx.segmentKey, ctx.creativeId, ctx.decisionId));
      feedback.inc({
        event_type: event.event_type,
        outcome: !learn ? 'holdout' : counted ? 'counted' : 'duplicate',
      });
      return;
    }
    const profiles = [event.customer_id, event.anonymous_id].filter((v): v is string => Boolean(v));
    await this.attribution.remember(event.tenant_id, profiles, {
      decisionId: ctx.decisionId,
      campaignId: ctx.campaignId,
      creativeId: ctx.creativeId,
      segmentKey: ctx.segmentKey,
      placement: ctx.placement,
      clickedAt: event.occurred_at,
    });
    const campaign = await this.campaign(event.tenant_id, ctx.campaignId);
    if (learn && campaign?.goal === 'click') {
      const counted = await this.bandit.success(
        ctx.campaignId,
        ctx.segmentKey,
        ctx.creativeId,
        ctx.decisionId,
        `clk:${ctx.decisionId}`,
      );
      feedback.inc({ event_type: event.event_type, outcome: counted ? 'counted' : 'duplicate' });
    } else feedback.inc({ event_type: event.event_type, outcome: learn ? 'attributed' : 'holdout' });
  }

  private async handleDomain(event: DomainEvent): Promise<void> {
    if (event.event_type === 'creative.approved') {
      const campaign = await this.campaign(event.tenant_id, event.properties.campaign_id);
      if (!campaign) return;
      for (const segment of [...campaign.targetSegments, DEFAULT_SEGMENT])
        await this.bandit.initArm(campaign.id, segment, event.properties.creative_id);
      feedback.inc({ event_type: event.event_type, outcome: 'initialized' });
      return;
    }
    if (event.event_type !== 'order.placed') return;
    const p = event.properties;
    let attribution: Attribution | null = null;
    const fromPayload = p.attribution as Partial<Attribution> | null | undefined;
    if (fromPayload?.decisionId && fromPayload.campaignId && fromPayload.creativeId) {
      attribution = {
        decisionId: fromPayload.decisionId,
        campaignId: fromPayload.campaignId,
        creativeId: fromPayload.creativeId,
        segmentKey: fromPayload.segmentKey ?? DEFAULT_SEGMENT,
        placement: fromPayload.placement ?? '',
        clickedAt: fromPayload.clickedAt ?? event.occurred_at,
      };
    } else {
      const found = await this.attribution.lookup(
        event.tenant_id,
        [p.profile_id, p.customer_id].filter((v): v is string => Boolean(v)),
      );
      const placedAt = Date.parse(event.occurred_at);
      if (found) {
        const clicked = Date.parse(found.clickedAt);
        if (clicked <= placedAt + 60_000 && placedAt - clicked <= ATTRIBUTION_WINDOW_MS) attribution = found;
      }
      if (attribution)
        await this.uow.runForTenant(event.tenant_id, () =>
          this.repo.setOrderAttribution(p.order_id, { ...attribution }),
        );
    }
    if (!attribution) {
      feedback.inc({ event_type: event.event_type, outcome: 'unattributed' });
      return;
    }
    await this.track.publish({
      event_id: derivedUuid(event.event_id, 'ad_converted'),
      event_type: 'ad_converted',
      schema_version: 1,
      tenant_id: event.tenant_id,
      occurred_at: event.occurred_at,
      received_at: new Date().toISOString(),
      ...(p.customer_id ? { customer_id: p.customer_id } : { anonymous_id: p.profile_id }),
      properties: {
        decision_id: attribution.decisionId,
        campaign_id: attribution.campaignId,
        creative_id: attribution.creativeId,
        placement: attribution.placement || 'unknown',
        segment_key: attribution.segmentKey,
        order_id: p.order_id,
        revenue_cents: p.total_cents,
      },
    });
    const campaign = await this.campaign(event.tenant_id, attribution.campaignId);
    const record = await this.decisions.get(attribution.decisionId);
    if (campaign?.goal === 'conversion' && record?.policy !== 'holdout_uniform') {
      const counted = await this.bandit.success(
        attribution.campaignId,
        attribution.segmentKey,
        attribution.creativeId,
        attribution.decisionId,
        `conv:${p.order_id}`,
      );
      feedback.inc({ event_type: event.event_type, outcome: counted ? 'conversion' : 'duplicate' });
    } else feedback.inc({ event_type: event.event_type, outcome: 'attributed' });
  }
}
