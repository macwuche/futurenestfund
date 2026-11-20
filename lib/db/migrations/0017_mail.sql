CREATE TABLE "demo_mail_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text DEFAULT 'attachment' NOT NULL,
	"message_id" uuid,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text,
	"stored_name" text,
	"blocked_reason" text,
	"content_id" text,
	"inline" boolean DEFAULT false NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_mail_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_mail_inbound" (
	"svix_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"email_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_try_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "demo_mail_inbound" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_mail_mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"display_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"catch_all" boolean DEFAULT false NOT NULL,
	"system_sender" boolean DEFAULT false NOT NULL,
	"signature" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_mail_mailboxes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid,
	"mailbox_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"message_id" text,
	"in_reply_to" text,
	"references_header" text,
	"from_address" text NOT NULL,
	"from_name" text,
	"to_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"authentication" jsonb,
	"auth_failed" boolean DEFAULT false NOT NULL,
	"remote_images" boolean DEFAULT false NOT NULL,
	"unread" boolean DEFAULT false NOT NULL,
	"resend_id" text,
	"sent_by" text,
	"send_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"error" text,
	"with_signature" boolean DEFAULT true NOT NULL,
	"forward_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_mail_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_mail_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"folder" text DEFAULT 'inbox' NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"unread" integer DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"has_outgoing" boolean DEFAULT false NOT NULL,
	"has_incoming" boolean DEFAULT false NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"profile_id" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"binned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_mail_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "demo_mail_files_message" ON "demo_mail_files" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "demo_mail_inbound_due" ON "demo_mail_inbound" USING btree ("status","next_try_at");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_mail_mailboxes_address" ON "demo_mail_mailboxes" USING btree ("address");--> statement-breakpoint
CREATE INDEX "demo_mail_messages_thread" ON "demo_mail_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "demo_mail_messages_message_id" ON "demo_mail_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "demo_mail_messages_status" ON "demo_mail_messages" USING btree ("status","send_at");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_mail_messages_resend" ON "demo_mail_messages" USING btree ("mailbox_id","resend_id");--> statement-breakpoint
CREATE INDEX "demo_mail_threads_list" ON "demo_mail_threads" USING btree ("mailbox_id","folder","last_message_at");--> statement-breakpoint
CREATE INDEX "demo_mail_threads_profile" ON "demo_mail_threads" USING btree ("profile_id");