# email.md: everything about email in GrantApp

_Started 2026-11-20 · branch `user-side-redesign` · status: **built and tested 2026-11-20 (Phase 14), not deployed yet** (needs `deploy.sh`: migrations 0016, 0017 and Supabase 0008, then the go-live steps in §13). Sections marked "planned" describe what was built; §13 records how it was built and tested._

This file is the single place for email: what exists today, what we're building (the admin **Mail** box and the new email settings), how it works, and every decision. `docs/PROJECT.md` §7 keeps a short summary and links here.

Secret values (API keys, webhook secrets) are **never** written here. They live encrypted in the database (Admin → Settings) or in `secrets.local.md` / `/etc/futurenestfund/api.env`.

---

## Contents

1. [What exists today](#1-what-exists-today)
2. [What the user asked for (2026-11-20)](#2-what-the-user-asked-for-2026-11-20)
3. [How it will work: the big picture](#3-how-it-will-work-the-big-picture)
4. [Admin Settings → Email](#4-admin-settings--email)
5. [The Mail box](#5-the-mail-box)
6. [Signatures](#6-signatures)
7. [Data, API and security](#7-data-api-and-security)
8. [Build steps](#8-build-steps)
9. [Questions for you](#9-questions-for-you)
10. [Recommendations](#10-recommendations)
11. [Decisions log](#11-decisions-log)
12. [Resend facts we rely on](#12-resend-facts-we-rely-on)
13. [As built (2026-11-20)](#13-as-built-2026-11-20)

---

## 1. What exists today

Built in Phase 4.6 (`043e1a1`) and 7.1 (`3b62c4c`); **sending only, nothing is received**.

| Part | File | What it does |
|---|---|---|
| Sending | `api-server/src/lib/email.ts` | `sendEmail()` → `POST https://api.resend.com/emails`, with an idempotency key. Off until there's an API key and a sender |
| Settings | `lib/emailSettings.ts`, `routes/emailSettings.ts`, web `components/email-settings.tsx` | Admin → Settings → Email: Resend API key and Send Email Hook secret (write-only, sealed with AES-256-GCM by `secretBox.ts`, only a hint like `re_••••abcd` reaches the browser), sender name and address, reply-to, support address, **plain-text signature** (600 characters / 10 lines). Saved values win over `RESEND_API_KEY` / `EMAIL_FROM` / `EMAIL_REPLY_TO` / `SUPPORT_EMAIL` / `SEND_EMAIL_HOOK_SECRET`. Stored on `demo_settings` (`email_config`, `email_secrets`) |
| Health checks | `emailHealth()` | Key accepted (sending-only keys recognised), sender's domain on the account and verified (with each DNS record's status from Resend), `APP_URL` set, last Send Email Hook call, outbox state. **Send test email** |
| Templates | `lib/emailTemplates.ts` | One branded layout (app name + brand colour from Settings → Branding), plain-text version, every value HTML-escaped. Sign-in emails (13 kinds), notification email, money emails (request received / approved / declined), tier emails, card-added email, test email. Signature and support address go under every email |
| Sign-in emails | `lib/sendEmailHook.ts` | Supabase's **Send Email Hook** at `POST /api/hooks/supabase/send-email`, Standard Webhooks signature, replays answered without resending |
| Notification emails | `lib/notificationMailer.ts` | Outbox: each bell notification can be emailed; a worker every 15 s, `SKIP LOCKED`, up to 5 tries in 24 h |

**On the live server:** email is **not set up yet** (`server.md` step 10). Sign-up confirmations come from Supabase's own sender. Resend DNS records already exist for **`mail.futurenestfund.org`** (sending). `futurenestfund.org` itself is the WordPress site, with **no MX records** (no mailbox anywhere on that domain today).

---

## 2. What the user asked for (2026-11-20)

1. An **admin email box** that looks and feels like Gmail.
2. In Admin Settings, an **email section** where the admin:
   - sets the **Resend API key**
   - adds the **email domain**
   - **creates email addresses** (mailboxes)
   - sets up the **webhook**
   - sees the **DNS health check** and **connectivity**
   - and everything is wired up end to end.
3. The mail box can **attach documents**, **reply** and **forward**.
4. On the mail box page the admin can **switch between the addresses** they created.
5. **Email signature:** create one, choose its **brand colour**, upload a **logo**, and a **footer** that's simple but looks good.
6. Questions, suggestions and recommendations first, and this file documenting everything.

---

## 3. How it will work: the big picture

```
          SENDING                                         RECEIVING
 Admin writes in Mail ──► our API ──► Resend /emails ──► recipient
                              │
                              └─ copy kept in our database (Sent)

 Someone writes to grants@<domain> ──► MX record ──► Resend receives it
        ──► Resend POSTs "email.received" to https://access.futurenestfund.org/api/hooks/resend/inbound
        ──► our API checks the signature, fetches the full email + attachments from Resend,
            stores them (database + upload disk), files it in the right mailbox and thread
        ──► the admin's Mail box shows it (refreshes every ~15 s, like the bell)
```

- **Resend does both directions.** Resend can now *receive* email on a domain you verify (an MX record pointing to Resend), then calls a webhook (`email.received`). The webhook only carries an id; the API then fetches the body (`GET /emails/receiving/{id}`) and the attachments (download links valid for 1 hour). So we **copy everything to our own storage straight away**: the mail box never depends on Resend keeping it.
- **One domain, many addresses.** Once a domain is verified for receiving, *any* address on it reaches Resend. "Creating an address" is therefore our own record: we decide which addresses become mailboxes (e.g. `grants@`, `support@`, `finance@`). Mail to an address nobody created goes to a catch-all or is dropped (question Q5).
- **Setup from inside the app.** With a **full-access** Resend key the API can do the Resend side itself: add the domain (`POST /domains`, which returns the DNS records to add), ask Resend to verify it (`POST /domains/{id}/verify`), and create the webhook (`POST /webhooks`, which returns the signing secret once; we seal and store it). The admin only adds DNS records at Cloudflare, and the page shows exactly which ones and whether each is in place. A **sending-only** key can't do this (the page will say so).

---

## 4. Admin Settings → Email

Replaces today's single Email page with a guided setup plus tabs. Route stays `/admin/settings/email`.

**Setup checklist at the top** (each step green / amber / red, with what to do next):

| Step | What the admin does | What the app checks |
|---|---|---|
| 1. Connect Resend | Paste the API key (full access) | Key accepted; full access or sending-only |
| 2. Add your domain | Type the domain (e.g. `mail.futurenestfund.org`); choose **Send**, **Receive** or **both** | Domain created in Resend (or found if it exists) |
| 3. Add the DNS records | Copy each record into Cloudflare (copy buttons; Cloudflare tip: DNS only, not proxied) | Per record: in DNS? verified by Resend? (see DNS health below) |
| 4. Turn on receiving | One button: creates the webhook in Resend pointing to `<APP_URL>/api/hooks/resend/inbound` and stores its secret | Webhook exists, enabled, our URL, last call and its result |
| 5. Create addresses | Add mailboxes: address, display name, who may use it, signature | Address is on a verified domain |
| 6. Test it | **Send test** (out) and **Round-trip test**: the app sends from one mailbox to itself and waits for it to arrive | Both pass, with timings |

**Tabs underneath:**
- **Connection:** API key (write-only, hint shown), key type, Resend reachable + response time, webhook status, last inbound email received, outbox (waiting / retrying / failed).
- **Domains:** each domain with its role (send / receive), status, the DNS table, **Check again**. 
- **DNS health** (our own lookups from the server, `node:dns`, plus Resend's verdict), each with ok / missing / wrong value / conflict:
  - **MX** for receiving (and a warning if other MX records exist that would compete, see §12)
  - **SPF** (TXT, or CNAME on newer Resend domains) and the `send.` bounce MX
  - **DKIM** (`resend._domainkey`)
  - **DMARC** (`_dmarc`): not required by Resend but strongly advised; we suggest `v=DMARC1; p=none; rua=mailto:…` to start
  - Cloudflare **proxied** records spotted when possible (they break mail records)
- **Addresses:** the mailboxes (create, rename, disable, delete when empty; default sender for system emails; reply-to target).
- **Signatures:** §6.
- **Sign-in emails (Supabase hook):** unchanged from today: the hook URL to paste in Supabase, the hook secret, last call.
- **System emails:** which address sends notifications / money / tier emails, and where replies to them go (recommendation R4).

Every change is audited (no secret values in the audit), as today.

---

## 5. The Mail box

New admin page **Mail** (`/admin/mail`, menu item with the unread count). The layout follows the familiar **Gmail pattern**, in our own brand colour and logo (not Google's logo, colours or name).

**Layout (desktop):**
```
┌──────────────┬───────────────────────────────────────────────────────────┐
│ [✎ Compose]  │ 🔍 Search mail                          ⚙  grants@ ▾      │
│              ├───────────────────────────────────────────────────────────┤
│ Inbox     12 │ ☐ ☆  Jane Cooper      Grant question – Hi, I wanted…  10:42│
│ Starred      │ ☐ ☆  Amara Okafor  📎 Bank letter – Please find att…  09:15│
│ Sent         │ ☐ ★  David Chen    (3) Re: Withdrawal – Thanks, that…  Nov 18│
│ Drafts     2 │ …                                                          │
│ Archive      │                                                           │
│ Spam         │                                         1–50 of 214  ‹ ›  │
│ Trash        │                                                           │
│ ──────────── │                                                           │
│ Mailboxes    │                                                           │
│ ● grants@  12│                                                           │
│ ○ support@  3│                                                           │
│ ○ finance@   │                                                           │
└──────────────┴───────────────────────────────────────────────────────────┘
```
- **Switch mailbox:** the switcher (top right) and the list in the left column; "All mailboxes" view too. Each mailbox has its own unread count.
- **Message list:** unread in bold, star, attachment clip, thread count `(3)`, snippet, time; checkbox selection with bulk actions (archive, delete, mark read / unread, star, move to spam); hover actions on each row; 50 per page.
- **Conversation view:** messages of a thread stacked, older ones collapsed to one line; each with sender, to / cc, date, **Reply**, **Reply all**, **Forward**, a ⋮ menu (show original, mark unread from here, delete this message); attachments as chips with preview (images, PDF) and download.
- **Compose** (bottom-right window like Gmail, can be expanded to full screen or minimised; full screen on phones): From (any mailbox the admin may use), To / Cc / Bcc with suggestions from users and past contacts, subject, **rich text** (bold, italic, underline, lists, links, quote, clear formatting), **attachments** (drag and drop or pick; checked like other uploads; size total shown), signature inserted automatically (per mailbox, can be switched off per email), **Send**, **Discard**, autosaved **Drafts**.
- **Reply / forward:** reply keeps the thread (`In-Reply-To` / `References` headers, `Re:` subject) so the other side's mail app groups it too; forward includes the original header block and **carries its attachments** (can be removed one by one).
- **Search:** sender, recipient, subject, body text, "has attachment", date range, mailbox (Postgres full-text search).
- **Safety in the reader** (see §7): images from the internet hidden until "Show images" (like Gmail), a red banner when the sender failed SPF / DKIM / DMARC ("This message may not be from who it says"), links open in a new tab with a warning for look-alike links.
- **Link to the user:** when the sender is a registered applicant, a side card shows their name, tier, KYC status and a link to their profile in Users (recommendation R5).
- **Phones:** the list full width, the folder menu in a drawer, conversation full screen, compose full screen; 44 px targets, like the rest of the admin.
- **Keyboard shortcuts** (optional, Gmail-style): `c` compose, `r` reply, `a` reply all, `f` forward, `e` archive, `#` delete, `j`/`k` next / previous, `/` search.
- **New mail:** list refreshes every 15 s (same approach as the bell); optional browser tab title "(3) Mail".

---

## 6. Signatures

Replaces today's plain-text signature with a designed one. Several signatures can exist; each mailbox picks its default.

**Editor** (Settings → Email → Signatures, live preview on light background and in a narrow phone frame):
- **Logo:** upload (PNG / JPG / WebP, re-encoded and resized to max 200 × 80 px) or remove. Shown left of the text or above it.
- **Brand colour** for the signature: defaults to the app's brand colour (Settings → Branding), can be set separately (swatches, picker, hex). Used for the name and a thin accent line; text on it is checked for readability, as in Branding.
- **Fields:** name, job title, organisation, phone, website, email (each optional), plus up to 3 links (e.g. LinkedIn).
- **Footer:** a short line under a thin divider in small grey text, e.g. *"Future Nest Fund · Grants team · futurenestfund.org"* and an optional one-line notice (e.g. "This email and any attachments are confidential."). Two choices only (with / without the notice), so it stays simple.

**How it's sent:** built as a small email-safe HTML table (inline styles, no web fonts, works in Gmail, Outlook and Apple Mail, readable in dark mode) plus a plain-text version. The logo is served from a public URL on our site (`/api/mail/signature-logo/<id>`), not attached, so it doesn't look like an attachment and isn't blocked as one.

**Preview of the default style:**
```
  [LOGO]  Your Name                         ← brand colour, bold
          Grants Manager · Future Nest Fund
          +44 20 0000 0000 · futurenestfund.org
  ─────────────────────────────────────────  ← thin brand-colour line
  Future Nest Fund · access.futurenestfund.org     (small, grey)
```

---

## 7. Data, API and security

**New tables** (migration **0017** `0017_mail.sql`; Supabase migration **0008** `0008_mail.sql` for their `app_api_all` policies; RLS on, no Data API grants, as every other table):

| Table | Holds |
|---|---|
| `mail_domains` | Domain, Resend id, role (send / receive), status, records snapshot, last checked |
| `mail_mailboxes` | Address, display name, signature id, who may use it, enabled, default for system emails |
| `mail_threads` | Mailbox, subject, participants, last message at, unread, starred, folder (inbox / archive / spam / trash), labels |
| `mail_messages` | Thread, direction (in / out / draft), Message-ID, In-Reply-To, References, from / to / cc / bcc, subject, sanitised HTML, text, auth results (SPF / DKIM / DMARC), Resend id, sent by (admin), sent status, search vector |
| `mail_attachments` | Message, filename, type, size, file id in `demo_files` (same disk storage as other uploads), content-id for inline images |
| `mail_signatures` | Name, fields, colour, logo file id, footer |
| `mail_events` | Received webhook ids (replay protection) and delivery events (delivered / bounced / complained), optional |

**API** (admin only, under `/api/admin/mail/*`; webhook outside sign-in):
- `GET mailboxes`, `GET threads?mailbox&folder&q&page`, `GET threads/:id`, `PATCH threads` (bulk: read, star, folder), `POST messages` (send / reply / forward), `PUT/DELETE drafts/:id`, `POST attachments` (upload before sending), `GET attachments/:id` (download, owner-admin only, sandbox CSP), `GET remote-image?url=` (image proxy, see below).
- Settings: `POST mail/domains`, `POST mail/domains/:id/verify`, `GET mail/dns-health`, `POST mail/webhook`, `POST mail/round-trip-test`, CRUD for mailboxes and signatures.
- `POST /api/hooks/resend/inbound`: mounted before `express.json()` (signature covers the raw body), Svix / Standard Webhooks signature (same code as the Supabase hook), 5-minute window, replays ignored, answers fast and processes in the background (fetch, store) with retries.

**Security (inbound mail is untrusted):**
- **HTML is sanitised on the server** (allow-list of tags and attributes, no scripts, forms, iframes, event handlers, `javascript:` links) and shown in a **sandboxed iframe** with its own strict CSP. Belt and braces.
- **Remote images blocked by default** (stops tracking pixels and IP leaks); "Show images" loads them **through our image proxy**, so the sender sees our server, not the admin. This also keeps the site's CSP strict (`img-src 'self'`).
- **Attachments** go through the same checks as every upload (real type from the bytes, size caps) and **virus scanning when ClamAV is on**. Today ClamAV is **off** on the server (memory), so attachments from strangers would be stored unscanned: the reader shows a warning until scanning is on. See R7.
- **Limits:** per-mailbox storage cap and per-message size (Resend's limits apply too); webhook rate limit; sending limit per admin per minute (stops a stolen session spamming).
- **Spam / spoofing:** Resend gives SPF / DKIM / DMARC results; failures get the red banner and can go straight to Spam (Q8). We don't have a full spam filter (R8).
- **Audit:** sending, forwarding, deleting and settings changes are audited (who, when, which mailbox; not the content).
- **Sending reputation:** replies and forwards come from our verified domain; we never "send as" an outside address.

---

## 8. Build steps

Proposed as **Phase 14**. Each step tested (unit + `.unlazy/` API and browser suites, phone audit) and committed when green; one `deploy.sh` per step or at the end.

| Step | What | Done when |
|---|---|---|
| 14.1 | Settings → Email rebuilt: connection, domains (create / verify via API), DNS health, webhook creation, addresses, round-trip test | Domain verified and webhook created from the app against a Resend stand-in; DNS checks show each state |
| 14.2 | Inbound: webhook, fetch, store, threading, attachments to disk | A test email lands in the right mailbox and thread with its files; replays ignored; bad signatures refused |
| 14.3 | Mail box UI: folders, list, conversation, search, mailbox switcher, read / star / archive / delete, phone layout | Browser suite desktop + phone green |
| 14.4 | Compose, reply, reply all, forward (with attachments), drafts | Threads hold together in Gmail and Outlook (checked with a real inbox) |
| 14.5 | Signatures: editor, logo, colour, footer; used in Mail and (if Q10 says so) system emails | Renders in Gmail, Outlook web, Apple Mail, dark mode |
| 14.6 | Safety pass: sanitiser tests, image proxy, auth banners, limits, audit | Security tests green |
| 14.7 | Go live: DNS at Cloudflare, Resend key, Supabase hook, test real mail both ways | Real email in and out on `access.futurenestfund.org` |

Rough size: **large** (several days of build and test). 14.1 + 14.2 are useful on their own (email working and arriving), so we can ship them first.

---

## 9. Questions for you

**All answered on 2026-11-20: see §11.** Recommended answers were marked **(R)**.

**Domain and addresses**
- **Q1. Which domain receives mail?** (a) `mail.futurenestfund.org` → addresses like `grants@mail.futurenestfund.org` **(R: safest, records already partly there, never clashes with a future Google Workspace / Microsoft 365 on the main domain)**; (b) the main `futurenestfund.org` → `grants@futurenestfund.org` (nicer, but it puts Resend's MX on the organisation's main domain; if you ever want normal mailboxes there they'd clash); (c) another domain.
- **Q2. Does anyone already receive mail @futurenestfund.org anywhere** (e.g. through the WordPress host, or forwarding)? Today there's no MX record, so probably not, but please confirm.
- **Q3. Which addresses do you want to start with?** e.g. `grants@`, `support@`, `finance@`, `no-reply@`.
- **Q4. Who can use each mailbox?** Today there's one admin. (a) every admin sees every mailbox **(R for now)**; (b) each mailbox lists which admins may use it (worth it once you have several admins).
- **Q5. Mail to an address nobody created** (e.g. `info@`): (a) goes to a catch-all mailbox you choose **(R)**; (b) dropped.

**The mail box**
- **Q6. Gmail features for the first version:** must-haves are inbox, sent, drafts, archive, trash, star, search, threads, reply / reply all / forward, attachments, mailbox switcher. Do you also want **labels**, **snooze**, **scheduled send**, **undo send** (a 5–10 s delay), **keyboard shortcuts**? **(R: undo send + shortcuts now; labels, snooze, scheduled send later)**
- **Q7. Should replies from applicants land in the mail box?** Today notification emails have no useful reply-to. If system emails get `Reply-To: support@…`, applicants can just hit Reply and it arrives in Mail, linked to their profile. **(R: yes)**
- **Q8. Emails failing SPF / DKIM / DMARC:** (a) inbox with a red warning **(R)**; (b) straight to Spam.
- **Q9. How long to keep mail?** (a) forever until deleted, Trash emptied after 30 days **(R)**; (b) a fixed retention (e.g. 2 years) for privacy rules.
- **Q9b. Can applicants see these emails in the app** (e.g. a "Messages" page), or is email only in their own inbox? **(R: email only for now)**

**Signatures**
- **Q10. Signature in system emails too?** Notification, money and tier emails today get the plain-text signature. (a) the new designed signature of the sending mailbox replaces it **(R)**; (b) system emails keep the plain one; (c) none in system emails.
- **Q11. One signature per mailbox, or also per admin** (each admin their own name and title)? **(R: per mailbox now; per admin when there are several admins)**
- **Q12. Footer text:** do you want a confidentiality notice line, an address, or just name + website? Send me the exact words if you have them.

**Resend and limits**
- **Q13. Which Resend plan are you on?** Free is 100 emails/day and 3,000/month, which is tight once notifications, sign-in emails and admin mail share it. Receiving counts towards the plan too. **(R: check the plan; Pro if you expect real traffic)**
- **Q14. Is it OK to create a new full-access Resend key** for the app (needed to create domains and webhooks from Settings)? A sending-only key works too, but then steps 2 and 4 are done by hand in Resend.

**Security**
- **Q15. Attachments while virus scanning is off:** (a) accept with a warning in the reader **(R short term)**; (b) only accept common safe types (PDF, images, Office documents without macros) **(R in addition)**; (c) first add memory to the server and switch ClamAV on (step 11).

---

## 10. Recommendations

- ~~R1. Use `mail.futurenestfund.org`~~: you chose **`futurenestfund.org`** (§11). The existing `mail.futurenestfund.org` records in Resend / Cloudflare can stay or be removed later (Free plan allows 3 domains).
- **R2. Build in two releases:** first settings + DNS + webhook + receiving (14.1–14.2) so email actually works, then the Gmail-style UI (14.3–14.6). Step 10 of `server.md` (email go-live) is folded into this.
- **R3. Keep our own copy of every email** (in and out) instead of reading from Resend each time: faster, searchable, and Resend's attachment links expire after an hour.
- **R4. Route replies to system emails into Mail** (Q7): `Reply-To` on notification / money emails = `support@…`. Today those replies go nowhere useful.
- **R5. Link mail to applicants** by email address: a side card with their profile, and a "Mail" tab on the user inspector listing conversations with them.
- **R6. Add DMARC** (`_dmarc` TXT, start at `p=none`): Gmail and Yahoo require it for bulk senders and it improves delivery. The DNS health tab will suggest the exact record.
- **R7. Turn on virus scanning before real outside mail arrives** (it needs ~1–1.2 GB of memory; the server has 1.8 GB shared by four apps). Until then, safe-type allow-list + warning (Q15).
- **R8. Accept that this isn't a full spam filter.** Authentication checks, a Spam folder, "Mark as spam" (which sends future mail from that sender to Spam) and a block list are planned; heavy spam would need a dedicated service.
- **R9. Look like Gmail, but be ours:** same layout and gestures, our brand colour, logo and Inter font. No Google logo, colours or name.
- **R10. Rotate the secrets pasted in chat before this goes live** (`server.md` §6): the mail box makes the admin account more valuable to an attacker.
- **R11. Raise the Supabase minimum password length to 8** for the same reason.

---

## 11. Decisions log

| Date | Decision |
|---|---|
| 2026-10-29 | All email goes through **Resend**, including Supabase's sign-in emails via the Send Email Hook |
| 2026-10-31 | Email settings live in Admin → Settings → Email; secrets sealed in the database, write-only |
| 2026-11-01 | The API creates its own master key file (`settings.key`), so keys can be saved with no server change |
| 2026-11-20 | Request: Gmail-style admin Mail box, mailbox management, DNS / webhook setup in Settings, designed signatures (§2). Plan in this file |
| 2026-11-20 | **Q1 domain: `futurenestfund.org`** (the main domain), for sending and receiving, e.g. `support@futurenestfund.org`. Safe today because nothing receives mail there (Q2). Records it needs at Cloudflare: Resend's **MX on the root** (receiving), the `send.` MX + SPF and `resend._domainkey` DKIM (sending), and `_dmarc` (advised). None of these touch the WordPress site's web records. If normal mailboxes (Google Workspace / Microsoft 365) are ever wanted on this domain, receiving would have to move to a subdomain first |
| 2026-11-20 | **Q2:** nobody receives mail @futurenestfund.org today |
| 2026-11-20 | **Q3:** start with one mailbox, **`support@futurenestfund.org`** |
| 2026-11-20 | **Q4:** every admin sees every mailbox |
| 2026-11-20 | **Q5:** mail to an address nobody created goes to a **catch-all mailbox** the admin picks (support@ to start) |
| 2026-11-20 | **Q6:** first version: inbox, starred, sent, drafts, archive, spam, trash, search, conversations, reply / reply all / forward, attachments, mailbox switcher, **undo send** and **keyboard shortcuts**. Labels, snooze and scheduled send later |
| 2026-11-20 | **Q7:** replies to system emails land in Mail: system emails get `Reply-To: support@…`, and conversations are linked to the applicant's profile |
| 2026-11-20 | **Q8:** mail failing SPF / DKIM / DMARC stays in the inbox with a red warning |
| 2026-11-20 | **Q9: 30 days**, read as: mail is kept until deleted; **Trash (and Spam) are emptied after 30 days**. (If "30 days" was meant for all mail, say so: that would delete every email a month after it arrives) |
| 2026-11-20 | **Q9b:** applicants see email in their own inbox only (no Messages page) |
| 2026-11-20 | **Q10:** the designed signature of the sending mailbox replaces the plain-text one in system emails too |
| 2026-11-20 | **Q11:** one signature **per mailbox**, editable by the admin |
| 2026-11-20 | **Q12:** footer = the **website name** only for now |
| 2026-11-20 | **Q13: Resend Free plan**: 100 emails/day and 3,000/month **including received mail**, 3 domains, **1 webhook endpoint**, 30-day retention on Resend's side. The app uses one endpoint for every event and keeps its own copies, so it fits; Settings will show today's usage against 100/day |
| 2026-11-20 | **Q14:** a **full-access** Resend key, so the app creates the domain and webhook itself |
| 2026-11-20 | **Q15:** attachments limited to safe document types while virus scanning is off: **PDF, images (JPG, PNG, GIF, WebP, HEIC), Word (.doc/.docx), Excel (.xls/.xlsx), PowerPoint (.ppt/.pptx), OpenDocument, plain text / CSV, RTF**. Macro-enabled Office files (.docm, .xlsm, .pptm), executables, scripts and archives are refused. Applies to received and sent attachments |

---

## 12. Resend facts we rely on

Checked 2026-11-20 against Resend's docs; re-check field names when building.

- **Receiving:** works on a verified custom domain (MX record shown on the domain's page in Resend, e.g. a regional `receive-…` host) or on Resend's own `<id>.resend.app` address. If the domain already has MX records, Resend's would compete with them (lowest priority number wins; equal priorities = unpredictable), so Resend advises a **subdomain** in that case.
- **Webhook:** event `email.received`, payload carries `email_id` and metadata only; webhooks are signed with Svix headers (`svix-id`, `svix-timestamp`, `svix-signature`), verified over the raw body.
- **Fetching a received email:** `GET /emails/receiving/{id}` → from, to, cc, bcc, reply_to, subject, html, text, headers, `message_id`, `authentication` (SPF / DKIM / DMARC), attachment metadata (id, filename, content_type, content_id, size), and a `raw` download link for the original message. Attachments are downloaded through the received-attachments endpoints; each `download_url` expires after **1 hour**.
- **Managing from the app:** `POST /domains` (returns the DNS records), `POST /domains/{id}/verify` (a domain fails if records aren't found within 72 hours), `POST /webhooks` (returns the signing secret **once**). Domains created after August 2026 may get CNAME records for SPF instead of TXT / MX.
- **Sending:** `POST /emails` supports attachments and custom headers (`In-Reply-To`, `References` for threading).

Sources: [Resend: receiving](https://resend.com/docs/dashboard/receiving/introduction), [custom domains for receiving](https://resend.com/docs/dashboard/receiving/custom-domains), [retrieve a received email](https://resend.com/docs/api-reference/emails/retrieve-received-email), [received attachments](https://resend.com/docs/dashboard/receiving/attachments), [create webhook](https://resend.com/docs/webhooks/create-webhook), [managing webhooks via API](https://resend.com/changelog/managing-webhooks-via-api), [verify webhook requests](https://resend.com/docs/webhooks/verify-webhooks-requests), [manage domains](https://resend.com/docs/dashboard/domains/manage-domains).


---

## 13. As built (2026-11-20)

Differences from the plan above, and where everything lives.

**Code**

| Part | File |
|---|---|
| Tables (`demo_mail_mailboxes`, `demo_mail_threads`, `demo_mail_messages`, `demo_mail_files`, `demo_mail_inbound`) | `lib/db/src/schema/demo-mail.ts`, `lib/db/migrations/0017_mail.sql`, `lib/db/supabase/migrations/0008_mail.sql` |
| Pure rules: addresses, subjects, threading headers, quoting, snippets, **accepted attachment types** (from the bytes; macros, scripts, programs, archives refused) | `api-server/src/lib/mailRules.ts` |
| Received-HTML cleaner (sanitize-html allow-list, remote images held in `data-remote-src`, `cid:` → our copy, CSS that loads anything dropped) and Compose HTML cleaner | `lib/mailHtml.ts` |
| Signatures: check, email-safe HTML + text | `lib/mailSignature.ts` |
| Resend calls: domains, webhooks, received mail and attachments, sending with cc / bcc / attachments / headers | `lib/resendApi.ts` |
| Attachment and logo storage (`<UPLOAD_DIR>/mail/`, virus scan when ClamAV is on) | `lib/mailStore.ts` |
| Mailboxes, lists, reading, drafts, send with **undo (10 s)**, reply / forward, receiving + threading, delivery events, workers (send queue 5 s, inbound queue 15 s with retries, Trash/Spam emptied after 30 days, unused uploads after a day) | `lib/mail.ts` |
| Settings: connect domain, DNS health (public resolvers 1.1.1.1 / 8.8.8.8), webhook, round-trip test, the webhook endpoint | `lib/mailSetup.ts` |
| Routes (`/api/admin/mail/*`, public `/api/mail/signature-logo/:id`, webhook `POST /api/hooks/resend/inbound`) | `routes/mail.ts`, `app.ts` |
| Web: Mail page, Compose (TipTap editor), message reader (shadow root), attachment cards | `grant-platform/src/pages/admin-mail.tsx`, `components/mail/*` |
| Web: Settings → Email checklist, Domain and DNS, Receiving, Mailboxes and signatures (editor with live preview), Round-trip test | `components/mail-settings.tsx` (above the existing "Sending and sender" card) |

**How system emails changed (Q7, Q10):** the mailbox marked "Sends system emails" (the first one made) becomes the From and Reply-To of every notification / money / tier / test email, and its designed signature replaces the plain-text one. The old sender fields in "Sending and sender" show "In use from the mailbox…" and only apply when no mailbox sends system emails.

**Limits:** attachments 15 MB each, 25 MB per email, 20 per email; received attachments up to 25 MB (bigger ones are listed as not kept); 50 recipients per email; 500 kB of HTML. Undo delay `MAIL_UNDO_SECONDS` (default 10).

**Server settings (all optional):** `RESEND_DAILY_LIMIT` (default 100, shown in the usage bar), `MAIL_UNDO_SECONDS`. Test-only: `MAIL_ALLOW_HTTP_WEBHOOK=1`, `MAIL_DNS_SERVERS`. `RESEND_WEBHOOK_SECRET` is a fallback for the webhook secret saved in Settings.

**Tests (2026-11-20):** typecheck clean; `pnpm test` 171/171 (+1 skipped), new `mail.test.ts` (21: addresses, subjects, threading, quoting, attachment types, HTML cleaning, signatures). Local suites (git-ignored `.unlazy/`, Resend stand-in `mock-resend.mjs` extended with domains, webhooks, received mail, Svix-signed calls and loop-back delivery): `phase14-mail.mjs` **15/15** (key access, domain + verify, webhook + bad signatures, mailboxes, receiving with hostile HTML and blocked attachments, catch-all, spoofed mail, reply with undo and threading headers, their reply threading back, forward with attachments, drafts, folders and search, signature + system emails, bounce, round trip), `phase14-ui.mjs` **7/7 desktop and 7/7 phone** (list, conversation, Show images, reply + send, drafts, shortcuts, Settings and the signature editor). `phase7-email` 10/11 against this test server (the one miss expects the suite's own `APP_URL`).

**Not built (later, as agreed):** labels, snooze, scheduled send; a real spam filter; virus scanning of attachments needs ClamAV on the server (until then only the safe types are accepted).

**Go live:**
1. Commit is pushed (Replit Git pane → Sync), then on the server `bash /var/www/futurenestfund/deploy/deploy.sh` (applies 0016, 0017 and Supabase 0008).
2. Follow `docs/DEPLOY.md` step 10 (key, domain, DNS at Cloudflare, receiving, support@ mailbox and signature, round-trip test, Supabase hook).
