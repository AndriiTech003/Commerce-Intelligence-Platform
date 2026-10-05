ALTER TABLE decisions ADD COLUMN IF NOT EXISTS policy LowCardinality(String) DEFAULT '';
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS received_at DateTime64(3, 'UTC') DEFAULT now64(3);
