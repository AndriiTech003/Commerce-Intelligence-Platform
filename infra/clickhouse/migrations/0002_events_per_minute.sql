CREATE TABLE IF NOT EXISTS events_per_minute
(
    tenant_id     UUID,
    event_type    LowCardinality(String),
    minute        DateTime,
    events        AggregateFunction(count),
    uniq_profiles AggregateFunction(uniq, UUID),
    revenue       AggregateFunction(sum, Int64)
)
ENGINE = AggregatingMergeTree
ORDER BY (tenant_id, event_type, minute);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_events_per_minute TO events_per_minute AS
SELECT
    tenant_id,
    event_type,
    toStartOfMinute(occurred_at) AS minute,
    countState() AS events,
    uniqState(profile_id) AS uniq_profiles,
    sumState(coalesce(revenue_cents, toInt64(0))) AS revenue
FROM events
GROUP BY tenant_id, event_type, minute;
