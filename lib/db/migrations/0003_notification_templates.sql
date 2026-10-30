ALTER TABLE "demo_notifications" ADD COLUMN "email_kind" text;--> statement-breakpoint
ALTER TABLE "demo_notifications" ADD COLUMN "email_data" jsonb;--> statement-breakpoint
ALTER TABLE "demo_notifications" ADD COLUMN "in_app" boolean DEFAULT true NOT NULL;