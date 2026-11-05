CREATE TABLE "demo_grant_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"industry_id" uuid,
	"amount_cents" integer NOT NULL,
	"fee_mode" text DEFAULT 'fixed' NOT NULL,
	"fee_value" integer DEFAULT 0 NOT NULL,
	"logo_file_id" uuid,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_grant_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_industries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_industries_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "demo_industries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demo_profiles" ADD COLUMN "industry_id" uuid;--> statement-breakpoint
ALTER TABLE "demo_applications" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "demo_applications" ADD COLUMN "plan_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "demo_applications" ADD COLUMN "answers" jsonb;--> statement-breakpoint
ALTER TABLE "demo_applications" ADD COLUMN "fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- The starting list of industries (Phase 11); administrators add, rename and remove them in Settings.
INSERT INTO "demo_industries" ("name") VALUES
  ('Agriculture & farming'),
  ('Arts & culture'),
  ('Beauty & personal care'),
  ('Child welfare'),
  ('Community development'),
  ('Construction & infrastructure'),
  ('Disability support'),
  ('Education'),
  ('Elderly care'),
  ('Environment & climate'),
  ('Faith-based organisations'),
  ('Fashion & textiles'),
  ('Film & entertainment'),
  ('Financial inclusion'),
  ('Fisheries & aquaculture'),
  ('Food & beverage'),
  ('Government & public sector'),
  ('Housing'),
  ('Indigenous communities'),
  ('Legal aid & human rights'),
  ('Manufacturing'),
  ('Media & journalism'),
  ('Medical & healthcare'),
  ('Mental health'),
  ('Mining & natural resources'),
  ('Minority-owned business'),
  ('Music'),
  ('Nonprofit & charity'),
  ('Renewable energy'),
  ('Retail & e-commerce'),
  ('Science & research'),
  ('Small business & entrepreneurship'),
  ('Sports & recreation'),
  ('Technology & innovation'),
  ('Tourism & hospitality'),
  ('Transport & logistics'),
  ('Veterans'),
  ('Water & sanitation'),
  ('Women empowerment'),
  ('Youth development')
ON CONFLICT ("name") DO NOTHING;
