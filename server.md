# GrantApp deployment tracker (server.md)

_Deployment only. Last updated 2026-11-06._

- **Exact commands:** [`docs/DEPLOY.md`](docs/DEPLOY.md).
- **This file:** the record of what's decided, done, not done yet and still to do.
- **Secret values:** only in the git-ignored `secrets.local.md` and on the server in `/etc/futurenestfund/`. Never here.

---

## 1. Goal

Run GrantApp on the EU VPS at **https://access.futurenestfund.org**, so the admin and applicants can sign in for real, on Supabase project `futurenestfund` (ref `fybslfcepjnswcnoewgi`, EU).

Replit stays the development environment. It isn't the production host: its dev servers stop, and it only serves a temporary preview address.

## 2. Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-31 | Deploy on the existing VPS `77.68.98.14` | The EU server already used for three other apps |
| 2026-10-31 | **PM2**, not Docker | Already used on the server, nothing extra to run in 1.8 GB of memory, same pattern as the other apps (comparison table in `docs/DEPLOY.md`) |
| 2026-10-31 | GrantApp gets its **own** Node 24, PM2 daemon, system user (`futurenestfund`) and boot service | Root's PM2 runs noveriqgroups and akkayalar; a second install or `pm2 startup` as root could break them |
| 2026-10-31 | Address **`access.futurenestfund.org`** | `futurenestfund.org` is the organisation's live WordPress site (Cloudflare DNS, hosted elsewhere) and must not change; matches the `access.` names of the other apps |
| 2026-10-31 | Cloudflare record **DNS only** (grey cloud) | certbot works directly; the API sees visitors' real IP addresses for its rate limits (`TRUST_PROXY=1`) |
| 2026-10-31 | Code comes from the **private GitHub repo `macwuche/futurenestfund`**, branch **`user-side-redesign`**, with a read-only deploy key | Same as the other apps. The Replit Git pane's sync pushes that branch, so no separate `main` to keep in step. Updates are `deploy.sh` (git + build) |
| 2026-10-31 | API listens on **127.0.0.1:3200** only | The firewall is off; only nginx should reach the API |
| 2026-10-29 | Supabase over the **session pooler** | The VPS has no IPv6; Supabase's direct address is IPv6-only |
| 2026-10-29 | The running app connects as **`app_api`**; the `postgres` owner is used only for migrations and backups | Least privilege; the owner URL never reaches the app |

## 3. The server (from the checks of 2026-10-10 to 2026-10-18)

| Item | Value |
|---|---|
| OS / size | Ubuntu 26.04.1, 1 vCPU, 1.8 GB RAM + 2 GB swap, 58 GB disk (51 GB free) |
| Network | IPv4 `77.68.98.14` only (no public IPv6) |
| Already installed | nginx, certbot (auto-renewal timer active), git |
| Not installed | Docker, psql/pg_dump, fail2ban, Redis |
| SSH | Key-only, root by key (password logins off) |
| Firewall | `ufw` **inactive** |

**Other apps on the server (don't touch):**

| App | Address | Runs as | Port |
|---|---|---|---|
| akkayalar | access.akkayalartransportation.online | root's PM2, `/opt/akkayalar-node` | 127.0.0.1:3010 |
| novabridgegrant | access.novabridgegrant.org | systemd `novabridgegrant-api`, user novabridgegrant | *:3100 |
| noveriqgroups | access.noveriqgroups.com | root's PM2, `/opt/noveriqgroups-node` (holds PM2 7.0.4) | 0.0.0.0:4001 |
| **GrantApp (new)** | **access.futurenestfund.org** | **own PM2 as user futurenestfund** | **127.0.0.1:3200** |

## 4. Done

| Date | What | Evidence |
|---|---|---|
| 2026-10-31 | Server inspected: apps, ports, PM2, nginx, certificates, users, env file names | Your three check rounds (summarised in §3) |
| 2026-10-31 | Domain checked | `futurenestfund.org` = WordPress behind Cloudflare (NS `weston`/`isabel.ns.cloudflare.com`); no `www`, no MX; `access.` doesn't exist yet |
| 2026-10-31 | Admin account works on Supabase | Sign-in as `admin@futurenestfund.org` accepted; email confirmed; role `admin` |
| 2026-10-31 | Git history checked before pushing to GitHub | No passwords, secret keys or database URLs in any commit (only the public publishable key) |
| 2026-10-31 | API can listen on one address (`HOST`) | Tested: `HOST=127.0.0.1` binds locally only |
| 2026-10-31 | Deployment files written (`deploy/`) and runbook (`docs/DEPLOY.md`) | Commit `dcc7ba9` |
| 2026-10-31 | Deployment tested here as far as possible | Clean clone without Replit settings: install, API build, web build with CSP. PM2 7.0.4 ran the API from the process file + env file, health 200, reload OK |

**Files in `deploy/` and where each goes:**

| File | Installed as |
|---|---|
| `deploy.sh` | run in place: `bash /var/www/futurenestfund/deploy/deploy.sh [commit]` |
| `ecosystem.config.cjs` | used in place by `deploy.sh` |
| `fnf-pm2` | `/usr/local/bin/fnf-pm2` |
| `pm2-futurenestfund.service` | `/etc/systemd/system/` |
| `nginx-futurenestfund.conf` | `/etc/nginx/sites-available/futurenestfund` (+ link in `sites-enabled`) |
| `api.env.example` | `/etc/futurenestfund/api.env` (filled in, root:futurenestfund 640) |
| `migrate.env.example` | `/etc/futurenestfund/migrate.env` (filled in, root 600) |
| `backup.sh` | run in place by cron |
| `cron-futurenestfund-backup` | `/etc/cron.d/futurenestfund-backup` |
| `logrotate-futurenestfund` | `/etc/logrotate.d/futurenestfund` |

## 5. To do: the deployment steps

Status: ☐ not started · ◐ in progress · ☑ done. "Who": **you** = in a dashboard or on the server over SSH; **Claude** = here in Replit.

| # | Step | Who | Status | Done when |
|---|---|---|---|---|
| 1a | Cloudflare: `A` record `access` → `77.68.98.14`, **DNS only** | you | ☑ 2026-10-31 (DNS only; Google and Cloudflare resolvers return `77.68.98.14`, no AAAA) | `getent hosts access.futurenestfund.org` on the server prints `77.68.98.14` |
| 1b | GitHub: private repo `macwuche/futurenestfund`, connected to Replit | you | ☑ 2026-10-31 | `origin` = `https://github.com/macwuche/futurenestfund` |
| 1c | Code on GitHub, branch `user-side-redesign` (Replit Git pane → Sync) | you | ☑ 2026-10-31 | GitHub had `e44c98d`; re-sync after each new commit |
| 2 | User `futurenestfund`, folders, Node 24.22.1 (checksum verified), pnpm 10.26.1, PM2 7.0.4 in `/opt/futurenestfund-node` | you | ☑ 2026-10-31 (checksum OK; user uid 994; uploads folder 700) | `node -v` = v24.22.1, `pnpm -v` = 10.26.1 |
| 3 | Deploy key (read-only) on GitHub; SSH alias `github.com-futurenestfund`; clone to `/var/www/futurenestfund` | you | ☑ 2026-10-31 (key `SHA256:GW9gKgeh…`, no write access; cloned at `68c648a`) | Clone succeeds |
| 4 | Fill in `/etc/futurenestfund/api.env` and `migrate.env` from `secrets.local.md`; set permissions | you | ☑ 2026-10-31 (no `REPLACE` left except the 3 commented lines; 640 root:futurenestfund / 600 root) | Files exist with 640 / 600 |
| 5 | Install `fnf-pm2`; first `deploy.sh`: build, **database migrations 0003–0006 on Supabase**, start API | you | ☑ 2026-10-31 (`093d2d3`; app migrations 4 applied / 7 recorded, Supabase `0003_admin_profiles` applied; health 200) | Prints `OK: <commit> is live` |
| 6 | Boot service `pm2-futurenestfund` enabled and running | you | ☑ 2026-10-31 (enabled; active since 13:25:39 UTC; `pm2 resurrect` restored `futurenestfund-api` online) | `systemctl status` active; `fnf-pm2 list` shows `futurenestfund-api` online |
| 7 | nginx site + `certbot --nginx -d access.futurenestfund.org` (redirect to HTTPS) | you | ☑ 2026-10-31 (certificate expires 2027-01-29; HTTPS healthz OK; HTTP → 301) | `https://access.futurenestfund.org/api/healthz` → `{"status":"ok"}` |
| 8a | Supabase → Auth → URL Configuration: Site URL `https://access.futurenestfund.org`, Redirect URL `https://access.futurenestfund.org/**` | you | ☑ 2026-10-31 (both saved; Site URL entered with a trailing `/`) | Saved |
| 8b | Admin signs in at `/admin` | you | ☑ 2026-10-31 | Admin dashboard loads |
| 8c | Applicant signs up (real inbox), confirms, signs in | you | ☑ 2026-10-31 (`/api/applicant/dashboard`, `/account`, `/kyc` → 200 in the API log; those routes only answer signed-in applicants; confirmation email from Supabase's built-in sender arrived) | Applicant dashboard loads |
| 8d | Admin → Settings → "Send test errors" | you | ☑ 2026-10-31 (server `240ee29f…` and browser `a746d44f…` both in `fnf-pm2 logs`) | Both references found in `fnf-pm2 logs` |
| 9 | `postgresql-client` (pg_dump ≥ 17), log rotation, nightly backup cron, one manual backup | you | ☑ 2026-10-31 (pg_dump 18.6; `db-20261031-1503.dump` 32K + `uploads-20261031-1503.tar.gz`) | Files in `/var/backups/futurenestfund` |
| 10 | Email, all in **Admin → Settings → Email** (since 2026-11-01 the API creates its own encryption key file, `/var/lib/futurenestfund/settings.key`; nothing to add to `api.env`; deployed in d9f2edc, file present): Resend API key, sender (records already exist for **`mail.futurenestfund.org`**, so use e.g. `no-reply@mail.futurenestfund.org`), support address, signature, test email; Supabase Send Email Hook → the URL shown there, secret saved there (steps in `docs/DEPLOY.md`) | you | ☐ | All email health checks green; a password-reset email arrives from Resend |
| 11 | Optional: virus scanning: check `free -m`; if there's room, `apt install clamav-daemon`, `CLAMAV_SOCKET` in `api.env`, restart; EICAR test (steps in `docs/DEPLOY.md`) | you | ☐ (decide on memory first, §8) | Settings → Monitoring says **Scanning**; an EICAR upload is refused |

Step 6.5 counts as **done** when steps 1–9 have been followed once end to end. Steps 10 and 11 can follow later.

## 6. Not done yet, outside the steps

| Item | Why it matters | When |
|---|---|---|
| **Rotate the secrets pasted in chat** (`postgres` database password, `app_api` database password, secret key, admin password; pasted 2026-10-28 and again 2026-10-31) | Anyone who sees the chat could use them | After step 8 works; then update `secrets.local.md` and `/etc/futurenestfund/*.env` |
| Delete the GitHub personal access token pasted in chat | Unused (the server pulls with its deploy key), but it gives access to the GitHub account, private repos included. Never in git: `secrets.local.md` is git-ignored and was never committed (re-checked 2026-10-31) | Any time |
| Supabase Auth: password minimum length 8 (today 6) | Weak passwords | Any time (dashboard) |
| Off-server copies of backups | Backups on the same server are lost with it | After step 9 |
| Optional: Sentry (EU) or GlitchTip, `SENTRY_DSN` in `api.env` | Errors reported outside the server log | Any time after step 8 |
| Replit Secrets (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL`) | Only for real sign-in on the Replit preview; the VPS doesn't need them | Optional |

## 6b. After deploying (in the admin area)

The app is live at `2ad3f00` (2026-11-06, 9.4 tier rules). These need you in the admin area, or applicants can't use the matching feature:

| What | Where | Until it's done |
|---|---|---|
| Create at least one grant plan | Admin → Grant Plans | "No grants are open right now" |
| Create and enable a Deposit and a Withdrawal method | Admin → Payment Gateway | No deposit or withdrawal requests |
| Switch card types on and set prices | Admin → Settings → Cards | "No cards are on sale right now" |
| Check the 40 starting industries | Admin → Settings → Industries | The starting list is used |
| After deploying branding: set the application name, colour and logo | Admin → Settings → Branding | The app is called "GrantApp" in navy; the admin side's accents turn navy too (they were lime) |
| Set each tier's limits and cards, and the Tier 2 / Tier 3 upgrade forms | Admin → Settings → Tiers | Every tier has the old platform-wide withdrawal limits, no top-up limits, every card; nobody can ask to move up |

**Next deploy (branding):** app migration **0013** (`demo_settings.branding`); no Supabase migration. It only adds a column, so rolling back works (older code shows "GrantApp" in navy / lime again).

9.4 is deployed (`2ad3f00`, migration 0012 and Supabase 0006 applied). Rolling back to `f39c238` works: the migrations only add, and older code ignores the tier rules and uses the old platform-wide limit columns again.

Memory readings: 1,028 MB available at rest on 2026-11-05 (before Phase 11); RAM 70.8% right after the Phase 11 build (earlier builds 47–57%). Check `free -m` again once it settles.

## 7. Server housekeeping (affects all apps: do separately, carefully)

These were found during the checks and **aren't part of GrantApp's deployment**:
- **Firewall off.** noveriqgroups listens on `0.0.0.0:4001`, so it's reachable without nginx. Enabling `ufw` (allow 22, 80, 443) would close that. Allow SSH first, or you lock yourself out.
- fail2ban isn't installed; SSH sees constant login attempts (key-only, so they fail).
- Package updates waiting (`apt upgrade`): 7 on 2026-10-18, **29** on 2026-10-31, 21 on 2026-11-05.
- **"System restart required"** shown at login on 2026-11-05 (a kernel or library update is waiting for a reboot). A reboot restarts all four apps; GrantApp comes back by itself through `pm2-futurenestfund.service`. Pick a quiet time.

## 8. Later (Phase 6, after go-live)

- **6.6 (code done 2026-11-01):** the API scans every upload through a ClamAV daemon when `CLAMAV_SOCKET` is set (off until then). Installing ClamAV is step 11 in `docs/DEPLOY.md`. **Decision for you:** the daemon needs ~1–1.2 GB of memory and this server has 1.8 GB for four apps, so either add memory first (4 GB is comfortable) or leave scanning off. Uploads are already on the server's own disk (`/var/lib/futurenestfund/uploads`), which survives deploys, and backed up nightly.
- ~~6.7~~ **9.2 shared rate limits (Redis)**: built and deployed 2026-11-05 (`a1072f6`), off on this server (one API server, no Redis). Turn on only with a second API server: DEPLOY step 12.

## 9. Updating and rolling back (after go-live)

- **Update:**
  1. Claude commits; you press **Sync** in Replit's Git pane (pushes `user-side-redesign`).
  2. On the server: `bash /var/www/futurenestfund/deploy/deploy.sh`.
- **Roll back:**
  1. `git -C /var/www/futurenestfund log --oneline -5`
  2. `bash /var/www/futurenestfund/deploy/deploy.sh <commit>`
  - Migrations only add tables and columns, so older code runs on top of them. One caveat since Phase 11: an account balance below $0 (from an application fee) or plan applications made since would be shown by older code without their plan details.
- **Status, logs, restarts:** see "Everyday operations" in `docs/DEPLOY.md`.

## 10. Log

| Date | Entry |
|---|---|
| 2026-10-31 | The Replit preview showed "Can't reach GrantApp" (502). Cause: the dev API workflow had been stopped by a test clean-up, and Replit Secrets lack the Supabase settings. Decided to deploy to the VPS instead. |
| 2026-10-31 | Decisions in §2 made; runbook and `deploy/` files written and tested (commit `dcc7ba9`). Waiting on step 1 (Cloudflare record, GitHub repo URL). |
| 2026-10-31 | Cloudflare `access` A record → `77.68.98.14` added but **Proxied**. Through the proxy it reached the VPS and showed akkayalar's "Navarro Shipping" page (no GrantApp nginx site yet). Asked to switch to DNS only. Zone also has `app.futurenestfund.org` → `15.204.46.232` (same host as WordPress) and Resend records on `mail.futurenestfund.org`. |
| 2026-10-31 | `access` record switched to DNS only: resolves to `77.68.98.14`; HTTP reaches the VPS's nginx (404 until step 7). **Step 1 complete.** |
| 2026-10-31 | GitHub repo `macwuche/futurenestfund` connected and synced from Replit's Git pane (branch `user-side-redesign`, `e44c98d`). Server deploys that branch; no `main` needed. A personal access token was pasted in chat; it isn't used and should be deleted on GitHub. |
| 2026-10-31 | **Step 2 complete:** user `futurenestfund` (uid 994), folders, Node v24.22.1 (sha256 OK), pnpm 10.26.1, PM2 7.0.4 in `/opt/futurenestfund-node`. npm's offer to upgrade itself to 12.x was not taken. |
| 2026-10-31 | **Step 3 complete:** deploy key `/root/.ssh/futurenestfund_deploy` (fingerprint `SHA256:GW9gKgehh9O47QfmgTtR1u/42MTTNpfgxgkJrtrnaZM`) added to the repo read-only; SSH alias `github.com-futurenestfund`; cloned to `/var/www/futurenestfund` at `68c648a` (later commits only change `server.md`). |
| 2026-10-31 | **Step 4 complete:** `/etc/futurenestfund/api.env` (640, root:futurenestfund) and `migrate.env` (600, root) filled in. The `postgres` and `app_api` database passwords were both pasted in chat while doing this; added to the rotation list in §6. |
| 2026-10-31 | **Step 5 complete:** first `deploy.sh` at `093d2d3`. Install 19 s, API and web builds OK. Migrations: app 0003–0006 applied (7 recorded), Supabase `0003_admin_profiles.sql` applied. PM2 7.0.4 daemon under `/home/futurenestfund/.pm2`; API online, `Server listening` on 127.0.0.1:3200 with `database: supabase`; `/api/healthz` 200; process list saved. The first health-check try ran before the API was up and printed a curl error, then succeeded; `deploy.sh` now keeps those early tries quiet. Email off until step 10 (expected warning). |
| 2026-10-31 | **Step 6 complete:** `pm2-futurenestfund.service` installed and enabled. The hand-started daemon was stopped with `fnf-pm2 kill`; systemd started it again with `pm2 resurrect` and `futurenestfund-api` came back online (110 MB; server RAM 46.5% in use). A typo in the `export PATH` line (`$PAT`) briefly broke the shell's PATH; fixed by setting PATH again, no effect on the server. |
| 2026-10-31 | **Step 7 (in progress):** nginx site installed and enabled; `nginx -t` OK, reloaded. Through nginx: `/api/healthz` → `{"status":"ok"}`, `/admin` → 200. First certbot run failed (typo `futurenestfunds.org`, NXDOMAIN; nothing changed). Second run: certificate for `access.futurenestfund.org` issued and deployed to the site, expires 2027-01-29, renewed by the existing timer. Waiting on the HTTPS and redirect check from outside. |
| 2026-10-31 | **Step 7 complete:** `https://access.futurenestfund.org/api/healthz` → `{"status":"ok"}`; `http://…/admin` → 301 to HTTPS; `nginx -t` still OK after certbot's edit. |
| 2026-10-31 | **Step 8a complete:** Supabase Auth → URL Configuration: Site URL `https://access.futurenestfund.org/`, Redirect URLs `https://access.futurenestfund.org/**` (the only entry). Confirmed from a dashboard screenshot. |
| 2026-10-31 | **Step 8b complete:** admin signed in at `https://access.futurenestfund.org/admin`; dashboard loads. |
| 2026-10-31 | **Steps 8c and 8d complete, step 8 done.** API log at 14:42–14:45 UTC: applicant routes (`/api/applicant/dashboard`, `/account`, `/kyc`, `/notifications`) → 200, so an applicant session works. "Send test errors": server error logged at level 50 with request id `240ee29f-33a8-4202-a679-c6b0b4d3a1bb` (500 returned, stack points to `routes/monitoring.ts`); browser error received via `/api/client-errors` (202) with id `a746d44f-bdf6-4ee8-b7d6-c88eaf6bc7bd`. Error log file empty (pino writes everything to the out log). Next: step 9 (backups). |
| 2026-10-31 | 8c detail: the applicant's confirmation email arrived from Supabase's built-in sender (no Resend yet), so the Site URL / Redirect URL setup works for email links. |
| 2026-10-31 | **Step 9 complete; steps 1–9 done, so Phase 6.5 is done.** `postgresql-client` 18 installed (`pg_dump` 18.6, ≥ 17 as Supabase needs). Logrotate file and nightly cron (02:30 UTC) installed. Manual `backup.sh`: `20261031-1503 ok, 40K`; `db-20261031-1503.dump` (32K) and `uploads-20261031-1503.tar.gz` (126 bytes: uploads folder still empty, nobody has uploaded a file yet), both 600 root. apt reported 29 packages not upgraded (housekeeping, §7). Remaining: step 10 (email) and the §6 items, starting with the secret rotation. |
| 2026-10-31 | Backup checked: `pg_restore --list` reads the dump (86 entries, from Postgres 17.11, gzip, starts with schema `public`, functions, `app_migrations`). `logrotate -d` dry run: no errors ("already rotated" on the first run is normal; real rotation starts with the daily run). |
| 2026-11-01 | **Deployed `a82a158`** (Phase 7 + 6.6) with `deploy.sh` from `093d2d3`. Builds OK; app migrations: 1 applied (**0007** email settings), 8 recorded; Supabase migrations all skipped (already applied). API reloaded, health OK. The two `curl: (7)` lines before `OK` were the old `deploy.sh` (from `093d2d3`, already running when the code was pulled) printing its early retries; the quiet version (`4a2882f`) is used from the next deploy. Host RAM read 76.6% right after the build (46.5% on 2026-10-31); re-check `free -m` at rest before deciding on ClamAV (step 11). Virus scanning stays off; email waits for step 10. |
| 2026-11-01 | Admin Settings → Email said keys couldn't be saved (`SETTINGS_ENCRYPTION_KEY` not set). Changed so the API creates its own master key file `/var/lib/futurenestfund/settings.key` (mode 600, outside the uploads folder, so not in the nightly backup) when the variable isn't set; the admin can now save the Resend key without server changes. Needs a `deploy.sh`. |
| 2026-11-01 | Deployed **d9f2edc** (no migrations: 0 applied, 8 recorded; health check OK). `/var/lib/futurenestfund/settings.key` created by the API: `-rw------- futurenestfund futurenestfund`, 45 bytes. |
| 2026-11-02 | Deployed **62ec3aa** (8.1: dashboard balance cards, eligible amount per tier and per user, "Level" → "Tier"). Builds OK; app migrations: 1 applied (**0008** eligible amounts), 9 recorded; Supabase migrations all skipped. API reloaded, health OK. RAM 53.8% right after the build. Next: set the tier amounts in Admin → Settings → Money (until then every dashboard shows $0.00). |
| 2026-11-05 | Deployed **dc386f9** (9.1 card activation queue, Phase 10 payment gateway, 9.3 fees / card types / card purchases; up from `62ec3aa`). Builds OK; app migrations: 2 applied (**0009** payment methods, **0010** fees and card types), 11 recorded; Supabase **0004_payment_methods** applied, 0001–0003 skipped. API reloaded, health OK, `futurenestfund-api` online (125 MB). `free -m` at rest: 1028 MB available of 1839, swap 547 MB used: too little for ClamAV (~1–1.2 GB), so step 11 stays off. Login banner: 21 updates, system restart required (§7). Next: create the deposit and withdrawal methods in Payment Gateway (until then applicants can't place requests), set card types and prices in Settings → Cards, tier amounts in Settings → Money. |
| 2026-11-05 | Deployed **a1072f6** (9.2 shared rate limits, optional; up from `dc386f9`). Builds OK; no migrations (0 applied, 11 recorded; Supabase all skipped). API reloaded, health OK. `RATE_LIMIT_REDIS_URL` not set, so limits stay in memory (one API server); Settings → Monitoring → Rate limits should read *This server*. RAM 56.6% right after the build. |
| 2026-11-05 | Deployed **1b2a4c0** (8.2: dashboard cards Account balance / Grant balance / Successful deposit, eligible amount removed, "deposit balance" renamed "account balance"; up from `a1072f6`). Builds OK; no migrations (0 applied, 11 recorded; Supabase all skipped). API reloaded, health OK, `futurenestfund-api` online. RAM 46.8% after the build. Login banner still says system restart required (§7). The tier amounts in Settings → Money are gone, so that step is no longer needed. |
| 2026-11-05 | Deployed **f39c238** (Phase 11: grant plans, industries, application fees; matchmaking and sample grants removed; up from `1b2a4c0`). Builds OK; app migrations: 1 applied (**0011** grant plans: `demo_industries` with 40 industries, `demo_grant_plans`, profile industry, application plan/answers/fee), 12 recorded; Supabase **0005_grant_plans** applied, 0001–0004 skipped. API reloaded, health OK. RAM 70.8% right after the build (higher than the 47–57% of earlier builds; check `free -m` once it settles). Next: create grant plans in Admin → Grant Plans (until then applicants see "No grants are open right now"). |
| 2026-11-06 | Deployed **2ad3f00** (9.4 tier rules: withdrawal and top-up limits and cards per tier, upgrade forms, Tier Upgrades queue; up from `f39c238`). Builds OK; app migrations: 1 applied (**0012** tier rules: `demo_tier_requests`, `demo_settings.tier_rules` with the platform-wide withdrawal limits copied into every tier), 13 recorded; Supabase **0006_tier_requests** applied, 0001–0005 skipped. API reloaded, health OK, `futurenestfund-api` online. RAM 59.5% right after the build. Next: Admin → Settings → Tiers (limits, cards, Tier 2 / Tier 3 upgrade forms). |
