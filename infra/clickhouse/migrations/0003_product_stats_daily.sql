CREATE TABLE IF NOT EXISTS product_stats_daily
(
    tenant_id     UUID,
    day           Date,
    product_id    UUID,
    views         UInt64,
    add_to_cart   UInt64,
    purchases     UInt64,
    revenue_cents Int64
)
ENGINE = SummingMergeTree
ORDER BY (tenant_id, day, product_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_product_stats_daily TO product_stats_daily AS
SELECT
    tenant_id,
    toDate(occurred_at) AS day,
    assumeNotNull(product_id) AS product_id,
    countIf(event_type = 'product_viewed') AS views,
    countIf(event_type = 'cart_item_added') AS add_to_cart,
    toUInt64(sumIf(coalesce(quantity, 0), event_type = 'purchase_item')) AS purchases,
    sumIf(coalesce(revenue_cents, toInt64(0)), event_type = 'purchase_item') AS revenue_cents
FROM events
WHERE product_id IS NOT NULL
GROUP BY tenant_id, day, product_id;
