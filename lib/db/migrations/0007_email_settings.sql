ALTER TABLE "demo_settings" ADD COLUMN "email_config" jsonb;--> statement-breakpoint
ALTER TABLE "demo_settings" ADD COLUMN "email_secrets" jsonb;--> statement-breakpoint
ALTER TABLE "demo_settings" ADD COLUMN "email_hook_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "demo_settings" ADD COLUMN "email_hook_result" text;--> statement-breakpoint
ALTER TABLE "demo_notifications" ADD COLUMN "email_last_error" text;