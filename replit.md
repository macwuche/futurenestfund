# Grant Platform

A new grant-management web app built from the supplied applicant and admin dashboard/profile specifications.

## Current delivery

This is an explicitly labeled **interactive demo**, not a production financial service. It uses isolated sample profiles in this project's PostgreSQL fallback database. Applicant/admin switching is preview navigation, **not authentication or authorization**. Do not add real customer information to these demo endpoints.

- React + Vite + Wouter frontend: `artifacts/grant-platform`
- Express 5 API at `/api`, managed on port 8080: `artifacts/api-server`
- Contract: `lib/api-spec/openapi.yaml`; generated hooks and validation: `lib/api-client-react`, `lib/api-zod`
- Drizzle sample schema: `lib/db/src/schema/demo-*.ts`
- Sample seeding: `artifacts/api-server/src/lib/demoSeed.ts`
- Workspace behavior/transactions: `artifacts/api-server/src/lib/demoWorkspace.ts`
- Applicant records (applications, milestones): `artifacts/api-server/src/lib/applicantRecords.ts`; uploads: `uploads.ts`, `kyc.ts`, `avatars.ts`

## Run and verify

- `pnpm --filter @workspace/api-spec run codegen` after every OpenAPI edit
- `pnpm run typecheck` for all libraries and apps
- `pnpm --filter @workspace/db run push` for development schema changes
- Restart the existing managed workflows, never start duplicate servers.

## User-requested production stack

TypeScript 5.9 / Node.js 24 / pnpm monorepo; React/Vite/Wouter (not Next.js or SSR); React Hook Form with Zod sharing domain rules with the API; Supabase Postgres accessed through Drizzle, with Replit Postgres fallback; Supabase Auth with email confirmation and TOTP; images rebuilt by sharp; uploaded files on the API server's disk, **not Supabase Storage**; all email through Resend including Supabase's Send Email Hook; Vitest and ignored `.unlazy/` headless Chromium scripts.

The supplied documents contain generic Next.js instructions, but the user's explicit stack above takes precedence. Their visual/menu/responsive requirements remain authoritative. Fonts were not specified in the supplied documents.

## Backend and security boundaries

- Profile edits, tier/permission updates, account freezes, global freeze and sample balance top-ups persist in Postgres and create append-only application audit records.
- Money is stored in integer cents. Sample ledger changes and audit writes share a transaction, using row locks. Global freeze and individual account freeze block sample top-ups.
- Demo tables have RLS enabled without public policies; only the API's database connection accesses them.
- The public demo API is not production-secure account management. Real auth/roles, two-person approvals, KYC review decisions, actual OCR, Resend delivery and live grant workflows are not enabled yet. Applicant endpoints scope data through `currentUserId()` (still the demo applicant until sign-in exists).
- Uploads (profile photos, identity documents, proposal files) are written to the API server's disk in `UPLOAD_DIR` (default `artifacts/api-server/uploads/`, git-ignored), with metadata in `demo_files`. The server checks real file types from the bytes, re-encodes images with sharp (strips EXIF/GPS, caps pixels), refuses PDFs with scripts/attachments and macro Word files, caps files at 10 MB, and serves them owner-only with a sandbox CSP. That disk is not durable on Replit deployments; a deployment needs persistent storage before real use. The UI asks users to upload sample documents only.
- No payment processor or card network is connected. Any card, confidence score, grant/application, chart or document shown is sample data.
- Do not describe a demonstration confidence score as real OCR or the preview role switch as sign-in.

## UI source requirements

The preserved brief files are under `.local/conversation-workspace/files/attached_assets/`:
- `Pasted--User-Dashboard-Profile-UI-Specification-user-dashboard_1792092005165.txt`
- `Pasted--Admin-Dashboard-User-Profile-UI-Specification-admin-da_1792095537728.txt`

Applicant navigation is Dashboard, Grant categories, Applications, Cards, Transactions, Withdrawals, Add funds, Settings. Admin navigation is Dashboard, Users, Transactions, Deposit Page, Withdrawal Page, KYC Page, Settings.
