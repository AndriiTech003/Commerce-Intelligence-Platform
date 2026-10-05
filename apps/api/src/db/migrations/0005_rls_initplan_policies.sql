DROP POLICY tenant_isolation ON "webhook_endpoints";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webhook_endpoints" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "webhook_deliveries";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webhook_deliveries" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "invitations";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invitations" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "api_keys";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "api_keys" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "audit_log";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_log" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "tenant_counters";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tenant_counters" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "categories";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "categories" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "products";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "products" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "product_images";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "product_images" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "product_variants";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "product_variants" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "inventory_items";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "inventory_items" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "inventory_reservations";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "inventory_reservations" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "inventory_movements";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "inventory_movements" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "customers";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "customers" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "carts";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "carts" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "cart_items";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "cart_items" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "discounts";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "discounts" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "orders";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "orders" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "order_items";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "order_items" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "order_status_history";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "order_status_history" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "payments";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payments" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "jobs";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "jobs" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "segments";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "segments" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "campaigns";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "campaigns" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "creatives";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "creatives" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "bandit_snapshots";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bandit_snapshots" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "customer_profiles";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "customer_profiles" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "fake_payment_webhooks";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "fake_payment_webhooks" USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
--> statement-breakpoint
DROP POLICY tenant_isolation ON "memberships";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "memberships" USING (tenant_id = (SELECT nullif(current_setting('app.tenant_id', true), '')::uuid) OR user_id = (SELECT nullif(current_setting('app.user_id', true), '')::uuid)) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
