ALTER TABLE "demo_settings" ADD COLUMN "card_types" jsonb;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_payment_methods" ADD COLUMN "fee_mode" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_payment_methods" ADD COLUMN "fee_value" integer DEFAULT 0 NOT NULL;