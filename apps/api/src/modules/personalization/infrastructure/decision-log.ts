import { Inject, Injectable } from '@nestjs/common';
import {
  DECISION_ROUTING_KEY,
  EXCHANGES,
  MESSAGE_HEADERS,
  type DecisionMade,
  type RedisKeys,
} from '@cip/contracts';
import type { Publisher } from '@cip/messaging';
import { counter, type Logger } from '@cip/observability';
import type { Redis } from 'ioredis';
import { KEYS, LOGGER, PUBLISHER, REDIS } from '../../../shared/tokens';
import type { DecisionLog, DecisionRecord } from '../application/ports';

const published = counter('decisions_published_total', 'Decisions published to the decisions.log queue', [
  'outcome',
]);

export const DECISION_TTL_SECONDS = 86400;

@Injectable()
export class RedisMqDecisionLog implements DecisionLog {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
    @Inject(PUBLISHER) private readonly publisher: Publisher,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async record(decision: DecisionMade): Promise<void> {
    const record: DecisionRecord = {
      tenantId: decision.tenant_id,
      profileId: decision.profile_id,
      decisionId: decision.decision_id,
      placement: decision.placement,
      segmentKey: decision.segment_key,
      campaignId: decision.campaign_id,
      creativeId: decision.creative_id,
      policy: decision.policy,
      explanation: decision.explanation,
    };
    await this.redis.set(
      this.keys.decision(decision.decision_id),
      JSON.stringify(record),
      'EX',
      DECISION_TTL_SECONDS,
    );
    void this.publisher
      .publish({
        exchange: EXCHANGES.domain,
        routingKey: DECISION_ROUTING_KEY,
        body: decision,
        messageId: decision.decision_id,
        headers: {
          [MESSAGE_HEADERS.tenantId]: decision.tenant_id,
          [MESSAGE_HEADERS.eventType]: DECISION_ROUTING_KEY,
        },
      })
      .then(() => published.inc({ outcome: 'ok' }))
      .catch((error: unknown) => {
        published.inc({ outcome: 'failed' });
        this.logger.warn({ err: error, decisionId: decision.decision_id }, 'decision log publish failed');
      });
  }

  async get(decisionId: string): Promise<DecisionRecord | null> {
    const raw = await this.redis.get(this.keys.decision(decisionId));
    return raw ? (JSON.parse(raw) as DecisionRecord) : null;
  }
}
