CREATE TABLE "daily_spend" (
	"day" date PRIMARY KEY NOT NULL,
	"anthropic_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"kernel_scans" integer DEFAULT 0 NOT NULL
);
