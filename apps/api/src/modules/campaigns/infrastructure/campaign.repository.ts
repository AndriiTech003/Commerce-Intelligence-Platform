import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { ProductSelector } from '@cip/contracts';
import { campaigns, creatives } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { Campaign, Creative, CreativeStatus } from '../domain/campaign';
import type {
  CampaignRepository,
  CampaignWrite,
  CreativeWrite,
  PromptProductRow,
} from '../application/ports';

type Row = Record<string, unknown>;

function toCampaign(row: typeof campaigns.$inferSelect): Campaign {
  return {
    id: row.id,
    name: row.name,
    placement: row.placement as Campaign['placement'],
    status: row.status as Campaign['status'],
    targetSegments: row.targetSegments,
    productSelector: row.productSelector as ProductSelector,
    goal: row.goal as Campaign['goal'],
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function toCreative(row: typeof creatives.$inferSelect): Creative {
  return {
    id: row.id,
    campaignId: row.campaignId,
    headline: row.headline,
    body: row.body,
    cta: row.cta,
    tone: row.tone,
    targetSegment: row.targetSegment,
    status: row.status as CreativeStatus,
    source: row.source as Creative['source'],
    generation: row.generation ?? null,
    guardrailFlags: row.guardrailFlags,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    reviewComment: row.reviewComment,
    createdAt: row.createdAt,
  };
}

function campaignValues(write: Partial<CampaignWrite>) {
  return {
    ...write,
    ...(write.productSelector ? { productSelector: write.productSelector as Record<string, unknown> } : {}),
  };
}

@Injectable()
export class DrizzleCampaignRepository implements CampaignRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.tx().execute(query)).rows as Row[];
  }

  async list() {
    const rows = await this.db.tx().select().from(campaigns).orderBy(desc(campaigns.createdAt));
    const counts = await this.rows(
      sql`select campaign_id, status, count(*)::int as n from creatives group by campaign_id, status`,
    );
    const byCampaign = new Map<string, Record<string, number>>();
    for (const c of counts) {
      const map = byCampaign.get(String(c.campaign_id)) ?? {};
      map[String(c.status)] = Number(c.n);
      byCampaign.set(String(c.campaign_id), map);
    }
    return rows.map((r) => ({ ...toCampaign(r), creativeCounts: byCampaign.get(r.id) ?? {} }));
  }

  async find(id: string) {
    const [row] = await this.db.tx().select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    return row ? toCampaign(row) : null;
  }

  async insert(id: string, campaign: CampaignWrite) {
    const [row] = await this.db
      .tx()
      .insert(campaigns)
      .values({
        id,
        tenantId: this.db.tenantId(),
        ...campaignValues(campaign),
      } as typeof campaigns.$inferInsert)
      .returning();
    return toCampaign(row!);
  }

  async update(id: string, patch: Partial<CampaignWrite>) {
    if (Object.keys(patch).length === 0) return this.find(id);
    const [row] = await this.db
      .tx()
      .update(campaigns)
      .set({ ...campaignValues(patch), updatedAt: new Date() })
      .where(eq(campaigns.id, id))
      .returning();
    return row ? toCampaign(row) : null;
  }

  async creatives(campaignId: string) {
    return (
      await this.db
        .tx()
        .select()
        .from(creatives)
        .where(eq(creatives.campaignId, campaignId))
        .orderBy(asc(creatives.createdAt))
    ).map(toCreative);
  }

  async creativesByStatus(status: CreativeStatus) {
    const rows = await this.db
      .tx()
      .select({ creative: creatives, campaignName: campaigns.name, placement: campaigns.placement })
      .from(creatives)
      .innerJoin(campaigns, eq(campaigns.id, creatives.campaignId))
      .where(eq(creatives.status, status))
      .orderBy(desc(creatives.createdAt))
      .limit(200);
    return rows.map((r) => ({
      ...toCreative(r.creative),
      campaignName: r.campaignName,
      placement: r.placement,
    }));
  }

  async findCreative(id: string) {
    const [row] = await this.db.tx().select().from(creatives).where(eq(creatives.id, id)).limit(1);
    return row ? toCreative(row) : null;
  }

  async insertCreative(id: string, creative: CreativeWrite) {
    const [row] = await this.db
      .tx()
      .insert(creatives)
      .values({ id, tenantId: this.db.tenantId(), ...creative })
      .returning();
    return toCreative(row!);
  }

  async updateCreative(id: string, patch: Partial<CreativeWrite>) {
    const [row] = await this.db
      .tx()
      .update(creatives)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(creatives.id, id))
      .returning();
    return row ? toCreative(row) : null;
  }

  async activateApproved(campaignId: string) {
    const rows = await this.db
      .tx()
      .update(creatives)
      .set({ status: 'active', updatedAt: new Date() })
      .where(and(eq(creatives.campaignId, campaignId), eq(creatives.status, 'approved')))
      .returning({ id: creatives.id });
    return rows.length;
  }

  async creativeByInputHash(inputHash: string) {
    return (
      await this.db
        .tx()
        .select()
        .from(creatives)
        .where(sql`${creatives.generation} ->> 'inputHash' = ${inputHash}`)
    ).map(toCreative);
  }

  async liveCampaigns(placement: string) {
    const live = await this.db
      .tx()
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.placement, placement),
          eq(campaigns.status, 'active'),
          sql`(${campaigns.startsAt} is null or ${campaigns.startsAt} <= now())`,
          sql`(${campaigns.endsAt} is null or ${campaigns.endsAt} > now())`,
        ),
      )
      .orderBy(asc(campaigns.createdAt));
    const out = [];
    for (const row of live) out.push({ ...toCampaign(row), creatives: await this.creatives(row.id) });
    return out;
  }

  async promptProducts(ids: string[]): Promise<PromptProductRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.rows(sql`
      select p.id, p.title, p.brand, p.attributes, p.description, c.path::text as category_path,
        (select array_agg(v.price_cents order by v.price_cents) from product_variants v where v.product_id = p.id) as prices,
        (select array_agg(v.compare_at_cents - v.price_cents) from product_variants v where v.product_id = p.id and v.compare_at_cents > v.price_cents) as savings
      from products p left join categories c on c.id = p.category_id
      where p.id = any(${`{${ids.join(',')}}`}::uuid[])`);
    const order = new Map(ids.map((id, i) => [id, i]));
    return rows
      .map((r) => {
        const prices = ((r.prices as Array<string | number> | null) ?? []).map(Number);
        return {
          id: String(r.id),
          title: String(r.title),
          brand: (r.brand as string | null) ?? null,
          categoryPath: (r.category_path as string | null) ?? null,
          attributes: (r.attributes as Record<string, unknown>) ?? {},
          description: String(r.description ?? ''),
          priceMinCents: prices.length ? Math.min(...prices) : null,
          priceMaxCents: prices.length ? Math.max(...prices) : null,
          prices,
          savings: ((r.savings as Array<string | number> | null) ?? []).map(Number),
        };
      })
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  async activeDiscounts() {
    const rows = await this.rows(sql`
      select code, type, value from discounts
      where active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
        and (usage_limit is null or used_count < usage_limit)
      order by code`);
    return rows.map((r) => ({
      code: String(r.code),
      type: r.type === 'fixed' ? ('fixed' as const) : ('percent' as const),
      value: Number(r.value),
    }));
  }

  async segmentAggregates(segmentKey: string): Promise<string[]> {
    const filter = segmentKey === '_default' ? sql`true` : sql`${segmentKey} = any(segments)`;
    const [summary] = await this.rows(sql`
      select count(*)::int as n,
        avg(nullif(features->>'price.ewma_cents', '')::float8) as price,
        avg(case when coalesce(nullif(features->>'orders_count', '')::float8, 0) >= 1 then 1 else 0 end) as buyers,
        avg(nullif(features->>'intent', '')::float8) as intent
      from customer_profiles where ${filter}`);
    const top = await this.rows(sql`
      select substr(e.key, 9) as category, sum((e.value #>> '{}')::float8) as score
      from customer_profiles cp, jsonb_each(cp.features) e
      where ${filter} and e.key like 'aff.cat.%' and position('.' in substr(e.key, 9)) = 0
        and jsonb_typeof(e.value) = 'number'
      group by 1 order by 2 desc limit 3`);
    const n = Number(summary?.n ?? 0);
    if (n === 0) return [];
    const out = [`${n} profiles in the latest snapshot`];
    if (summary?.price !== null && summary?.price !== undefined)
      out.push(`average viewed price ${(Number(summary.price) / 100).toFixed(0)}`);
    if (top.length > 0) out.push(`top categories: ${top.map((t) => String(t.category)).join(', ')}`);
    out.push(`${Math.round(Number(summary?.buyers ?? 0) * 100)}% have already purchased`);
    if (summary?.intent !== null && summary?.intent !== undefined)
      out.push(`average purchase intent ${Number(summary.intent).toFixed(2)}`);
    return out;
  }

  async latestBanditSnapshot(campaignId: string, segmentKey: string) {
    const rows = await this.rows(sql`
      select creative_id, alpha, beta, impressions, successes from bandit_snapshots
      where campaign_id = ${campaignId}::uuid and segment_key = ${segmentKey}
        and snapshot_at = (select max(snapshot_at) from bandit_snapshots where campaign_id = ${campaignId}::uuid and segment_key = ${segmentKey})`);
    return rows.map((r) => ({
      creativeId: String(r.creative_id),
      alpha: Number(r.alpha),
      beta: Number(r.beta),
      impressions: Number(r.impressions),
      successes: Number(r.successes),
    }));
  }

  async insertBanditSnapshots(
    rows: Array<{
      campaignId: string;
      segmentKey: string;
      creativeId: string;
      alpha: number;
      beta: number;
      impressions: number;
      successes: number;
    }>,
  ) {
    if (rows.length === 0) return;
    const tenantId = this.db.tenantId();
    await this.db.tx().execute(sql`
      insert into bandit_snapshots (campaign_id, segment_key, creative_id, tenant_id, alpha, beta, impressions, successes, snapshot_at)
      select v.campaign_id, v.segment_key, v.creative_id, ${tenantId}::uuid, v.alpha, v.beta, v.impressions, v.successes, now()
      from jsonb_to_recordset(${JSON.stringify(
        rows.map((r) => ({
          campaign_id: r.campaignId,
          segment_key: r.segmentKey,
          creative_id: r.creativeId,
          alpha: r.alpha,
          beta: r.beta,
          impressions: Math.round(r.impressions),
          successes: Math.round(r.successes),
        })),
      )}::jsonb) as v(campaign_id uuid, segment_key text, creative_id uuid, alpha float8, beta float8, impressions bigint, successes bigint)
      on conflict do nothing`);
  }

  async banditHistory(campaignId: string, since: Date) {
    const rows = await this.rows(sql`
      select snapshot_at, segment_key, creative_id, alpha, beta from bandit_snapshots
      where campaign_id = ${campaignId}::uuid and snapshot_at >= ${since.toISOString()}::timestamptz
      order by snapshot_at limit 5000`);
    return rows.map((r) => ({
      snapshotAt: new Date(String(r.snapshot_at)),
      segmentKey: String(r.segment_key),
      creativeId: String(r.creative_id),
      alpha: Number(r.alpha),
      beta: Number(r.beta),
    }));
  }

  async setOrderAttribution(orderId: string, attribution: Record<string, unknown>) {
    const rows = await this.rows(sql`
      update orders set attribution = ${JSON.stringify(attribution)}::jsonb
      where id = ${orderId}::uuid and attribution is null returning id`);
    return rows.length > 0;
  }
}
