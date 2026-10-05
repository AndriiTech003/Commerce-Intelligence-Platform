CREATE TABLE IF NOT EXISTS decisions
(
    decision_id    UUID,
    tenant_id      UUID,
    placement      LowCardinality(String),
    profile_id     UUID,
    segment_key    LowCardinality(String),
    campaign_id    UUID,
    creative_id    UUID,
    product_ids    Array(UUID),
    sampled_scores Map(String, Float64),
    explanation    String,
    decided_at     DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (tenant_id, decided_at)
TTL toDateTime(decided_at) + INTERVAL 90 DAY;
