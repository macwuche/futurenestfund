CREATE TABLE "demo_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"organization" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"telegram" text DEFAULT '' NOT NULL,
	"masked_id" text NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"verification_level" text DEFAULT 'Pending' NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"grant_cents" integer DEFAULT 0 NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"card_cents" integer DEFAULT 0 NOT NULL,
	"cards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb NOT NULL,
	"joined_at" date NOT NULL,
	"avatar_file_id" uuid,
	"auth_user_id" uuid,
	CONSTRAINT "demo_profiles_email_unique" UNIQUE("email"),
	CONSTRAINT "demo_profiles_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
ALTER TABLE "demo_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text,
	"action" text NOT NULL,
	"actor" text DEFAULT 'Demo administrator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"kind" text DEFAULT 'Top-up' NOT NULL,
	"account" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"request_id" uuid,
	"application_id" text,
	"actor" text DEFAULT 'Demo administrator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" text NOT NULL,
	"status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_application_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'Submitted' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"title" text NOT NULL,
	"grant" text NOT NULL,
	"due" date NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_milestones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"message" text NOT NULL,
	"link" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"emailed_at" timestamp with time zone,
	"email_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"purpose" text NOT NULL,
	"application_id" text,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"stored_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_files_stored_name_unique" UNIQUE("stored_name")
);
--> statement-breakpoint
ALTER TABLE "demo_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_kyc_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"file_id" uuid,
	"sample_confidence" real,
	"superseded" boolean DEFAULT false NOT NULL,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_kyc_documents" ENABLE ROW LEVEL SECURITY;