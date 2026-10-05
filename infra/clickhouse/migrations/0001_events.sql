CREATE TABLE IF NOT EXISTS events
(
    event_id       UUID,
    tenant_id      UUID,
    event_type     LowCardinality(String),
    occurred_at    DateTime64(3, 'UTC'),
    received_at    DateTime64(3, 'UTC'),
    profile_id     UUID,
    anonymous_id   UUID,
    customer_id    Nullable(UUID),
    session_id     UUID,
    product_id     Nullable(UUID),
    variant_id     Nullable(UUID),
    category_path  LowCardinality(String),
    price_cents    Nullable(Int64),
    quantity       Nullable(Int32),
    order_id       Nullable(UUID),
    revenue_cents  Nullable(Int64),
    decision_id    Nullable(UUID),
    campaign_id    Nullable(UUID),
    creative_id    Nullable(UUID),
    segment_key    LowCardinality(String),
    country        LowCardinality(String),
    device         LowCardinality(String),
    properties     String
)
ENGINE = ReplacingMergeTree(received_at)
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, event_type, toDate(occurred_at), event_id)
TTL toDateTime(occurred_at) + INTERVAL 13 MONTH;
