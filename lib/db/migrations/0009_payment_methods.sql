CREATE TABLE "demo_payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"logo_file_id" uuid,
	"amount_mode" text DEFAULT 'range' NOT NULL,
	"min_cents" integer,
	"max_cents" integer,
	"fixed_amounts_cents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proof_mode" text DEFAULT 'off' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_payment_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demo_profiles" ADD COLUMN "withdrawal_sources" text DEFAULT 'grant' NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "method_id" uuid;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "method_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "field_values" jsonb;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "proof_file_id" uuid;--> statement-breakpoint
-- Withdrawals placed before Phase 10 were all paid from the grant balance.
UPDATE "demo_requests" SET "source" = 'grant' WHERE "kind" = 'Withdrawal' AND "source" IS NULL;
