CREATE TABLE "demo_admin_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"avatar_file_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_admin_profiles" ENABLE ROW LEVEL SECURITY;