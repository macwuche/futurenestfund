CREATE TABLE "demo_payment_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"holder_name" text NOT NULL,
	"network" text NOT NULL,
	"last_four" text NOT NULL,
	"number_hash" text NOT NULL,
	"number_sealed" text NOT NULL,
	"cvv_sealed" text NOT NULL,
	"exp_month" integer NOT NULL,
	"exp_year" integer NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"block_reason" text,
	"block_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "demo_payment_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_reported_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number_hash" text NOT NULL,
	"network" text NOT NULL,
	"last_four" text NOT NULL,
	"reason" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reported_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_by" text,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "demo_reported_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "card_id" uuid;--> statement-breakpoint
ALTER TABLE "demo_payment_methods" ADD COLUMN "method_type" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
CREATE INDEX "demo_payment_cards_profile" ON "demo_payment_cards" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "demo_payment_cards_hash" ON "demo_payment_cards" USING btree ("number_hash");--> statement-breakpoint
CREATE INDEX "demo_reported_cards_hash" ON "demo_reported_cards" USING btree ("number_hash");