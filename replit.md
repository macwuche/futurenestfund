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
- Admin operations (application decisions, deposit/withdrawal approvals, KYC review, ledger, CSV export, search): `artifacts/api-server/src/lib/adminOps.ts`; admin UI in `src/pages/admin.tsx`, `admin-ops.tsx`, `components/admin-bits.tsx`

## Run and verify

- `pnpm --filter @workspace/api-spec run codegen` after every OpenAPI edit
- `pnpm run typecheck` for all libraries and apps
- `pnpm --filter @workspace/db run push` for development schema changes
- Database selection (`lib/db/src/connection.ts`): Supabase when `SUPABASE_DB_URL` is set, otherwise Replit Postgres (`DATABASE_URL`). `db run push` only manages `demo_*` tables. Supabase is Postgres 17: back it up with a v17 `pg_dump` (see work.md, 2026-10-29).
- Supabase (`futurenestfund`, ref `fybslfcepjnswcnoewgi`, the only project this app uses): `pnpm --filter @workspace/scripts run supabase:migrate` applies `lib/db/supabase/migrations/*.sql` once each; `pnpm --filter @workspace/scripts run seed:admin` creates or repairs the admin (idempotent; `-- --reset-password` to reset). Both need `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL` (session pooler), `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` in Replit Secrets.
- Restart the existing managed workflows, never start duplicate servers.

## User-requested production stack

TypeScript 5.9 / Node.js 24 / pnpm monorepo; React/Vite/Wouter (not Next.js or SSR); React Hook Form with Zod sharing domain rules with the API; Supabase Postgres accessed through Drizzle, with Replit Postgres fallback; Supabase Auth with email confirmation and TOTP; images rebuilt by sharp; uploaded files on the API server's disk, **not Supabase Storage**; all email through Resend including Supabase's Send Email Hook; Vitest and ignored `.unlazy/` headless Chromium scripts.

The supplied documents contain generic Next.js instructions, but the user's explicit stack above takes precedence. Their visual/menu/responsive requirements remain authoritative. Fonts were not specified in the supplied documents.

## Backend and security boundaries

- Profile edits, tier/permission updates, account freezes, global freeze and sample balance top-ups persist in Postgres and create append-only application audit records.
- Money is stored in integer cents. Sample ledger changes and audit writes share a transaction, using row locks. Global freeze and individual account freeze block sample top-ups.
- Demo tables have RLS enabled without public policies; only the API's database connection accesses them.
- Every money movement is a row in `demo_ledger` (signed cents, linked to its request or application). Approving a deposit credits the deposit balance; approving a withdrawal debits the grant balance; approving an application credits the grant balance. Approvals lock settings → profile → record, re-check freezes, balance and the user's KYC requirement, and write ledger + audit + notification in one transaction. Declines need a reason and move no money.
- `demo_audit`, `demo_ledger` and `demo_application_events` are append-only: triggers installed at boot (`demoSeed.ts`) refuse UPDATE/DELETE (TRUNCATE for test resets still works). The dashboard's "Audit log: Intact" checks those triggers exist.
- **API auth** (`artifacts/api-server/src/lib/auth.ts`): every route except `/healthz` verifies a Supabase access token. The token is ES256, checked against the project's JWKS for issuer, audience `authenticated` and expiry. No token or a bad one → 401. The role comes from `app_metadata.role` (only writable with the secret key): `admin`/`root` may use `/admin/*`, everyone else is an applicant and may use only `/applicant/*` (otherwise 403). An applicant's `demo_profiles` row (linked by `auth_user_id`) is created on their first request. `currentUserId()` / `currentAdmin()` read the verified identity; admin actions are recorded with the admin's email. `POST /api/auth/session` mirrors the token into the HttpOnly `gp_session` cookie, which authenticates **GET requests only** (images, downloads), so a cookie can never trigger a change.
- `AUTH_MODE=demo` keeps the old preview identities (Jane / Demo administrator) and is refused when `NODE_ENV=production`. The dev script defaults to it until the sign-in UI (step 4.4) exists; production always verifies tokens and needs `SUPABASE_URL`.
- Two-person (4-eyes) approvals, actual OCR, Resend delivery and live grant workflows are not enabled yet. One administrator approves everything; the UI says so. Token revocation: a role change, ban or sign-out takes effect when the access token expires (Supabase default 1 hour).
- Uploads (profile photos, identity documents, proposal files) are written to the API server's disk in `UPLOAD_DIR` (default `artifacts/api-server/uploads/`, git-ignored), with metadata in `demo_files`. The server checks real file types from the bytes, re-encodes images with sharp (strips EXIF/GPS, caps pixels), refuses PDFs with scripts/attachments and macro Word files, caps files at 10 MB, and serves them owner-only with a sandbox CSP. That disk is not durable on Replit deployments; a deployment needs persistent storage before real use. The UI asks users to upload sample documents only.
- No payment processor or card network is connected. Any card, confidence score, grant/application, chart or document shown is sample data.
- Do not describe a demonstration confidence score as real OCR or the preview role switch as sign-in.

## UI source requirements

The preserved brief files are under `.local/conversation-workspace/files/attached_assets/`:
- `Pasted--User-Dashboard-Profile-UI-Specification-user-dashboard_1792092005165.txt`
- `Pasted--Admin-Dashboard-User-Profile-UI-Specification-admin-da_1792095537728.txt`

Applicant navigation is Dashboard, Grant categories, Applications, Cards, Transactions, Withdrawals, Add funds, Settings. Admin navigation is Dashboard, Users, Transactions, Deposit Page, Withdrawal Page, KYC Page, Settings (the written admin spec is the admin design source; application review lives under Users at `/admin/users/:userId/applications/:id`, reached from the inspector and the dashboard queue).
