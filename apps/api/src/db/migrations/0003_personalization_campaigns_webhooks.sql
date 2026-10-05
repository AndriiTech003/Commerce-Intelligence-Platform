DROP INDEX IF EXISTS "products_embedding_idx";
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "embedding" TYPE vector(384) USING NULL;
--> statement-breakpoint
UPDATE "products" SET "embedding_version" = NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "embedding_source_hash" text;
--> statement-breakpoint
CREATE INDEX "products_embedding_idx" ON "products" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN IF NOT EXISTS "review_comment" text;
--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creatives_campaign_status_idx" ON "creatives" ("campaign_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creatives_input_hash_idx" ON "creatives" ("tenant_id", (("generation" ->> 'inputHash')));
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_tenant_status_placement_idx" ON "campaigns" ("tenant_id", "status", "placement");
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "result" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bandit_snapshots_tenant_campaign_idx" ON "bandit_snapshots" ("tenant_id", "campaign_id", "snapshot_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_profiles_customer_idx" ON "customer_profiles" ("tenant_id", "customer_id");
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret" text NOT NULL,
	"secret_prefix" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "webhook_endpoints_status_check" CHECK ("webhook_endpoints"."status" in ('active','disabled'))
);
--> statement-breakpoint
CREATE INDEX "webhook_endpoints_tenant_idx" ON "webhook_endpoints" ("tenant_id", "status");
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_status_code" integer,
	"last_error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "webhook_deliveries_status_check" CHECK ("webhook_deliveries"."status" in ('pending','succeeded','failed','dead')),
	CONSTRAINT "webhook_deliveries_endpoint_event_unique" UNIQUE ("endpoint_id", "event_id")
);
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" ("next_attempt_at") WHERE "status" in ('pending','failed');
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" ("endpoint_id", "created_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook_endpoints", "webhook_deliveries" TO app_user, app_system;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webhook_endpoints" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webhook_deliveries" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cip_seed_system_segments(target uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  INSERT INTO segments (id, tenant_id, key, name, rules, priority, is_system)
  SELECT gen_random_uuid(), target, s.key, s.name, s.rules::jsonb, s.priority, true
  FROM (VALUES
    ('high_intent', 'High intent', '{"all":[{"feature":"intent","op":"gte","value":0.7}]}', 10),
    ('vip', 'VIP (top 10% LTV)', '{"all":[{"feature":"orders_count","op":"gte","value":1},{"feature":"ltv_cents","op":"gte","value":50000}]}', 20),
    ('lapsed', 'Lapsed customers', '{"all":[{"feature":"orders_count","op":"gte","value":1},{"feature":"days_since_last_order","op":"gt","value":60}]}', 30),
    ('price_sensitive', 'Price sensitive', '{"any":[{"feature":"price.band","op":"eq","value":"low"},{"feature":"used_discount","op":"eq","value":true}]}', 40),
    ('returning_customer', 'Returning customers', '{"all":[{"feature":"orders_count","op":"gte","value":1}]}', 50),
    ('new_visitor', 'New visitors', '{"all":[{"feature":"sessions_30d","op":"lte","value":1},{"feature":"orders_count","op":"eq","value":0}]}', 60)
  ) AS s(key, name, rules, priority)
  ON CONFLICT (tenant_id, key) DO NOTHING;
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cip_tenant_system_segments() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  PERFORM cip_seed_system_segments(NEW.id);
  RETURN NEW;
END;
$fn$;
--> statement-breakpoint
CREATE TRIGGER tenants_system_segments AFTER INSERT ON "tenants" FOR EACH ROW EXECUTE FUNCTION cip_tenant_system_segments();
--> statement-breakpoint
SELECT cip_seed_system_segments(id) FROM tenants;
