CREATE TABLE IF NOT EXISTS campaign_stats_hourly
(
    tenant_id   UUID,
    hour        DateTime,
    campaign_id UUID,
    creative_id UUID,
    segment_key LowCardinality(String),
    impressions UInt64,
    clicks      UInt64,
    conversions UInt64,
    revenue_cents Int64
)
ENGINE = SummingMergeTree
ORDER BY (tenant_id, campaign_id, creative_id, segment_key, hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_campaign_stats_hourly TO campaign_stats_hourly AS
SELECT
    tenant_id,
    toStartOfHour(occurred_at) AS hour,
    assumeNotNull(campaign_id) AS campaign_id,
    assumeNotNull(creative_id) AS creative_id,
    segment_key,
    countIf(event_type = 'ad_impression') AS impressions,
    countIf(event_type = 'ad_clicked') AS clicks,
    countIf(event_type = 'ad_converted') AS conversions,
    sumIf(coalesce(revenue_cents, toInt64(0)), event_type = 'ad_converted') AS revenue_cents
FROM events
WHERE campaign_id IS NOT NULL AND creative_id IS NOT NULL
GROUP BY tenant_id, hour, campaign_id, creative_id, segment_key;
