# GrantApp: deployment runbook (EU VPS)

_Written 2026-10-31 (Phase 6.5). Server `77.68.98.14`, Ubuntu 26.04, 1 vCPU, 1.8 GB RAM + 2 GB swap. Address **https://access.futurenestfund.org**._

`futurenestfund.org` itself is the organisation's WordPress website, hosted elsewhere. **Don't change its DNS records.** The app gets its own subdomain, like the other apps on this server (`access.novabridgegrant.org`, `access.noveriqgroups.com`).

Secret values are in the git-ignored `secrets.local.md`, never in this file. Progress (what's done, what's left) is tracked in [`server.md`](../server.md).

---

## What runs where

```
Browser ──HTTPS──▶ nginx :443 (access.futurenestfund.org, Let's Encrypt)
                     ├─ /api/*  ──▶ API on 127.0.0.1:3200   (PM2 "futurenestfund-api", user futurenestfund)
                     └─ /*      ──▶ static web build        (/var/www/futurenestfund-web/current)
API ──▶ Supabase EU (Auth + Postgres via the session pooler, as app_api)
```

| Thing | Where |
|---|---|
| Code (git checkout, owned by root) | `/var/www/futurenestfund` |
| Web builds (last 5 kept; `current` is a symlink) | `/var/www/futurenestfund-web/releases/<commit>` |
| Node 24, pnpm, PM2 for this app only | `/opt/futurenestfund-node` |
| App settings (root:futurenestfund, 640) | `/etc/futurenestfund/api.env` |
| Database owner URL for migrations/backups (root, 600) | `/etc/futurenestfund/migrate.env` |
| Uploaded files (futurenestfund, 700) | `/var/lib/futurenestfund/uploads` |
| PM2 home and logs | `/home/futurenestfund/.pm2` (logs in `logs/`) |
| Boot service | `pm2-futurenestfund.service` |
| nginx site | `/etc/nginx/sites-available/futurenestfund` |
| Backups (14 days) | `/var/backups/futurenestfund` |

### Rules for this shared server
- **Four apps share it.** Ports in use: 3010 (akkayalar), 3100 (novabridgegrant), 4001 (noveriqgroups). GrantApp uses **3200**.
- **Never run plain `pm2`, `pm2 startup` or `npm i -g pm2` as root.** Root's PM2 (in `/opt/noveriqgroups-node`) runs two other apps. GrantApp has its own PM2 daemon, user and Node, and is always driven through **`fnf-pm2`**.
- **Don't edit the other sites' nginx files.** Test with `nginx -t` before every `systemctl reload nginx`.

### PM2 or Docker on this server

| | PM2 (chosen) | Docker |
|---|---|---|
| Already on the server | Yes, PM2 7.0.4 runs two apps; we add a separate copy for GrantApp | Not installed |
| Memory (1.8 GB shared) | Nothing extra: just Node | Docker daemon (~100 MB+), plus image layers |
| Setup effort | Small: Node folder + process file | Dockerfile, image builds, volumes, networking with nginx |
| Matches the other apps | Yes (all use PM2/systemd + nginx) | No; a second way of running things to maintain |
| Restarts on crash / at boot | Yes (PM2 + systemd unit) | Yes (restart policy) |
| Logs | Files in `~/.pm2/logs`, rotated by logrotate | `docker logs`, needs its own rotation settings |
| Isolation from other apps | Own user, own Node, own PM2 daemon | Stronger: own filesystem and libraries |
| Same environment everywhere | Depends on the server's Node version (pinned to 24.22.1 here) | Identical image on any machine |
| Updates / rollback | `deploy.sh` (git + build); rollback = deploy an older commit | Rebuild/pull image; rollback = previous image tag |
| Firewall surprises | None | Published ports bypass ufw rules unless bound to 127.0.0.1 |

PM2 suits this small, shared server. Docker would be worth it with several servers, or a team that needs identical environments.

---

## First deployment, step by step

Run every server command as **root** over SSH. Paste one line at a time: long pasted lines have been wrapped and broken in this terminal before.

At the start of every SSH session:
```bash
export PATH=/opt/futurenestfund-node/bin:$PATH
```

### Step 1. DNS (Cloudflare) and code (GitHub)
1. **Cloudflare** → `futurenestfund.org` → DNS → **Add record**:
   - Type `A`, Name `access`, IPv4 `77.68.98.14`
   - Proxy status **DNS only** (grey cloud), so certbot works and the API sees visitors' real IP addresses for its rate limits
   - Don't add an AAAA record: the server has no IPv6.
2. **GitHub**: the private repository is `macwuche/futurenestfund`. The server deploys branch **`user-side-redesign`**, which the Replit Git pane's sync pushes.
3. Check DNS from the server; the command should print `77.68.98.14`:
   ```bash
   getent hosts access.futurenestfund.org
   ```

### Step 2. User, folders, Node 24, pnpm, PM2
```bash
useradd --system --create-home --home-dir /home/futurenestfund --shell /usr/sbin/nologin futurenestfund
mkdir -p /var/lib/futurenestfund/uploads /etc/futurenestfund /var/www/futurenestfund-web/releases /var/backups/futurenestfund
chown -R futurenestfund:futurenestfund /var/lib/futurenestfund
chmod 700 /var/lib/futurenestfund/uploads
cd /tmp
curl -fsSLO https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz
echo "6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6  node-v24.22.1-linux-x64.tar.xz" | sha256sum -c
mkdir -p /opt/futurenestfund-node
tar -xJf node-v24.22.1-linux-x64.tar.xz -C /opt/futurenestfund-node --strip-components=1
export PATH=/opt/futurenestfund-node/bin:$PATH
npm install -g pnpm@10.26.1 pm2@7.0.4
node -v; pnpm -v; ls -l /opt/futurenestfund-node/bin/pm2
```
Expected: `sha256sum` prints `OK`, then `v24.22.1`, `10.26.1`, and the `pm2` link. Node 24.22.1 and pnpm 10.26.1 are what the app is built and tested with.

### Step 3. Deploy key and code
```bash
ssh-keygen -t ed25519 -N "" -C "futurenestfund-vps" -f /root/.ssh/futurenestfund_deploy
cat /root/.ssh/futurenestfund_deploy.pub
```
GitHub → the repository → Settings → **Deploy keys** → Add: paste the line, leave **write access off**.

Then add the SSH host alias, the same pattern as the other apps:
```bash
printf '\nHost github.com-futurenestfund\n  HostName github.com\n  User git\n  IdentityFile /root/.ssh/futurenestfund_deploy\n  IdentitiesOnly yes\n' >> /root/.ssh/config
git clone git@github.com-futurenestfund:macwuche/futurenestfund.git /var/www/futurenestfund
```
Answer `yes` to GitHub's fingerprint the first time.

### Step 4. Settings files
```bash
cp /var/www/futurenestfund/deploy/api.env.example /etc/futurenestfund/api.env
cp /var/www/futurenestfund/deploy/migrate.env.example /etc/futurenestfund/migrate.env
nano /etc/futurenestfund/api.env
nano /etc/futurenestfund/migrate.env
chown root:futurenestfund /etc/futurenestfund/api.env
chmod 640 /etc/futurenestfund/api.env
chmod 600 /etc/futurenestfund/migrate.env
```
In nano, replace each `REPLACE…` with the value from `secrets.local.md`:
- `api.env`: the publishable key, and the **`app_api`** password inside `SUPABASE_DB_URL`
- `migrate.env`: the **`postgres`** database password inside `SUPABASE_ADMIN_DB_URL`

Leave the email and Sentry lines commented for now. Save with Ctrl+O, Enter; quit with Ctrl+X.

### Step 5. First build and start
```bash
cp /var/www/futurenestfund/deploy/fnf-pm2 /usr/local/bin/fnf-pm2
chmod 755 /usr/local/bin/fnf-pm2
bash /var/www/futurenestfund/deploy/deploy.sh
```
This takes a few minutes. It:
1. installs the locked packages
2. builds the API and the web app
3. **runs the pending database migrations on Supabase** (0003 to 0006)
4. starts the API under PM2
5. ends with `OK: <commit> is live`

If it prints `FAILED`, run `fnf-pm2 logs futurenestfund-api --lines 50` and send the output.

### Step 6. Start at boot
```bash
cp /var/www/futurenestfund/deploy/pm2-futurenestfund.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable pm2-futurenestfund
fnf-pm2 kill
systemctl start pm2-futurenestfund
systemctl status pm2-futurenestfund --no-pager | head -5
fnf-pm2 list
```
`fnf-pm2 kill` stops the daemon that step 5 started by hand, so that systemd owns it from now on. Expected: `active (running)`, and `futurenestfund-api` **online**.

### Step 7. nginx and HTTPS
```bash
cp /var/www/futurenestfund/deploy/nginx-futurenestfund.conf /etc/nginx/sites-available/futurenestfund
ln -s /etc/nginx/sites-available/futurenestfund /etc/nginx/sites-enabled/futurenestfund
nginx -t
systemctl reload nginx
curl -s -H 'Host: access.futurenestfund.org' http://127.0.0.1/api/healthz
certbot --nginx -d access.futurenestfund.org
```
Expected:
- `nginx -t` says `successful`.
- `curl` prints `{"status":"ok"}`.
- certbot says `Successfully deployed certificate`. If it asks about redirecting HTTP to HTTPS, choose **redirect**.

The existing `certbot.timer` renews the certificate automatically.

### Step 8. Supabase and first sign-ins
1. Supabase → Authentication → **URL Configuration**:
   - **Site URL**: `https://access.futurenestfund.org`
   - **Redirect URLs**: add `https://access.futurenestfund.org/**`
2. Open **https://access.futurenestfund.org/admin**: you should see the sign-in page, not "Can't reach GrantApp". Sign in as the admin.
3. In a private window, **sign up** as an applicant with an inbox you control.
   - Click the confirmation email. Until step 10, Supabase sends it itself, a few per hour at most.
   - Sign in.
4. Admin → Settings → **Send test errors**: both references should appear in `fnf-pm2 logs futurenestfund-api --lines 30`.

### Step 9. Backups and log rotation
```bash
apt install -y postgresql-client
pg_dump --version
cp /var/www/futurenestfund/deploy/logrotate-futurenestfund /etc/logrotate.d/futurenestfund
cp /var/www/futurenestfund/deploy/cron-futurenestfund-backup /etc/cron.d/futurenestfund-backup
bash /var/www/futurenestfund/deploy/backup.sh
ls -lh /var/backups/futurenestfund
```
`pg_dump` must be version **17 or newer**, because Supabase runs Postgres 17. The backup covers the app's tables and uploaded files. Sign-in accounts are in Supabase's own backups. These copies are on the same server, so download one now and then (e.g. `scp`) or copy them to other storage.

### Step 10. Email (when ready)
Email is set up in the app: **Admin → Settings → Email**. The server only needs a master key that encrypts the secrets you save there.

1. **Master key (once), on the server:**
   ```bash
   openssl rand -base64 32
   nano /etc/futurenestfund/api.env
   fnf-pm2 restart futurenestfund-api --update-env
   ```
   Put the printed value in `SETTINGS_ENCRYPTION_KEY=` and keep a copy in `secrets.local.md`. If it's ever lost or changed, the saved Resend key and hook secret can't be read any more; Settings says so, and you enter them again.
2. **Resend:** records already exist for `mail.futurenestfund.org`, so check that domain in Resend → Domains first (otherwise add a domain and put the DNS records it lists in Cloudflare; they're on their own names and **don't affect the website**). Create an API key (Sending access is enough).
3. **Admin → Settings → Email:** paste the API key; set the sender name and address (e.g. `no-reply@mail.futurenestfund.org`), the support address and the signature; save. The health checks show whether Resend accepts the key and the domain is verified. Send a test email to yourself.
4. **Supabase → Authentication → Hooks → Send Email** → HTTPS: paste the hook URL shown in Settings (`https://access.futurenestfund.org/api/hooks/supabase/send-email`), generate the secret, and save it as **Hook secret** in Settings. No restart is needed.
5. Test with a password reset: it should arrive from your sender with the signature, and the "Supabase sign-in emails" check turns green.

Values saved in Settings win over `RESEND_API_KEY` / `EMAIL_FROM` / `SEND_EMAIL_HOOK_SECRET` in `api.env`; those still work as a fallback. Backups contain the secrets only in encrypted form; the master key isn't in them.

---

## Everyday operations

| Task | Command |
|---|---|
| Deploy the latest `user-side-redesign` (after a Replit Git sync) | `bash /var/www/futurenestfund/deploy/deploy.sh` |
| Roll back to an earlier commit | `git -C /var/www/futurenestfund log --oneline -5`, then `bash /var/www/futurenestfund/deploy/deploy.sh <commit>` |
| Status | `fnf-pm2 list` |
| Logs (live / last 100 lines) | `fnf-pm2 logs futurenestfund-api` / `fnf-pm2 logs futurenestfund-api --lines 100 --nostream` |
| Find an error reference (e.g. `1a2b3c4d`) | `grep -h 1a2b3c4d /home/futurenestfund/.pm2/logs/*` |
| Restart after editing `api.env` | `fnf-pm2 restart futurenestfund-api --update-env` |
| Backup now | `bash /var/www/futurenestfund/deploy/backup.sh` |

**Rollback notes:**
- Migrations only ever add tables or columns, so an older commit runs fine on a newer database.
- `deploy.sh <commit>` rebuilds that commit. The previous web builds are also kept in `/var/www/futurenestfund-web/releases`.

## Server observations (2026-10-18 checks, not changed by this runbook)
- **Firewall is off** (`ufw inactive`), and noveriqgroups listens on `0.0.0.0:4001`, so it's reachable without nginx. GrantApp listens on 127.0.0.1 only.
  - Turning ufw on (allow 22, 80, 443) would close that.
  - Do it in a separate, careful step: it affects every app and SSH.
- SSH is key-only (password logins off), which is good. fail2ban isn't installed.
- 7 package updates were waiting.
