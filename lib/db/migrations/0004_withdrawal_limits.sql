ALTER TABLE "demo_profiles" ADD COLUMN "withdrawal_limit_custom" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_profiles" ADD COLUMN "withdrawal_max_cents" integer;--> statement-breakpoint
ALTER TABLE "demo_profiles" ADD COLUMN "withdrawal_daily_cents" integer;--> statement-breakpoint
ALTER TABLE "demo_settings" ADD COLUMN "withdrawal_max_cents" integer;--> statement-breakpoint
ALTER TABLE "demo_settings" ADD COLUMN "withdrawal_daily_cents" integer;