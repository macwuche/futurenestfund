# GrantApp: project documentation

_Last updated 2026-10-31 · branch `user-side-redesign` · Phases 0–5 complete; Phase 6 under way (6.1–6.4 done, 6.5–6.7 to do)._

A grant-management web app with two workspaces: **applicants** apply for grants and manage funding; **administrators** review applications, money requests and identity documents. Grants, balances and cards are **sample data**: no payment processor, card network or OCR is connected.

Secret values (passwords, keys, connection strings) are **not** in this file. They're in the git-ignored [`secrets.local.md`](../secrets.local.md) in the project root, and belong in Replit Secrets / the VPS environment. Day-by-day build notes and test logs are in [`work.md`](../work.md); the short engineering guide is [`replit.md`](../replit.md).

### Progress at a glance

| Phase | What it delivered | Status |
|---|---|---|
| 0 | Applicant workspace rebuilt to the reference design | Done |
| 1 | Applications, milestones and notifications stored on the server | Done |
| 2 | File uploads: identity documents, proposal files, profile photos | Done |
| 3 | Admin operations: ledger, deposit / withdrawal / KYC queues, application decisions | Done |
| 4 | Real accounts on Supabase: sign-in, API auth, email through Resend, Settings security; then a hardening pass (RLS, `app_api` role, migrations, CSP, rate limits, unit tests) | Done (4.5 two-factor dropped by decision) |
| 5 | Admin controls: withdrawal emails, limits, audit-log viewer, users directory, debits, card controls, profile photos | Done (5.1–5.7) |
| 6 | Finish and harden: matchmaking, applicant card controls, phone polish, error monitoring | 6.1–6.4 done 2026-10-30/31; **6.5 deployment runbook written ([`docs/DEPLOY.md`](DEPLOY.md)), being followed on the VPS** (progress in [`server.md`](../server.md)); then 6.6 upload storage + virus scanning, 6.7 shared rate limits (only with several servers) |

What still needs you is listed in §12 (go-live checklist) and §15 (open items).

---

## Contents

1. [What's built](#1-whats-built)
2. [Tech stack](#2-tech-stack)
3. [Code layout](#3-code-layout)
4. [Supabase project](#4-supabase-project)
5. [Sign-in and roles](#5-sign-in-and-roles)
6. [Database, RLS and migrations](#6-database-rls-and-migrations)
7. [Email](#7-email)
8. [Security controls](#8-security-controls)
9. [Configuration (every environment variable)](#9-configuration-every-environment-variable)
10. [Commands](#10-commands)
11. [Testing](#11-testing)
12. [Deployment and go-live checklist](#12-deployment-and-go-live-checklist)
13. [Decisions](#13-decisions)
14. [History (commits)](#14-history-commits)
15. [Open items and next steps](#15-open-items-and-next-steps)

---

## 1. What's built

### Applicant workspace (navy theme)
Pages: Dashboard, My Applications (+ detail page), Grant Search, Grant categories, Grant Funding Tracker, Cards, Transactions, Withdrawals, Add funds, Reports, Milestones, Settings, Help Centre.

- **Dashboard:**
  - funding tracker (stacked chart on desktop, progress bar on phones)
  - setup cards: grant matchmaking, first proposal (each is marked complete by the server: answers saved / an application submitted)
  - grant highlights
- **Applications:** create (with an optional PDF/Word proposal), list with filters, detail page.
  - The detail page has a status timeline and documents (attach up to 5, download, remove).
  - When changes are requested, the applicant can reply and resubmit (optionally with a revised amount).
  - Applications can be withdrawn.
- **Money:**
  - deposit and withdrawal requests, checked server-side: 2 decimals, $0.01 to $1M, freezes, KYC rules, and withdrawals can't exceed the available balance
  - transactions list (real ledger entries plus requests)
  - balances and sample cards: the applicant can freeze and unfreeze their own card (a card an administrator froze stays locked to them), see card details, and say a physical card has arrived to ask for it to be activated
- **Milestones:** add, tick, delete (stored per user).
- **Notifications:** the bell (polled every 30 s), plus an **email** for each notification when enabled. Deposit and withdrawal requests get dedicated emails when placed, approved and declined (with a reference, and the reason for a decline). An admin can override a user's email and in-app notifications (always on / always off).
- **Settings:**
  - profile (name, phone, Telegram) and profile photo
  - **identity verification**: upload a government ID and proof of address, see status and rejection reasons
  - account panel with an **email-notifications switch**
  - **Sign-in & security**: change password, sign out of other devices, sign out everywhere
- **Grant matchmaking (rule-based, no AI):** five questions (organization type, focus areas, goals, funding size, timing), stored per applicant and editable. Every sample grant gets a 0–100 score from fixed rules, with a reason for each point: focus area 40, goal 20, amount 20 (neighbouring band 8), timing 20 (5–10 if later than needed). Grants not open to the applicant's organization type score 0, and closed grants are never recommended. **Recommended = score ≥ 70.** Before answering, nothing is marked Recommended.
  - Grant categories: "Your top matches" (top 3 with reasons) and "Edit answers"; each grant card shows its % match and "Why this match"
  - Grant Search: "Best match" sort (default once answered) and a "Recommended only" filter
  - Catalogue and rules: `api-server/src/lib/grantCatalog.ts`; API `GET|PUT /applicant/matchmaking`
- **Grant Search, Funding Tracker, Reports** (with CSV downloads) and a **Help Centre** FAQ.

### Admin workspace (black / lime "command center")
Pages: Dashboard, Users, Transactions, Deposit Page, Withdrawal Page, KYC Page, Settings (the written admin spec's menu). Application review lives under Users (`/admin/users/:userId/applications/:id`).

- **Dashboard:**
  - KPIs: pending applications, KYC, deposits, withdrawals
  - six-month money in/out chart
  - real system health: database round trip, audit-log integrity
  - review queue and recent activity
- **Users / inspector:**
  - directory: search, status filter, sort by name / joined / tier / status / balances, 25 per page (state kept in the address bar; cards on phones)
  - edit profile; tier; account freeze
  - per-user rules: KYC for deposits / withdrawals; email and in-app notification overrides (user's choice / always on / always off)
  - credit and **debit** balances (a debit needs a reason shown to the user, never goes below $0 or below what pending withdrawals hold, and asks for confirmation)
  - **cards:** issue a sample card (virtual active at once, physical pending until marked issued), freeze / unfreeze with a reason shown to the user (also locks a card the user froze themselves), cancel (permanent); shows who froze a card and when a user asked for a physical card to be activated
  - **profile photo:** upload or remove the user's photo (same checks and re-encoding as the applicant's own upload; removal asks first). Audited, and the user is notified.
  - the user's applications and KYC documents
- **Application review:** Submitted → Review → Approved / Declined / Changes requested, with notes. Approving credits the grant balance through the ledger.
- **Deposit / Withdrawal queues:** approve or decline (decline needs a reason). Freezes, balances and KYC are re-checked at approval time. A pending withdrawal above the user's current limit is flagged.
- **Withdrawal limits:** a global max per request and daily total (last 24 h, under review + approved) in Settings, and optional custom limits per user that replace them. Enforced when the applicant places a request.
- **Transactions:** the full ledger with filters, search, pagination, totals and **CSV export** (spreadsheet-formula injection neutralised).
- **KYC:** a document queue with previews; approve or reject (with a reason). The verification level is recomputed.
- **Settings:**
  - global freeze, with a confirmation and a reason
  - security rules overview
  - **error monitoring:** where errors go (server log, plus Sentry when configured) and a "Send test errors" button that raises one server and one browser error and shows their references
  - the admin's **own profile photo**, shown in the sidebar and as the header avatar (which links to Settings)
  - the admin's own **Sign-in & security**
- **Audit log** (`/admin/audit`, from Settings, the dashboard and each user's audit trail): every recorded change, searchable and filterable by user (or platform-wide), who did it and date, 25 per page, with CSV export.
- **Header search** across users, applications, ledger entries and the audit log.

### Platform
- **Real accounts:** sign up (with email confirmation), sign in, forgot / reset password, sign out, confirmation via email links. Admins and applicants are kept in their own workspaces.
- **Money integrity:** money is stored in integer cents.
  - Every money movement is a row in an **append-only ledger**.
  - Approvals lock rows and write ledger + audit + notification in one transaction.
  - The audit log, ledger and application history **can't be edited or deleted**; database triggers refuse it.
- **Uploads** are stored on the API server's disk.
  - The real file type is read from the bytes.
  - Images are re-encoded with sharp, stripping EXIF/GPS.
  - PDFs with scripts or attachments and macro-enabled Word files are refused; 10 MB cap.
  - Files are served owner-only with a sandbox CSP.
- **Email** for everything (sign-in emails and notifications) through Resend. This is built and tested, but waiting for go-live settings (§12).
- **Error monitoring:** every response carries a random `X-Request-Id`, also on every log line.
  - A server error shows the user only "contact support with reference `1a2b3c4d`" (the first 8 characters of the request id); the details go to the log.
  - Browser crashes (uncaught errors, failed promises, the "Something went wrong" screen) are reported to the API, even when signed out, and the crash screen shows a reference too.
  - With `SENTRY_DSN` set, errors also go to Sentry (EU region) or GlitchTip, without the user, cookies, headers, IP or query strings, and with emails, tokens, secrets and long numbers removed from messages.
- **Phones:** every page was audited at 390 px: 44 px tap targets, no sideways scrolling, bell, menu and search reachable.

---

## 2. Tech stack

| Area | Choice |
|---|---|
| Language / runtime | TypeScript 5.9, Node.js 24, pnpm workspaces |
| Web app | React 19 + Vite 7 + Wouter + Tailwind v4, React Query; forms with React Hook Form + Zod |
| API | Express 5 under `/api`, contract in OpenAPI 3.1 (`lib/api-spec/openapi.yaml`). Orval generates the React Query hooks and Zod validators. |
| Database | Postgres via Drizzle ORM: **Supabase** (production) or Replit Postgres (development fallback) |
| Auth | **Supabase Auth** (email + password, email confirmation), supabase-js **2.117.3** pinned, PKCE flow; API verifies tokens with `jose` |
| Email | **Resend** (Supabase Send Email Hook + notification outbox) |
| Images | sharp |
| Tests | Vitest 5.0.3 (`pnpm test`, committed) + headless-Chromium suites in the git-ignored `.unlazy/` |

---

## 3. Code layout

| Path | What |
|---|---|
| `artifacts/grant-platform/` | Web app. `src/App.tsx` (routes + `AuthGate`), `src/lib/auth.tsx` (Supabase session ↔ API), `src/pages/auth.tsx` (sign-in / sign-up / forgot / reset / `/auth/confirm`), `src/pages/applicant*.tsx`, `src/pages/admin*.tsx`, `src/components/shell.tsx` (layouts), `src/components/security.tsx` (Sign-in & security), `src/components/card-self-service.tsx` (applicant card controls), `src/lib/monitoring.ts` (browser crash reports) |
| `artifacts/api-server/` | API. `src/lib/auth.ts` (authentication middleware), `tokens.ts` (token verification), `rateLimit.ts`, `email.ts` / `emailTemplates.ts` / `sendEmailHook.ts` / `notificationMailer.ts`, `adminOps.ts`, `applicantRecords.ts`, `demoWorkspace.ts`, `cards.ts`, `grantCatalog.ts` (matchmaking rules), `monitoring.ts` (scrubbing + Sentry), `uploads.ts` / `kyc.ts` / `avatars.ts`, `demoSeed.ts` |
| `lib/db/` | Drizzle schema (`src/schema`), connection choice + pinned CA (`src/connection.ts`, `src/supabaseCa.ts`), **migrations** (`migrations/`, `supabase/migrations/`) |
| `lib/api-spec/`, `lib/api-zod/`, `lib/api-client-react/` | OpenAPI contract and generated code (`pnpm --filter @workspace/api-spec run codegen`) |
| `scripts/` | `db:migrate`, `db:app-role`, `seed:admin` |
| `.unlazy/` (git-ignored) | Browser / end-to-end test scripts and local test tools |

---

## 4. Supabase project

| Item | Value |
|---|---|
| Project name | `futurenestfund` |
| Project ref | `fybslfcepjnswcnoewgi` (the **only** project this app may use; ref `ukeikuaduqmbkkhmzewg` from the pasted details is not this app's, so never connect to it) |
| URL | `https://fybslfcepjnswcnoewgi.supabase.co` |
| Region | EU, `eu-central-1` (Frankfurt). Production server is an EU VPS, so they sit close together. |
| Postgres | 17.x (back up with a v17 `pg_dump`) |
| Session pooler host | `aws-1-eu-central-1.pooler.supabase.com:5432` |
| Publishable key (public) | `sb_publishable_nDwJDKagzxzYx9xQUiZLWA_mfZu6EgY` |
| Token signing | ES256, keys at `https://fybslfcepjnswcnoewgi.supabase.co/auth/v1/.well-known/jwks.json` |
| Database TLS root (pinned) | Supabase Root 2021 CA, SHA-256 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`, valid to 2031-04-26 |
| Admin account | `admin@futurenestfund.org` (auth id `c1ef1ffe-496d-491d-9a1f-40450e563d77`), `app_metadata.role = admin`, email + password only |
| Database users | `postgres` (owner, for migrations and seeding) and **`app_api`** (the running API) |
| Secret key, DB password, `app_api` password, connection strings | in `secrets.local.md` |

Dashboard settings to check (see §12): Site URL (still `http://localhost:3000`), Redirect URLs, minimum password length (6 today, should be 8), Send Email hook.

---

## 5. Sign-in and roles

**Flow.**
1. The browser asks `GET /api/auth/config` (public) whether sign-in is on, and gets the Supabase URL and publishable key.
2. supabase-js (PKCE) signs the user in.
3. Every API call carries `Authorization: Bearer <access token>`.
4. Right after sign-in, and after every token refresh, the app calls `POST /api/auth/session`. That sets the HttpOnly, SameSite=Strict `gp_session` cookie on `/api`. The cookie authenticates **GET requests only**, so images and download links work but a cookie can never trigger a change (no CSRF).
5. Signing out (or switching user) clears all cached data.

**What the API checks on every request** (except `/healthz`, `/auth/config` and the email hook):
1. The token signature against the project's published keys (ES256/RS256 only), issuer, audience `authenticated`, expiry, and that it's a signed-in (non-anonymous) user. Otherwise **401**.
2. **That the session is still alive**, via Supabase `GET /auth/v1/user` (cached ≤ 60 s per token). Signed-out sessions and banned users → **401** within a minute; Supabase unreachable → **503** ("try again"), never a sign-out.
3. **The role** comes from that live answer's `app_metadata.role` (only the secret key can set it): `admin` / `root` → `/admin/*`; everyone else is an applicant → `/applicant/*`. The wrong area → **403**.

**First sign-in** creates the applicant's profile (`demo_profiles`, id `usr-<auth id>`, linked by `auth_user_id`) from the name and organization given at sign-up. It starts at tier 1, unverified, with $0. The profile email follows the account email.

**Pages:**
- `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`
- `/auth/confirm`, where every email link lands: `?token_hash=…&type=…&next=…`, exchanged with `verifyOtp`. There are no tokens in the URL, it works on any device, scanners can't use the link up, and a used or invalid link shows "expired".

**Router rules:**
- Signed out: only the auth pages; anything else redirects to `/sign-in?next=<page>`, where `next` must be a path inside the app.
- Admins stay in `/admin`; applicants stay outside it.
- An explicit sign-out goes to a plain `/sign-in`.

**Account security:**
- Change password: re-checks the current password first, then **signs out every other session**.
- A password reset also signs out every other session.
- Sign out of other devices, and sign out everywhere (with a confirmation).
- Admins sign in with email + password only (decision, §13).

**Demo mode.** `AUTH_MODE=demo` (development only; the server refuses to start with it in production) restores the old preview: everyone is the sample applicant Jane or the "Demo administrator", with a User/Admin switch. Without `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, development falls back to demo automatically.

---

## 6. Database, RLS and migrations

**Which database.** Supabase when `SUPABASE_DB_URL` is set, otherwise Replit Postgres (`DATABASE_URL`). Supabase connections **verify TLS** against the pinned root CA.

**Tables** (all in `public`):

| Table | Holds |
|---|---|
| `demo_profiles` | Users (sample profiles + signed-up applicants, `auth_user_id` links to Supabase Auth) |
| `demo_applications`, `demo_application_events` | Applications and their status history (**append-only**) |
| `demo_requests` | Deposit / withdrawal requests |
| `demo_ledger` | Every money movement, signed cents (**append-only**) |
| `demo_audit` | Audit trail of every change (**append-only**) |
| `demo_notifications` | In-app notifications + email outbox state (`emailed_at`, `email_attempts`, `email_claimed_until`) |
| `demo_milestones`, `demo_files`, `demo_kyc_documents`, `demo_settings` | Milestones, uploaded file metadata, identity documents, platform freeze |
| `demo_admin_profiles` | Administrators' own details (photo); id `adm-<auth user id>`, or `adm-demo` in demo mode |
| `user_roles` (Supabase only) | Elevated roles linked to `auth.users` |
| `app_migrations` (Supabase only), `drizzle.__drizzle_migrations` | Migration bookkeeping |

**Row Level Security** (verified live on 2026-10-29):
- RLS is **on for every table**: from the schema (`.enableRLS()`), the migrations, and the dashboard's `ensure_rls` trigger.
- The only policies are `app_api_all`, which let the API's role through. Nothing else matches, so `anon` and `authenticated` get nothing.
- `anon` / `authenticated` hold **no grants** on app tables (default privileges keep that true for new tables). Supabase's public Data API answers "permission denied".
- The API connects as **`app_api`**:
  - no BYPASSRLS, no DDL, no `auth` schema access, no TRUNCATE
  - read/write only on the `demo_*` tables, through its policy
  - the append-only triggers still apply to it
- Migrations and seeding run as the owner `postgres` via `SUPABASE_ADMIN_DB_URL`.

**Migrations** (versioned, each applied once):

| File | What |
|---|---|
| `lib/db/migrations/0000_baseline.sql` | All 11 app tables with RLS |
| `lib/db/migrations/0001_notification_email_lease.sql` | `demo_notifications.email_claimed_until` |
| `lib/db/migrations/0002_append_only_triggers.sql` | Triggers refusing UPDATE/DELETE on `demo_audit`, `demo_ledger`, `demo_application_events` |
| `lib/db/migrations/0003_notification_templates.sql` | `demo_notifications.email_kind`, `email_data`, `in_app` |
| `lib/db/migrations/0004_withdrawal_limits.sql` | Global (`demo_settings`) and per-user (`demo_profiles`) withdrawal limits |
| `lib/db/migrations/0005_admin_profiles.sql` | `demo_admin_profiles` (admins' own photo) |
| `lib/db/migrations/0006_matchmaking.sql` | `demo_profiles.matchmaking` (the applicant's matchmaking answers) |
| `lib/db/supabase/migrations/0001_user_roles.sql` | `user_roles` (Supabase only) |
| `lib/db/supabase/migrations/0002_app_api_role.sql` | `app_api` role, grants, `app_api_all` policies, revoked Data API grants |
| `lib/db/supabase/migrations/0003_admin_profiles.sql` | `app_api_all` policy for `demo_admin_profiles`; no Data API grants |

Changing the schema: edit `lib/db/src/schema` → `pnpm --filter @workspace/db run generate` → review the new SQL → `pnpm --filter @workspace/scripts run db:migrate`. A new table also needs an `app_api_all` policy in a new Supabase migration. Both existing databases were "baselined" once on 2026-10-29 (`db:migrate -- --baseline`), because they had been built with `drizzle-kit push`.

---

## 7. Email

All email goes through **Resend** (`lib/email.ts`). Without `RESEND_API_KEY` and `EMAIL_FROM`, email is off and the server logs a warning.

**Supabase sign-in emails:** the **Send Email Hook** at `POST /api/hooks/supabase/send-email` (`lib/sendEmailHook.ts`).
- **Signature check:** Standard Webhooks (HMAC-SHA256 over `id.timestamp.body` with the `v1,whsec_…` secret), a 5-minute timestamp window, constant-time comparison.
- **Retries:** a replayed id is answered without resending; Resend idempotency keys stop duplicates.
- **Errors:** Resend failures answer 503 (retryable) or 500; unknown email types answer 400.
- **Emails covered:**
  - confirm sign-up, reset password, magic link, invite
  - email change: both addresses. Supabase's fields are reversed here, so the **current** address gets `token_hash_new`.
  - re-authentication and sign-in codes
  - security notices: password / email / phone changed, sign-in method linked / removed, MFA added / removed. The email-changed notice goes to the **old** address.
- **Links:** they point to `<APP_URL>/auth/confirm` (the Supabase verify URL is the fallback without `APP_URL`).

**Notification emails** (`lib/notificationMailer.ts`) work as an **outbox**.
- `notifyUser()` writes the row inside the business transaction. A worker (every 15 s) claims due rows in one short statement (`SKIP LOCKED` + a 2-minute lease) and sends them **outside** any transaction, so a rolled-back action never emails.
- Up to 5 tries within 24 h; permanent refusals aren't retried.
- Only signed-up users with email notifications on get email; the sample profiles never do.
- Applicants turn this on or off in Settings → Account (`PATCH /api/applicant/preferences`, audited).

**Templates** (`lib/emailTemplates.ts`): one branded HTML layout plus a plain-text version for every email. Every value is HTML-escaped.

---

## 8. Security controls

| Control | Where |
|---|---|
| Token verification (signature, issuer, audience, expiry, asymmetric algorithms only) | `api-server/src/lib/tokens.ts` |
| Live session / ban / role check (≤ 60 s) and 503 on Supabase outage | `api-server/src/lib/auth.ts` |
| Default-deny routing: 401 without a sign-in, 403 in the wrong workspace | `api-server/src/routes/index.ts` |
| GET-only HttpOnly SameSite=Strict cookie (no CSRF) | `auth.ts`, `routes/auth.ts` |
| Open-redirect guard for `?next=` (refuses `//`, `\`, control characters, absolute URLs) | `grant-platform/src/lib/safe-next.ts` |
| Data isolation: every applicant query scoped to the signed-in profile | `currentUserId()` throughout |
| RLS + least-privilege `app_api` role + revoked Data API grants | §6 |
| Verified database TLS (pinned CA) | `lib/db/src/connection.ts` |
| Append-only audit / ledger / history (database triggers) | migration 0002 |
| Rate limits: per IP 600/min, per-account writes 60/min, uploads 20/10 min, email hook 120/min → 429 + Retry-After (in memory; several servers would need Redis) | `api-server/src/lib/rateLimit.ts` |
| API headers: `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, `Cross-Origin-Resource-Policy: same-origin`, Permissions-Policy, Referrer-Policy, HSTS in production; JSON bodies ≤ 100 kB | `api-server/src/app.ts` |
| Web app Content-Security-Policy (production build): scripts only from the site; network only to the site and `*.supabase.co` | `grant-platform/vite.config.ts` |
| Upload checks (real type from the bytes, re-encoded images, PDF/DOCX structure checks, size and count caps, owner-only download, sandbox CSP) | `api-server/src/lib/uploads.ts` |
| Email: signed webhook, HTML escaping, enumeration-safe sign-up and reset screens | §7 |
| Password changes and resets end other sessions | `security.tsx`, `auth.tsx` |
| CSV export neutralises spreadsheet formulas | `adminOps.ts` |
| Error monitoring: a random request id on every response and log line; 500s show only a short reference; browser crashes reported to `/api/client-errors` (no sign-in, 20/min per IP, 1 kB message / 8 kB stack caps); optional Sentry forwarding via the envelope API with no user, cookies, headers, IP or query strings, and emails / long numbers / tokens scrubbed | `api-server/src/lib/monitoring.ts`, `grant-platform/src/lib/monitoring.ts` |

Known limits:
- Rate limits are per process.
- Uploads live on the server's local disk (needs persistent storage on the VPS).
- PDF/DOCX checks are structural (no virus scan).
- The minimum password length is 6 until changed in the dashboard.
- Crash reports are unauthenticated (they must work on the sign-in page), so anyone can write rate-limited entries to the log. Page paths in reports can include internal record ids (e.g. `usr-…`), never names or emails.

---

## 9. Configuration (every environment variable)

Put these in **Replit Secrets** (development) and the **VPS environment** (production). Values for the secret ones are in `secrets.local.md`.

### API server (`artifacts/api-server`)

| Variable | Required | Value / format | Notes |
|---|---|---|---|
| `NODE_ENV` | prod | `production` | Enables HSTS and secure cookies; forbids demo mode |
| `PORT` | yes | `8080` | VPS: `3200` |
| `HOST` | VPS | `127.0.0.1` | Listen address. Unset: every interface (Replit). On the VPS only nginx should reach the API |
| `SUPABASE_URL` | yes (prod) | `https://fybslfcepjnswcnoewgi.supabase.co` | Token verification, live session check |
| `SUPABASE_PUBLISHABLE_KEY` | yes (prod) | `sb_publishable_nDwJ…` (see §4) | Public; handed to the browser |
| `SUPABASE_DB_URL` | yes (prod) | `postgresql://app_api.fybslfcepjnswcnoewgi:<APP_DB_PASSWORD>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres` | **Secret.** The API's `app_api` connection. Unset → Replit Postgres. |
| `DATABASE_URL` | dev | Replit Postgres (set by Replit) | Fallback database |
| `AUTH_MODE` | no | `demo` or `supabase` | `demo` only in development |
| `RESEND_API_KEY` | for email | from Resend | **Secret** |
| `EMAIL_FROM` | for email | `GrantApp <no-reply@futurenestfund.org>` | Domain verified in Resend |
| `APP_URL` | for email | public web address, e.g. `https://app.futurenestfund.org` | Email links and notification buttons |
| `SEND_EMAIL_HOOK_SECRET` | for email | `v1,whsec_…` from Supabase | **Secret** |
| `TRUST_PROXY` | VPS | `1` | Number of proxies in front (nginx), for real client IPs and `req.secure` |
| `UPLOAD_DIR` | no | default `artifacts/api-server/uploads/` | Must be persistent disk on the VPS |
| `RATE_LIMIT_IP_PER_MIN`, `RATE_LIMIT_WRITES_PER_MIN`, `RATE_LIMIT_UPLOADS_PER_10MIN`, `RATE_LIMIT_HOOK_PER_MIN`, `RATE_LIMIT_CLIENT_ERRORS_PER_MIN` | no | defaults 600 / 60 / 20 / 120 / 20 | |
| `SENTRY_DSN` | no | e.g. `https://<key>@o<org>.ingest.de.sentry.io/<project>` (EU region), or a GlitchTip DSN | **Secret-ish** (lets anyone send events). Unset → errors go to the log only |
| `SENTRY_ENVIRONMENT` | no | default `NODE_ENV` | e.g. `production`, `staging` |
| `APP_RELEASE` | no | e.g. the git commit | Tags each error report with the release |
| `LOG_LEVEL` | no | default `info` | |
| `RESEND_API_URL` | tests only | | Points email at the local stand-in |

### Scripts (`scripts/`) and admin tasks

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_ADMIN_DB_URL` | `db:migrate`, `seed:admin`, `db:app-role` | **Secret.** `postgres` owner pooler URL; keep it off the running app |
| `SUPABASE_SECRET_KEY` | `seed:admin`, tests | **Secret**, full project admin |
| `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` | `seed:admin` | `admin@futurenestfund.org` / see secrets file |
| `APP_DB_PASSWORD` | `db:app-role` | **Secret**, ≥ 24 characters |

### Web app (`artifacts/grant-platform`)
No secrets. `PORT` and `BASE_PATH` for Vite; everything else comes from `GET /api/auth/config` at runtime.

---

## 10. Commands

| Command | What it does |
|---|---|
| `pnpm run typecheck` | Type-check every package |
| `pnpm test` | Vitest unit tests (67) |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate API hooks / validators after editing `openapi.yaml` |
| `pnpm --filter @workspace/db run generate` | Write a new migration from schema changes |
| `pnpm --filter @workspace/scripts run db:migrate` | Apply pending migrations (`-- --baseline` once for a database built with push) |
| `pnpm --filter @workspace/scripts run db:app-role` | Set the `app_api` password from `APP_DB_PASSWORD` |
| `pnpm --filter @workspace/scripts run seed:admin` | Create / repair the admin (idempotent; `-- --reset-password` to reset it) |
| `pnpm --filter @workspace/api-server run build` / `start` | Build / run the API (`dist/index.mjs`) |
| `pnpm --filter @workspace/grant-platform run build` | Production web build (with CSP) |

On Replit, restart the existing workflows instead of starting extra servers.

---

## 11. Testing

**Committed:** `pnpm test`, 67 Vitest tests.
- Token verification: valid, expired, other project, wrong audience, anonymous, forged key, tampered payload, `alg: none`, HS256 algorithm confusion, key server down/timeout → 503.
- Standard Webhooks signatures.
- Email link mapping (including the reversed email-change fields) and HTML escaping.
- Rate limiter.
- `safeNext`.
- Error wording.
- Matchmaking rules (scores, reasons, closed and not-eligible grants).
- Error monitoring: scrubbing (emails, tokens, secrets, long numbers), DSN and stack parsing, the exact fields sent to Sentry, the React component stack.

**Local browser / end-to-end suites** (git-ignored `.unlazy/`, see `.unlazy/README.md`). They drive headless Chromium against a test copy of the API.

| Suite | Checks |
|---|---|
| `phase4-auth` | API auth: 401 / 403, bad tokens, profile creation, isolation, revoked sessions, demotion, bans, email follow, headers (16) |
| `phase4-ui` | Sign-in UI desktop + phone: redirects, validation, admin/applicant routing, sign-out, cookie rules, confirm / reset links, used and garbage links (14 + 3) |
| `phase4-security` | Settings security: preference API, switch, password change ends other sessions, sign out others / everywhere, 44 px targets (7 + 1) |
| `phase4-email` | Hook signatures, every email type, escaping, replay, Resend failures, notification outbox (11) |
| `phase1-*`, `phase2-*`, `phase3-*`, `smoke` | Everything built in Phases 0–3 (175 checks, demo mode) |
| `phase5-*` | Admin operations from Phase 5: withdrawals, limits, audit log, users directory, debits, cards, photos |
| `phase6-matchmaking`, `phase6-cards` (+ `-ui`) | Rule-based matchmaking; applicant card controls (8 + 7 + 7; 7 + 6 + 6) |
| `phase6-monitoring` (+ `-ui`) | Request ids, 500 references, server and browser errors in the log and in a mock Sentry (envelope shape, nothing personal, scrubbing), signed-out reports, rate limit; test button, uncaught error, rejection, render crash screen (8; 4 + 4) |
| `phase6-mobile` | Phone audit at 390 px of every page, menu, panel, main dialogs and the sign-in pages: zoom-out, overflow, boxes sticking out, 44 px targets, bell / menu / search reachable; full-page screenshots with `SHOTS=` (35). Sign-in pages need `AUTH_WEB`: a proxy to a signed-out Supabase-mode API |

Full run on 2026-10-29: all green on the dev frontend, on the **production build with its CSP**, and **on Supabase as `app_api`**.

Latest run (2026-10-31, after 6.4, demo mode): typecheck clean, `pnpm test` 67/67, every API suite from Phases 3, 5 and 6 and every browser suite from Phases 1–6 green (counts in `work.md` §12). `phase4-ui` and `phase4-security` weren't re-run: they need the Supabase secret key and create throwaway users.

---

## 12. Deployment and go-live checklist

**Supabase dashboard**
- [ ] Authentication → URL Configuration: **Site URL** = the production web address (today `http://localhost:3000`); **Redirect URLs** = the production address (and the Replit dev URL for testing).
- [ ] Authentication → Policies (passwords): **minimum length 8** (today 6).
- [ ] Authentication → Hooks → **Send Email** → HTTPS → `<public API URL>/api/hooks/supabase/send-email`; generate the secret and copy it into `SEND_EMAIL_HOOK_SECRET`.

**Resend**
- [ ] Add and verify the sending domain (e.g. `futurenestfund.org`, using the DNS records Resend lists); create an API key.

**Secrets (Replit and VPS)**
- [ ] `SUPABASE_DB_URL` = the **`app_api`** URL (changed on 2026-10-29); add `SUPABASE_ADMIN_DB_URL` where migrations run.
- [ ] `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`, `SEND_EMAIL_HOOK_SECRET`, `TRUST_PROXY=1` (VPS), `NODE_ENV=production`.

**Rotate (pasted in chat on 2026-10-28)**
- [ ] Database password (Supabase → Database settings), then update `SUPABASE_ADMIN_DB_URL`.
- [ ] Secret key (Supabase → API keys), then update `SUPABASE_SECRET_KEY`.
- [ ] Admin password (change it in the app's Settings, or set `ADMIN_SEED_PASSWORD` and run `seed:admin -- --reset-password`).

**VPS** (follow [`docs/DEPLOY.md`](DEPLOY.md); address `https://access.futurenestfund.org`, since `futurenestfund.org` is the WordPress site)
- [ ] Cloudflare: `A access → 77.68.98.14`, DNS only; private GitHub repo with a read-only deploy key.
- [ ] nginx + Let's Encrypt in front, API under its own PM2 (user `futurenestfund`, port 3200, 127.0.0.1 only), uploads in `/var/lib/futurenestfund/uploads`, nightly backups.
- [ ] Run `db:migrate` on each deploy before starting the API.

**Now (Supabase)**
- [ ] Run `db:migrate` against Supabase with `SUPABASE_ADMIN_DB_URL` to apply migrations **0005** (admin profile photos) and **0006** (matchmaking answers). Until then those two features fail on the Supabase database.

**Error monitoring (optional)**
- [ ] Create a Sentry project in the **EU (Frankfurt) region**, or run GlitchTip on the VPS; set `SENTRY_DSN` (and `APP_RELEASE` to the deployed commit) on the server.
- [ ] Admin Settings → Error monitoring → **Send test errors**; check both references arrive.
- [ ] After go-live: one real sign-up and one password reset to an inbox you control; check the response times from the VPS.

---

## 13. Decisions

| Date | Decision |
|---|---|
| 2026-10-15 | Menu = the written spec's 8 items + the reference design's extra items; mobile keeps an in-app bottom tab bar |
| 2026-10-21 | Admin design follows the written admin spec; application review lives inside Users |
| 2026-10-28 | Dedicated Supabase project `futurenestfund` (never the existing GrantFlow Hub project) |
| 2026-10-29 | Keep the EU Supabase region: the production server is an EU VPS |
| 2026-10-29 | **Admins sign in with email + password only (no two-factor)**; step 4.5 dropped |
| 2026-10-29 | Browser test scripts stay in the git-ignored `.unlazy/` folder; unit tests are committed (Vitest) |
| 2026-10-30 | **No two-person (4-eyes) approval**: one finance admin approves or declines each withdrawal; the applicant is notified in-app and by email when they request it and when it's decided |

---

## 14. History (commits)

| Commit | What |
|---|---|
| `0c05d76` … `7febe95` | Initial app, API client, first platform components |
| `4df02af` | Applicant workspace rebuilt to the reference design (Phase 0) |
| `4f24fd5` | Applications, milestones and notifications on the server (Phase 1) |
| `9befb81` | File uploads, KYC submission, proposal documents, profile photos (Phase 2) |
| `0d8e0eb` | Admin operations: ledger, approval queues, KYC review, application decisions (Phase 3) |
| `32a1acb` | Admin seeded into Supabase (4.1) |
| `ef24406` | App data on Supabase (4.2) |
| `5709c05` | Every API route requires a Supabase sign-in (4.3) |
| `dbed1b2` | Sign-in, sign-up, password reset, sign-out (4.4) |
| `043e1a1` | Email through Resend, incl. Supabase Auth emails (4.6) |
| `90ceb67` | Settings: sign-in & security, email-notification switch (4.7) |
| `330d9c6` | Hardening after review: verified TLS, `app_api` role + RLS policies, migrations, live session checks, `/auth/confirm` links, rate limits, CSP, Vitest |
| `bf2039f` | Withdrawal / deposit emails and notifications; admin notification overrides (5.1) |
| `9a16757` | Global and per-user withdrawal limits (5.2) |
| `579b4cf` | Audit-log viewer with filters and CSV export (5.3) |
| `45e7b5c` | Users directory sorting and pagination (5.4) |
| `057fce1` | Debit adjustments (5.5) |
| `0f64fd4` | Admin card controls (5.6) |
| `349ec5f` | Profile photos: the admin's own, and users' from the inspector (5.7) |
| `92bc2a7` | Rule-based grant matchmaking (6.1) |
| `33ef864` | Applicant card controls; proposal setup card reworded (6.2) |
| `0c1f657` | Phone polish: 44 px tap targets, overflow fixes, search in the phone menu (6.3) |
| `6bca36f` | Error monitoring: request ids, crash reporting, optional Sentry (6.4) |

---

## 15. Open items and next steps

**Needs you:** everything in the §12 checklist, most urgently the Supabase migrations 0005 and 0006.

**Phase 5 (admin controls)**, full plan in `work.md` §11:
- ~~5.1 withdrawal notifications~~ and ~~5.2 withdrawal limits~~: done 2026-10-30
- ~~5.3 audit-log viewer~~: done 2026-10-30
- ~~5.4 users directory sorting and pagination~~: done 2026-10-30
- ~~5.5 debit adjustments~~: done 2026-10-30
- ~~5.6 admin card controls~~: done 2026-10-30
- ~~5.7 profile photos (the admin's own, and users' from the inspector)~~: done 2026-10-30

**Phase 6 (finish and harden)**, full plan in `work.md` §12:
- ~~6.1 grant matchmaking (rule-based)~~: done 2026-10-30
- ~~6.2 card controls for applicants~~: done 2026-10-31
- ~~6.3 mobile polish~~: done 2026-10-31 (every screen audited at 390 px: 44 px tap targets, no overflow, search in the phone menu)
- ~~6.4 error monitoring~~: done 2026-10-31 (own logs with request ids; optional Sentry via `SENTRY_DSN`)
- **6.5 deployment runbook**: written 2026-10-31 ([`docs/DEPLOY.md`](DEPLOY.md): PM2 + nginx + HTTPS, `deploy.sh` with migrations and rollback, backups); done when followed once end to end on the VPS
- 6.6 persistent upload storage and virus scanning (ClamAV, tested with the EICAR file)
- 6.7 a Redis-backed rate limiter, only if there's more than one API server

**Limits worth knowing:**
- The API can't sign anyone in by itself if Supabase is down; requests answer 503 until it's back.
- Grants, balances and cards are sample data; nothing moves real money.
- Card activation requests have no admin queue yet: they show in the user inspector and recent activity only.
- Uploads live on one server's disk and aren't virus-scanned yet (6.6); rate limits are in memory, fine for one server (6.7).
