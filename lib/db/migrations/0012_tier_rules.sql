CREATE TABLE "demo_tier_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"from_tier" integer NOT NULL,
	"to_tier" integer NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"form_snapshot" jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decision_note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_tier_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demo_settings" ADD COLUMN "tier_rules" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_tier_requests_one_pending" ON "demo_tier_requests" USING btree ("profile_id") WHERE status = 'Pending';--> statement-breakpoint
-- Step 9.4: tier limits replace the platform-wide withdrawal limits. Copy today's values into every tier, so nobody's limit
-- changes on deploy; top-up limits, card rules and upgrade forms start empty (open) until the admin sets them.
UPDATE "demo_settings" SET "tier_rules" = jsonb_build_object(
  '1', jsonb_build_object('withdrawalMaxCents', "withdrawal_max_cents", 'withdrawalDailyCents', "withdrawal_daily_cents"),
  '2', jsonb_build_object('withdrawalMaxCents', "withdrawal_max_cents", 'withdrawalDailyCents', "withdrawal_daily_cents"),
  '3', jsonb_build_object('withdrawalMaxCents', "withdrawal_max_cents", 'withdrawalDailyCents', "withdrawal_daily_cents")
) WHERE "tier_rules" IS NULL;
