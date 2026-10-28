CREATE TYPE "public"."audit_actor" AS ENUM('user', 'agent', 'system', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."candidate_source" AS ENUM('channel3', 'demo', 'link');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('chat', 'link');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('approve', 'auto');--> statement-breakpoint
CREATE TYPE "public"."store_role" AS ENUM('legit', 'scam', 'borderline');--> statement-breakpoint
CREATE TYPE "public"."true_label" AS ENUM('scam', 'legit');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('SAFE', 'HOLD', 'BLOCK');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"actor" "audit_actor" NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"store_name" text NOT NULL,
	"store_url" text NOT NULL,
	"product_title" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"source" "candidate_source" NOT NULL,
	"rank" integer
);
--> statement-breakpoint
CREATE TABLE "demo_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"pair" smallint NOT NULL,
	"role" "store_role" NOT NULL,
	"theme" text NOT NULL,
	CONSTRAINT "demo_stores_slug_unique" UNIQUE("slug"),
	CONSTRAINT "demo_stores_pair_range" CHECK ("demo_stores"."pair" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"scan_id" uuid,
	"paypal_order_id" text NOT NULL,
	"authorization_id" text,
	"capture_id" text,
	"store_slug" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"status" text NOT NULL,
	"mode" "payment_mode" NOT NULL,
	"override_used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_paypal_order_id_unique" UNIQUE("paypal_order_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"language" text DEFAULT 'en' NOT NULL,
	"autopay_enabled" boolean DEFAULT false NOT NULL,
	"autopay_limit" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_domain" text NOT NULL,
	"url" text NOT NULL,
	"risk_score" smallint NOT NULL,
	"verdict" "verdict" NOT NULL,
	"signals" jsonb NOT NULL,
	"explanation" jsonb NOT NULL,
	"hard_rules_triggered" text[] DEFAULT '{}'::text[] NOT NULL,
	"kernel_replay_url" text,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cache_expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	CONSTRAINT "scans_risk_score_range" CHECK ("scans"."risk_score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "shopping_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_type" "entry_type" NOT NULL,
	"query_or_url" text NOT NULL,
	"demo_mode" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_set_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"true_label" "true_label" NOT NULL,
	"source" text,
	"verdict" "verdict" NOT NULL,
	"risk_score" smallint NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_slug" text NOT NULL,
	"payment_id" uuid,
	"scan_id" uuid,
	"language" text DEFAULT 'en' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_receipts_public_slug_unique" UNIQUE("public_slug"),
	CONSTRAINT "trust_receipts_has_subject" CHECK ("trust_receipts"."payment_id" is not null or "trust_receipts"."scan_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "vault_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"paypal_vault_token_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_tokens_paypal_vault_token_id_unique" UNIQUE("paypal_vault_token_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paypal_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"signature_verified" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_session_id_shopping_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."shopping_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_id_shopping_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."shopping_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "neon_auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_sessions" ADD CONSTRAINT "shopping_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "neon_auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_receipts" ADD CONSTRAINT "trust_receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_receipts" ADD CONSTRAINT "trust_receipts_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_tokens" ADD CONSTRAINT "vault_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "neon_auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "candidates_session_idx" ON "candidates" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "payments_session_idx" ON "payments" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "scans_domain_cache_idx" ON "scans" USING btree ("store_domain","cache_expires_at");--> statement-breakpoint
CREATE INDEX "shopping_sessions_user_idx" ON "shopping_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_paypal_event_id_key" ON "webhook_events" USING btree ("paypal_event_id");