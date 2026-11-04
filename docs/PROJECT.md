# GrantApp: project documentation

_Last updated 2026-11-01 · branch `user-side-redesign` · Phases 0–5 and 7 complete; Phase 6: 6.1–6.6 done (6.6 in code, ClamAV not installed on the server yet), 6.7 only with several servers · **live at https://access.futurenestfund.org** (`a82a158` deployed 2026-11-01)._

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
| 6 | Finish and harden: matchmaking, applicant card controls, phone polish, error monitoring | 6.1–6.5 done 2026-10-30/31; **6.5: deployed on the EU VPS at https://access.futurenestfund.org on 2026-10-31** ([`docs/DEPLOY.md`](DEPLOY.md), record in [`server.md`](../server.md)); **6.6 virus scanning of uploads: code done 2026-11-01**, off until ClamAV is installed on the server (DEPLOY step 11, memory decision); 6.7 shared rate limits (only with several servers) |
| 8 | User dashboard: balance cards, eligible amounts per tier and per user | 8.1 done 2026-11-02, deployed at `62ec3aa` (`work.md` §14) |
| 9 | Remaining backlog: card activation queue (9.1), shared rate limits (9.2, was 6.7), automatic fees (9.3), tier rules (9.4) | Planned 2026-11-04 (`work.md` §15); 9.3 and 9.4 wait for decisions |
| 10 | Payment gateway: admin-made deposit and withdrawal methods (logo, amount rule, custom fields, payment proof); withdrawals from the grant and/or deposit balance; optional approval note | Built and tested 2026-11-04 (`work.md` §16); not committed or deployed yet (migration 0009 + Supabase 0004) |
| 7 | UI overhaul: admin email settings + health checks, Settings rebuilt, one design system, admin layout, admin tables on phones, applicant fixes (review scored the UI 67/100) | Done: 7.1 on 2026-10-31, 7.2–7.7 on 2026-11-01 ([`work.md`](../work.md) §13 and the log after it) |

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
Menu in groups: **Overview** (Dashboard, My Applications (+ detail page), Milestones) · **Find funding** (Grant categories, Grant Search) · **Track** (Funding Tracker, Reports) · **Money** (Cards, Transactions, Withdrawals, Add funds) · Settings and Help Centre at the bottom. Phones keep the bottom tab bar and a New Application button on the dashboard.

- **Dashboard:**
  - three balance cards (Phase 8.1): **Eligible amount** ("Largest open award at Tier N", set by an admin per tier or per user), **Grant balance** (with the number of approved awards), **Successful deposit** (the deposit balance: approved deposits minus charges)
  - setup cards: grant matchmaking, first proposal (each is marked complete by the server: answers saved / an application submitted)
  - grant highlights
- **Applications:** create (with an optional PDF/Word proposal), list with filters, detail page.
  - The detail page has a status timeline and documents (attach up to 5, download, remove).
  - When changes are requested, the applicant can reply and resubmit (optionally with a revised amount).
  - Applications can be withdrawn.
- **Money:**
  - deposit and withdrawal requests go through a **payment method** the admin created (Phase 10): the applicant picks a method (logo, name, amount rule), reads its instructions, enters an amount within its minimum/maximum or picks one of its fixed amounts, fills in its fields (e.g. wallet address, network, account number) and, for deposits when the method asks for it, attaches a **payment proof** (image or PDF, virus-scanned, stored with the request in one transaction)
  - checked server-side: the method's rules, 2 decimals, $0.01 to $1M, freezes, KYC rules, withdrawal limits (the stricter of the method and the limits wins), and withdrawals can't exceed the available amount of the chosen balance
  - withdrawals come from the **grant balance**, the **deposit balance**, or either (the applicant chooses), as the admin set for that user; the default is grant only
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
  - Grant categories: "Your top matches" (top 3 with reasons), "Edit answers", and one tile per category (grants, largest amount, next deadline, how many recommended) that opens Grant Search filtered to it (`/grant-search?category=…`); grant cards (with % match and "Why this match") are in Grant Search only
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
- **Deposit / Withdrawal queues:** approve (with an optional note shown to the applicant) or decline (decline needs a reason). Each request shows its method, the applicant's answers, the payment proof (preview / download) and, for withdrawals, the balance it's paid from. Freezes, balances, KYC and the user's open withdrawal balances are re-checked at approval time. A pending withdrawal above the user's current limit is flagged.
- **Payment Gateway** (menu group → Deposit / Withdrawal, `/admin/payment-gateway/deposit|withdrawal`): create, edit, enable / disable, reorder and delete methods. A method has a logo (uploaded, or downloaded once from an `https://` link with private / internal addresses refused, re-encoded to WebP), a name (unique per kind), an amount rule (minimum and maximum, either optional, or up to 10 fixed amounts), instructions, up to 20 fields (short / long text, number, email, phone, date, dropdown; required or optional; placeholder and help) and, for deposits, payment proof required / optional / off. A live preview shows the applicant's form. Requests keep a copy of the method as it was, so edits never change them; a used method can only be disabled. Every change is audited.
- **Withdraw from** (inspector → Limits): grant balance / deposit balance / both, per user; audited, the user is notified. A debit can't eat into what pending withdrawals from that balance hold.
- **Eligible amount:** one amount per tier in Settings → Money, and an optional custom amount per user (inspector → Limits) that replaces it; shown on the applicant's dashboard only (it doesn't limit requests yet). Per-user changes are audited and notify the applicant.
- **Withdrawal limits:** a global max per request and daily total (last 24 h, under review + approved) in Settings, and optional custom limits per user that replace them. Enforced when the applicant places a request.
- **Transactions:** the full ledger with filters, search, pagination, totals and **CSV export** (spreadsheet-formula injection neutralised).
- **KYC:** a document queue with previews; approve or reject (with a reason). The verification level is recomputed.
- **Settings** (`/admin/settings/<section>`, side menu on desktop, tabs on phones):
  - **General:** global freeze (with a confirmation and a reason) and the security rules
  - **Email:** Resend key, sender, signature, health checks, test email (§7)
  - **Money** (`/admin/settings/limits`): the platform-wide withdrawal limits and the **eligible amount per tier**
  - **Monitoring:** where errors go (server log, plus Sentry when configured), a "Send test errors" button that raises one server and one browser error and shows their references, and **upload virus scanning** status (Scanning / Not answering / Off, with the ClamAV version)
  - **Audit log:** a link to the full log
  - **Your account:** the admin's own profile photo (shown in the sidebar and as the header avatar, which links here) and **Sign-in & security**
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
  - **Virus scanning** (6.6, `lib/virusScan.ts`): with `CLAMAV_SOCKET` (or `CLAMAV_HOST`) set, every upload is streamed to a ClamAV daemon first, before the type check or any decoder. A flagged file is refused ("didn't pass the virus scan") and logged with its signature; nothing is written. While the scanner is down, uploads answer 503 "try again" (fail closed; `CLAMAV_FAIL_OPEN=1` accepts them unscanned instead). Off until ClamAV is installed on the server.
- **Email** for everything (sign-in emails and notifications) through Resend. This is built and tested, but waiting for go-live settings (§12).
- **Error monitoring:** every response carries a random `X-Request-Id`, also on every log line.
  - A server error shows the user only "contact support with reference `1a2b3c4d`" (the first 8 characters of the request id); the details go to the log.
  - Browser crashes (uncaught errors, failed promises, the "Something went wrong" screen) are reported to the API, even when signed out, and the crash screen shows a reference too.
  - With `SENTRY_DSN` set, errors also go to Sentry (EU region) or GlitchTip, without the user, cookies, headers, IP or query strings, and with emails, tokens, secrets and long numbers removed from messages.
- **Phones:** every page was audited at 390 px: 44 px tap targets, no sideways scrolling, bell, menu and search reachable. The admin header is one 64 px row (search opens from an icon); the ledger and request decisions become cards.
- **Look:** one typeface (Inter) on both sides; amounts in tabular figures; the admin side keeps its black / lime colours.

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

Dashboard settings (see §12): Site URL and Redirect URLs are set to `https://access.futurenestfund.org` (2026-10-31); still to do: minimum password length (6 today, should be 8) and the Send Email hook.

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
| `demo_requests` | Deposit / withdrawal requests (method, copy of the method, answers, proof file, balance paid from) |
| `demo_payment_methods` | Deposit and withdrawal methods (Payment Gateway) |
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
| `lib/db/migrations/0008_eligible_amounts.sql` | `demo_settings.tier1/2/3_eligible_cents`; `demo_profiles.eligible_custom`, `eligible_cents` (eligible amount per tier and per user) |
| `lib/db/migrations/0009_payment_methods.sql` | `demo_payment_methods`; `demo_requests.source`, `method_id`, `method_snapshot`, `field_values`, `proof_file_id` (old withdrawals backfilled to `grant`); `demo_profiles.withdrawal_sources` |
| `lib/db/migrations/0007_email_settings.sql` | `demo_settings.email_config`, `email_secrets`, `email_hook_seen_at`, `email_hook_result`; `demo_notifications.email_last_error` |
| `lib/db/supabase/migrations/0001_user_roles.sql` | `user_roles` (Supabase only) |
| `lib/db/supabase/migrations/0002_app_api_role.sql` | `app_api` role, grants, `app_api_all` policies, revoked Data API grants |
| `lib/db/supabase/migrations/0003_admin_profiles.sql` | `app_api_all` policy for `demo_admin_profiles`; no Data API grants |
| `lib/db/supabase/migrations/0004_payment_methods.sql` | `app_api_all` policy for `demo_payment_methods`; no Data API grants |

Changing the schema: edit `lib/db/src/schema` → `pnpm --filter @workspace/db run generate` → review the new SQL → `pnpm --filter @workspace/scripts run db:migrate`. A new table also needs an `app_api_all` policy in a new Supabase migration. Both existing databases were "baselined" once on 2026-10-29 (`db:migrate -- --baseline`), because they had been built with `drizzle-kit push`.

---

## 7. Email

All email goes through **Resend** (`lib/email.ts`). Email is off until there's an API key and a sender address.

**Admin → Settings → Email** (`lib/emailSettings.ts`, `components/email-settings.tsx`, Phase 7.1) is where it's set up, with no SSH or restart:
- **Resend API key** and **Send Email Hook secret**: write-only. Each is encrypted (AES-256-GCM, field-bound) with a master key that never goes into the database before it's stored in `demo_settings.email_secrets`; the browser only ever gets a hint like `re_••••abcd`. The master key is `SETTINGS_ENCRYPTION_KEY` when set, otherwise a key file the API creates itself on first start (`settings.key` next to `UPLOAD_DIR`, mode 600; on the VPS `/var/lib/futurenestfund/settings.key`, not in the nightly backup; `SETTINGS_KEY_FILE` overrides the place), so the admin can save the Resend key with nothing done on the server (2026-11-01). Losing the key file means entering the secrets again.
- **Sender name and address, reply-to, support address, signature** (plain text, up to 600 characters / 10 lines, added to every email; the support address goes in every footer and the Help Centre, via `GET /api/auth/config`).
- **Precedence:** a value saved in Settings wins over `RESEND_API_KEY` / `EMAIL_FROM` / `EMAIL_REPLY_TO` / `SUPPORT_EMAIL` / `SEND_EMAIL_HOOK_SECRET`; removing it falls back to the environment. The page shows where each value comes from. Saving applies at once; other processes re-read every minute.
- **Health checks:** Resend accepts the key (sending-only keys recognised); the sender's domain is on the account and verified, with its DNS records; `APP_URL` set; when Supabase last called the hook and how it ended; outbox: waiting, retrying, gave up in 7 days, last error (`demo_notifications.email_last_error`). **Send test email** to any address.
- Every change is audited without the secret values.

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
| Virus scanning of uploads through ClamAV (clamd INSTREAM), fail closed, off until `CLAMAV_SOCKET` is set | `api-server/src/lib/virusScan.ts` |
| Email: signed webhook, HTML escaping, enumeration-safe sign-up and reset screens | §7 |
| Password changes and resets end other sessions | `security.tsx`, `auth.tsx` |
| CSV export neutralises spreadsheet formulas | `adminOps.ts` |
| Error monitoring: a random request id on every response and log line; 500s show only a short reference; browser crashes reported to `/api/client-errors` (no sign-in, 20/min per IP, 1 kB message / 8 kB stack caps); optional Sentry forwarding via the envelope API with no user, cookies, headers, IP or query strings, and emails / long numbers / tokens scrubbed | `api-server/src/lib/monitoring.ts`, `grant-platform/src/lib/monitoring.ts` |

Known limits:
- Rate limits are per process.
- Uploads live on the VPS's own disk (`/var/lib/futurenestfund/uploads`): survives deploys, backed up nightly, but only on that one server.
- PDF/DOCX checks are structural; virus scanning only runs once ClamAV is installed on the server (DEPLOY step 11).
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
| `SETTINGS_ENCRYPTION_KEY` | no | 32 random bytes, base64 (`openssl rand -base64 32`) | **Secret.** Optional master key for the email secrets saved in Admin Settings. Unset: the API creates and uses its own key file (see `SETTINGS_KEY_FILE`) |
| `SETTINGS_KEY_FILE` | no | default `settings.key` next to `UPLOAD_DIR` (VPS: `/var/lib/futurenestfund/settings.key`) | Where the API keeps its self-created master key (mode 600). Losing it means entering the email secrets again |
| `RESEND_API_KEY` | optional | from Resend | **Secret.** Fallback; Admin Settings → Email wins |
| `EMAIL_FROM` | optional | `Future Nest Fund <no-reply@mail.futurenestfund.org>` | Fallback; domain verified in Resend |
| `EMAIL_REPLY_TO`, `SUPPORT_EMAIL` | optional | addresses | Fallbacks for the reply-to and support address |
| `APP_URL` | for email | public web address: `https://access.futurenestfund.org` | Email links and notification buttons |
| `SEND_EMAIL_HOOK_SECRET` | optional | `v1,whsec_…` from Supabase | **Secret.** Fallback; Admin Settings → Email wins |
| `TRUST_PROXY` | VPS | `1` | Number of proxies in front (nginx), for real client IPs and `req.secure` |
| `UPLOAD_DIR` | no | default `artifacts/api-server/uploads/`; VPS: `/var/lib/futurenestfund/uploads` | Must be persistent disk |
| `RATE_LIMIT_IP_PER_MIN`, `RATE_LIMIT_WRITES_PER_MIN`, `RATE_LIMIT_UPLOADS_PER_10MIN`, `RATE_LIMIT_HOOK_PER_MIN`, `RATE_LIMIT_CLIENT_ERRORS_PER_MIN` | no | defaults 600 / 60 / 20 / 120 / 20 | |
| `SENTRY_DSN` | no | e.g. `https://<key>@o<org>.ingest.de.sentry.io/<project>` (EU region), or a GlitchTip DSN | **Secret-ish** (lets anyone send events). Unset → errors go to the log only |
| `SENTRY_ENVIRONMENT` | no | default `NODE_ENV` | e.g. `production`, `staging` |
| `APP_RELEASE` | no | e.g. the git commit | Tags each error report with the release |
| `CLAMAV_SOCKET` | no | `/var/run/clamav/clamd.ctl` | Turns on virus scanning of uploads (clamd's local socket) |
| `CLAMAV_HOST`, `CLAMAV_PORT` | no | e.g. `127.0.0.1`, `3310` | clamd over TCP instead of a socket |
| `CLAMAV_FAIL_OPEN` | no | `1` | Accept uploads unscanned while clamd is down (default: refuse with 503) |
| `CLAMAV_TIMEOUT_MS` | no | default `30000` | |
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
| `pnpm test` | Vitest unit tests (101) |
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

**Committed:** `pnpm test`, 101 Vitest tests.
- Token verification: valid, expired, other project, wrong audience, anonymous, forged key, tampered payload, `alg: none`, HS256 algorithm confusion, key server down/timeout → 503.
- Standard Webhooks signatures.
- Email link mapping (including the reversed email-change fields) and HTML escaping.
- Rate limiter.
- `safeNext`.
- Error wording.
- Matchmaking rules (scores, reasons, closed and not-eligible grants).
- Error monitoring: scrubbing (emails, tokens, secrets, long numbers), DSN and stack parsing, the exact fields sent to Sentry, the React component stack.
- Email settings: secret encryption (round trip, tampering, wrong field or master key; the self-created key file: made once with mode 600, never overwritten, broken or unwritable file reported), signature and support address escaped in every template, From parsing.
- Payment methods: what a method may contain (names, amounts, fixed amounts, fields, proof), amount rules, answers per field type; logo links (https only, private / loopback / mapped addresses refused before connecting); money emails with method, balance and approval note.
- Virus scanning: off without settings, chunked INSTREAM, the EICAR test string refused with its signature, fail closed / fail open, scanner errors and timeouts, status for Settings.

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
| `phase7-email` (+ `-ui`) | Email settings: validation, secrets never returned / stored plain / logged / audited, precedence, every health state (pending or missing domain, sending-only or refused key, hook calls, outbox failures, undecryptable secret), test email, removal (11; 9 + 9) |
| `phase10-methods`, `phase10-ui` | Payment Gateway: methods, logos (upload and link), requests through a method (amounts, fields, proof, no orphan files), copies kept, queue details, approval note, withdrawal sources, limits on top, concurrency (18); admin menu, method form, applicant deposit / withdrawal, queue, inspector (11 + 11). Older suites place requests through a plain test method (`.unlazy/methods.mjs`) |
| `phase6-mobile` | Phone audit at 390 px of every page, menu, panel, main dialogs and the sign-in pages: zoom-out, overflow, boxes sticking out, 44 px targets, bell / menu / search reachable; full-page screenshots with `SHOTS=` (35). Sign-in pages need `AUTH_WEB`: a proxy to a signed-out Supabase-mode API |

Full run on 2026-10-29: all green on the dev frontend, on the **production build with its CSP**, and **on Supabase as `app_api`**.

Latest run (2026-11-01, after Phase 7 and 6.6, demo mode): typecheck clean, `pnpm test` 80/80, every suite touched by Phase 7 and 6.6 green, including the new `phase6-virus` (6/6, against `.unlazy/mock-clamd.mjs`) and the phone audit `phase6-mobile` (39/39, 0 problems); counts per step in `work.md`. Before that (2026-10-31, after 6.4): `pnpm test` 67/67, every API suite from Phases 3, 5 and 6 and every browser suite from Phases 1–6 green (counts in `work.md` §12). `phase4-ui` and `phase4-security` weren't re-run: they need the Supabase secret key and create throwaway users.

---

## 12. Deployment and go-live checklist

**Supabase dashboard**
- [x] Authentication → URL Configuration: **Site URL** `https://access.futurenestfund.org/`, **Redirect URLs** `https://access.futurenestfund.org/**` (2026-10-31). Add the Replit dev URL only if you test sign-in there.
- [ ] Authentication → Policies (passwords): **minimum length 8** (today 6).
- [ ] Authentication → Hooks → **Send Email** → HTTPS → the URL shown in Admin → Settings → Email; generate the secret and save it there as Hook secret.

**Resend**
- [ ] Add and verify the sending domain (e.g. `futurenestfund.org`, using the DNS records Resend lists); create an API key.

**Secrets (Replit and VPS)**
- [x] VPS: `/etc/futurenestfund/api.env` (`app_api` URL, Supabase URL and keys, `APP_URL`, `TRUST_PROXY=1`, `NODE_ENV=production`) and `migrate.env` (`SUPABASE_ADMIN_DB_URL`), 2026-10-31.
- [ ] Step 10: the Resend key, sender and hook secret go in Admin → Settings → Email (no server change needed since 2026-11-01: the API creates its own encryption key file).
- [x] App migration **0007** (email settings) applied on Supabase by `deploy.sh` at `a82a158` (2026-11-01).
- [ ] Replit Secrets: optional, only for real sign-in on the Replit preview.

**Rotate (pasted in chat on 2026-10-28 and 2026-10-31; never in git, a precaution)**
- [ ] Delete the GitHub personal access token (unused; the server uses its read-only deploy key).
- [ ] `postgres` database password (Supabase → Database settings), then update `SUPABASE_ADMIN_DB_URL` in `secrets.local.md` and `/etc/futurenestfund/migrate.env`.
- [ ] `app_api` database password, then update `SUPABASE_DB_URL` in `api.env` and restart the API.
- [ ] Secret key (Supabase → API keys), then update `SUPABASE_SECRET_KEY` in `api.env` and restart.
- [ ] Admin password (change it in the app's Settings, or set `ADMIN_SEED_PASSWORD` and run `seed:admin -- --reset-password`).

**VPS** (follow [`docs/DEPLOY.md`](DEPLOY.md); address `https://access.futurenestfund.org`, since `futurenestfund.org` is the WordPress site)
- [x] Cloudflare: `A access → 77.68.98.14`, DNS only; private GitHub repo with a read-only deploy key.
- [x] nginx + Let's Encrypt in front (certificate to 2027-01-29, auto-renewed), API under its own PM2 (user `futurenestfund`, port 3200, 127.0.0.1 only), boot service, uploads in `/var/lib/futurenestfund/uploads`.
- [x] `db:migrate` runs on every `deploy.sh` before the API starts.
- [x] Nightly backups (02:30 UTC, 14 days, `pg_dump` 18.6) and log rotation; first backup checked with `pg_restore --list`.
- [ ] Copy backups off the server now and then.
- [ ] Optional, step 11: ClamAV for upload virus scanning, only with ~1.5 GB of memory free (`free -m`); then `CLAMAV_SOCKET` in `api.env` and the EICAR test.

**Supabase migrations**
- [x] App migrations 0003–0006 (incl. **0005** admin profile photos and **0006** matchmaking answers) and Supabase `0003_admin_profiles` applied by the first `deploy.sh` (2026-10-31).

**Error monitoring (optional)**
- [ ] Create a Sentry project in the **EU (Frankfurt) region**, or run GlitchTip on the VPS; set `SENTRY_DSN` (and `APP_RELEASE` to the deployed commit) on the server.
- [x] Admin Settings → Error monitoring → **Send test errors**: both references in the server log (2026-10-31).
- [x] After go-live: one real sign-up (confirmation email arrived from Supabase's own sender, applicant dashboard loads, 2026-10-31).
- [ ] After step 10: one password reset to an inbox you control; check the response times from the VPS.

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
| 2026-11-04 | **Payment Gateway**: admins create the deposit and withdrawal methods; every request uses one (the plain amount-and-note form is gone). Fields ask the applicant for details; fixed-amount methods offer several amounts; payment proof is set per method. Withdrawals can come from the grant balance, the deposit balance or both, set per user by an admin. The method limits and the withdrawal limits both apply. Approvals take an optional note; declines still need a reason |
| 2026-11-02 | The applicant's level is called **Tier** (1–3) everywhere, on both sides; the **eligible amount** is set by an admin per tier, with an optional custom amount per user; Successful deposit = the deposit balance (approved deposits minus charges) |

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
| `dcc7ba9` | Deployment runbook and `deploy/` files: PM2, nginx, HTTPS, backups (6.5) |
| `e44c98d` … `74350c3` | `server.md` deployment record: steps 1–9 followed on the VPS, live at `access.futurenestfund.org` (6.5) |
| `3b62c4c` | Email settings and health checks in Admin Settings (7.1) |
| `f2891d7` | Admin Settings in sections; 4-Eyes wording removed (7.2) |
| `6f44fba` | Design-system pass: one typeface, tabular amounts, avatars, wording, charts animate once (7.3) |
| `0f339ec` | Admin layout: 64 px header, phone search icon, KPIs, inspector section menu (7.4) |
| `cb909d4` | Admin ledger and decisions as cards on phones (7.5) |
| `02bdf27` | Applicant fixes: grouped menu, category overview, rows, cards, money steps (7.6) |
| `2bf48ad` | Applicant phone: New Application, compact grant cards, folding filters (7.7) |

---

## 15. Open items and next steps

**Needs you** (Phase 7 + 6.6 deployed 2026-11-01 at `a82a158`): the open §12 items: rotate the secrets pasted in chat, email through Resend (step 10 in `docs/DEPLOY.md`), minimum password length 8, off-server backup copies; and the ClamAV memory decision (step 11). Shared-server housekeeping (firewall, fail2ban, 29 package updates) is listed in `server.md` §7.

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
- ~~6.5 deployment~~: done 2026-10-31 (runbook [`docs/DEPLOY.md`](DEPLOY.md) followed end to end; live at https://access.futurenestfund.org; record in [`server.md`](../server.md))
- ~~6.6 virus scanning of uploads~~: code done 2026-11-01 (ClamAV through `CLAMAV_SOCKET`, fail closed, tested with the EICAR string against a stand-in). **Needs you:** install ClamAV on the server (DEPLOY step 11) once there's memory for it (~1–1.2 GB; the server has 1.8 GB for four apps).
- 6.7 a Redis-backed rate limiter, only if there's more than one API server

**Phase 7 (UI overhaul)**, full review and plan in `work.md` §13:
- ~~7.1 email settings and health checks in Admin Settings~~: done 2026-10-31 (since 2026-11-01 the API creates its own encryption key, so keys can be saved there with no server change)
- ~~7.2 Settings in sections · 7.3 design system · 7.4 admin layout · 7.5 admin tables on phones · 7.6 applicant fixes · 7.7 applicant phone~~: done 2026-11-01. Not done as planned: no new shared `Button`/`Card` React components (the shared class tokens stayed the single source), and Grant Search on phones is 38% shorter rather than half.

**Limits worth knowing:**
- The API can't sign anyone in by itself if Supabase is down; requests answer 503 until it's back.
- Grants, balances and cards are sample data; nothing moves real money.
- A deposit is still a declaration checked by an admin against the proof: no payment processor is connected.
- Card activation requests have no admin queue yet: they show in the user inspector and recent activity only.
- Uploads live on one server's disk (backed up nightly on that same server) and are virus-scanned only once ClamAV is installed (6.6); rate limits are in memory, fine for one server (6.7).
