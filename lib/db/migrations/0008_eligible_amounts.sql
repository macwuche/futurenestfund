ALTER TABLE "demo_profiles" ADD COLUMN "eligible_custom" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_profiles" ADD COLUMN "eligible_cents" integer;--> statement-breakpoint
ALTER TABLE "demo_settings" ADD COLUMN "tier1_eligible_cents" integer;--> statement-breakpoint
ALTER TABLE "demo_settings" ADD COLUMN "tier2_eligible_cents" integer;--> statement-breakpoint
ALTER TABLE "demo_settings" ADD COLUMN "tier3_eligible_cents" integer;