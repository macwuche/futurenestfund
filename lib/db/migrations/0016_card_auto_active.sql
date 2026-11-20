ALTER TABLE "demo_payment_cards" ALTER COLUMN "status" SET DEFAULT 'Active';--> statement-breakpoint
UPDATE "demo_payment_cards" SET "status" = 'Active' WHERE "status" IN ('Pending', 'Verified');
