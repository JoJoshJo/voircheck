ALTER TABLE "payments" ADD COLUMN "refund_id" text;--> statement-breakpoint
CREATE INDEX "payments_capture_idx" ON "payments" USING btree ("capture_id");