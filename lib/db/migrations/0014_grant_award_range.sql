ALTER TABLE "demo_applications" ADD COLUMN "requested_cents" integer;--> statement-breakpoint
ALTER TABLE "demo_grant_plans" ADD COLUMN "amount_mode" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_grant_plans" ADD COLUMN "max_amount_cents" integer;