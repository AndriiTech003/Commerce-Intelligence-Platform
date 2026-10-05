CREATE TABLE "fake_payment_webhooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"intent_id" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "fake_payment_webhooks_status_check" CHECK ("fake_payment_webhooks"."status" in ('pending','delivered','failed'))
);
--> statement-breakpoint
CREATE INDEX "fake_payment_webhooks_due_idx" ON "fake_payment_webhooks" ("due_at") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "fake_payment_webhooks_intent_idx" ON "fake_payment_webhooks" ("intent_id");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "fake_payment_webhooks" TO app_user, app_system;
--> statement-breakpoint
ALTER TABLE "fake_payment_webhooks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fake_payment_webhooks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "fake_payment_webhooks" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
