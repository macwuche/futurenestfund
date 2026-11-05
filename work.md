# work.md — Codebase study & UI issue log

_Study date: 2026-10-15. Read every hand-written source file. Ran `pnpm run typecheck` (passes) and checked the live API on :8080 and the web app on :20233. Nothing has been changed yet._

---

## 1. What we have built

A **grant-management demo app** with two workspaces:

- **Applicant**: navy (`#1E3A8A`) theme.
- **Admin "command center"**: black (`#111`) and lime (`#C6F432`) theme.

They are built from the two spec files in `.conversation/attached_assets/`. The app is explicitly a **demo**: there is no auth, and the "User / Admin workspace" switch is plain navigation.

### Monorepo layout (pnpm workspaces)

| Path | What it is |
|---|---|
| `artifacts/grant-platform` | React 19 + Vite + Wouter + Tailwind v4 frontend (port 20233) |
| `artifacts/api-server` | Express 5 API under `/api` (port 8080), seeds demo data on boot |
| `lib/api-spec/openapi.yaml` | API contract (source of truth) → Orval codegen |
| `lib/api-client-react` | Generated React Query hooks (`useGetApplicantDashboard`, …) |
| `lib/api-zod` | Generated Zod schemas used by the server to validate and parse |
| `lib/db` | Drizzle + Postgres: `demo_profiles`, `demo_audit`, `demo_ledger`, `demo_settings` (RLS on) |
| `artifacts/mockup-sandbox` | Replit component-preview sandbox (not part of the product) |

### Frontend structure (all real UI lives in 6 files)

| File | Contents |
|---|---|
| `src/App.tsx` | Routes: 8 applicant routes and 8 admin routes |
| `src/components/shell.tsx` | Layout: sidebar, mobile drawer, top bars, bottom nav, global-freeze modal, New Application modal |
| `src/components/bits.tsx` | Helpers (`money`, `dateFmt`, `cx`), `StatusBadge`, `Modal`, `Field`, `Empty`, `ErrorState`, skeletons |
| `src/lib/demo-state.tsx` | Client-only context; some of it persists to localStorage (apps, setup, requests) and some doesn't (search, notifications) |
| `src/pages/applicant.tsx` | Dashboard, Grant categories, Applications, Cards, Transactions, Withdrawals, Add funds, Settings |
| `src/pages/admin.tsx` | Overview, Users, User inspector, Transactions, Deposit, Withdrawal, KYC, Settings |

The roughly 50 shadcn components in `src/components/ui/` are **unused** except `toaster`, `toast` and `tooltip` (and `card` in `not-found.tsx`). The pages use hand-rolled Tailwind with hard-coded hex colors.

### Routes

- **Applicant:** `/` and `/dashboard`, `/grants`, `/applications`, `/cards`, `/transactions`, `/withdrawals`, `/deposits` (labelled "Add funds"), `/settings`
- **Admin:** `/admin`, `/admin/users`, `/admin/users/:userId`, `/admin/transactions`, `/admin/deposits`, `/admin/withdrawals`, `/admin/kyc`, `/admin/settings`

### API (`artifacts/api-server/src/routes/workspace.ts`)

| Method | Path | Backed by |
|---|---|---|
| GET | `/applicant/dashboard?period=weekly\|monthly` | DB profile `usr-jane`. Applications, chart, setup cards and recommendations are **hard-coded** in `demoWorkspace.ts`. |
| PATCH | `/applicant/profile` | DB, plus an audit row |
| GET | `/admin/dashboard` | DB counts. `pendingDeposits` and `pendingWithdrawals` are hard-coded to `0`. |
| GET | `/admin/users?search&status` | DB |
| GET / PATCH | `/admin/users/:id` | DB (name, phone, telegram, tier, status, permissions) plus audit |
| POST | `/admin/users/:id/balance-adjustments` | DB transaction with row locks. Credit only. Blocked by global or account freeze. |
| PATCH | `/admin/system/freeze` | DB, plus audit |

Seed data: three users (Jane Cooper is the applicant, plus David Chen and Amara Okafor). Each has 2 cards and 2 KYC docs stored as JSONB. Money is stored in integer cents.

### What is real vs. fake

- **Persisted in the DB:**
  - profile edits
  - tier, permissions and account freeze
  - global freeze
  - balance top-ups
  - audit trail
- **localStorage only (never reaches the server or the admin):**
  - new applications
  - deposit and withdrawal requests
  - completed setup cards
- **In-memory only (lost on reload):**
  - notifications
  - search text
  - saved grants
  - avatar preview
- **Hard-coded:**
  - applications list
  - chart data
  - grant recommendations
  - total budget ($50,000)
  - system health
  - 4-eyes = false

---

## 2. Bugs (confirmed)

### Functional / logic

1. **The "Your next big idea" setup card goes to Settings instead of opening the upload / new-application flow.**
   - Where: `applicant.tsx:48-54`. `act()` matches keywords in `title + actionLabel`, and that string contains neither "proposal" nor "upload".
   - Verified: `"Your next big idea starts here Complete Setup"` → `/settings`.
   - The `'ai'` substring match is fragile too.
   - Same problem in the icon logic (`applicant.tsx:111`): both cards get the Sparkles icon and never UploadCloud.
2. **Setup cards are marked complete on click,** before the user has done anything (`applicant.tsx:49`).
3. **Date-only fields show one day early in American time zones.**
   - Where: `dateFmt` (`bits.tsx:7`) runs `new Date('2026-10-08')`, which is UTC midnight. Verified: it prints "Oct 7, 2026" in New York.
   - Affects `submittedAt`, `deadline` and `joinedAt`.
4. **Deposit and withdrawal requests never reach the admin.**
   - Applicant requests live only in localStorage (`demo-state.tsx`).
   - The admin Deposit and Withdrawal pages just list all users. They are not request queues, and their counters are always 0 (`demoWorkspace.ts:88`).
5. **Withdrawals can exceed the balance.** Validation only compares a single request against the grant balance. It doesn't subtract pending requests, and the balance never decreases (`applicant.tsx:294`).
6. **New applications are local only.**
   - Admin "Pending applications" and "Applications by status" ignore them.
   - The sidebar count includes them, so the applicant and admin numbers disagree.
7. **Funding tracker can overflow.**
   - `allocatedFunds` is the user's grant balance (`demoWorkspace.ts:64`).
   - An admin grant top-up past $50k makes "Remaining" negative and the allocation text exceed 100%.
8. **Freeze state is invisible on the applicant side.**
   - A frozen account or a global freeze has no effect on the applicant UI. They can still "record" deposits and withdrawals.
   - The admin freeze banner says adjustments are paused "conceptually", but the backend really does block them, so the copy is inconsistent.
9. **The applicant UI calls the admin API.** The Cards, Transactions, Withdrawals and Add funds pages use `useGetAdminUser` (`applicant.tsx:220-222`). That's a contract and role-boundary inconsistency.
10. **Applicant "Transactions" shows audit-log entries, not transactions.**
    - It lists things like "Updated tier", "Sample profile created" and "Demo global freeze…".
    - Local requests come first, then audit entries, with no merged date sort.
    - The empty state renders under an empty `<ul>`.
11. **Admin "Transactions" is just the last 8 audit events.**
    - The `demo_ledger` table is never exposed.
    - There is no export, filtering or pagination (the spec asks for "immutable ledgers and export tools").
12. **The KYC page can't do KYC.**
    - It lists users who aren't Verified and has no approve or reject actions.
    - The API can't change `verificationLevel` or document status, so a document can never be verified.
13. **Profile audit logs every submitted field even if unchanged,** e.g. "Updated name, phone, telegram" (`demoWorkspace.ts:110`).
14. **Fake card data.**
    - Every user's cards share the same last four digits (`4829` / `7391`, seeded in `demoSeed.ts:16-17`).
    - Jane's masked ID also ends in 4829.
    - The physical card balance is always 0. The "Top up" button on a card credits the generic `card` account.
15. **Grant categories don't match up.**
    - Recommendations use `Technology / Community / Environment`.
    - The New Application modal uses `Innovation / Community Arts / Education / Health / Climate`.
    - Seeded applications use `Technology & innovation / Arts & culture / Environment`.
    - The "Apply" button on a grant opens a blank modal without prefilling the title or category.
16. **"Save grant" problems.** The notification always says "Saved" even when un-saving, and the saved list isn't persisted (`applicant.tsx:190`).
17. **Search state is shared but inconsistent.**
    - Header search, dashboard highlights search and Applications search all write to one global `search` value.
    - The dashboard matches title only; the Applications page matches title or category.
    - Admin header search says "Search logs, users, IDs" but only filters users by name, email or org, and does nothing on other pages until you press Enter.
18. **Admin Settings freeze skips the confirmation and reason** that the header freeze requires (`admin.tsx:372`).
19. **One shared `upd.isPending` in the inspector.**
    - Toggling a permission shows "Saving..." on the profile Save button.
    - It also disables every tier, switch and freeze control at the same time (`admin.tsx:159`).
20a. **A bad API response crashes the whole page.**
    - When `/api` returns HTML instead of JSON (e.g. the app opened on port 20233 directly, where there is no proxy), the query "succeeds" with a string.
    - `UserTop` then throws `Cannot read properties of undefined (reading 'organization')` (`shell.tsx:177`). The full-page error fallback replaces the friendly `ErrorState`.
    - Fix: validate the response shape and use optional chaining (`data?.profile?.…`).
20. **Duplicate fetch on dashboard load.** `Gate` fetches with no params and the body fetches `{period:'weekly'}`. They're different query keys, so the same data is fetched twice.

### Layout / visual

21. ~~**All Tailwind shadows may be disabled.**~~ **Not a bug:** a browser check shows that card shadows render.
    - `index.css` `:root` redefines `--shadow-sm` … `--shadow-2xl` with alpha `0`. The unlayered `:root` overrides Tailwind's theme layer.
    - So every `shadow-sm`, `shadow-lg`, `shadow-xl` and `shadow-2xl` (cards, modals, dropdowns, payment cards) renders with **no shadow**. The spec requires soft shadows.
22. **The phone-frame mockup is applied to real mobile users.**
    - `.mobile-preview-frame` puts a 4px dark border with 30px rounded corners around the whole applicant app below 1024px.
    - A fake "grantapp.mx/…" address bar sits on top (`shell.tsx:107-112`).
    - That was a presentation idea from the spec, but on a real phone it wastes space and looks broken.
    - The bottom nav uses `inset-x-1 bottom-1 rounded-b-[24px]` to fit inside that frame.
23. **The whole layout remounts on every navigation.**
    - Every page renders its own `<Shell>`, so the sidebar, header, queries and dropdown state are torn down and rebuilt on each route change.
    - That causes flicker, resets sidebar scroll and replays the `rise` animation.
24. **The user header can overflow on small screens.** The row has no `flex-wrap`. Title, search input (`w-36`), bell, New button and avatar all compete for width (`shell.tsx:180-217`).
25. **The workspace switch is duplicated.**
    - Admin: sidebar, header and an extra mobile row (3 places).
    - User: sidebar and header.
26. **Dropdowns don't close properly.**
    - The org switcher and notifications panel don't close on outside click or Escape.
    - Both can be open at once.
    - The notification badge never clears.
27. **Modal accessibility is weak.** There's no focus trap, no initial focus and no body-scroll lock (`bits.tsx:71-91`).
28. **Possible class conflicts.**
    - `cx()` is a plain join with no `tailwind-merge`. For example, `Stat accent` applies both `bg-white` and `bg-[#111]`, and both `border-[#E2E8F0]` and `border-[#111]` (`admin.tsx:25`).
    - Which one wins depends on CSS order, so this needs verifying in the browser.
29. **Fonts are loaded twice.**
    - `index.html` loads **Inter**, which is never used.
    - `index.css` loads Bricolage Grotesque, DM Sans and Spline Sans Mono through `@import url(...)`.
30. **Zoom is disabled.** `maximum-scale=1` in the viewport meta blocks pinch-zoom.
31. **The mobile scroll rows show scrollbars in Firefox.** `.noscroll` only hides the WebKit scrollbar.
32. **404 and error pages are off-brand.**
    - `not-found.tsx` is the default template ("Did you forget to add the page to the router?") with no shell and no link home.
    - The error-boundary fallback is unstyled gray.
33. **The bottom nav uses `<button onClick=nav>`** instead of links, so it has no hrefs and you can't long-press to open in a new tab.
34. **Color and token drift.**
    - Canvas colors are `#E9EDF3` (user) and `#F4F5F8` (admin); the CSS token `--background` is a third value.
    - Pages hard-code hex everywhere instead of using the theme tokens.
    - `.dark` is a copy of light.
35. **Badge semantics.** "4-Eyes approval: not enabled" uses an amber **Pending** badge. The spec's header badge is meant to read "4-Eyes Active"; it currently reads "4-Eyes: not enabled (demo config)".
36. **Small text issues.**
    - "1 virtual card(s)".
    - The applicant button says "Save changes" while the admin one says "Save Updates".
    - The adjustment modal is titled "adjustment", but it can only credit (no debit).

---

## 3. Spec gaps (vs. the two UI spec files)

- **Admin:**
  - Transactions has no export.
  - Deposit Page has no pending wire approvals.
  - Withdrawal Page has no 4-eyes sign-off flow.
  - KYC has no global document queue or OCR inspection.
  - Settings has no threshold limits.
- **Admin:** the avatar upload is preview only (an object URL that is never revoked).
- **User:**
  - The Applications badge counts all applications, including Approved, not active ones.
  - The org switcher is hidden below `md`.
  - The header avatar only shows at `xl`.
- **User:** Settings has no notification preferences or avatar.
- **Stack note:** `replit.md` lists the target production stack (Supabase Auth + TOTP, Resend, sharp, Vitest, …). **None of it is implemented yet.** There are no tests in the repo.

---

## 4. Code-health notes

- `shell.tsx:275-278` has `import` statements in the middle of the file.
- `UsersView`'s `UserTable` branch (no `cols`) is dead code; only the KYC page uses `UsersView`.
- `demoLedgerTable` lives in `demo-audit.ts`, and is written but never read.
- Profile `cards` and `documents` are untyped JSONB. The virtual card balance is overwritten from `cardCents` at read time (`demoWorkspace.ts:27-29`).
- `.agents/memory/data-isolation.md`: keep this app's data separate from the user's existing "GrantFlow Hub" Supabase project. Don't point at it.

---

## 5. Visual comparison: our applicant dashboard vs. the reference design

Reference: "Mobile and Desktop Dashboard Comparison.png" (provided link). It shows the applicant dashboard only, with no admin screens.
Ours: headless Chromium screenshots of `/dashboard` at 1440px and 390px, taken via the dev domain.

> **Conflict to decide:** the reference sidebar (My Applications, Grant Search, Grant Funding Tracker, Reports, Milestones, Help Centre) does **not** match the written spec's menu (Dashboard, Grant categories, Applications, Cards, Transactions, Withdrawals, Add funds, Settings). We built the written spec's menu.

### 5a. Desktop

| # | Area | Reference design | What we have | Match? |
|---|---|---|---|---|
| D1 | Brand / logo | "GrantApp" wordmark with a blue ✓-style "V" logo and a small green badge | "Grant Platform" with a navy "G" square and a "FUNDING WORKSPACE" subtitle | ❌ |
| D2 | Sidebar items | Dashboard, My Applications (3), Grant Search, Grant Funding Tracker, Reports, Milestones | Dashboard, Grant categories, Applications (3), Cards, Transactions, Withdrawals, Add funds, Settings | ❌ (spec conflict) |
| D3 | Active nav style | Pale blue pill, dark text | Solid navy pill, white text | ❌ |
| D4 | Count badge | Small grey circle "3" | Light-blue pill "3" | ⚠️ |
| D5 | Sidebar bottom | Settings, Help Centre, divider, **user card** (avatar "J", Jane Cooper, Acme Foundation, "…" menu) | Demo note box and User/Admin workspace switch. No user card, no Help Centre. | ❌ |
| D6 | Top bar, left | Org switcher "Acme Foundation ▾" only, with **no page title** | "Dashboard" page title plus an org pill with a building icon | ❌ |
| D7 | Top bar, right | Bell **with red unread dot**, and a pill-shaped **Search input** labelled "Search" | Search **icon** that expands, bell with no dot, New Application button, workspace switch, "JC" avatar | ❌ |
| D8 | "+ New Application" button | Navy pill at the **top of the content area** (left) | Navy pill in the **header** (right) | ⚠️ |
| D9 | Profile greeting block | None on desktop (the user is shown in the sidebar card) | Large "JC" avatar, name, Verified badge and subtitle above the tracker | ❌ |
| D10 | Tracker header | Title "Grant Funding Tracker" in normal case, with a Submitted/Review legend right under it. Figures (Total Grant Budget $50,000.00, Funds Allocated $15,000.00) top-right. | Uppercase "GRANT FUNDING TRACKER" label, 3 figures including **Remaining**, a Weekly/Monthly toggle top-right | ⚠️ |
| D11 | Progress bar on desktop | None | Navy bar with "30% of budget allocated" | ⚠️ extra |
| D12 | Chart type | **Stacked** bars: navy Submitted with grey Review on top | **Grouped** side-by-side bars: navy and **orange/amber** | ❌ |
| D13 | Chart Y axis | **Dollar** amounts ($0 to $50,000) | Plain counts (0 to 32) | ❌ |
| D14 | Chart X axis | Months | Weekdays (weekly default), months with the toggle | ⚠️ |
| D15 | Chart legend | Above the chart (under the title) | Below the chart | ⚠️ |
| D16 | Number font | Same sans as the UI, bold | **Monospace** (Spline Sans Mono), so figures look wide and "techy" | ❌ |
| D17 | Setup section label | None | "SETUP AND RECOMMENDATIONS" caption | ⚠️ extra |
| D18 | Setup card icon | Icon inside a **white rounded tile**: sparkle for matchmaking, **document** for proposal | Small sparkle inline before the title, the same icon on both cards | ❌ |
| D19 | "Recommended" badge | Green pill top-right on each setup card | None | ❌ |
| D20 | Setup card copy | "AI Grant Matchmaking" and "Submit First Proposal", with titles in black | "Find your perfect grant match" and "Your next big idea starts here", with titles in navy | ❌ |
| D21 | Setup card button | Larger navy pill, "Complete Setup" | Smaller navy pill, "Complete Setup" | ⚠️ size |
| D22 | Highlights header | "Grant Highlights" with an **"All Revenue ▾" dropdown** on the right | "Grant highlights" with a search input and 6 filter chips | ❌ |
| D23 | Highlight rows | Each row is a **bordered card** with a leading icon (document or clock), title, status sub-line, status badge and **chevron ›** | Flat divided list: title, category and date, **amount**, badge with dot. No icon, no chevron. | ❌ |
| D24 | Status wording and colors | "Submitted" in **green**, "Under Review" in amber | "Submitted" in **blue**, "Review" in amber | ❌ |
| D25 | "View all applications" link | None | Present | ⚠️ extra |
| D26 | Canvas background | Very light grey-white | Darker blue-grey (`#E9EDF3`) | ⚠️ |
| D27 | Typography | Clean neo-grotesque (Inter / SF style) | Bricolage Grotesque headings, DM Sans body, mono numbers | ❌ |
| D28 | Demo footer text | None | "Demo preview. No real authentication…" | ⚠️ extra |

### 5b. Mobile (390px)

| # | Area | Reference design | What we have | Match? |
|---|---|---|---|---|
| M1 | Browser chrome | Real Safari address bar and toolbar. The phone frame is **presentation only**. | We **draw** a fake "grantapp.mx/dashboard · DEMO" bar and a dark rounded phone-frame border inside the page | ❌ remove |
| M2 | Top header | **No app header bar.** The page opens on the profile block. | Sticky header: ☰ (left), "Dashboard" title, search, bell, "+ New" | ❌ |
| M3 | Menu button | ☰ in a **light circle on the right**, inline with the profile | ☰ on the **left** of the header | ❌ |
| M4 | Avatar | Single initial "**J**" in a navy circle | Two initials "**JC**" | ⚠️ |
| M5 | Verified indicator | Green ✓ **icon** next to the name | Green "Verified" text pill | ⚠️ |
| M6 | Subtitle | "Acme Foundation" on one line, then "Here are your account's highlights." on its own line | Joined into one line with " · " | ⚠️ |
| M7 | Tracker layout | Two figures **side by side** with a vertical divider and legend dots (● Total Grant Budget, ● Funds Allocated), then a progress bar. **No chart.** | Three figures **stacked**, Weekly/Monthly toggle, progress bar, full bar chart, legend | ❌ |
| M8 | Progress bar colors | Navy fill on a **grey** track | Navy fill on a pale-blue track | ⚠️ |
| M9 | Setup cards scroller | Horizontal swipe row with the next card peeking ✓. Cards have an icon tile and a "Recommended" badge. | Horizontal swipe row with the next card peeking ✓. No icon tile, no badge. | ⚠️ partial |
| M10 | Second card button | **Outline** (white with border) "Complete Setup" | Filled navy | ⚠️ |
| M11 | Applications section | "My Applications" card: icon, title, status sub-line, badge | "Grant highlights" with search, chips and amounts. Titles get **truncated** ("AI Innovation …", "Communit…") because the amount column squeezes them. | ❌ |
| M12 | Bottom navigation | None in the app (the bar shown is Safari's toolbar) | 5-tab bottom nav (Dashboard, Categories, Apps, Cards, Settings). **The written spec requires it.** | ⚠️ spec conflict |

### 5c. What already matches

- Navy brand color (`#1E3A8A`) for primary buttons and accents.
- White cards with thin borders and rounded 16px corners.
- Light ice-blue setup cards (`#EEF4FB`) with left-aligned pill "Complete Setup" buttons.
- Horizontal swipe row of setup cards on mobile, with the next card peeking.
- Same figures: $50,000.00 budget and $15,000.00 allocated.
- Same sample data: Jane Cooper, Acme Foundation, AI Innovation Grant, Community Arts Support.
- Org switcher "Acme Foundation ▾" exists, and the Applications count badge "3" exists.

---

## 5d. Decisions (2026-10-15)

1. **Menu = both lists merged.**
   - Keep the written spec's 8 items.
   - Add the items that appear only in the reference: Grant Search, Grant Funding Tracker, Reports, Milestones, Help Centre.
   - Add the user card at the sidebar bottom.
   - The new pages get built later. For now, they need a placeholder route.
2. **Mobile keeps an in-app bottom tab bar.**
   - The Safari address bar, toolbar and phone frame in the image only show how the app looks on a phone. They are not part of the UI.
   - So remove our fake address bar and phone-frame border.

## 6. Suggested fix order

1. Global visual fixes:
   - restore shadows (#21)
   - remove the phone frame and fake address bar on real devices (#22)
   - make the layout persistent across routes (#23)
   - header overflow and dropdown behavior (#24–26)
   - fonts and zoom (#29–30)
2. Logic bugs visible in the UI:
   - setup cards (#1–2)
   - dates (#3)
   - funding overflow (#7)
   - categories and Apply prefill (#15)
   - save toast (#16)
   - search consistency (#17)
   - per-control pending state (#19)
3. Data consistency between applicant and admin. These need API and DB work:
   - requests, applications and freeze (#4–6, #8–12)
4. Polish:
   - 404 and error pages
   - modal accessibility
   - token cleanup
   - copy fixes

_Waiting for the UI link to check these visually and add anything only visible at runtime._

---

## 7. Progress log

### 2026-10-15: user side, pass 1 (admin later)

Done:
- **Persistent layout.** `Layout` lives in `App.tsx`. Pages now only register their title through `<Shell title>`, so the sidebar and header no longer remount on navigation (#23).
- **Sidebar:**
  - GrantApp logo.
  - Merged menu (Dashboard, My Applications, Grant Search, Grant categories, Grant Funding Tracker, Cards, Transactions, Withdrawals, Add funds, Reports, Milestones). Settings and Help Centre sit at the bottom.
  - Jane Cooper card with a "…" menu (Account settings, Switch to admin view, demo note).
  - Pale-blue active state and grey count badge.
- **New placeholder ("Coming soon") pages:** `/grant-search`, `/funding-tracker`, `/reports`, `/milestones`, `/help`.
- **Desktop top bar:** org switcher on the left; bell with a red unread dot and a Search pill on the right. Dropdowns close on outside click or Escape (#24–26).
- **"+ New Application"** now sits at the top of the dashboard content.
- **Mobile:**
  - Removed the fake address bar and phone frame (#22).
  - Dashboard header is the profile block (initial "J", green verified tick, org, subtitle) with ☰ on the right.
  - Other pages get a title bar with ☰. The drawer slides in from the right.
  - Full-width bottom tab bar made of real links (#33).
- **Funding Tracker:**
  - Desktop: title with the legend under it, two figures top-right, **stacked** navy/grey bars on a **$ axis**.
  - Mobile: two figures side by side, a progress bar, and no chart.
  - Allocation is clamped to 0–100% (#7).
- **Setup cards:**
  - Icon tiles (sparkle and document), "Recommended" badge, the design's titles and copy, larger buttons.
  - Proposal now opens New Application. Steps complete only when the user actually submits an application or saves a grant (#1–2).
- **Grant Highlights:**
  - "All Revenue ▾" amount filter (hidden on phones).
  - Bordered rows with a status icon, status sub-line, badge and ›.
  - Mobile title is "My Applications". "Submitted" is green and "Review" displays as "Under Review" (D22–D24).
- **Fonts:** user side uses Inter, the design's font, and plain (not monospace) numbers (D16, D27). Canvas is `#F3F4F6`.
- **Bug fixes:**
  - Dates no longer show a day early (#3).
  - A bad API response now shows an error card instead of crashing (#20a).
  - Single dashboard query, so no duplicate fetch (#20).
  - One shared category list, and Apply pre-fills the form (#15).
  - Saved grants persist and the save message is correct (#16).
  - Search behaves the same everywhere (#17).
  - Application rows no longer truncate titles on phones (M11).
  - Modal focus trap and scroll lock (#27).
  - Pinch-zoom enabled (#30).
  - Firefox scrollbars hidden (#31).
  - Branded 404 page (#32).
- **API sample data:** monthly trend in dollars (Mar–Oct), setup card copy, and recommendation category. **Needs an API Server workflow restart.**

Deliberately not done yet:
- Weekly/Monthly toggle removed because the design has none. The API still supports it.
- The mobile design's outline button on the second setup card is skipped; it's inconsistent with the desktop design.
- The small green badge next to the logo is skipped; its meaning is unclear.
- Not yet addressed:
  - user-side data issues: Transactions shows audit entries (#10); requests are local only (#4–6); freeze state is invisible (#8)
  - Settings, Cards, Withdrawals and Add funds have not been restyled to the design
  - all admin items

### 2026-10-15: user side, pass 2 (remaining pages)

Backend:
- New table `demo_requests` (pushed to the Replit dev DB `helium`, **not** Supabase).
- New endpoints `GET /applicant/account` and `POST /applicant/requests` (OpenAPI updated, codegen run). The applicant UI no longer calls the admin API (#9).
- Request rules, checked server-side:
  - 2-decimal amounts, $0.01 to $1M.
  - Refused while the platform or the account is frozen (#8).
  - Refused if the admin's KYC toggles require verification and the user isn't verified.
  - A withdrawal can't exceed the grant balance minus pending withdrawals (#5).
  - Each request writes an audit row.
- Admin `pendingDeposits` and `pendingWithdrawals` now count real pending requests (#4).
- Verified on a temporary server on :8099: 201 / 400 cases, the available balance and the admin counts all behave. Test rows were deleted afterwards.

Frontend (design language from the reference: white bordered cards, Inter, navy pills, icon tiles, dot-less badges):
- **Cards:**
  - Balance tiles (Grant, Deposit, Card).
  - Card visuals with the GrantApp mark, holder name and Visa / Mastercard mark.
  - A pending physical card shows "Being issued".
- **Transactions:**
  - Real money movements only: admin top-ups from `demo_ledger` plus the user's requests, sorted by date (#10).
  - Filter chips (All, Deposits, Withdrawals, Top-ups).
  - Rows show in/out arrow icons, signed amounts and a status.
- **Withdrawals / Add funds:**
  - Balance tile ("Available to withdraw" accounts for pending withdrawals), $-prefixed amount, quick amounts for deposits.
  - Server errors shown inline. The form is disabled with a notice when frozen.
  - Request history listed beside the form.
- **Settings:**
  - Profile header.
  - Personal information form with phone and Telegram format checks. Save is only enabled when something changed, and there's a Cancel button.
  - Locked email and organization.
  - Read-only Account panel: verification, status, tier, notifications, withdrawal KYC.
- Removed browser-only (localStorage) request storage.

**Needs an API Server workflow restart** before these pages load. Until then Cards, Transactions, Withdrawals, Add funds and Settings → Account show the "Could not load" card.

Still open on the user side:
- Applications are still stored in localStorage (#6).
- Admin approval of requests comes with the admin pass.

### 2026-10-15: user side, pass 3 (the five new menu pages)

Lives in `src/pages/applicant-more.tsx`. Shared bits (`card`, `Gate`, `GrantCard`, chart colors) are exported from `applicant.tsx`.
- **Grant Search:**
  - Keyword search plus Category, Amount, Deadline-window and Sort filters, and a "Saved grants only" toggle.
  - Result count, Clear filters, empty state.
  - Reuses the grant card (Apply pre-fills the form; Save persists).
- **Grant Funding Tracker:**
  - Budget, Allocated and Remaining tiles with a progress bar.
  - Stacked chart with a Weekly/Monthly toggle.
  - Application pipeline by status (count and amount).
  - Requested amounts by category.
- **Reports:**
  - Tiles for applications, total requested, approved funding and approval rate.
  - Money-movement summary from the account API.
  - CSV downloads for applications, transactions and funding trend.
- **Milestones:**
  - Progress summary (complete, overdue, to do).
  - Add-milestone form (title, grant, due date).
  - Tick to complete, delete.
  - Overdue / Due-soon / Scheduled states.
  - Seeded for the approved grant. **Stored in localStorage only** (no server model yet).
- **Help Centre:**
  - FAQ search and topic chips, accordion answers written to match how the app actually behaves.
  - Contact card (the placeholder inbox is labelled as unmonitored), quick links.
- **API:** sample grants grew from 3 to 12 across all six categories. **Needs an API Server restart.**

---

## 8. Build backlog and plan (2026-10-15)

Size: **S** ≈ a few hours, **M** ≈ about a day, **L** ≈ several days.
"Where" says what the work touches: UI = frontend, API = endpoints and contract, DB = new tables.

### 8a. User side: what's left

| # | Item | What "done" means | Where | Size |
|---|---|---|---|---|
| U1 | QA pass after the API restart | Every user page checked at desktop and phone width, clicks tested, issues fixed | UI | S |
| U2 | Applications on the server | New / list / detail stored in the DB (no more localStorage). Dashboard, My Applications, Tracker and Reports read from it. The admin can see them. | API, DB, UI | M |
| U3 | Application detail page | Click a row and see a status timeline, amounts, documents and funder notes. "Changes requested" lets the user reply and resubmit. Withdraw a draft or submitted application. | UI, API | M |
| U4 | Milestones on the server | Same features, stored per user in the DB | API, DB, UI | S |
| U5 | Notifications on the server | Bell shows real events (request approved, application status changed, KYC result). Read/unread is stored. Mobile gets access to the bell too. | API, DB, UI | M |
| U6 | File uploads (shared foundation) | Upload endpoint saving to the API server's disk (per `replit.md`), type and size checks, images re-encoded with sharp | API | M |
| U7 | KYC submission | User uploads a government ID and proof of address and sees verification status. This is what feeds the admin KYC queue. | UI, API, DB | M |
| U8 | Proposal upload | The "Submit First Proposal" setup card uploads a document and attaches it to an application | UI, API | S |
| U9 | Profile photo | Avatar upload in Settings, shown in the sidebar card and header | UI, API | S |
| U10 | Grant matchmaking setup | The "AI Grant Matchmaking" card opens a short questionnaire (goals, org type, focus areas, funding size) that ranks grants. Rule-based first; real AI optional later. | UI, API | M |
| U11 | Card controls | Freeze or unfreeze a card, show card details behind a confirmation, activate the physical card when it arrives | UI, API | M |
| U12 | Settings: preferences and security | Notification preferences. Password, 2FA and active sessions come with real login (P1). | UI, API | S, then M |
| U13 | Mobile polish | Search and notifications reachable on phones; final spacing pass | UI | S |

### 8b. Admin side: what's left

| # | Item | What "done" means | Where | Size |
|---|---|---|---|---|
| A1 | Admin design and QA pass | Admin brought to the spec (or a design image), plus fixes for #18, #19, #28, #35, the freeze banner copy, header search scope and the duplicate workspace switch | UI | M |
| A2 | Dashboard with real numbers | KPIs from the DB (pending applications, KYC, deposits, withdrawals), a simple trend chart, recent activity, system health | API, UI | S |
| A3 | Users directory upgrade | Sorting and pagination, search by ID, quick filters (KYC pending, frozen, tier) | API, UI | S |
| A4 | User inspector completion | Real avatar upload, debit adjustments (not just credits), per-card issue / activate / freeze, a separate saving state per control (#19) | API, UI | M |
| A5 | Transactions ledger | Full ledger: top-ups, approved deposits and withdrawals, with filters by type / user / date, search by ID and CSV export (#11) | API, UI | M |
| A6 | Deposit Page | Queue of pending deposit requests. Approve credits the balance and writes a ledger entry and audit; Reject needs a reason and notifies the user. Manual balance injection is kept. | API, DB, UI | M |
| A7 | Withdrawal Page (4-eyes) | Pending withdrawals need **two different admins** to approve; the first approval is recorded and the second releases the funds. Needs real admin identities (P1); single-approval until then. | API, DB, UI | M |
| A8 | KYC Page | Global document queue with previews. Approve / reject per document; the user's verification level updates and they're notified. OCR confidence stays labelled as demo until real OCR exists. (#12) | API, DB, UI | M |
| A9 | Applications review | Admins move applications Submitted → Under Review → Approved / Declined / Changes requested, with notes. **Not in the admin spec's menu; needs a decision.** | API, UI | M |
| A10 | Settings: rules and limits | Threshold limits (e.g. withdrawals above $X need 4-eyes, daily caps), KYC defaults, global freeze with confirmation everywhere (#18) | API, DB, UI | M |
| A11 | Audit log viewer | Searchable, read-only audit log for the whole platform, with filters and export | API, UI | S |

### 8c. Platform foundations (both sides depend on these)

| # | Item | Notes | Size |
|---|---|---|---|
| P1 | Real sign-in and roles | Supabase Auth with email confirmation and TOTP 2FA (per `replit.md`). Roles: applicant / admin / root. Every endpoint scoped to the signed-in user; the hard-coded `usr-jane` goes away. **Needs a dedicated Supabase project, never the existing GrantFlow Hub one.** | L |
| P2 | Email | Resend for confirmations, password reset and notification emails (including the Supabase Send Email Hook) | M |
| P3 | Tests | Vitest for API rules (money, freeze, KYC, 4-eyes); headless-Chromium smoke scripts for the main flows | M |
| P4 | Production hardening | Rate limits, input limits, error monitoring, deployment checklist | M |

### 8d. Plan

Rule while building: new endpoints go through one `currentUser()` helper now (still returning the demo user), so P1 becomes a swap rather than a rewrite.

| Phase | Goal | Items | Ends with |
|---|---|---|---|
| **0. Lock in** | Make sure what's built works, and save it | API restart, U1, commit | A tested, committed user side |
| **1. User data on the server** | Nothing important lives only in the browser | U2, U3, U4, U5 | The admin can see everything users create |
| **2. Files and identity** | Users can upload what admins need to review | U6, U7, U8, U9 | Real documents in the KYC pipeline |
| **3. Admin operations core** | Admins can act on what users submit | A1, A2, A5, A6, A8, A9 | Full request → approve → ledger loop |
| **4. Real accounts** | Real people, real roles | P1, P2, U12 (security part) | Sign-in, 2FA, per-user data |
| **5. Admin controls** | Rules that need real admin identities | A7 (true 4-eyes), A10, A11, A3, A4 | The spec's security command centre |
| **6. Finish and harden** | Polish and confidence | U10, U11, U13, P3, P4 | Ready to deploy |

Why this order:
- Phases 1–3 close the biggest gap: users and admins can't see each other's actions yet.
- Login comes before true 4-eyes because two-person approval is meaningless without knowing who the two people are.
- Tests come last as a phase, but each phase adds tests for the money rules it touches.

### 8e. Decisions needed (1 and 2 settled on 2026-10-21, see the Phase 3 log; 3 settled on 2026-10-28, see §9)

1. **Admin design:** is there a design image for the admin side, or should we follow the written admin spec?
2. **Applications review (A9):** admins need somewhere to approve applications. Should we add an "Applications" item to the admin menu, or put it inside Users?
3. **Real sign-in (P1):** OK to create a **new, dedicated** Supabase project for this app when we reach Phase 4?
4. **Grant matchmaking (U10):** rule-based is enough for now, or do you want real AI from the start?

### 2026-10-15: Phase 0 in progress

- Built a dependency-free click-test harness: headless Chromium driven through the DevTools protocol, with true 390px phone emulation. Scripts are in the session scratchpad for now; they'll move to the ignored `.unlazy/` folder (per `replit.md`) in P3.
- **Desktop flows: 35/35 pass.** Covered:
  - new application (validation, redirect, list, sidebar count)
  - notification dot, panel and Escape
  - setup cards complete only after the real action
  - header search
  - Apply pre-fill and Save
  - Grant Search filters
  - milestone add, validate, tick, delete
  - Help search, tracker Weekly toggle
  - user menu outside-click
  - 404 page
- **Phone flows: 15/15 pass.** Covered: profile header, chart hidden, drawer open / navigate / close, bottom nav, no horizontal scroll on 8 pages.
- No console errors in either run.
- Fixed: the New Application form now keeps a pre-filled category that isn't in the standard list (previously it silently fell back to the first option).
- **Blocked:** the API Server process has not restarted (uptime over 1h), so it still serves the old build. Untested until it does: Cards, Transactions, Withdrawals, Add funds, Settings → Account, Reports → Money movements, the 12 sample grants and the dollar chart. The commit waits for that.

### 2026-10-15: Phase 0 done

- The API Server never actually restarted (the restart wasn't reaching this container, and stopping the process from the agent session was not permitted). To test the new code anyway, it ran as a temporary copy on :8099; the test browser's `/api` calls were sent there. The temporary copy is stopped and all test rows are deleted.
- **Account flows: 23/23 pass.** Covered:
  - 12 grants and the setup card titles from the design
  - dollar chart bars and axis
  - Cards balances, the two cards, "Being issued"
  - Withdrawal validation (empty / over balance), a Pending request, available balance dropping to $14,900, form reset
  - Deposit quick amount and request
  - Transactions listing and filter
  - Settings tier, Save disabled until a change, phone validation
  - Reports money summary
  - Admin pending counters 1/1
- With the earlier runs, that's **73 automated checks passing** (35 desktop + 15 phone + 23 account).
- Tweak: transaction rows on phones drop the "account" label so the date stays visible.
- Committed on branch `user-side-redesign` (4df02af).
- **Still needed:** a real restart of the API Server workflow, so the live preview serves the new API.

### 2026-10-19: Phase 1 done (U2–U5: user data on the server)

Applications, milestones and notifications now live in Postgres. Nothing important lives only in the browser any more (saved grants and setup-card progress are still localStorage, by design for now).

Backend:
- New tables in `lib/db/src/schema/demo-applications.ts` (pushed to the Replit dev DB, **not** Supabase):
  - `demo_applications` and `demo_application_events` (an append-only status history)
  - `demo_milestones`
  - `demo_notifications`
- `currentUserId(req)` in `api-server/src/lib/currentUser.ts`. Every new endpoint goes through it (still `usr-jane`), so P1 is a one-place swap.
- Applications (`lib/applicantRecords.ts`):
  - list, create, detail with timeline, withdraw, and respond to "Changes requested" (optionally revising the amount)
  - amounts from $100 to $10M, 2 decimals
  - only Submitted / Review / Changes requested can be withdrawn
  - every change writes an event, an audit row and a notification in one transaction
  - every query is scoped to the current user
- Milestones: list, create, tick and delete, scoped per user.
- Notifications (`lib/notifications.ts`): list (latest 20, plus the unread count) and mark all read. They're created by applications, deposit/withdrawal requests, admin top-ups and account freeze/unfreeze.
- Seeds: 4 applications (including "Youth Coding Bootcamp", which is in Changes requested) with history, and 4 milestones.
- The admin dashboard's pending applications and applications-by-status now come from the DB (#6). Withdrawn applications are excluded from totals but kept in history.

Frontend:
- **New `/applications/:id` detail page:**
  - header with status and amount
  - "Changes requested" reply form
  - status history timeline
  - withdraw with a confirmation dialog
  - "Application not found" state
- New Application saves to the server and opens the new application's page.
- My Applications has filter chips (All, Active, Needs changes, Approved, Withdrawn).
- The bell reads server notifications (polled every 30s). Opening it marks everything read, and items link to the relevant page. The bell is also on phones (U5, and part of U13).
- Milestones read and write the server, with optimistic tick and delete.
- Removed localStorage storage of applications and milestones, and the in-memory notifications.

Tested (2026-10-19, against the live API, which had restarted with this build):
- **API checks: 18/18 pass.** Covered:
  - validation 400s
  - unknown ID 404s
  - withdrawing an approved application → 400
  - responding when no changes were requested → 400
  - milestone bad ID, body and date
  - another user's application is invisible and can't be withdrawn or answered (404)
- **Desktop click tests: 26/26 pass.** Covered:
  - dashboard and sidebar count from the server
  - filters
  - detail page, reply validation, resubmit with a revised amount, timeline
  - notification dot, panel, Escape, read state surviving a reload, links
  - New Application validation, save and redirect, count 4 → 5 → 4 after withdrawal
  - withdraw cancel and confirm
  - 404 page
  - admin top-up shows up as a notification
  - milestone add, validate, reload, tick, delete
  - tracker excludes withdrawn applications
  - admin "Pending applications" stat
- **Phone (390px) click tests: 10/10 pass.** Covered:
  - bell in the profile header (44px tap target)
  - no sideways scroll on list, detail, milestones and 404
  - resubmit
  - panel and dialog stay on screen
  - withdraw, milestone add and tick
- **Smoke test: all 22 applicant and admin routes, desktop and phone, 44/44 pass.** No error states, no console errors.
- The DB was backed up before testing and restored afterwards.
- The scripts are now kept in `.unlazy/` (added to `.gitignore`, as `replit.md` intended):
  - `harness.mjs` (Chromium over the DevTools protocol, with `/api` routed to :8080)
  - `phase1-desktop.mjs`, `phase1-phone.mjs`, `smoke.mjs`
  - run with `node .unlazy/<file>` while both servers are up

Still open after Phase 1:
- Nothing in the admin UI can move an application to Review, Approved, Declined or Changes requested yet. Only the seed data has those states. That's A9 (Phase 3).
- Saved grants and setup-card progress are still per-browser.
- §1 "What is real vs. fake" above describes the state on 2026-10-15. Applications, milestones and notifications have since moved to the server.
- Next: Phase 2 (U6–U9: files and identity) or Phase 3 (admin operations). Decisions 1–4 in §8e are still open.

### 2026-10-19: Phase 2 done (U6–U9: files and identity)

**U6: upload foundation** (`api-server/src/lib/uploads.ts`)
- Added `multer` (memory storage) and `sharp` to the API server.
- Files are written to `UPLOAD_DIR`, by default `artifacts/api-server/uploads/` (git-ignored). Each gets a random server-side name and file mode 0600.
- New table `demo_files` records the owner, purpose, application, display name, type, size and sha256.
- Validation:
  - one file per request, 10 MB maximum
  - the real type is detected from the file's bytes; the browser's claim is ignored
  - images (JPG, PNG, WebP) are re-encoded with sharp: rotation applied, metadata (EXIF/GPS) removed, input capped at 50 M pixels (stops "decompression bomb" images), resized (avatar 256px WebP, documents ≤ 2400px JPEG)
  - PDFs must be complete, and are refused if they contain JavaScript, launch actions, embedded files or rich media
  - `.docx` files must really be Word documents; macro-enabled files are refused
  - maximum 200 files per user
- Writes are atomic: the file is written, then its row is inserted in the same transaction as the business change, and the file is deleted if that transaction fails. Tests confirmed refused uploads leave no orphan files.
- Downloads:
  - `GET /applicant/files/:id` is owner-only; `GET /admin/files/:id` serves any file
  - headers: `nosniff`, a sandbox CSP and private caching
  - images display inline; documents always download as attachments
- `lib/api-zod/tsconfig.json` now includes the `dom` lib, because the generated multipart schemas use `Blob`.

**U7: KYC submission** (`lib/kyc.ts`)
- New table `demo_kyc_documents`. The sample documents moved there from the profile JSONB, which is now legacy and unused.
- A replaced document is marked `superseded` and kept for the audit trail.
- `GET /applicant/kyc` and `POST /applicant/kyc/documents` (fields: `kind` and `file`).
- Verification rules:
  - Unsubmitted or Rejected → Pending once both document kinds are on file
  - a Verified user who uploads a replacement stays Verified while it's reviewed
- Each upload writes an audit row and a notification linking to `/settings#verification`.
- Settings has a new **Identity verification** section: level badge, explanation, one row per document, Upload/Replace, View. It warns users to upload sample or redacted documents only.
- Admin side:
  - the inspector shows the real files (image preview, PDF download, "not machine-checked")
  - sample documents keep their demo OCR score
  - users now carry `pendingKycDocuments`
  - the KYC page also lists verified users with a document awaiting review
  - the dashboard's Pending KYC counts them too
- **Approve/reject is not built yet. That's A8 in Phase 3.**

**U8: proposal upload**
- New Application has an optional PDF/Word attachment. If the upload fails, the application is still created and the user is told to retry from its page.
- The application detail page has a **Documents** section:
  - attach (maximum 5), download, and remove with a confirmation
  - adding and removing are allowed only while the application is Submitted, Under review or Changes requested
  - the server re-checks this under a row lock
- `ApplicationDetail` gained `documents` and `canAttach`.
- Admins can't see proposal files yet. They'll appear in application review (A9).

**U9: profile photo** (`lib/avatars.ts`)
- `POST` / `DELETE /applicant/avatar`. The old file is deleted once the replacement is committed.
- The photo shows in Settings (camera button, Remove photo), the sidebar card, the phone dashboard header and the admin inspector.
- The admin's own avatar picker is still preview-only (A4).

Also:
- Help Centre has new answers about uploads.
- A withdrawal refused for missing KYC now points the user to Settings.
- Bigger touch targets for file controls on phones.

Tested (2026-10-19). The API under test ran as a temporary copy on :8099, because the managed API workflow keeps running the old build in memory until it restarts.
- **API checks: 44/44 pass**, plus EXIF-stripping and response-header checks. Covered:
  - avatar: PNG/JPG accepted and re-encoded to a 256px WebP; GIF, PDF, fake JPEG and decompression-bomb image refused; missing file, wrong field name and two files refused; replacing and removing delete the old file
  - KYC: kind validation; DOCX, PDF with JavaScript, truncated PDF and an 11 MB file refused; EXIF marker present in the original and gone from the stored copy; inline vs `?download`; Unsubmitted → still Unsubmitted after one document → Pending after both; withdrawal blocked while Pending; Verified user stays Verified after a replacement
  - admin: pending counts, document URLs, can open any file
  - ownership: another user's file is a 404 from the applicant endpoint and a 200 from the admin endpoint; bad and unknown file IDs give 404
  - application documents: PDF and DOCX accepted; macro DOCX, plain ZIP and images refused; a 6th document refused; Approved application refused; unknown application 404; remove, remove again (404), and remove via the wrong application (404); audit rows written
- **Desktop click tests: 25/25 pass.** Covered:
  - photo upload, reload, the 256px square, remove
  - client-side and server-side refusals with clear messages
  - KYC replace and View; the Unsubmitted → Pending flow
  - notification link scrolling to the section
  - proposal attached from New Application
  - download headers
  - attach, refuse and remove on the application page
  - documents locked on decided and withdrawn applications
  - admin preview, PDF download, KYC queue and dashboard count
  - Help Centre
- **Phone click tests: 6/6 pass.**
- **Regression on the new build:** Phase 1 desktop 26/26, phone 10/10, all-routes smoke test 46/46.
- Two bugs found and fixed during testing:
  - a proposal uploaded from New Application didn't show up until another action refreshed the page
  - `/settings#verification` was scrolled back to the top by the layout
- The DB was backed up before testing and restored afterwards. Test uploads went to the scratchpad and were deleted.
- New local tooling in `.unlazy/`:
  - `proxy.mjs` (routes `/api` to a chosen API port, so real multipart uploads work)
  - `make-fixtures.sh`, `phase2-*.mjs`, `restore-demo-db.sh`, `README.md`

**Needs a restart of the API Server workflow.** It installs `sharp`/`multer`, seeds the KYC documents and serves the new endpoints. Until then, Settings → Identity verification, photo upload and document upload return errors on the live preview. The new DB tables are already pushed (Replit dev DB, not Supabase).

Still open after Phase 2:
- KYC approve/reject (A8) and admin access to proposal files (A9). Both are Phase 3.
- Uploaded files live on local disk. Replit deployments don't keep that disk, so persistent storage is needed before real use (P4).
- No virus scanning. The PDF/DOCX checks are structural only, and files are only ever served as downloads.

### 2026-10-21: Phase 3 done (A1, A2, A5, A6, A8, A9: admin operations core)

Decisions taken (§8e):
- **1. Admin design:** follow the written admin spec (user's choice).
- **2. Applications review (A9):** kept inside **Users**, so the admin menu stays exactly the spec's 7 items. Review page is `/admin/users/:userId/applications/:id`, reached from the inspector's new Applications section, the dashboard's review queue and header search.

Backend (`api-server/src/lib/adminOps.ts`, new endpoints in OpenAPI, codegen run):
- **Schema** (pushed to the Replit dev DB, **not** Supabase): `demo_ledger` gained `kind`, `request_id`, `application_id`, `actor`; `demo_requests` and `demo_kyc_documents` gained `review_note`, `reviewed_by`, `reviewed_at`.
- **One ledger for all money.** Signed amounts, linked to the request or application. Seeded "Opening balance" rows (and Jane's $15,000 grant award) explain the sample balances; fixed hashed ids so they insert once.
- **Append-only logs.** Boot installs triggers that refuse UPDATE/DELETE on `demo_audit`, `demo_ledger`, `demo_application_events`. Dashboard "Audit log: Intact" now checks they exist; "Database" is a real round-trip timing.
- **Application decisions (A9).** Submitted → Review / Approved / Declined / Changes requested; Review → the last three. Decline and Changes requested need a note. Approve credits the grant balance through the ledger and is refused during a global or account freeze. Each decision writes an event, an audit row and a notification. Admins can download proposal files.
- **Deposit / withdrawal queues (A6, plus single-approval A7).** Approve deposit → deposit balance up; approve withdrawal → grant balance down (refused if the balance is now too small). Approvals re-check global freeze, account freeze and the user's KYC requirement at approval time. Decline needs a reason (allowed during a freeze; no money moves). The applicant sees "Declined: reason".
- **KYC review (A8).** Approve / reject the current document (reject needs a reason; a replaced document can't be reviewed). Level recomputed: both kinds verified → Verified; any current document rejected → Rejected; otherwise unchanged. The applicant sees the reason in Settings → Identity verification.
- **Ledger (A5).** `GET /admin/transactions` with type / user / date (UTC, inclusive) / search (entry, request or application id, reason, user), 25 per page, money in/out totals; `GET /admin/transactions/export` CSV (≤10,000 rows, spreadsheet-formula cells neutralised).
- **Header search.** `GET /admin/search` over users (incl. id), applications, ledger entries and audit log.
- **Dashboard (A2).** Six-month money in/out trend from the ledger; real health checks; pending counters link to their queues.
- `currentAdmin(req)` (still "Demo administrator") is recorded on every admin action, next to `currentUserId()`, so P1 stays a swap.
- Fixed **#13**: profile audits list only changed fields (e.g. "Updated depositKycRequired on").

Frontend:
- **Dashboard:** KPI tiles (linked), money-movement chart, system health, "Applications awaiting a decision" queue (oldest first), status bars, recent activity.
- **Users / inspector:** directory search is page-local again (no shared state with the header; reads `?q=`), user ID shown. Inspector: separate saving state per control group (**#19**), Save enabled only when the form changed, Applications section, KYC approve/reject inline and in the viewer, "Credit" wording (the dialog only credits, **#36**).
- **Application review page:** summary, proposal documents, history timeline, decision panel (only allowed decisions; approve disabled with the reason when frozen), confirmation dialog with note.
- **Deposit Page / Withdrawal Page:** pending queue with balances, KYC and account status; approve (confirmation shows the balance change) / decline (reason); buttons explain why an approval is blocked; recent decisions; Deposit Page keeps manual balance injection (user picker). Withdrawal Page states plainly that 4-eyes is not active.
- **Transactions:** ledger table, filters, pagination, totals, CSV export, links to the source application.
- **KYC Page:** global document queue with thumbnails, viewer, approve/reject, recent decisions.
- **Settings:** freeze now uses the same confirmation + reason dialog as the header (**#18**); rules list says what is and isn't enforced.
- **Header:** search with grouped results (**header search scope**), honest "4-Eyes not active" badge (**#35**), freeze banner says what is actually paused, workspace switch only in the sidebar (**duplicate switch**; also fixed its overflow). Stat tile class conflict removed (**#28**). Modal close buttons are 44px.
- **Applicant side:** Transactions has a "Grant awards" filter; Reports shows grant awards received; KYC rows show rejection reasons; Help Centre answers updated.

Tested (2026-10-21, API under test on :8099 through the local proxy; DB backed up and restored after each run):
- **API checks 24/24** (`phase3-api.mjs`): append-only triggers; deposit approve under freeze / frozen account / success / double approval; ledger link and no duplicate applicant row; withdrawal decline (reason required, allowed while frozen) and approve (negative ledger), insufficient balance, KYC re-check; 404s; application queue order, transitions, notes, changes-requested → applicant can respond, approve blocked by freeze then credits $25,000; KYC level rules incl. superseded document and applicant-visible reason; ledger filters, paging, wildcard escaping, sums; CSV headers, filtering, formula neutralising; search; no-op profile save writes no audit.
- **Desktop click tests 22/22** (`phase3-desktop.mjs`) and **phone 16/16** (`phase3-phone.mjs`: no sideways scroll on 9 admin pages, ledger scrolls in its own container, left drawer with the 7 items, search panel and dialogs on screen, 44px close).
- **Regression:** Phase 1 desktop 26/26, phone 10/10; Phase 2 desktop 25/25 (one check updated for the new KYC queue), phone 6/6; smoke 46/46.
- Found and fixed while testing: dashboard grid overflowed on phones (grid children needed `min-w-0`); sidebar workspace switch overflowed; seeded ledger ids all looked identical.

**Needs a restart of the API Server workflow.** The managed :8080 process still runs the Phase 2 build, so every new admin endpoint returns 404 on the live preview until it restarts (the frontend is already live through Vite). The schema is already pushed.

Still open after Phase 3:
- True 4-eyes withdrawal sign-off (A7) needs real admin identities (P1). Today one administrator approves.
- Debit adjustments, card controls, real admin avatar upload (A4); threshold limits (A10); full audit-log viewer (A11); directory sorting/pagination (A3).
- Decisions 3 (dedicated Supabase project) and 4 (rule-based vs AI matchmaking) in §8e are still open.
- Next: Phase 4 (real accounts: P1, P2, U12).

---

## 9. Phase 4 build plan: real accounts on Supabase (2026-10-28)

Decision 3 (§8e) is settled: the app gets its **own** Supabase project, `futurenestfund` (ref `fybslfcepjnswcnoewgi`, EU / eu-central-1). Checked on 2026-10-28: it was empty (no public tables, no auth users). The other project ref that appeared in the pasted connection details (`ukeikuaduqmbkkhmzewg`) is **not** this app's and is never used (see `.agents/memory/data-isolation.md`).

Secrets live in Replit Secrets / env vars, never in git: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL` (session pooler, port 5432), `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD`.

| Step | Goal | What gets built | Done when |
|---|---|---|---|
| **4.1 Seed the admin** (this step) | The first real administrator exists in Supabase | `lib/db/supabase/migrations/0001_user_roles.sql`: `public.user_roles` (user id → `auth.users`, role `applicant` / `admin` / `root`), RLS on with no public policies, like every other table. `scripts/src/supabase-migrate.ts` applies migrations once each (tracked in `public.app_migrations`). `scripts/src/seed-admin.ts`: creates the admin through the Auth Admin API with the email pre-confirmed, sets `app_metadata.role = "admin"` (users can't edit app_metadata, so it's safe to read from the JWT), and writes the `user_roles` row. Re-running it changes nothing; it never resets an existing password unless `--reset-password` is passed. | Admin can sign in with email + password against Supabase Auth (verified with a real password grant); script is idempotent (verified by running it twice) |
| 4.2 Move app data to Supabase | One database for auth and data | Point `DATABASE_URL` at the Supabase pooler, `drizzle-kit push` the `demo_*` schema, boot seeds sample data there; Replit Postgres stays as fallback | All earlier test suites pass against Supabase |
| 4.3 API auth | Every request knows who is calling | Verify the Supabase JWT on the API; `currentUserId()` / `currentAdmin()` read it; `/admin/*` requires role `admin` or `root`; applicant profiles linked to `auth.users` | Unauthenticated calls get 401, applicants get 403 on admin routes |
| 4.4 Sign-in UI | Real login replaces the workspace switch | Sign-in, sign-up with email confirmation, password reset, sign-out; admin-only routes guarded | Click tests for each flow |
| 4.5 TOTP 2FA | Admins must use 2FA | Supabase MFA enrolment + challenge; admin routes require AAL2 | Admin without 2FA can't reach `/admin` |
| 4.6 Email (P2) | Real emails | Resend + Supabase Send Email Hook for confirmations / reset / notifications | Emails delivered from the app's domain |
| 4.7 Settings security (U12) | Users manage their own security | Change password, 2FA management, sign out other sessions | Click tests |

Not in 4.1: no frontend changes, no API changes, the demo data stays on Replit Postgres. The live app keeps working exactly as before.

### 2026-10-28: Step 4.1 done (admin seeded in Supabase)

- `pnpm --filter @workspace/scripts run supabase:migrate` applied `0001_user_roles.sql` (`public.user_roles`, plus `public.app_migrations` for tracking). Both tables have RLS on with no policies.
- `pnpm --filter @workspace/scripts run seed:admin` created `admin@futurenestfund.org` (auth id `c1ef1ffe-496d-491d-9a1f-40450e563d77`): email pre-confirmed, `app_metadata.role = "admin"`, `user_roles` row `admin`.
- Checked:
  - a second run of both scripts changed nothing ("already applied", "auth record unchanged", "already up to date")
  - a real password sign-in with the publishable key succeeds; the JWT carries `app_metadata.role: admin` (aal1, since there's no 2FA until 4.5)
  - a wrong password is refused (`invalid_credentials`)
  - the public REST API returns `[]` for `user_roles` (RLS blocks it)
- Both scripts need the §9 env vars. `SUPABASE_SECRET_KEY` is already in Replit Secrets; **the other five still need adding** there (they were supplied inline for this run).
- The app itself is unchanged: the API still uses the demo identities and the Replit database. The admin can sign in to Supabase, but the app won't ask for that until 4.3 / 4.4.
- Next: 4.2 (move the app's data to Supabase).

### 2026-10-29: Step 4.2 built and tested (app data on Supabase), region decision open

Code:
- `lib/db/src/connection.ts` picks the database: **Supabase when `SUPABASE_DB_URL` is set**, otherwise the Replit Postgres fallback (`DATABASE_URL`). The app (`lib/db/src/index.ts`, TLS, pool of 5 for the session pooler) and `drizzle-kit` (`drizzle.config.ts`) both use it. The API's "Server listening" log line names the database in use.
- `drizzle.config.ts` now has `tablesFilter: ["demo_*"]`, so a push can never drop the Supabase-side `user_roles` / `app_migrations` tables.

Done on Supabase (`futurenestfund`):
- `drizzle-kit push` created all 11 `demo_*` tables (RLS on for each). `user_roles` and its admin row were untouched.
- Copied the Replit data across with `pg_dump --data-only`. All 11 tables match row for row (compared by column name, since Replit's tables have a different column order from later `ALTER`s). It was only sample seed data: no uploads, requests or notifications.
- Booted the API against Supabase. The seed found everything present and inserted nothing new; the append-only triggers are installed.
- Supabase runs Postgres 17, but the shell's `pg_dump` is 16 and refuses to dump it. Use `/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin/pg_dump` for Supabase backups.

Tested (API copy on :8099 against Supabase via the proxy, Supabase data restored before each suite and at the end):
- API 24/24; smoke 46/46; Phase 1 desktop 26/26, phone 10/10; Phase 2 desktop 25/25, phone 6/6; Phase 3 desktop 22/22, phone 16/16. **175 checks, all passing.**
- The first run had 9 failures (phase3-desktop 14/22, phase2-phone 5/6). They came from two races in the test scripts, which the slower database exposed, not from app bugs:
  - a check for the freeze banner ran before its query had loaded; it failed before the test could unfreeze, so the next six checks ran against a frozen platform
  - a click came before the button had rendered
- Fixed both tests (they now wait, and the freeze test always unfreezes in a `finally`).

**Latency: the open issue.** The Replit container is in Oregon (US). The Supabase project is in Frankfurt (EU). Each query is a ~144 ms round trip, against ~1 ms locally, and endpoints run queries one after another:

| Endpoint | Supabase (EU) | Replit DB |
|---|---|---|
| `applicant/applications` | 0.14 s | <0.01 s |
| `admin/users`, `admin/transactions` | 0.29 s | <0.01 s |
| `admin/users/:id` | 0.43 s | <0.01 s |
| `applicant/account`, `admin/dashboard` | 1.15 s | ~0.01 s |

An approval runs ~10 statements in one transaction, so it would take about 1.5 s. Options (decision needed):
1. **Make a new Supabase project in a US West region next to Replit** (recommended, unless EU hosting is required for the users' data). Queries drop to a few ms. A project's region can't be changed after it's created, but redoing 4.1 and 4.2 is a few minutes with the scripts.
2. Keep EU and run independent queries in parallel. That brings the slow pages to ~0.3 s, but transactions (approvals) stay slow.
3. Keep EU as it is.

The live app is unchanged until `SUPABASE_DB_URL` is added to Replit Secrets **and** the API Server workflow restarts. Holding off on that until the region is settled.

**Decision (2026-10-29): keep the EU project.** The production server is an EU VPS, so in production the API sits next to Supabase (Frankfurt) and queries should be a few ms. The ~144 ms round trips only affect development on Replit's US container. So:
- Production (EU VPS): set `SUPABASE_DB_URL`.
- Replit development: leave `SUPABASE_DB_URL` unset to stay on the fast Replit fallback, or set it to work against Supabase and accept the slower pages.
- Measure latency again from the VPS once it's deployed. Running queries in parallel (option 2) can still come later if a page is slow there.
- Deployment target is the EU VPS, not Replit autoscale. Uploads still need persistent disk there (P4).

### 2026-10-29: Step 4.3 done (API auth)

How it works (`artifacts/api-server/src/lib/auth.ts`, wired in `routes/index.ts`):
- **Every route except `/healthz` needs a sign-in.** The API verifies the Supabase access token locally: ES256 signature against the project's JWKS (keys are cached and refetched when Supabase rotates them), issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated`, expiry, and `role: authenticated`. No token or a bad one → **401**.
- **Roles come from `app_metadata.role`.** Only the secret key can write `app_metadata`; users can edit `user_metadata`, so that's never trusted. `admin` / `root` → `/admin/*`. Anyone else is an applicant → `/applicant/*` only. The wrong area → **403**, and that includes admins on applicant routes, so no applicant profile is ever made for an admin.
- **An applicant's profile is created on their first request.** It's `demo_profiles` id `usr-<auth id>`, linked by the new unique `auth_user_id` column, with name and organization taken from sign-up metadata (falls back to the email). Starts at tier 1, Unsubmitted, $0. Concurrent first requests create a single row.
- `currentUserId()` / `currentAdmin()` now read the verified identity. Admin actions are recorded with the admin's **email**; applicant actions with their name.
- **Images and downloads:** `<img>` and download links can't send a bearer header. So `POST /api/auth/session` (bearer only) copies the token into the HttpOnly, SameSite=Strict `gp_session` cookie on path `/api`, expiring with the token, and `DELETE` clears it. The cookie authenticates **GET/HEAD only**, so a cross-site form can never trigger a change with it.
- New `GET /api/me` (mode, email, name, role, profileId) lets the frontend choose the workspace in 4.4. OpenAPI updated with the security schemes, codegen run.
- **`AUTH_MODE=demo`** keeps the old preview identities so the live preview keeps working until the sign-in UI exists. The dev script defaults to it. The server refuses to start with it when `NODE_ENV=production`, and refuses to start without `SUPABASE_URL` otherwise (both verified).
- Known limit: Supabase access tokens stay valid until they expire (default 1 hour), so a role removal, ban or sign-out takes up to that long to bite. Lowering the JWT expiry in the Supabase dashboard (Auth → Sessions) shortens it.

**Bug found and fixed:** four older endpoints still hard-coded the demo applicant `usr-jane`:
- `GET /applicant/dashboard`, `PATCH /applicant/profile`, `GET /applicant/account`, `POST /applicant/requests`
- every signed-in applicant would have seen Jane's dashboard and balances, edited her profile, and filed deposit or withdrawal requests on her account

They now take the caller's profile. The global-freeze and balance-credit audits also recorded fixed names instead of the acting admin; fixed too. `demoApplicantId` is gone.

Schema: `demo_profiles.auth_user_id uuid unique`, added on both the Replit DB and Supabase. drizzle-kit wanted an interactive "truncate?" prompt, so the column went in with the equivalent SQL; push now reports no changes on both.

Tested (API copy on :8099; DB backed up and restored around each run; throwaway Supabase users deleted afterwards, leaving only the admin):
- **New `.unlazy/phase4-auth.mjs`: 12/12.** Covered:
  - 401 without a token (incl. unknown paths)
  - refused tokens: garbage, tampered payload, forged signature with the real `kid`, `alg: none`, wrong issuer, publishable key, secret key
  - admin: 200 on admin routes, 403 on applicant routes
  - profile provisioning (one row under 5 parallel first requests)
  - a new applicant loads all 6 applicant pages
  - profile edits, requests and balances act on the caller and leave Jane untouched
  - isolation between applicants and from the sample data
  - `user_metadata.role: admin` doesn't grant admin
  - admin email in the audit trail
  - cookie flags, GET-only, can't mint itself, cleared on DELETE
- **Regression in demo mode: all earlier suites pass.** API 24/24, smoke 46/46, Phase 1 26/26 + 10/10, Phase 2 25/25 + 6/6, Phase 3 22/22 + 16/16.

**Needs:** `SUPABASE_URL` in Replit Secrets (and on the VPS) before running without `AUTH_MODE=demo`. Restart the API Server workflow to pick up this build. It stays in demo mode in development.

Next: 4.4, the sign-in UI. supabase-js in the frontend, `setAuthTokenGetter` for API calls, `POST /auth/session` after sign-in and every token refresh, sign-in / sign-up with email confirmation / reset / sign-out, guarded admin routes. Then drop the dev default of `AUTH_MODE=demo` and give the test scripts a sign-in step.

### 2026-10-29: Step 4.4 done (sign-in UI)

Frontend:
- `src/lib/auth.tsx` (`AuthProvider`):
  - asks `GET /api/auth/config` (new, public) whether sign-in is on
  - starts supabase-js (pinned **2.117.3**; implicit flow, so an email link opened on another device still works)
  - hands API calls the access token through `setAuthTokenGetter`
  - sets the GET-only download cookie (`POST /api/auth/session`) before the workspace renders and after every token refresh
  - loads `/me`
  - signing out or switching user clears the whole React Query cache; a 401 from `/me` (e.g. a deleted account) signs the browser out
- `src/pages/auth.tsx`: **Sign in**, **Create account** (name, optional organization, email, password ≥ 8 + confirm; "check your email" screen), **Forgot password**, **Choose a new password** (after the reset link; "link expired" when there's no recovery session). React Hook Form + Zod. Supabase errors are reworded, e.g. "Email or password is incorrect.", unconfirmed email with a resend button, rate limits.
  - Sign-up and forgot-password give the same answer whether or not the address is registered, so neither reveals which emails have accounts.
- `App.tsx` `AuthGate`:
  - signed out: only the four auth pages; anything else → `/sign-in?next=<page>` (only same-app paths are accepted as `next`)
  - signed in: admins (`admin` / `root`) are kept in `/admin`, applicants out of it
  - an explicit sign-out goes to plain `/sign-in`, so the next person doesn't land on the previous user's last page
  - demo mode is unchanged
- Shell: in real sign-in mode the User/Admin workspace switch and "no real sign-in" notes are gone. Applicants sign out from the account menu (…); admins from a "Signed in as" card in the sidebar (also in the phone drawer, 44px button). Help Centre answers "I forgot my password".
- Saved grants and setup progress (localStorage) are now kept per signed-in user.

API: `GET /api/auth/config`. The API now picks Supabase mode by itself when `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are set; the dev script no longer forces demo. In production it always uses Supabase and refuses to start without both.

Found while building:
- The project's **Site URL is still `http://localhost:3000`**, and no redirect URLs are allowed, so real confirmation and reset links currently land on localhost. Fix in the Supabase dashboard → Auth → URL Configuration: Site URL = the production URL; Redirect URLs = the production URL, `<production>/reset-password`, and the Replit dev URL (+ `/reset-password`) for testing.
- Supabase's built-in email does send (a probe sign-up got a confirmation), but it's heavily rate-limited (a few emails an hour). That's 4.6.

Tested (API copy on :8099 in Supabase mode, Vite through the proxy, demo DB restored after; throwaway Supabase users deleted, so only the admin remains):
- **New `.unlazy/phase4-ui.mjs`: desktop 13/13, phone 3/3.** Covered:
  - redirects with `next`, including query strings
  - validation; wrong password; show/hide password
  - admin lands on the requested admin page; the cookie is HttpOnly and authenticates GETs but not changes
  - an admin is kept out of the applicant side; reload keeps the session
  - sign-out clears the cookie and stored session
  - `?next=//evil.example` is ignored
  - applicant workspace with their own name and no sample data; `/admin` sends them home
  - switching accounts shows no previous-user data
  - sign-up validation and the "check your email" screen
  - the **confirmation link signs a new applicant in** with the name and organization they entered (tokens are removed from the address bar)
  - forgot password
  - the **reset link**: set a new password, the old one stops working, the new one works
  - no console errors
  - phone: all four pages fit at 390px; applicant and admin sign out from the drawer
  - Email links come from the Admin API (`generate_link`, nothing is mailed) and are replayed on the test origin.
- Two failures on the first runs were test mistakes, now fixed: one test expected the old "remember the last page" behaviour after sign-out, which is what led to the explicit sign-out change; another changed only the URL `#` fragment, which isn't a page load.
- API auth `phase4-auth.mjs` 12/12 again. **Demo-mode regression: all 175 earlier checks pass** (API 24, smoke 46, Phase 1 36, Phase 2 31, Phase 3 38).

Restart the API Server workflow to pick this up. Once `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are in Replit Secrets, the dev preview requires sign-in.

### 2026-10-29: Step 4.6 done (email through Resend)

(4.5, TOTP for admins, was skipped at the user's request and is still open. Until it's done, the admin account is protected by its password only.)

Built (API server):
- `lib/email.ts`: one Resend client (`POST /emails`, 10 s timeout, `Idempotency-Key`, retryable vs permanent errors). Needs `RESEND_API_KEY` and `EMAIL_FROM`; without them email is off with a startup warning.
- `lib/emailTemplates.ts`: branded table layout plus a plain-text version for every email. Every value is HTML-escaped (names come from users). Covers:
  - confirm sign-up, reset password, magic link, invite
  - email change (both addresses)
  - re-authentication / sign-in codes
  - the seven Supabase security notices (password changed, email changed, …)
  - app notifications
- `lib/sendEmailHook.ts`: **Supabase Send Email Hook** at `POST /api/hooks/supabase/send-email`. Mounted before `express.json()` (the signature covers the raw bytes). Standard Webhooks check: HMAC-SHA256 over `id.timestamp.body`, `v1,whsec_…` secret, a 5-minute timestamp window, constant-time compare.
  - Builds the `…/auth/v1/verify?token=<hash>&type=…&redirect_to=…` link.
  - Handles Supabase's reversed token fields on email change: the current address gets `token_hash_new`, the new address gets `token_hash`.
  - Sends an email-change notice to the old address.
  - A replayed webhook id is answered without resending. Resend 5xx/429 → 503 (Supabase can retry; idempotency keys stop duplicates); other failures → 500; unknown email types → 400, so nothing goes out silently.
- `lib/notificationMailer.ts`: **notification emails as an outbox**. `notifyUser()` still only writes the row inside the business transaction; a worker (every 15 s, `FOR UPDATE … SKIP LOCKED`) emails it afterwards, so a rolled-back action never sends mail.
  - Only signed-up users (not the sample profiles) with email notifications on get email.
  - Up to 5 tries within 24 h; a permanent refusal isn't retried.
  - New columns `demo_notifications.emailed_at` and `email_attempts`, pushed to both DBs.
  - The link goes to `APP_URL` + the notification's page.

Tested (API copy on :8099 with `RESEND_API_URL` pointing at the new local stand-in `.unlazy/mock-resend.mjs`; no real email sent):
- **New `.unlazy/phase4-email.mjs`: 11/11.** Covered:
  - refused signatures: missing, garbage, wrong secret, ±10 min timestamp, tampered body, unknown version; one valid signature among several is accepted
  - sign-up email: recipient, from, bearer, idempotency key, the exact verify link, plain text
  - HTML escaping of a hostile name
  - recovery / magic link / invite wording and link types
  - the email-change token mapping, with and without Secure Email Change
  - codes and notices (email-changed goes to the old address)
  - 400s for unknown types and bad payloads
  - replay sends once
  - Resend 500 → 503, then the retry delivers exactly once; 422 → 500
  - a real signed-up applicant gets the "deposit approved" email with an app link and their name
  - nothing goes to the sample profiles or to a user who has notifications off
- Rendered the confirmation email in Chromium to check the layout.
- Regression: API auth 12/12, sign-in UI 16/16, and all 175 earlier checks in demo mode.

**To switch it on (needs the user):**
1. Resend: add and verify the sending domain (e.g. `futurenestfund.org`: the DNS records Resend lists), create an API key.
2. Secrets (Replit and VPS):
   - `RESEND_API_KEY`
   - `EMAIL_FROM` (e.g. `GrantApp <no-reply@futurenestfund.org>`)
   - `APP_URL` (the public web address)
   - `SEND_EMAIL_HOOK_SECRET`
3. Supabase dashboard → Authentication → Hooks → **Send Email hook** → HTTPS → `<public API URL>/api/hooks/supabase/send-email` → generate the secret and copy it into `SEND_EMAIL_HOOK_SECRET`. The URL must be reachable from the internet (the VPS, or the Replit dev URL for testing).
4. Then send one real sign-up and one reset to an inbox you control to confirm delivery. That's the one thing that can't be tested from here.

### 2026-10-29: Step 4.7 done (Settings: sign-in & security)

Built:
- `src/components/security.tsx` (`AccountSecurity`) on the **applicant Settings** page and the **admin Settings** page, styled to each workspace. Hidden in demo mode.
  - **Change password:** current + new (≥ 8, ≤ 72) + confirm; refuses reuse of the current password. Supabase's `updateUser` doesn't ask for the current password, so the app checks it first by signing in again with it. A wrong one reads "Your current password is incorrect."
  - **Sign out of other devices** (`signOut({ scope: 'others' })`) and **Sign out everywhere** (`'global'`, behind a confirmation dialog, then plain `/sign-in`). The copy says plainly that a device that's already open keeps access for up to an hour (its access token runs out); it can't sign back in.
  - A "two-factor sign-in is coming soon" note, because 4.5 hasn't been built.
- **Email notifications are the applicant's own choice now** (a switch in Settings → Account). `PATCH /api/applicant/preferences` (OpenAPI + codegen) changes only that flag, keeps the other permissions, and writes an audit row only when it actually changes. The other account settings stay admin-managed, and the page says so. The notification email footer now points to Settings.
- `AuthProvider` gained `signOut(scope)` and `signOutOthers()`. Help Centre: "change my password / sign out other devices" and "stop notification emails".

Tested (API copy on :8099 in Supabase mode via the proxy; throwaway Supabase users deleted; the real admin's password and sessions never touched):
- **New `.unlazy/phase4-security.mjs`: desktop 7/7, phone 1/1.** Covered:
  - preferences API: 401 / 403 / 400s, stored value, other permissions kept, one audit row for two identical saves
  - the switch persists after reload
  - password: required / wrong current / mismatch / reuse refused; after a change the old password fails and the new one works, and the user stays signed in
  - "other devices": a second real session's refresh token is refused, while this browser stays signed in
  - "everywhere": cancel keeps you there; confirm ends this session and another one
  - admin Settings shows the section
  - no console errors
  - phone: no sideways scroll, 44 px buttons
- Regression: API auth 12/12, sign-in UI 16/16, email 11/11, and all 175 earlier checks in demo mode.

Phase 4 status: 4.1, 4.2, 4.3, 4.4, 4.6 and 4.7 done. **4.5 (admin TOTP) is still open.** The email go-live steps listed under 4.6 need the user (Resend domain + key, hook secret, Site URL / redirect URLs).

---

## 10. Hardening plan after the 2026-10-29 review

**Decision (user, 2026-10-29): admins sign in with email + password only. Step 4.5 (admin TOTP) is dropped,** and the "two-factor coming soon" note comes out of Settings. Rotating the credentials that were pasted in chat (DB password, secret key, admin password) is still recommended.

**RLS check (live Supabase, 2026-10-29):**
- All 13 public tables have RLS on: our schema (`.enableRLS()`, migrations) plus the dashboard's `ensure_rls` event trigger. None has a policy.
- Through the public REST API, anonymous and signed-in callers read `[]`, inserts fail with "violates row-level security policy", and updates match 0 rows.
- Gaps:
  - `anon` / `authenticated` still hold table grants (RLS is the only wall)
  - the API connects as `postgres`, which has BYPASSRLS, so RLS never applies to our own server (item 12)

| # | Fix | Done when |
|---|---|---|
| 10 | JWKS timeouts / Supabase unreachable → 503, not 401 (which signed users out) | Test with an unreachable JWKS |
| 5 | Changing or resetting a password signs out every other session | Test: another session's refresh fails afterwards |
| 13 | Applicant profile email follows the Supabase account email | Test |
| 7 | Notification outbox claims rows with a short lease, sends **outside** the transaction, then marks them sent | Tests pass; no long transactions |
| 3 | Verify the Supabase DB TLS certificate (pinned Supabase root CA) instead of `rejectUnauthorized: false` | Connects with verification on |
| 8 | Versioned SQL migrations (drizzle-kit generate + our runner), baseline recorded on both DBs; append-only triggers move from boot code into a migration | `migrate` is a no-op on both DBs; a fresh DB builds from migrations |
| 12 | Dedicated `app_api` DB role on Supabase: no BYPASSRLS, only DML on app tables, RLS policies for `app_api` only; grants revoked from `anon` / `authenticated` | API runs as `app_api`; REST callers still blocked; `app_api` can't touch `auth` or DDL |
| 11 | Admin routes re-check that the Supabase session is still live (signed-out / banned admins lose access within a minute, not an hour) | Test |
| 6 | Email links carry a one-time `token_hash` to the app's `/auth/confirm`, exchanged with `verifyOtp` (no tokens in the address bar); supabase-js moves to the PKCE flow | UI tests: confirm + reset via the new links |
| 9 / 14 | Rate limits on the API (auth'd writes, uploads, hook) + security headers; production Content-Security-Policy for the web app | Tests: 429 past the limit, headers present |
| 1 | Vitest test suite committed in the repo (`pnpm test`): token verification, webhook signatures, email mapping/escaping, rate limits, redirect safety. `.unlazy/` browser scripts stay git-ignored as the stack asks. | `pnpm test` green |
| 4 | Supabase dashboard (user): minimum password length 8 | User confirms |

### 2026-10-29: Hardening done (§10)

| # | What changed | Proof |
|---|---|---|
| 4.5 | **Dropped** (admins use email + password, user decision). The "two-factor coming soon" note is removed. | security suite checks it's gone |
| 10 | Supabase key server unreachable or timing out → **503** "couldn't check your sign-in" (the app offers a retry), not 401, which signed people out | Vitest (down + timeout) |
| 11 | Every token is re-checked with Supabase `/auth/v1/user` (≤ 1×/min per token, cached by hash). Signed-out sessions, bans and removed admin rights apply within a minute, and the **role comes from the live answer**, not the token. | phase4-auth: revoked session 401; token still claiming admin → 403 after demotion; ban → 401 |
| 5 | Changing **or resetting** a password signs out every other session | phase4-security: another device's refresh token is refused afterwards |
| 13 | The applicant profile email follows the account's email (notifications go to the current address) | phase4-auth |
| 7 | The notification outbox claims rows in one short statement (SKIP LOCKED + a 2-minute lease, new column `email_claimed_until`) and sends with **no transaction or lock held**; a failed send retries after a minute | phase4-email 11/11 |
| 3 | Supabase DB TLS is **verified** against the pinned Supabase Root 2021 CA (`lib/db/src/supabaseCa.ts`; the fingerprint matched both the live chain and Supabase's published file). Used by the app, drizzle-kit and the scripts. | connects with verification; any other CA is refused |
| 8 | **Versioned migrations:** `lib/db/migrations/0000_baseline` (11 tables, RLS) · `0001` lease column · `0002` append-only triggers (moved out of boot code; boot now only checks they exist). `pnpm --filter @workspace/scripts run db:migrate` (also applies `lib/db/supabase/migrations`). `--baseline` recorded 0000 on the Replit DB and on Supabase. | fresh DB builds from migrations (11 tables, RLS, 3 triggers; push then reports no diff); reruns are no-ops |
| 12 | **`app_api` role** for the API on Supabase (migration `supabase/0002`): no BYPASSRLS, DML on `demo_*` only, through `app_api_all` RLS policies; grants revoked from `anon` / `authenticated` (default privileges too). Password set by `db:app-role` from `APP_DB_PASSWORD`. Migrations and seeding use `SUPABASE_ADMIN_DB_URL`. | as app_api: reads/writes OK; `auth.users`, `user_roles`, CREATE TABLE, TRUNCATE, editing audit rows, disabling RLS and dropping triggers are all refused. The public Data API now answers "permission denied" (it used to return `[]`). Full API + smoke suites pass against Supabase as app_api. |
| 6 | Email links → the app's **`/auth/confirm?token_hash=…&type=…&next=…`**, exchanged with `verifyOtp`. supabase-js now uses PKCE. No session tokens in any URL; links work on any device; pre-fetching scanners can't use them up; `next` only for our own origin. The page waits for the session before moving on (no "expired" flash). | phase4-ui: confirm, reset, reused / garbage / incomplete links show "expired" and sign nobody in; address bar cleaned |
| 9 / 14 | Rate limits (`lib/rateLimit.ts`): per-IP 600/min, writes 60/min per account, uploads 20/10 min, hook 120/min → 429 + Retry-After. `TRUST_PROXY` for nginx. JSON bodies ≤ 100 kB. API headers: CSP `default-src 'none'`, X-Frame-Options, CORP, Permissions-Policy, HSTS (production). **Production web build carries a strict CSP** (scripts only from the site). | Vitest (limits, windows, per-account vs per-IP); header checks; browser suites pass on the production build with no CSP violations |
| 1 | **`pnpm test` (Vitest 5.0.3): 43 tests**, committed: token verification (expired / other project / audience / anon / forged key / tampered / `alg: none` / HS256 confusion / key server down), Standard Webhooks signatures, email link mapping and escaping, rate limiter, `safeNext`, auth error wording. Mutation check: weakening `safeNext` makes 3 tests fail. `.unlazy/` stays git-ignored as the stack asks. | `pnpm test` green |

Also found and fixed while testing:
- the boot trigger check used `= any(${array})`, which drizzle expands into invalid SQL (the API wouldn't start); caught on the first run
- the email-notification switch had a 28 px tap target → now 44 px
- `safeNext` now also refuses backslashes and control characters (e.g. `/\t/evil.com`)

Verification run (2026-10-29), all passing:
- API auth 16/16, sign-in UI 14+3, security 7+1, email 11/11 (dev frontend)
- the same UI suites on the **production build with its CSP**
- **on Supabase as `app_api`**: API auth 16/16, Phase 3 API 24/24, smoke 46/46
- demo mode: all 175 earlier checks
- `pnpm test` 43/43, typecheck clean
- Test data restored on both DBs; throwaway auth users deleted (only the admin remains)

**Needs the user:**
1. **New / changed secrets** (Replit + VPS). The values are in the session scratchpad file `supabase.env`, never in git.
   - `SUPABASE_DB_URL` is now the **`app_api`** pooler URL.
   - Add `SUPABASE_ADMIN_DB_URL` (the old `postgres` URL), used only for `db:migrate` / `seed:admin`. Keep it off the running app if possible.
   - On the VPS behind nginx: `TRUST_PROXY=1`.
2. **Supabase dashboard → Authentication → Policies (passwords):** minimum length **8** (it's 6 today; confirmed).
3. Still from 4.6: Resend domain + key, `EMAIL_FROM`, `APP_URL`, hook URL + `SEND_EMAIL_HOOK_SECRET`, Site URL / Redirect URLs. Redirect URLs now only need the app origin (email links go to `/auth/confirm`).
4. Rotate the credentials pasted in chat (DB password, secret key, admin password). After a DB password change, update `SUPABASE_ADMIN_DB_URL`.

## 11. Phase 5 build plan: admin controls (2026-10-30)

**Decision (2026-10-30): two-person (4-eyes) approval is dropped.** It would make two different admins approve every withdrawal. That changes nothing for the applicant except a longer wait, but with one admin today it would block every withdrawal. Withdrawals stay **one finance admin approves or declines**, as the user described.

**The withdrawal flow the user wants (5.1):**
1. **Applicant requests a withdrawal** (Withdrawals page). The amount is held: it comes off "available to withdraw" at once, so the same funds can't be requested twice. The grant balance itself doesn't change yet.
2. **At once, the applicant gets:**
   - an in-app notification: "Withdrawal request of $X received (ref ABC12345). Our finance team will review it; your funds are released once it's approved."
   - an **email** saying the same: amount, reference, date, what happens next, and a button to the Withdrawals page.
3. **Admin side:** the request appears in **Withdrawal Page** (queue) and in the dashboard's "Pending withdrawals" count. The admin approves or declines; a decline needs a reason. This already exists (Phase 3), with freeze, balance and KYC re-checks at approval time.
4. **On approval:** the grant balance is debited through the ledger, and the applicant gets a notification + email: "approved, your funds are on their way."
5. **On decline:** no money moves and the held amount is available again. The applicant gets a notification + email with the reason.

What exists today vs. what 5.1 adds:

| Piece | Today | 5.1 |
|---|---|---|
| Request + hold on available balance | ✅ (`demoWorkspace.ts` `createRequest`) | unchanged |
| Notification on request | ✅ generic "Withdrawal request for $X submitted for review" | finance-team wording + reference number |
| Email on request / approval / decline | only the generic notification email (subject = message, heading "You have an update"), and only when the email switch is on | **dedicated templates**: "Withdrawal request received", "Withdrawal approved", "Withdrawal declined", with amount, reference, date, reason and next steps; same set for deposits |
| Applicant screen after submitting | toast "will show as Pending" | confirmation panel with reference + "what happens next" (3 steps), request list shows "Under review" / "Approved" / "Declined" + reason |
| Admin queue | ✅ approve / decline | show the reference; optional new-request email to the finance team (decision below) |

How the dedicated emails are built:
- New nullable columns on `demo_notifications`: `email_kind` (e.g. `withdrawal_requested`) and `email_data` (jsonb: amount, reference, reason). Migration `0003`. No new table, so no new RLS policy is needed.
- `notifyUser()` takes an optional `{ kind, data }`; the outbox worker renders the matching template from `emailTemplates.ts`, or the generic one when there's no kind. Every value is still HTML-escaped.
- Sending stays in the outbox: nothing is emailed if the action rolls back, with retries and idempotency keys as today.

Tests: Vitest for the new templates (content + escaping); `.unlazy/` browser suite: request → notification + email captured by the local Resend stand-in → admin approve and decline → second notification + email, balances and ledger correct.

**The rest of Phase 5:**

| Step | Goal | What gets built | Done when |
|---|---|---|---|
| **5.1 Withdrawal notifications** | The flow above | see above | Browser suite + Vitest green |
| 5.2 Withdrawal limits | Guard rails without a second admin | Admin Settings: max per request and a per-user daily total (0 = off), checked server-side when requesting and re-checked on approval; audited changes | Over-limit requests refused with a clear message |
| 5.3 Audit-log viewer | Admins can read the full trail | Admin page with filters (user, admin, action text, date range), pagination and CSV export (formula-safe, like the ledger) | Filters + export tested |
| 5.4 Users directory | Usable with many users | Sorting (name, joined, balance, status) and server-side pagination | Tested with 100+ users |
| 5.5 Debit adjustments | Admins can correct balances down | "Remove funds" next to "credit balances": reason required, can't go below 0, ledger + audit + notification in one transaction | Tested, ledger matches balances |
| 5.6 Card controls (admin) | Freeze / unfreeze a sample card | Per-card freeze on the user inspector, audited, applicant notified | Tested |
| 5.7 Admin avatar | Real admin photo | Admin uploads their own photo (same pipeline as applicant photos) | Tested |

Order: 5.1 first (what the user asked for), then 5.2–5.7. Each step is committed on its own, after typecheck, `pnpm test` and its browser suite pass.

**Answers (2026-10-30):**
1. Money emails **follow the applicant's email switch**, but the admin can **override it per user** on the admin user profile: email notifications and in-app ("push") notifications can each be set to *user's choice* / *forced on* / *forced off*, and the admin's setting wins whatever the user chose. There's no browser/phone push in the app, so "push" = the in-app bell. When locked, the applicant's switch is disabled with "Set by your administrator".
2. **No admin email** for new requests: dashboard count + Withdrawal Page only.
3. **Limits (5.2):** a **global** withdrawal limit (admin Settings) and an optional **per-user** limit (admin user profile) that replaces the global one for that user. Each limit has a max per request and a daily total; 0 / empty = no limit.

**5.1 revised scope:**
- `demo_notifications`: new columns `email_kind`, `email_data` (jsonb), `in_app` (boolean, default true). Migration `0003`.
- Profile permissions: `emailOverride` and `inAppOverride` (`null` = user's choice, `true` = forced on, `false` = forced off), set from the admin inspector (audited, API `PATCH /admin/users/:id`). The outbox sends when `emailOverride ?? emailNotifications` is true. In-app rows are always written (so email still works), but `in_app = false` rows are hidden from the bell when in-app is forced off.
- Applicant Settings: the email switch shows the effective value and is disabled with "Set by your administrator" when overridden; `PATCH /applicant/preferences` refuses changes while it's locked.
- Dedicated withdrawal/deposit email templates + new notification wording + confirmation panel on the Withdrawals page (as above).

### 2026-10-30: Step 5.1 done (withdrawal notifications + admin notification overrides)

| What | Where |
|---|---|
| Migration `0003_notification_templates`: `demo_notifications.email_kind`, `email_data` (jsonb), `in_app` (default true) | `lib/db/src/schema/demo-applications.ts`, `lib/db/migrations/0003_*` |
| Dedicated emails "We received your withdrawal/deposit request", "… was approved", "… was declined" (amount, reference, date, status, reason; finance-team wording); new `rows` block in the layout | `emailTemplates.ts` `moneyEmail()` |
| `notifyUser(…, email?)` stores the template + data; the outbox renders it (generic template otherwise). `in_app` is computed from `permissions.inAppOverride` at insert, and the bell lists only `in_app` rows | `notifications.ts`, `notificationMailer.ts` |
| Request references (`requestReference(id)`, first 8 hex chars uppercased) in notifications, the applicant list (`reference`, `reviewNote`) and the admin queue (`reference`) | `demoWorkspace.ts`, `adminOps.ts`, OpenAPI |
| Admin overrides `permissions.emailOverride` / `inAppOverride` (null = user's choice, true/false = forced). The outbox sends when `emailOverride ?? emailNotifications`. Admin permission updates now **merge** into the stored permissions, and the audit reads "email notifications: always off (admin override)" | `demoWorkspace.ts` `changeProfile`, admin inspector `NotificationOverride` |
| `PATCH /applicant/preferences` refused (400) while the email setting is overridden; the applicant sees "Set by your administrator" with a lock | `changePreferences`, `EmailNotificationsSwitch` |
| Withdrawals / Add funds: "request placed" panel (reference + 3 steps: placed → finance team review → funds released), statuses read "Under review / Approved / Declined", reference on every request row; Help Centre answer updated | `applicant.tsx`, `applicant-more.tsx` |

Tests (2026-10-30), all passing:
- `pnpm test` 47/47 (4 new money-email tests) · typecheck clean
- new `.unlazy/phase5-withdrawals.mjs` 11/11 (demo-mode API + mock Resend): hold on request, notification + email on request / approval / decline, escaped reason, deposits, switch respected, admin always-on and always-off win, locked preference refused, in-app off hides from the bell but still emails, permissions merge, audit wording
- new `.unlazy/phase5-ui.mjs` 4/4 desktop + 4/4 phone: placed panel, statuses + references, locked switch, override buttons (44 px), admin queue reference
- `phase3-api` 24/24 (one assertion updated for the new "(ref …)" wording)
- Demo data restored on the Replit DB.

Not done yet:
- Migration `0003` is applied on the **Replit** database only. Supabase needs `pnpm --filter @workspace/scripts run db:migrate` with `SUPABASE_ADMIN_DB_URL` set (not available in this shell).
- Withdrawal emails go out only once Resend is configured (go-live checklist §12).

### 2026-10-30: Step 5.2 plan (withdrawal limits)

**Rules**
- Two limits: **max per request** and **daily total**. The daily total counts withdrawals in the **last 24 hours** that are under review or approved; declined ones don't count. Either limit can be empty, meaning no limit.
- **Global limit** (admin Settings) applies to everyone by default.
- **Per-user limit** (admin user profile): "Use the global limit" or "Custom for this user". A custom limit **replaces** the global one for that user and can be higher or lower; an empty custom field means no limit for that user.
- Amounts are $0.01–$1,000,000 with 2 decimals. A daily total lower than the max per request is refused.
- **Enforced when the applicant places a request**, server-side, inside the same transaction that locks the profile (two quick requests can't slip past the daily total). The messages say which limit applies, e.g. "You can withdraw up to $500.00 per request" or "You have $200.00 left of your $1,000.00 daily limit".
- **Approval isn't blocked by limits** (the admin is the reviewer), but the queue flags a request that is above the user's *current* limit, e.g. after the limit was lowered.
- Every change is audited. When an admin changes a user's own limit, that user is notified (in-app + email, per their notification settings). Changing the global limit sends no notifications.

**Build**

| Part | What |
|---|---|
| DB (migration 0004) | `demo_settings.withdrawal_max_cents`, `withdrawal_daily_cents` (nullable); `demo_profiles.withdrawal_limit_custom` (default false), `withdrawal_max_cents`, `withdrawal_daily_cents` (nullable) |
| API | `GET` / `PUT /admin/system/withdrawal-limits`; `PUT /admin/users/:id/withdrawal-limits` `{ custom, maxPerRequest, dailyTotal }`; `AdminUserProfile.withdrawalLimits` (custom flag, effective limits, used in the last 24 h); `ApplicantAccount.withdrawalLimits` (effective limits, used, left); `AdminRequest.limitWarning` |
| Applicant UI | Withdrawals form shows "Up to $X per request · $Y per 24 hours ($Z left)" and checks it before sending |
| Admin UI | Settings: "Withdrawal limits" card (two fields, empty = no limit). User profile: "Withdrawal limits" card (global / custom). Queue: a limit warning on a flagged request |
| Tests | Vitest for the limit check (pure function); `.unlazy/phase5-limits.mjs` API suite; browser checks desktop + phone |

### 2026-10-30: Step 5.2 done (withdrawal limits)

Built as planned above, with these details:
- Pure rules in `api-server/src/lib/withdrawalLimits.ts` (`effectiveLimits`, `limitProblem`, `parseLimits`, `withdrawnLast24h`), plus Vitest.
- Enforced in `createApplicantRequest` after the profile row lock, so simultaneous requests are serialised.
- Admin setters `changeGlobalWithdrawalLimits` / `changeUserWithdrawalLimits` and the queue's `limitWarning` are in `adminOps.ts`.
- Routes: `GET`/`PUT /admin/system/withdrawal-limits`, `PUT /admin/users/:id/withdrawal-limits`.
- `withdrawalLimits` (custom flag, effective limits, `usedLast24h`) is on `AdminUserProfile` and `ApplicantAccount`.
- UI in `grant-platform/src/components/withdrawal-limits.tsx`:
  - admin Settings card
  - user-profile card with "Use global limits" / "Custom for this user"
  - "Your limits" line with what's left today on the Withdrawals form, with the same checks before sending
  - amber warning in the queue
- Copy: the 4-eyes banner, tooltip and Settings line now say two-person approval is not used, and one finance admin decides.

Tests (2026-10-30), all passing:
- `pnpm test` 50/50 · typecheck clean
- new `.unlazy/phase5-limits.mjs` 10/10:
  - defaults and validation
  - per-request limit, then the 24-hour total
  - declined and > 24 h requests don't count; approved ones do
  - custom limits replace global (higher too); empty custom fields = no limit
  - back to global; the queue warning doesn't block approval
  - audit and notification
  - **5 simultaneous requests against a $100 daily limit: exactly 1 accepted**
- new `.unlazy/phase5-limits-ui.mjs` 6/6 desktop + 6/6 phone
- regressions: `phase5-withdrawals` 11/11, `phase5-ui` 4+4, `phase3-api` 24/24, `phase3-desktop` 22/22, `phase3-phone` 16/16. `phase3-desktop` now uses the KYC switch where it used the admin email switch replaced in 5.1.
- Demo data restored. Migration `0004` is applied on the Replit DB only; Supabase still needs `db:migrate` (0003 + 0004).

### 2026-10-30: Step 5.3 plan (audit-log viewer)

**Goal:** admins can read and export the whole audit trail (`demo_audit`, append-only), not just the last 30 rows per user in the inspector or 8 on the dashboard.

**Where it lives:** a new page `/admin/audit`, "Audit log". The admin menu stays the 7 items of the written spec (decision 2026-10-21), so the page is reached from:
- a new "Audit log" card in Settings ("Open audit log")
- the dashboard's Recent activity ("View full audit log")
- each user's Audit trail in the inspector ("View all", opening the page filtered to that user)
- header search results for audit entries

If the user wants it in the menu instead, that's a one-line change.

**Page**
- Filters: free-text search (action text, user name or ID, who did it, entry ID), user (all users / one user / platform-wide entries with no user), done by (all, or one of the distinct actors), from / to dates (UTC whole days, `to` inclusive).
- Table, newest first: date + entry ID, user (link to the profile, or "Platform"), action, done by. 25 per page with Previous / Next, plus the matching count. The filters are kept in the URL (`?userId=…`), so links from the inspector work.
- **Export CSV** of all matching entries (up to 10,000), with the same formula-injection protection as the ledger export: Entry ID, Date (UTC), User ID, User, Action, Done by.
- Empty, loading and error states; no sideways page scroll on a phone (the table scrolls inside its card).

**API (OpenAPI first, then codegen)**
- `GET /admin/audit?search&userId&actor&from&to&page` returns `{ items, total, page, pageSize, actors }`. `actors` lists the distinct "done by" values for the filter. `userId=platform` means entries with no user.
- `GET /admin/audit/export` with the same filters returns `text/csv`, via the GET-only session cookie like the ledger export.
- Admin-only like every `/admin/*` route. Read-only: there is no way to change or delete an entry, and the database triggers still refuse it.

**Tests:** `.unlazy/phase5-audit.mjs` (API: filters, combined filters, pagination, platform entries, actor list, CSV content + formula neutralising, bad dates → 400, applicant → 403 is covered by phase4-auth's default-deny) and `.unlazy/phase5-audit-ui.mjs` (desktop + phone: entry points, filters, URL filter from the inspector, export link, pagination, no overflow).

### 2026-10-30: Step 5.3 done (audit-log viewer)

Built as planned above.
- **API:** `listAudit` / `exportAuditCsv` in `adminOps.ts`; routes `GET /admin/audit` and `GET /admin/audit/export`.
- **Page:** `AdminAuditPage` in `admin-ops.tsx`, route `/admin/audit`.
- **Entry points:**
  - Settings "Audit log" card
  - dashboard "View full audit log"
  - inspector "View all", which opens the page filtered to that user (`?userId=`)
  - header-search audit results now open `/admin/audit?search=<entry id>` (before, they went to the user, or nowhere for platform entries)

Also changed while building:
- **Phone layout:** one card per entry, so the action is readable without scrolling sideways; wider screens keep the table.
- **Date filters (ledger and audit):** an impossible date such as `2026-02-31` passed the YYYY-MM-DD pattern and reached the database (500). Both now answer 400 with "isn't a valid date".
- **Ledger CSV export:** it set its download headers before running the query, so an error came back as a download. It now builds the CSV first.

Tests (2026-10-30), all passing:
- `pnpm test` 50/50 · typecheck clean
- new `.unlazy/phase5-audit.mjs` 9/9:
  - order, paging, actor list
  - search by action / user / actor / entry ID, with `%` and `_` taken literally
  - user and platform filters; exact done-by filter; combined filters
  - inclusive UTC days
  - bad dates → 400 for the audit and ledger lists and exports
  - CSV header, filter, formula neutralising, quote escaping, Platform label
  - no write routes; the database refuses deletes
- new `.unlazy/phase5-audit-ui.mjs` 6/6 desktop + 6/6 phone, including the real header search
- regressions: `phase5-limits` 10/10, `phase5-withdrawals` 11/11, `phase3-api` 24/24, `phase5-limits-ui` 6+6, `phase5-ui` 4+4, `phase3-desktop` 22/22, `phase3-phone` 16/16
- Demo data restored. No schema change in 5.3 (no migration).

### 2026-10-30: Step 5.4 plan (users directory: sorting and pagination)

**Today:** `GET /admin/users` returns every matching user in one list, sorted by name only. The Users page shows them all in one table that needs sideways scrolling on a phone.

**API** (`GET /admin/users`, backward compatible: same filters, same `items` / `total`)
- New query params:
  - `sort`: `name` (default) · `joined` · `grant` · `deposit` · `tier` · `status`
  - `dir`: `asc` / `desc`; the default is `asc` for name and `desc` for joined and the balances
  - `page` (default 1) and `pageSize` (default 25, max 500)
- Sorting and paging happen in the database. Ties are broken by user ID so pages never overlap or skip anyone.
- The response adds `page` and `pageSize`.
- The other admin pages' user dropdowns (ledger, audit, request queues) ask for `pageSize=500&sort=name`. Past 500 users they'd need a searchable picker, noted for Phase 6.

**Users page**
- Sortable column headers (click again to reverse; `aria-sort` for screen readers) for User, Joined, Tier, Status, Grant and Deposit. A new **Joined** column is added.
- On phones: a "Sort by" menu and one card per user (no sideways scroll).
- Previous / Next with "Showing 26–50 of 120". A change of search, status or sort goes back to page 1.
- Search, status, sort, direction and page are kept in the address bar, so "back" from a user returns to the same page of the list. The existing `?q=` link from the header search still works.

**Tests:** `.unlazy/phase5-users.mjs` (API, with 120 extra test users: every sort in both directions against SQL, page boundaries without overlap, filters + sort + page together, bad params → 400, pickers still list everyone), and `.unlazy/phase5-users-ui.mjs` (desktop + phone: header sorting, `aria-sort`, pagination, address-bar state through back navigation, phone cards, no overflow). Phase 3 suites re-run.

### 2026-10-30: Step 5.4 done (users directory: sorting and pagination)

Built as planned above.
- **API:** `listUsers` in `demoWorkspace.ts` takes `search, status, sort, dir, page, pageSize`. It sorts and pages in the database, breaks ties by ID, and returns `page` / `pageSize`. Search escapes `%` and `_` like the other admin searches.
- **Page:** `AdminUsersPage` / `UserTable` in `admin.tsx`.
  - sortable headers with `aria-sort`, plus a new Joined column
  - Previous / Next and "Showing 26–50 of N"
  - state in the address bar; sort and page changes add a history entry, typing doesn't
- **Phones:** a "Sort by" menu, and one card per user (name, organization, tier + join date, status / KYC badges, grant balance).
- **User dropdowns** on the ledger, audit and request-queue pages request `pageSize=500&sort=name`.

Tests (2026-10-30), all passing:
- `pnpm test` 50/50 · typecheck clean
- new `.unlazy/phase5-users.mjs` 7/7, with 120 extra users and many ties:
  - all 6 sorts × 2 directions match the database order
  - default directions
  - walking every page visits each user exactly once
  - search + status + sort + page together; `%` / `_` taken literally
  - bad params → 400
  - dropdowns still list everyone
- new `.unlazy/phase5-users-ui.mjs` 6/6 desktop + 6/6 phone:
  - header sorting and `aria-sort`
  - paging, and "back" from a user returns to the same page and sort
  - filters reset to page 1; the `?q=` link works
  - no overflow; 44 px buttons; the join date isn't cut off
- regressions: phase5 audit 9/9, limits 10/10, withdrawals 11/11, phase3-api 24/24, phase5 UI suites 6+6 / 6+6 / 4+4, phase3-desktop 22/22, phase3-phone 16/16
- Test users removed, demo data restored. No schema change (no migration).

### 2026-10-30: Step 5.5 plan (debit adjustments)

**Goal:** an admin can take money **off** a user's grant, deposit or card balance (to correct a mistake, reverse a credit, or recover funds), not only add it. The money is sample data as before.

**Rules**
- A debit needs a **reason** (5–240 characters). It's written to the ledger, shown to the user in their notification, and kept in the audit log.
- **No balance below $0.** A debit larger than the balance is refused, with the current balance in the message.
- **Pending withdrawals are protected:** a grant debit can't eat into money held by withdrawals under review. "This would leave $X, less than the $Y held for pending withdrawals." Otherwise those withdrawals could never be approved.
- Same as credits: refused during a global freeze or while the account is frozen; amount $0.01–$1,000,000 with 2 decimals.
- One transaction with row locks (settings → profile, like credits): balance update + ledger row (new type **"Debit"**, negative amount) + audit entry + notification. The notification is emailed per the user's notification settings: "$X was removed from your grant balance: <reason>".

**API**
- `POST /admin/users/:id/balance-adjustments` gets an optional `direction`, `credit` (default, so the current behaviour is unchanged) or `debit`.
- "Debit" is added to the ledger and transaction types.

**UI**
- User profile → Balances: a **Debit** button next to Credit on each account.
- The adjustment dialog becomes "Credit a balance" / "Remove funds". For a debit it shows the current balance and the balance after, and a confirmation step: "Remove $X from Jane Cooper's grant balance?"
- **Admin Transactions:** a "Debits" type filter; debits appear as money out.
- **Applicant Transactions:** a "Debits" filter and the reason in the row.
- **Reports:** a "Removed by an administrator" line.

**Tests:** `.unlazy/phase5-debits.mjs` (API: each account; can't go below 0; pending-withdrawal protection; freezes; validation; ledger, audit, notification and email all written once and atomically; concurrent debits can't overdraw) and `.unlazy/phase5-debits-ui.mjs` (desktop + phone: dialog, before/after, confirm, errors shown, applicant sees it). Earlier suites re-run.

### 2026-10-30: Step 5.5 done (debit adjustments)

Built as planned above.
- **Server:** `adjustBalance(…, direction)` in `demoWorkspace.ts`.
  - One transaction with settings → profile locks.
  - Refuses a balance below $0, or a grant balance below what pending withdrawals hold.
  - Writes the ledger row (kind **Debit**, negative), the audit entry ("Debit grant −$X · reason") and a notification with the reason.
- **API:** `POST /admin/users/:id/balance-adjustments` takes `direction` (`credit` default | `debit`). "Debit" was added to the ledger and transaction type enums.
- **UI:**
  - The `CreditModal` gains a debit mode: "Remove funds", balance before → after, a confirmation step, and server refusals shown in the dialog.
  - Debit buttons on each balance in the user profile (disabled at $0).
  - "Debits" filters on the admin Transactions and applicant Transactions pages.
  - "Removed by an administrator" line on the applicant's Reports.
- Credit amounts in audit and notification text now use thousands separators ("$1,000.00"); the wording is otherwise unchanged.

Tests (2026-10-30), all passing:
- `pnpm test` 50/50 · typecheck clean
- new `.unlazy/phase5-debits.mjs` 8/8:
  - ledger + audit + notification written once each
  - the applicant sees the notification, the transaction and the email
  - all 3 accounts
  - never below $0; the pending-withdrawal hold is protected and the withdrawal stays approvable
  - freezes, validation, 404
  - credits unchanged (direction defaults to credit)
  - **6 simultaneous $30 debits on $100: exactly 3 accepted, $10 left**
- new `.unlazy/phase5-debits-ui.mjs` 5/5 desktop + 5/5 phone
- regressions: users 7/7, audit 9/9, limits 10/10, withdrawals 11/11, phase3-api 24/24; UI suites users 6+6, audit 6+6, limits 6+6, phase5-ui 4+4; phase3-desktop 22/22, phase3-phone 16/16
- Demo data restored. No schema change (no migration).

### 2026-10-30: Step 5.6 plan (admin card controls)

**Today:**
- Cards are sample data in `demo_profiles.cards` (jsonb); there's no card network.
- The seeded sample profiles have a Virtual Visa (Active) and a Physical Mastercard (Pending, "Awaiting issuance"). **Signed-up users get no card at all.**
- Admins can only top up the card account; nothing changes a card's status.

**What admins get** (User profile → Balances and cards):

| Action | From → to | Needs |
|---|---|---|
| **Issue a card** (Virtual or Physical, Visa or Mastercard) | new: Virtual → Active; Physical → Pending | At most one non-cancelled card of each kind per user |
| **Mark as issued** (physical card delivered) | Pending → Active | |
| **Freeze** | Active → Frozen | A reason (5–240 characters), shown to the user |
| **Unfreeze** | Frozen → Active | |
| **Cancel** (permanent) | Active / Frozen / Pending → Cancelled | A reason, plus a confirmation |

- Any other transition is refused with a clear message (e.g. "This card is already frozen").
- Card actions are refused while the **user's account is frozen** (the account freeze already pauses money movement). They're allowed during the global freeze, since they move no money.
- Each action takes a row lock on the profile, writes an **audit entry** ("Card •• 4829 frozen · reason"), and **notifies the user** (in-app + email per their settings).
- What a frozen or cancelled card blocks today: **card top-ups** ("Top up" works only on an Active card), since nothing else spends from cards. The screens say so plainly, and the API refuses a credit to the card account when the user has no active card.

**Applicant Cards page:** shows each card's status. A frozen card says "Frozen by an administrator: <reason>"; cancelled cards are listed under "Cancelled cards", greyed out. Applicants freezing their own card is Phase 6 ("card controls for applicants").

**API** (no schema change: cards stay in the jsonb column, and status gains `Cancelled`):
- `POST /admin/users/:id/cards` `{ kind, network }` issues a card and returns the user.
- `POST /admin/users/:id/cards/:cardId/actions` `{ action: activate | freeze | unfreeze | cancel, reason? }` returns the user.
- `UserCard` gains optional `statusReason` and `issuedAt`.
- New card numbers are a random last four; never real numbers.

**Tests:** `.unlazy/phase5-cards.mjs` (API: every allowed and refused transition, reasons, one-per-kind rule, account freeze vs global freeze, audit + notification, top-up rule, concurrent actions on one card, works for a user with no cards) and `.unlazy/phase5-cards-ui.mjs` (desktop + phone: issue, mark issued, freeze with reason, unfreeze, cancel with confirmation, applicant view). Earlier suites re-run.

### 2026-10-30: Step 5.6 done (admin card controls)

Built as planned above.
- **Server:** `api-server/src/lib/cards.ts`.
  - `issueCard`: Virtual → Active, Physical → Pending; one non-cancelled card per kind.
  - `changeCard`: activate / freeze / unfreeze / cancel, with a transition table and clear refusals. A reason is needed to freeze or cancel, and is shown to the user.
  - Each change takes the profile row lock, writes an audit entry and notifies the user. Refused while the account is frozen; allowed during the global freeze.
  - `adjustBalance` refuses a card top-up when the user has no active card (debits still work).
  - A virtual card shows the card account balance unless it's cancelled.
- **API:** `POST /admin/users/:id/cards`, `POST /admin/users/:id/cards/:cardId/actions`. `UserCard.status` adds `Cancelled`, with optional `statusReason` and `issuedAt`. No migration: cards stay in the jsonb column.
- **Admin UI:** `components/card-controls.tsx` on the user profile.
  - Issue card dialog.
  - Per card: Mark as issued / Top up / Freeze / Unfreeze / Cancel card, by status.
  - Freeze and cancel ask for a reason; cancel says it's permanent.
  - A "Cancelled cards" list.
- **Applicant Cards page:** a frozen card is dimmed with a "Frozen" label and "Frozen by an administrator: <reason>. It can't be topped up until it's unfrozen."; a separate "Cancelled cards" list; an empty state that says an administrator can issue a card.

Tests (2026-10-30), all passing:
- `pnpm test` 50/50 · typecheck clean
- new `.unlazy/phase5-cards.mjs` 9/9:
  - every allowed and refused transition
  - reasons
  - top-up needs an active card; debit doesn't
  - cancel keeps the account balance
  - issue rules
  - a user with no cards
  - account freeze vs global freeze
  - bad input 400/404
  - **5 simultaneous freezes of one card: exactly 1 succeeds, 1 audit entry**
- new `.unlazy/phase5-cards-ui.mjs` 5/5 desktop + 5/5 phone
- regressions:
  - API: debits 8/8, users 7/7, audit 9/9, limits 10/10, withdrawals 11/11, phase3-api 24/24
  - UI: phase5 cards / debits / users / audit / limits / phase5-ui on desktop + phone; phase3-phone 16/16; phase1-desktop 26/26, phase1-phone 10/10
  - phase3-desktop 22/22. One run had a single timeout in "users directory reads ?q= from the header search Enter" (a page 5.6 doesn't touch); it passed on 3 straight reruns. Noted as a timing flake to keep an eye on.
- Demo data restored.

### 2026-10-30: Step 5.7 plan (profile photos: the admin's own, and users' from the inspector)

**Decision (user, 2026-10-30): build both readings of 5.7.** The Phase 5 plan meant the admin's own photo; backlog A4 meant the camera button on the user inspector, which today only previews a file locally ("preview only, not uploaded").

**Today:**
- Admins have no profile row (only applicants get `demo_profiles`), so there is nowhere to keep an admin photo. The admin sidebar shows only the email.
- Applicant photos already go through the shared upload pipeline: the real type is read from the bytes, sharp re-encodes to a 256 px WebP (EXIF/GPS stripped), 10 MB cap, rows in `demo_files`, served with a sandbox CSP.

**A. The admin's own photo**
- New table `demo_admin_profiles` (`id` = `adm-<auth user id>`, or `adm-demo` in demo mode; `email`, `avatar_file_id`, `updated_at`). Migration `0005` + Supabase migration `0003` (its `app_api_all` policy; no grants for `anon` / `authenticated`).
- API: `GET /admin/me` → `{ name, email, avatarUrl? }`; `POST /admin/me/avatar` (multipart) and `DELETE /admin/me/avatar`, same pipeline. Audited as a platform entry ("Administrator profile photo updated / removed") with the admin's email as actor.
- UI: a "Your profile photo" card in admin Settings (change / remove, errors shown inline); the photo (or initials) shows in the sidebar account card and in the header.

**B. A user's photo from the inspector**
- API: `POST /admin/users/:id/avatar` and `DELETE /admin/users/:id/avatar` → the updated user. Audit: "Profile photo updated by an administrator", actor = admin. The user is notified ("An administrator updated / removed your profile photo"). Allowed while the account or platform is frozen (no money moves).
- UI: the inspector's camera button really uploads (spinner, inline errors), plus a "Remove photo" action. The "preview only" toast goes away.

Both reuse the existing upload rate limit (20 per 10 min per account). The previous file is deleted after the new one is committed, as for applicants.

**Tests:** `.unlazy/phase5-avatars.mjs` (API: admin photo set / replace / remove, old file deleted, served only to admins, bad files refused, audit; user photo by admin: audit + notification, applicant sees it, applicant can't use the admin routes) and `.unlazy/phase5-avatars-ui.mjs` (desktop + phone: Settings upload and remove, sidebar/header photo, inspector upload and remove, error shown). Earlier suites re-run.

### 2026-10-30: Step 5.7 done (profile photos: the admin's own, and users' from the inspector)

Built as planned above.
- **DB:** `demo_admin_profiles` (`id` = `adm-<auth user id>` / `adm-demo`, `email`, `avatar_file_id`, `updated_at`), migration `0005_admin_profiles` (applied to the Replit DB) and Supabase migration `0003_admin_profiles` (`app_api_all` policy, no `anon` / `authenticated` grants). **Supabase still needs `db:migrate` run with `SUPABASE_ADMIN_DB_URL`.**
- **Server (`lib/avatars.ts`):**
  - `setAvatar` / `clearAvatar` take an optional acting admin: the audit says "… by an administrator" with the admin as actor, and the user is notified (link to Settings). They return false for an unknown user, and the stored file is rolled back (no orphan on disk).
  - `adminAccount`, `setAdminAvatar`, `clearAdminAvatar`: the admin's row is created on first upload; audited as platform entries ("Administrator profile photo updated / removed"). Admin files are owned by `adm-…`, so the applicant files route never serves them.
  - `currentAdminProfile(req)` in `currentUser.ts`.
- **API:** `GET /admin/me`, `POST|DELETE /admin/me/avatar` → `AdminAccount`; `POST|DELETE /admin/users/:id/avatar` → the updated user. Same upload pipeline and rate limit as applicant photos. Allowed during freezes (no money moves).
- **UI (`components/admin-photo.tsx`):**
  - `AdminAvatar` (black / lime, initials fallback).
  - Admin Settings: "Your profile photo" card (change, remove, errors inline).
  - Header avatar linking to Settings; the sidebar account card shows the photo (Supabase mode; demo mode keeps its demo box).
  - Inspector: the camera button really uploads (spinner, inline errors); "Remove photo" asks first. The old "preview only" toast is gone.
  - The camera button has a 44 px touch area (invisible padding around the 32 px circle).

Tests (2026-10-30), all passing:
- `pnpm test` 50/50 · typecheck clean
- new `.unlazy/phase5-avatars.mjs` 12/12: admin photo set / replace / remove (old row and bytes deleted, EXIF stripped, sandboxed WebP, audit once, second remove is a no-op); applicant route can't serve the admin's photo; GIF / fake JPG / PDF / pixel bomb / empty refused with nothing changed; user photo by admin (audit, one notification, applicant sees and loads it, replacement deletes the old file, works while frozen, removal notifies); unknown user 404 with no orphan file; applicants' own uploads unchanged.
- new `.unlazy/phase5-avatars-ui.mjs` 6/6 desktop + 6/6 phone.
- regressions (data restored before each): phase2-desktop 25/25, phase2-phone 6/6, phase3-api 24/24, phase3-phone 16/16, phase3-desktop 22/22 (the known header-search flake hit once, then 3 clean runs), phase5 cards 9/9, cards UI 5+5, debits UI 5+5, users UI 6+6, audit 9/9.
- `.unlazy/restore-demo-db.sh` now also truncates `demo_admin_profiles`. Demo data restored.

## 12. Phase 6 build plan: finish and harden (2026-10-30)

Phase 5 is complete (5.1–5.7). Phase 6 is what's left before the app is ready to deploy (from §8: U10, U11, U13, P3, P4, plus the open items in `docs/PROJECT.md` §15).

| Step | Goal | What gets built | Done when |
|---|---|---|---|
| **6.1 Grant matchmaking (rule-based)** | Real recommendations instead of hard-coded "Recommended" badges | A five-question questionnaire stored per applicant; every grant scored with the reasons shown; "best match" ordering (details below) | API + browser suites green |
| 6.2 Card controls for applicants | Applicants manage their own sample cards | Freeze / unfreeze their own card (a card an administrator froze stays locked to them), show card details behind a confirmation, request activation of a physical card | Tested |
| 6.3 Mobile polish | Final pass at phone width | Every applicant and admin page at 390 px: spacing, 44 px targets, no horizontal scroll, bell and search reachable | Phone suites + screenshots reviewed |
| 6.4 Error monitoring | Know when production breaks | Server errors and browser crashes reported (provider to be decided with the user; none is added without approval); request ids in logs | A forced error shows up |
| 6.5 Deployment runbook | Repeatable go-live on the EU VPS | `docs/DEPLOY.md`: nginx + HTTPS, systemd, env, `db:migrate` on deploy, backups, rollback | Followed once end to end |
| 6.6 Uploads in production | Files survive deploys and are scanned | Persistent `UPLOAD_DIR` on the VPS with backups; virus scanning (e.g. ClamAV) before a file is accepted | Tested with the EICAR test file |
| 6.7 Shared rate limits | Only if there's more than one API server | Redis-backed limiter | Skipped while there's one server |

Order: 6.1 first (the user asked for it), then 6.2–6.6. Each step is committed on its own after typecheck, `pnpm test` and its browser suite pass.

### 2026-10-30: Step 6.1 plan (rule-based grant matchmaking)

**Decision (user, 2026-10-30): matchmaking is rule-based**, with no AI. Answers in, a transparent score and reasons out.

**Today:**
- The 12 sample grants are hard-coded in `applicantDashboard()` with a fixed `recommended: true/false` that has nothing to do with the user.
- The "AI Grant Matchmaking" setup card says it uses AI and reads "facturas" (neither is true). It just opens Grant categories, and it counts as complete as soon as any grant is saved (browser storage only).

**What gets built**
- **Grant catalogue** moves to `lib/grantCatalog.ts`. Each sample grant gets who can apply (`orgTypes`) and what it funds (`goals`), alongside its category, amount and deadline. Still sample data.
- **Questionnaire** (5 questions, React Hook Form + Zod from the shared contract):
  1. Organization type: Nonprofit / Small business / Individual or artist / School or university / Community group
  2. Focus areas (1–6 of the existing categories)
  3. Goals (1–5): Start a new project / Grow an existing program / Research and development / Equipment / Operating costs
  4. Funding size: Under $10,000 / $10,000–$30,000 / Over $30,000 / Any amount
  5. When the money is needed: Within 30 days / Within 90 days / Flexible
- **Score (0–100), with a reason for every point awarded:**
  - Not open to your organization type → not eligible, score 0 ("Not open to small businesses").
  - Closed (deadline passed) → left out of matches.
  - Focus area matches: +40. Goal matches: +20. Amount in your size band: +20 (neighbouring band +8; "Any amount" +20). Deadline fits your timing: +20 (within 30 days: closes in ≤ 30 days +20, otherwise +5; within 90 days: ≤ 90 days +20, otherwise +10; flexible +20).
  - **Recommended = eligible, open and score ≥ 70**, so a recommendation always needs a focus-area match.
  - No answers yet → nothing is marked Recommended (no fake badges).
- **Storage:** `demo_profiles.matchmaking` (jsonb, null = not answered). Migration `0006`. No new table, so no new RLS policy.
- **API:**
  - `GET /applicant/matchmaking` → `{ answers | null, matches: [{ grantId, score, eligible, recommended, reasons[] }] }`
  - `PUT /applicant/matchmaking` (validated answers) → the same. Audited ("Updated grant matchmaking answers").
  - Dashboard `recommendations` get `matchScore` and `matchReasons` when answered, and `recommended` comes from the score.
  - The setup card is renamed **"Grant Matchmaking"** ("Answer five quick questions and we'll rank grants for your organization."); it's complete when answers are saved (server-side). Saving a grant no longer completes it.
- **Applicant UI:**
  - The setup card opens the questionnaire (dialog). After saving: toast + Grant categories.
  - **Grant categories:** a "Your top matches" panel at the top (top 3 with score and reasons, plus "Edit answers"), or a "Find grants that fit you" prompt before answering. Grant cards show "92% match" and a "Why this match" list.
  - **Grant Search:** a "Best match" sort (the default once answered) and a "Recommended only" filter.

**Tests:** Vitest for the scoring rules (pure function: eligibility, each rule, threshold, closed grants, ordering ties). `.unlazy/phase6-matchmaking.mjs` (API: validation, save / replace, audit, dashboard flags, another user's answers don't leak) and `.unlazy/phase6-matchmaking-ui.mjs` (desktop + phone: questionnaire, validation, top matches, reasons, edit, Best match sort).

### 2026-10-30: Step 6.1 done (rule-based grant matchmaking)

Built as planned above.
- **Rules (`api-server/src/lib/grantCatalog.ts`):** the 12 sample grants, now with `orgTypes` and `goals`. `scoreGrant` and `rankGrants` are pure functions (unit-tested): ineligible → 0 "Not open to …"; closed → 0; focus 40, goal 20, amount 20 / neighbouring band 8, timing 20 (5 or 10 when later than needed). Recommended at ≥ 70, so it always needs a focus match. Ranked by score, then earliest deadline, then title.
- **Server (`lib/matchmaking.ts`):** answers in `demo_profiles.matchmaking` (migration `0006`; **Supabase still needs `db:migrate`**). Saving drops duplicate picks; an unchanged save writes nothing; audited "Answered / Updated grant matchmaking answers". A stored value in an unknown shape counts as unanswered. The dashboard's `recommendations` come from the ranking (with `matchScore` / `matchReasons`); before answering, nothing is Recommended.
- **API:** `GET|PUT /applicant/matchmaking`; `GrantHighlight` gains optional `matchScore` and `matchReasons`.
- **Setup card:** now "Grant Matchmaking" / "Answer five quick questions and we'll rank grants for your organization." / "Find my matches". It opens the questionnaire and is complete once answers are saved. Saving a grant no longer completes it. The old wording promised AI that reads "facturas"; that's gone.
- **UI (`components/matchmaking.tsx`):** questionnaire dialog (React Hook Form + Zod, chips with 44 px targets on phones, says plainly that no AI is used); "Find grants that fit you" prompt or "Your top matches" (top 3 with reasons, Edit answers) on Grant categories; "% match" pill and "Why this match" on every grant card; Grant Search gets a "Best match" sort (the default once answered) and a "Recommended only" filter.

Tests (2026-10-30), all passing:
- `pnpm test` 60/60 (10 new for the rules) · typecheck clean
- new `.unlazy/phase6-matchmaking.mjs` 8/8: nothing recommended before answering; 8 kinds of invalid answers refused; scoring, order, reasons, ineligible grant; dashboard flags = score ≥ 70 and need a focus match; unchanged save writes no audit; re-ranking on edit; other profiles untouched; a corrupt stored value is treated as unanswered
- new `.unlazy/phase6-matchmaking-ui.mjs` 7/7 desktop + 7/7 phone
- regressions (data restored before each): smoke 23+23, phase1-desktop 26/26, phase1-phone 10/10, phase2-desktop 25/25, phase5-ui 4+4
- Demo data restored.

Not changed, but worth a look: the second setup card ("Submit First Proposal") still says "we'll use your facturas to pre-fill your business information", which the app doesn't do. *(Fixed 2026-10-31, see 6.2 below.)*

### 2026-10-31: "Submit First Proposal" setup card reworded

At the user's request. It promised to "use your facturas to pre-fill your business information", which the app doesn't do. It now reads "Start an application and attach your proposal as a PDF or Word file. You can follow it from review to decision." with the button "Start an application" (it opens the New application form, which takes a PDF/Word file). It's marked complete by the server once the applicant has submitted any application (a withdrawn one still counts). Before, completion lived only in browser storage; that storage (`doneSetup` / `completeSetup`) is removed.

### 2026-10-31: Step 6.2 plan and done (card controls for applicants)

**What the applicant can do on Cards:**
- **Freeze** an active card, and **unfreeze** it again. No reason is needed; the user isn't notified of their own action. Freezing works even while the account is frozen, because it only makes the card safer. Unfreezing doesn't.
- **A card an administrator froze stays locked.** The card says who froze it and why: "Only they can unfreeze it; contact support …". Each card now records `frozenBy` (`user` / `admin`). A card frozen before this was recorded counts as frozen by an administrator.
- **"It's arrived: activate"** on a pending physical card records `activationRequestedAt` and is audited once; asking again changes nothing. The administrator still activates it ("Mark as issued"), which clears the request and notifies the user as before.
- **Card details:** a sheet showing the masked number, type, network, status (and who froze it) and the issue date. **Deviation from the plan:** the plan said "show card details behind a confirmation". These are sample cards with only a random last four; there's no full number, expiry or security code to protect. Making them up would misrepresent the demo, so the sheet says so plainly and needs no confirmation. When a real card provider is connected, the reveal should go behind a re-authentication step.

**Administrator side (user inspector):** shows "Frozen by the user" and "User says it arrived · activation requested <date>". An administrator can freeze a card the user froze (with a reason), which locks it to the user. Admin freeze sets `frozenBy: admin`; unfreeze, activate and cancel clear the flags. The request also shows in the dashboard's recent activity (audit), but there's no separate queue for it.

**API:** `POST /applicant/cards/{cardId}/actions` with `{ action: freeze | unfreeze | request-activation }` returns the account. Another person's or an unknown card → 404 "Card not found."; refusals → 400 with the reason. `UserCard` gains optional `frozenBy` and `activationRequestedAt`. No migration (cards are JSON on the profile).

**Also:** the shared `Modal` now renders into `<body>` (React portal). The card-details sheet opened inside an animated card, and on phones the bottom navigation covered its last lines. Two Help Centre answers were added (freezing a card, activating a physical card).

Tests (2026-10-31):
- typecheck clean · `pnpm test` 60/60
- new `.unlazy/phase6-cards.mjs` 7/7: own freeze / unfreeze (audited, no notification); admin freeze stays locked; admin can lock a user-frozen card; old frozen cards count as admin-frozen; activation request (once, admin sees it, activate clears it); account frozen (freeze yes, unfreeze no); cancelled / unknown / other people's cards and bad actions
- new `.unlazy/phase6-cards-ui.mjs` 6/6 desktop + 6/6 phone
- `.unlazy/phase6-matchmaking.mjs` 8/8 (now also checks the reworded proposal card)
- `.unlazy/phase5-cards-ui.mjs` updated for the new frozen-card wording
- regressions after the Modal change (data restored before each): phase5-cards 9/9, phase5-cards-ui 5+5, phase6-matchmaking-ui 7+7, smoke 23+23, phase1 26 + 10, phase2 25 + 6, phase3 22 + 16, phase5-ui 4+4, avatars-ui 6+6, debits-ui 5+5, users-ui 6+6
- Demo data restored.

### 2026-10-31: Step 6.3 plan and done (mobile polish)

**How it was checked:** a new audit, `.unlazy/phase6-mobile.mjs`, runs at 390 × 844. It visits every applicant and admin page (25), the 404 page, both menus, the notifications panel, the New application and matchmaking dialogs, and the three sign-in pages. For the sign-in pages it uses a second test API in Supabase mode, signed out, with only the public URL and publishable key. For each screen it lists every problem it finds:
- a page wider than the phone (a phone browser zooms out instead of scrolling, which hides the overflow from a scroll check)
- horizontal scroll, and content poking out of the screen
- a box sticking out of the box it sits in
- tap targets under 44 × 44, counting invisible hit areas; links inside a sentence are exempt
- whether the bell, the menu button and search are on screen

It saves full-page screenshots. I reviewed them as contact sheets and caught what the checks can't (squeezed text, cut titles).

**First run: 306 problems.** Almost all were tap targets of 32–43 px: menu and close buttons, filter chips, the Apply / Save buttons on grant cards, admin action buttons, 38–42 px form fields, and small text links. The audit and the screenshots also found:
- **Reports was zoomed out (522 px wide).** A one-line "truncate" hint under each download stretched the CSS grid column. **The KYC queue** had the same cause: the Pending badge and the Reject button stuck out of their cards.
- **"Find grants that fit you"** on Grant categories squeezed its text into a column one or two words wide.
- **The admin header** wrapped the avatar onto a second line on pages with long titles (User inspector, Application review, Withdrawal Page).
- **The user inspector header** wrapped the masked ID one character per line beside the Freeze account button.
- **Admin application rows** (dashboard queue, inspector) cut titles to a few letters, and the applicant dashboard and Transactions cut titles to one line.
- **On phones there was no search except inside Applications.** The desktop header search had no phone equivalent.

**Fixes:**
- **Tap targets, in one place (`index.css`):** below the desktop breakpoint (lg), every button, link, summary, switch, tab, menu item and checkbox label gets an invisible, centred hit area of at least 44 × 44 px. Nothing changes visually. It's the same technique as the camera button, written with zero specificity, so an element's own position class still wins. Form fields and selects get a real minimum height of 44 px.
- **Grids:** Reports and the KYC queue use `grid-cols-[minmax(0,1fr)]`. The Reports download hints wrap instead of being cut.
- **Flex rows that never wrapped** (the matchmaking prompt, the inspector header): the text block has a minimum width of 12 rem, so the button drops below it on phones. The masked ID no longer breaks.
- **Admin header:** the title truncates. On phones the freeze button says "Freeze" / "Lift" (its accessible name stays "Global freeze"), so the title, button and avatar fit on one line.
- **Admin application rows:** on phones the title gets its own line, with the amount and status below. Applicant application and transaction titles wrap to two lines.
- **Search in the phone menu:** a "Search applications" field at the top of the applicant menu shares the desktop header search. Enter closes the menu and opens Applications, filtered.

**Not changed:**
- Horizontally scrolling chip rows (filters, Help topics, Transactions types) and the admin ledger table scroll on purpose.
- The admin workspace has no bell, because administrators have no notifications.

Tests (2026-10-31): typecheck clean · `pnpm test` 60/60 · `phase6-mobile` 35/35, 0 problems · browser regressions, with data restored before each: smoke 23+23, phase1 26 + 10, phase2 25 + 6, phase3 22 + 16, phase5-ui 4+4, cards-ui 5+5, debits-ui 5+5, users-ui 6+6, avatars-ui 6+6, audit-ui 6+6, limits-ui 6+6, phase6-matchmaking-ui 7+7, phase6-cards-ui 6+6. The desktop admin header was checked by screenshot (unchanged). Not re-run: `phase4-ui` / `phase4-security`, which need the Supabase secret key and create throwaway users. Demo data restored.

Audit result after the fixes: 35/35 screens, 0 problems. I confirmed it catches regressions by briefly undoing the Reports and KYC fixes: both were reported, then the fixes were restored.

### 2026-10-31: Step 6.4 plan and done (error monitoring)

**Decision (user, 2026-10-31): our own logs, plus optional Sentry.** With nothing set, errors go only to the server log on the VPS. Setting `SENTRY_DSN` also sends them to Sentry (EU region) or a self-hosted GlitchTip.

**Deviation from the option as offered:** it said "adds the Sentry SDK". Instead the server posts events to Sentry's documented envelope API with `fetch` (`lib/monitoring.ts`, ~100 lines):
- **no dependency:** the Node SDK pulls in OpenTelemetry auto-instrumentation
- **the browser loads nothing third-party:** the strict CSP stays as it is
- **every field that leaves the server is listed in one function:** `buildEnvelope`, which a unit test pins

It works with Sentry and GlitchTip alike.

**Built:**
- **Request ids:** each request gets a random UUID in `X-Request-Id`, on every log line (pino-http `genReqId`). It used to be a counter that restarted at 1.
- **Server errors (500):**
  - Logged with the request id and forwarded.
  - The user sees "… contact support with reference `1a2b3c4d`" (the first 8 characters of the request id), and the body carries `requestId`.
  - Input errors (400) aren't reported.
  - Unhandled promise rejections and uncaught exceptions are logged and reported too. An uncaught exception still exits, after up to 3 s to finish sending; systemd restarts the service.
- **Browser crashes:** `POST /api/client-errors`.
  - **Before the sign-in check:** a crash on the sign-in page still gets reported.
  - **Limits:** 20 a minute per IP (`RATE_LIMIT_CLIENT_ERRORS_PER_MIN`); message up to 1,000 characters, stack up to 8,000.
  - **What reports it:** window errors, unhandled rejections and the crash screen (React error boundary, with the component stack).
  - **Caps in the browser:** at most 10 reports per page load, and each distinct error once.
  - **The crash screen** shows "We've logged it … reference `xxxxxxxx`".
- **Privacy:**
  - Never sent: the user, cookies, headers, IP address or query strings.
  - Scrubbed from messages and stacks, in the log as well as in Sentry: email addresses, JWTs, Supabase / Resend / webhook secrets, and digit runs of 7 or more (dates kept).
  - React's component stack goes under `contexts.react`, as Sentry's React SDK does.
  - Page paths can include internal record ids (`usr-…`).
- **Admin settings → Error monitoring:** shows where errors go (log only, or log + Sentry host and environment). "Send test errors" raises one deliberate server error (`POST /api/admin/monitoring/test-error`, admins only) and one browser report, then shows both references to look up. This is the plan's "a forced error shows up".
- **Configuration:** `SENTRY_DSN`, `SENTRY_ENVIRONMENT` (default `NODE_ENV`), `APP_RELEASE` (e.g. the git commit). An invalid DSN is logged once at start-up, and errors still go to the log.

**To turn on Sentry (needs you):** create a Sentry project in the **EU (Frankfurt) region**, or run GlitchTip on the VPS. Put its DSN in `SENTRY_DSN` on the server, then press "Send test errors" in Admin settings.

Tests (2026-10-31):
- typecheck clean · `pnpm test` 67/67 (7 new: scrubbing, DSN parsing, stack parsing, envelope fields, component stack)
- new `.unlazy/mock-sentry.mjs`: a local stand-in for the envelope endpoint
- new `.unlazy/phase6-monitoring.mjs` 8/8:
  - unique request ids in the log
  - status
  - a 500 with its reference, logged, in Sentry with the right auth and nothing personal
  - 400s not reported
  - a browser report scrubbed in the log and in Sentry, without the query string
  - bad reports refused
  - signed out: reports accepted and everything else still 401
  - rate limit
- new `.unlazy/phase6-monitoring-ui.mjs` 4/4 desktop + 4/4 phone:
  - the test button gives two references, found in the log and in Sentry
  - an uncaught error and a rejection are reported (email scrubbed)
  - a real render crash shows the crash screen with a reference matching the Sentry event, with its component stack
  - a repeated crash is reported once
- regressions, with data restored before each:
  - API: phase3-api 24/24, phase5 cards 9/9, debits 8/8, limits 10/10, users 7/7, audit 9/9, withdrawals 11/11, avatars 12/12, phase6 cards 7/7, matchmaking 8/8
  - browser: smoke 23+23, phase1 26 + 10, phase2 25 + 6, phase3 22 + 16, phase5-ui 4+4, cards-ui 5+5, users-ui 6+6, avatars-ui 6+6, debits-ui 5+5, limits-ui 6+6, audit-ui 6+6, phase6 cards-ui 6+6, matchmaking-ui 7+7
  - The email and avatar suites first failed only because the test API had been started without the email settings and the suite without `UPLOAD_DIR`. With both set, they pass.
- Demo data restored.

### 2026-10-31: Step 6.5 plan and runbook (deployment on the EU VPS)

**Decisions (user, 2026-10-31):**
- **PM2**, not Docker. The comparison table is in `docs/DEPLOY.md`.
- **Address `access.futurenestfund.org`.** `futurenestfund.org` is the organisation's live WordPress site (Cloudflare DNS, hosted elsewhere), so it stays untouched.
- **Code from a private GitHub repo** with a read-only deploy key, as the server's other apps do.

**Server facts (from the user's checks):**
- Hardware and OS: Ubuntu 26.04, 1 vCPU, 1.8 GB + 2 GB swap, IPv4 only.
- **Shared** with three apps:
  - akkayalar: PM2, port 3010
  - noveriqgroups: PM2, port 4001
  - novabridgegrant: systemd, port 3100
- Root's PM2 7.0.4 lives in `/opt/noveriqgroups-node`, and each app has its own `/opt/<app>-node`.
- nginx + certbot are in place; the firewall is off.

**Built:**
- `HOST` setting for the API (`index.ts`): the VPS listens on 127.0.0.1 only.
- `deploy/`:
  - `deploy.sh`: fetch, install only the needed packages, build both, migrate, switch web build atomically, reload, health check, `pm2 save`; `deploy.sh <commit>` rolls back
  - `ecosystem.config.cjs`, plus `fnf-pm2`: GrantApp's own PM2 daemon as user `futurenestfund`, never root's
  - `pm2-futurenestfund.service`: our own boot unit; `pm2 startup` isn't used, because it could touch root's PM2
  - nginx site, `api.env` / `migrate.env` examples, `backup.sh` + cron, logrotate
- `docs/DEPLOY.md`: the 10-step runbook, everyday operations, and the shared-server rules.

**Tested here (2026-10-31):**
- In a clean clone without Replit's variables: the trimmed install (the design sandbox isn't installed), the API build and the web build with its CSP all work.
- With PM2 7.0.4:
  - the process file starts the API from `--env-file` (port and `HOST=127.0.0.1` read from the file, `APP_RELEASE` passed)
  - health 200
  - a reload swaps in the new version
- `bash -n` passes on all scripts; the test daemon and copy were removed.
- **Not tested here:** systemd, nginx, certbot, `runuser`. They're checked as the runbook is followed on the VPS.

### 2026-10-31: Step 6.5 done (deployed on the EU VPS)

The runbook (`docs/DEPLOY.md`) was followed end to end on the VPS (steps 1–9). GrantApp is live at **https://access.futurenestfund.org**. The step-by-step record, with evidence, is in `server.md`.

**What was done:**
- DNS: Cloudflare `A access → 77.68.98.14`, DNS only. Code from the private repo `macwuche/futurenestfund`, branch `user-side-redesign`, via a read-only deploy key.
- Server: user `futurenestfund`, its own Node 24.22.1, pnpm 10.26.1, PM2 7.0.4 and boot service `pm2-futurenestfund`. The other apps' PM2 wasn't touched.
- First `deploy.sh`: builds OK; app migrations 0003–0006 and Supabase `0003_admin_profiles` applied; API on 127.0.0.1:3200 with `database: supabase`.
- nginx site + Let's Encrypt certificate (expires 2027-01-29, renewed by the existing timer); HTTP redirects to HTTPS.
- Supabase Auth URL Configuration: Site URL and Redirect URL set to the new address.
- Backups: `postgresql-client` 18 (`pg_dump` 18.6), nightly cron at 02:30 UTC keeping 14 days, log rotation; first backup made and read back with `pg_restore --list` (86 entries).

**Checked on the live site:**
- Admin sign-in at `/admin`: dashboard loads.
- Applicant sign-up with a real inbox: the confirmation email (Supabase's own sender) arrived; the applicant dashboard loads (applicant routes 200 in the log).
- "Send test errors": the server error (`240ee29f…`, 500) and the browser error (`a746d44f…`, via `/api/client-errors`) both in `fnf-pm2 logs`.

**Still open:**
- Step 10: email through Resend and the Send Email Hook. Needed before real applicants, since Supabase's own sender allows only a few emails an hour.
- Rotate the secrets pasted in chat (two database passwords, secret key, admin password) and delete the unused GitHub token. They were never committed (`secrets.local.md` is git-ignored and has no history).
- Minimum password length 8; off-server copies of backups; 6.6 virus scanning.

---

## 13. UI review and Phase 7 build plan (2026-10-31)

**How it was reviewed:** headless Chromium screenshots of all 25 screens (15 applicant, 10 admin) at desktop (1440 px) and phone (390 px) width, 50 in total, demo mode, read alongside the page code. The charts looked empty in the first shots, but measuring them showed they just hadn't finished their entry animation, so that's not a bug. The phone audit from 6.3 (tap targets, overflow) still passes; this review looks at what it can't measure: hierarchy, consistency, wording, missing features.

### 13a. Score

| Area | Score | In one line |
|---|---|---|
| Applicant, desktop | **74** | Clean and close to the reference design; long flat menu, some repeated or misleading details |
| Applicant, phone | **70** | Works everywhere; cramped list rows, and things from the desktop are missing (New application on the dashboard) |
| Admin, desktop | **66** | Powerful, but the header wastes space, money is in a typewriter font, Settings is a flat pile of cards and **has no email settings at all** |
| Admin, phone | **58** | Everything is reachable, but tables are cut off at the side, the header takes ~110 px, and the user inspector is a 3,500 px scroll |
| **Overall** | **67 / 100** | Solid and functional; it now needs a design-system pass and an admin Settings rebuild more than new pages |

Scoring weights: visual consistency 20, layout and hierarchy 20, phone experience 20, clarity of wording and states 15, completeness (features you'd expect on the screen) 15, accessibility 10.

### 13b. What's wrong (by area, worst first)

Severity: **H** = broken, misleading or missing something needed · **M** = clearly hurts use or looks · **L** = polish.

**Both workspaces**

| # | Sev | Problem | Where |
|---|---|---|---|
| G1 | M | **Two design systems.** The applicant side uses Inter; the admin side uses DM Sans + Bricolage Grotesque headings + **Spline Sans Mono for every amount** (`$65,530.00` looks like code, with wide commas). Buttons, radii, label styles and empty states differ too. Four font families come from two separate Google Fonts requests (`index.html` + `index.css` `@import`). | `index.css:1,436-448`, `index.html:18` |
| G2 | M | **Avatar initials collide with the camera button**: "DA" / "JC" sit off-centre and the camera badge covers part of them (admin Settings photo, user inspector header). | `admin-photo.tsx`, inspector header |
| G3 | M | **Status shown twice** in list rows: sub-line "Submitted" plus a "Submitted" badge (applicant dashboard, Grant highlights). The space could show category, amount and date instead. On phones this pushes titles onto 3 lines ("Youth / Coding / Bootcamp"). | `applicant.tsx` highlights |
| G4 | L | Different words for the same action: "Save changes" (applicant) vs "Save Updates" (admin); "Global Freeze" / "Freeze" / "Enable freeze". | several |
| G5 | L | Charts replay their entry animation on every visit (≈1.5 s before numbers are readable). | `applicant.tsx:101`, `admin.tsx:52`, `applicant-more.tsx:179` |
| G6 | L | The live site's page description still says "Interactive demo". | `index.html:7-14` |

**Admin, desktop**

| # | Sev | Problem | Where |
|---|---|---|---|
| A1 | **H** | **No email settings.** The Resend API key, sending address, sender name, reply-to, signature and Send Email Hook secret can only be set in `/etc/futurenestfund/api.env` + a restart. There's **no way to see whether email works**: nothing shows if the key is valid, the domain is verified, the hook is receiving, or emails are failing in the outbox. | `email.ts` reads env once at start-up; Settings page |
| A2 | M | **Settings is a flat grid of 6 unrelated cards** (freeze, security rules, photo, limits, monitoring, audit log) with no grouping or navigation; adding email there makes it worse. Your own profile photo sits between platform controls. | `admin.tsx` Settings |
| A3 | M | **Header layout:** title, "4-Eyes not active" badge, search, Global Freeze and avatar are packed to the left, leaving ~350 px of empty header on the right; the search box is a fixed width. | `shell.tsx:600-620` |
| A4 | M | **"4-Eyes not active" is shown in three places** (header badge on every page, System health, Security rules) although two-person approval was dropped by decision on 2026-10-30. It reads like a warning that something is off. | `shell.tsx:610`, `admin.tsx:70` |
| A5 | M | **Dashboard KPIs repeat themselves:** "Total users 3 / 3 active" and "Active users 3 / 0 frozen". | `admin.tsx` KPIs |
| A6 | L | User inspector header shows `•••• •••• 4829 usr-jane`: a masked card number next to an internal id is meaningless to an admin. | inspector |
| A7 | L | Empty states on Deposit/Withdrawal/KYC are tall boxes with a tiny icon (two per page when both queues are empty). | `admin-ops.tsx` |
| A8 | L | The ledger search placeholder is cut off ("Entry or request ID, reason, u"). | Transactions |

**Admin, phone**

| # | Sev | Problem | Where |
|---|---|---|---|
| AM1 | **H** | **The ledger and audit tables are cut off on the right:** you see Date, User and half of Type ("Opening balan"); **the amount isn't visible** without scrolling sideways, and nothing shows that you can. | `admin-ops.tsx` ledger, audit |
| AM2 | M | **The header takes ~110 px**: menu, title, Freeze, avatar, then a full-width search on its own row, on every page. | `shell.tsx` |
| AM3 | M | **User inspector is a ~3,500 px single column** with no way to jump to a section (Profile → Access → Limits → Balances → Cards → Applications → KYC → Audit). | inspector |
| AM4 | M | Settings on phones is a ~1,900 px stack of the same 6 cards (see A2). | Settings |
| AM5 | L | KPI tiles: labels wrap to 2 lines ("PENDING / APPLICATIONS"), so tiles have uneven heights. | dashboard, queues |
| AM6 | L | Dashboard "Applications awaiting a decision" cuts the date ("Oct …"). | dashboard |

**Applicant, desktop**

| # | Sev | Problem | Where |
|---|---|---|---|
| U1 | M | **The menu has 13 flat items** (Dashboard … Milestones, Settings, Help) with no groups; Grant Search, Grant categories and Funding Tracker / Reports are hard to tell apart. | `shell.tsx` nav |
| U2 | M | **Grant categories and Grant Search show the same 12 grant cards** with the same Apply/Save buttons; only the filters differ. | `applicant.tsx`, `applicant-more.tsx` |
| U3 | M | **Setup cards keep their green "Recommended" badge after they're done** ("Submit First Proposal: ✓ Complete" still says Recommended). | dashboard |
| U4 | M | **"All Revenue" dropdown** on Grant Highlights: the label comes from the reference image and doesn't describe what it filters (application status). | dashboard |
| U5 | L | The **"Acme Foundation ▾" organisation switcher** looks interactive but there is only ever one organisation. | header |
| U6 | L | Help Centre shows **support@grantapp.mx** ("placeholder, not monitored") on the live site. | `applicant-more.tsx:469` |
| U7 | L | The virtual card picture is a large empty blue block (no chip, the gap is ~200 px). | Cards |
| U8 | L | Withdrawals / Add funds: no explanation of where money goes to or comes from (bank details, timing), only "reviewed by our finance team". | Withdrawals, Add funds |

**Applicant, phone**

| # | Sev | Problem | Where |
|---|---|---|---|
| UM1 | M | **No "New application" on the phone dashboard** (desktop has it at the top); you have to go to Apps first. | dashboard |
| UM2 | M | List rows squeeze titles to 2–3 lines because of the doubled status (G3) and badge width. | dashboard, Applications |
| UM3 | M | **Grant categories / Grant Search are ~3,000 px long**: 12 full cards, each with category, title, amount, deadline and two buttons; no compact list view. | grants |
| UM4 | L | The setup-card swipe row runs edge to edge while every other card has a 16 px margin. | dashboard |
| UM5 | L | The greeting "Here are your account's highlights." sits loose under the profile row. | dashboard |

### 13c. Phase 7 build plan

Order: **7.1 first** (what you asked for), then the shared design pass, then each workspace. Each step is committed on its own after typecheck, `pnpm test`, its browser suite and the 390 px phone audit pass, with before/after screenshots reviewed.

| Step | Goal | What gets built | Fixes | Done when |
|---|---|---|---|---|
| **7.1 Email settings + health** | Configure and check email from Admin Settings, no SSH | See 13d | A1 | Key saved in the UI sends a real test email; every health check shows its state |
| 7.2 Admin Settings rebuilt | Findable settings | Settings becomes sections with a side menu (tabs on phones): **General** (global freeze, security rules), **Email** (7.1), **Withdrawal limits**, **Monitoring**, **Audit log**, **Your account** (photo, sign-in & security) | A2, AM4, A4 | Every old setting reachable; phone audit clean |
| 7.3 Design-system pass | One look across both workspaces | One font loading path; one sans for both sides (Inter, admin keeps its black/lime theme); money in tabular figures of the same font (no mono); shared `Button`, `Card`, `KpiTile`, `EmptyState`, `Avatar` (initials centred, camera badge outside the letters); same wording for the same actions; charts animate once per session | G1, G2, G4, G5, A7, AM5 | Screenshots of all 50 screens reviewed; no visual regressions in suites |
| 7.4 Admin layout | Use the space | Header: title left, search fills the middle, freeze + avatar pinned right; on phones search collapses to an icon (header ≤ 64 px); "4-Eyes" badge removed (decision of 2026-10-30), health row reworded; KPIs de-duplicated; inspector gets a sticky section menu (chips on phones) | A3–A6, A8, AM2, AM3, AM6 | Phone header ≤ 64 px; inspector sections reachable in one tap |
| 7.5 Admin tables on phones | Read money on a phone | Ledger, audit log and users become stacked cards below the desktop breakpoint (date · user · type · **amount** visible without scrolling) | AM1 | No hidden amount column at 390 px |
| 7.6 Applicant fixes | Clearer applicant side | Menu grouped (Overview · Funding · Money · Account); Grant categories becomes a category overview that links into Grant Search (one grant list, not two); "Recommended" badge only on unfinished setup cards; highlights filter renamed "All statuses"; rows show category · amount · date instead of the repeated status; org switcher becomes a plain label unless there are several organisations; Help support address from the email settings (7.1); virtual card visual; money pages explain timing | U1–U8 | Phase 1/6 suites updated and green |
| 7.7 Applicant phone | Shorter, faster pages | "New application" on the phone dashboard; compact grant rows with "Show details"; setup-card row aligned to the 16 px margin; greeting tidied | UM1–UM5 | Phone audit clean; grants page roughly half as long |

Not in Phase 7: new features beyond email settings; the open go-live items (§12 of `docs/PROJECT.md`) stay separate.

### 13d. Step 7.1 in detail: email settings and health checks

**Admin → Settings → Email** (a section of its own):

- **Provider:** Resend API key, **write-only**: after saving, only `re_••••abcd` and "saved on <date> by <admin>" are shown, with Replace and Remove. The key is never sent back to the browser.
- **Sender:** from name (e.g. "Future Nest Fund"), from address (e.g. `no-reply@mail.futurenestfund.org`), optional reply-to. The from address is checked against the domains on the Resend account, and the form says when its domain isn't verified.
- **Signature:** a plain-text signature (e.g. name, organisation, address, support email) added to the footer of **every** email (sign-in emails and notifications), with a live preview of a sample email. Plain text, escaped, so nobody can put scripts or tracking into emails.
- **Support email**, shown in emails and in the Help Centre (replaces the `support@grantapp.mx` placeholder).
- **Send Email Hook secret** (`v1,whsec_…`), also write-only, with the exact URL to paste into Supabase shown next to it (copy button).
- **Health checks** (refreshed on open and with a "Run checks" button):
  1. API key accepted by Resend (Resend's domains API)
  2. sending domain verified, with the SPF / DKIM / MX record states Resend reports
  3. from address on a verified domain
  4. Send Email Hook: secret set, and **when the hook last received a request** from Supabase (never / time)
  5. Outbox: emails waiting, emails that gave up after 5 tries, last email sent, last error (scrubbed)
  6. **"Send test email"** to the signed-in admin's address, which shows Resend's message id or the exact refusal.

**How it's stored and kept safe:**
- Settings live in the database (new columns on `demo_settings`, migration `0007`, so no new table and no new RLS policy). Secrets (API key, hook secret) are **encrypted** (AES-256-GCM) with a master key that stays in the server environment (`SETTINGS_ENCRYPTION_KEY` in `api.env`), so a database backup or dump alone can't reveal them. Without that master key, the UI shows the email settings but says secrets can't be saved there yet.
- `RESEND_API_KEY` / `EMAIL_FROM` / `SEND_EMAIL_HOOK_SECRET` in `api.env` keep working. **Precedence: a value saved in the UI wins over the environment;** the page shows where each value comes from ("from server environment" / "set in Settings"). Removing a UI value falls back to the environment.
- Changes take effect **without a restart** (the API reloads its email settings on save).
- Every change is audited ("Updated email sender", "Replaced Resend API key") **without** the secret values. Admin-only endpoints; the rate limits apply.
- Outbox failures get a `last_error` column so the health panel can show why mail failed.

**API:** `GET /admin/settings/email` (settings with secrets masked + where each comes from), `PUT /admin/settings/email` (validated; secrets optional), `DELETE /admin/settings/email/{api-key|hook-secret}`, `POST /admin/settings/email/check` (health checks), `POST /admin/settings/email/test` (test email).

**Tests:** Vitest for encryption round trip, tampered ciphertext refused, precedence UI > env, signature escaping in every template. `.unlazy/phase7-email.mjs` against the local Resend stand-in (extended with a domains endpoint): save/replace/remove, the key never appears in any response or log, health states (bad key, unverified domain, hook never called, failing outbox), test email, audit wording. Plus `phase7-email-ui.mjs` desktop + phone.

**Decision needed before 7.1:** whether secrets may be stored (encrypted) in the database at all; the alternative keeps keys only in `api.env` and the page shows status and health checks but can't change the key.

### 2026-10-31: Step 7.1 done (email settings and health checks)

**Decision (user, 2026-10-31): secrets may be stored in the database, encrypted.**

**Built:**
- **Admin → Settings → Email** (`components/email-settings.tsx`), a full-width section:
  - Resend API key and Supabase hook secret: write-only fields showing a hint (`re_••••abcd`), where the value comes from (Settings / server environment / not set) and who saved it when; Replace, and Remove after a confirmation
  - sender name and address, reply-to, support address, signature (counter: 600 characters / 10 lines), each showing the environment value it replaces
  - a live preview of an email with the sender, signature and footer
  - health checks with Run checks: key accepted (sending-only keys recognised), sender domain on the account and verified (with a DNS record table), links (`APP_URL`), when Supabase last called the hook and how it ended, outbox (waiting / retrying / gave up, last error)
  - Send test email to any address, with Resend's answer
  - hook URL with a Copy button and setup steps
- **Server:**
  - `lib/secretBox.ts`: AES-256-GCM sealing with `SETTINGS_ENCRYPTION_KEY`, field name as associated data
  - `lib/emailSettings.ts`: loads, validates, saves and audits (never the secret values); health checks; test email
  - `email.ts` / `sendEmailHook.ts` / `emailTemplates.ts` read the settings at runtime instead of once at start-up; saving applies at once, and every process re-reads them each minute
  - the outbox worker always runs (email can be switched on later) and stores each failure's scrubbed reason
  - every email (sign-in, notifications, money, test) carries the signature and the support line, escaped
- **Migration 0007** (`demo_settings.email_config`, `email_secrets`, `email_hook_seen_at`, `email_hook_result`; `demo_notifications.email_last_error`): no new table, so no new RLS policy.
- **API:** `GET|PUT /admin/settings/email`, `DELETE /admin/settings/email/secrets/{resendApiKey|hookSecret}`, `POST /admin/settings/email/check`, `POST /admin/settings/email/test`; `GET /auth/config` gains `supportEmail`.
- **Help Centre** shows the real support address as a mail link (or "contact your grant administrator"), replacing the `support@grantapp.mx` placeholder (finding U6).
- `deploy/api.env.example`, `docs/DEPLOY.md` step 10 and `server.md` step 10 rewritten: the server only needs `SETTINGS_ENCRYPTION_KEY`; the rest happens in Settings.

**Tests (2026-10-31):**
- typecheck clean · `pnpm test` 73/73 (6 new: encryption, signature/support in every template, From parsing)
- new `.unlazy/phase7-email.mjs` 11/11 (mock Resend extended with domain endpoints): validation; the key never appears in responses, the database, the audit log or the API log; From header; unchanged save writes no audit; health for verified / pending / missing domain, sending-only and refused keys; test email (key, sender, reply-to, signature escaped, support line) and a refused one; hook secret used at once, last call ok / bad signature; outbox failures with their reason; an undecryptable secret reported and fixed by re-entering; removal
- new `.unlazy/phase7-email-ui.mjs` 9/9 desktop + 9/9 phone
- by hand: environment values shown and used, Settings values win, removing falls back to the environment; without `SETTINGS_ENCRYPTION_KEY` secrets are refused with the reason and plain settings still save
- regressions (data restored before each): phase5-withdrawals 11/11, phase5-limits 10/10, phase3-api 24/24, phase6-mobile 32/32 with 0 problems (the 3 sign-in pages weren't included: they need a Supabase-mode API), smoke 23+23, phase5-ui 4+4. `phase6-monitoring-ui` wasn't run: it needs the Sentry stand-in, and monitoring wasn't changed.

**Before it works on the live site:** deploy, then add `SETTINGS_ENCRYPTION_KEY` to `/etc/futurenestfund/api.env` and restart (step 10 in `docs/DEPLOY.md`). The Replit preview's API workflow also needs a restart to pick up the new code.

### 2026-11-01: Step 7.2 done (Admin Settings rebuilt into sections)

**Built:**
- `/admin/settings/<section>`: **General** (global freeze, security rules), **Email**, **Withdrawal limits**, **Monitoring**, **Audit log**, **Your account** (photo, sign-in & security). `/admin/settings` is General; an unknown section redirects there. One section shows at a time, so the phone page is no longer a ~1,900 px stack (AM4).
- Side menu on desktop (sticky), one scrollable row of tabs on phones and tablets (`tab-settings-*`). The header avatar opens **Your account**.
- "4-Eyes" removed everywhere (A4, decision of 2026-10-30): header badge, dashboard health row, Settings rule and footnote. The rule now reads "One finance administrator approves or declines each request" (Single approver). The withdrawal queue's amber 4-eyes warning became a plain note.
- Card titles that repeated the section name renamed ("Sending and sender", "Platform-wide limits").

**Tests (2026-11-01, test API on :8099 through the proxy, demo data restored after each suite):** typecheck clean; phase3-desktop 22/22 (4-eyes checks now assert absence), phase3-phone 16/16, phase5-audit-ui 6+6, phase5-avatars-ui 6+6, phase5-limits-ui 6+6, phase7-email-ui 9+9, phase6-mobile 37/37 with 0 problems (all six Settings sections added), smoke 23+23. Suites updated to open their section's URL. `phase4-security` and `phase6-monitoring-ui` weren't run (Supabase secret key / Sentry stand-in needed); their URLs were updated.

### 2026-11-01: Step 7.3 done (design-system pass)

**Built:**
- **One typeface (G1):** Inter for both workspaces, loaded once from `index.html`. The second Google Fonts request (`@import` of Bricolage Grotesque, DM Sans, Spline Sans Mono) is gone. Headings are Inter bold with slightly tighter tracking; amounts (`.font-num`) use Inter's tabular figures instead of the monospace font. The admin side keeps its black / lime colours.
- **Avatars (G2):** initials centred (`leading-none`), and the camera badge is smaller and sits outside the letters (`-bottom-1.5 -right-1.5`, 28 px).
- **Wording (G4):** "Save Updates" → "Save changes"; the header button says "Freeze platform" / "Lift freeze" (phones: "Freeze" / "Lift"), the same as Settings.
- **Charts (G5):** `useAnimateOnce()` in `bits.tsx`: each chart plays its entry animation once per browser session (none with reduced motion). The admin money chart moved into its own component (`MoneyChart`) so the hook follows React's rules.
- **Empty states (A7):** compact (about half the height, smaller icon).
- **KPI tiles (AM5):** sentence-case labels; on phones the label keeps room for two lines, so the values in a row line up.
- **Page description (G6):** title "GrantApp", and the description no longer says "Interactive demo".

**Not done as planned:** no new `Button` / `Card` / `KpiTile` React components. The existing shared class tokens (`card`, `lime`, `dark`, `ghost`, `danger`, `inputCls`) and `Stat`, `Empty`, `Avatar` stayed the single source; a component-level refactor would touch every page without changing what users see.

**Tests (2026-11-01):** typecheck clean; smoke 23+23, phase1-desktop 26/26, phase1-phone 10/10, phase3-desktop 22/22, phase3-phone 16/16, phase5-avatars-ui 6+6, phase5-users-ui 6+6, phase6-mobile 37/37 with 0 problems. Screenshots of the admin dashboard, inspector and applicant dashboard reviewed at both widths. (A full-page headless screenshot draws the money chart's bar in the wrong place; the DOM and a normal screenshot show it correctly at October.)

### 2026-11-01: Step 7.4 done (admin layout)

**Built:**
- **Header (A3, AM2):** one 64 px row: title on the left, search fills the middle (up to 36 rem), freeze button and avatar pinned right. On phones the search is an icon that opens a focused search row (closes on navigation), so the header stays 64 px instead of ~110 px. The phone header leaves out the avatar so the title fits; the account is in the menu and Settings → Your account. Search placeholder says what it covers.
- **Dashboard KPIs (A5):** "Active users 3 / 0 frozen" replaced by **Frozen accounts** (links to the users directory filtered to frozen). The review queue's details line wraps on phones instead of cutting the date (AM6).
- **User inspector (A6, AM3):** the header shows status, verification, level, email and organisation; the masked card number and internal id are gone. A **sticky section menu** (Profile, Limits, Balances & cards, Applications, KYC, Audit trail) sits under the header, one scrollable row of chips on phones; each section scrolls into view below it.
- Ledger search placeholder shortened so it fits (A8).
- (4-Eyes badge removal from A4 was done in 7.2.)

**Tests (2026-11-01):** typecheck clean; phase3-desktop 22/22, phase3-phone 16/16 (new: header ≤ 64 px, search hidden until the icon is tapped, focus moves to it), phase5-avatars-ui / users-ui / audit-ui 6+6 each, phase5-cards-ui 5+5, phase5-debits-ui 5+5, phase6-mobile 37/37 with 0 problems (it now checks the search button and the 64 px header on every admin page), smoke 23+23. By hand: the inspector chips land each section 17 px below the menu (or as far as the page can scroll).

### 2026-11-01: Step 7.5 done (admin tables on phones)

**Built:** below the `md` breakpoint (768 px) the **ledger** (Transactions) and the **Recent decisions** table on the Deposit and Withdrawal pages become one card per entry: user, type · account and the **signed amount** on the first line; reason; then date, who did it and the linked application or request. The audit log and users directory already had phone cards (5.3, 5.4). Wider screens keep the tables.

**Tests (2026-11-01):** typecheck clean; phase3-desktop 22/22; phase3-phone 17/17 (new: at 390 px the ledger table is hidden, every amount is fully on screen, no sideways scroll; the old "table scrolls sideways" check replaced); phase5-debits-ui 5+5; phase5-limits-ui 6+6; phase6-mobile 37/37 with 0 problems. `phase5-withdrawals` was run but its email checks need an API started with a Resend key and sender (this test API had none), so its 3 email checks failed for that reason; it tests the API, which 7.5 didn't change.

### 2026-11-01: Step 7.6 done (applicant fixes)

**Built:**
- **Menu in groups (U1):** Overview (Dashboard, My Applications, Milestones) · Find funding (Grant categories, Grant Search) · Track (Funding Tracker, Reports) · Money (Cards, Transactions, Withdrawals, Add funds); Settings and Help stay at the bottom. "Grant Funding Tracker" is "Funding Tracker" in the menu.
- **Grant categories is an overview (U2):** your top matches, then one tile per category (number of grants, largest amount, next deadline, how many are recommended for you; ranked by best match once you've answered). A tile opens **Grant Search filtered to that category** (`/grant-search?category=…`; an unknown value falls back to All). The grant cards appear only in Grant Search now.
- **Setup cards (U3):** "Recommended" only while the step is unfinished.
- **Highlights filter (U4):** it filters by amount, not status as the review said, so "All Revenue" became **"All amounts"**.
- **Dashboard rows (G3, UM2):** the line under each title shows category · amount · date instead of repeating the status badge.
- **Organisation (U5):** the "Acme Foundation ▾" switcher is a plain label.
- **Cards (U7):** both card designs show a chip and a contactless mark, so the virtual card is no longer an empty blue block.
- **Withdrawals / Add funds (U8):** a "What happens next" box: reference, the hold on withdrawals, a finance administrator's decision (told in the app, and by email when email is on), what approval does to which balance. It promises no timings or bank details, because no payment processor is connected.
- (U6, the Help Centre support address, was done in 7.1.)

**Tests (2026-11-01):** typecheck clean; phase6-matchmaking-ui 7+7 (ranked grid and "Why this match" now checked in Grant Search; new: no grant cards on the overview, category tile → filtered search, no Recommended badge on a finished setup card, row shows category · amount · date), phase6-matchmaking 8/8, phase1-desktop 26/26, phase1-phone 10/10, phase2-desktop 25/25, phase2-phone 6/6, phase6-cards-ui 6+6, phase5-limits-ui 6+6, phase6-mobile 37/37 with 0 problems, smoke 23+23.

### 2026-11-01: Step 7.7 done (applicant phone)

**Built:**
- **Dashboard (UM1, UM5):** a full-width **New Application** button under the name and organisation replaces the loose "Here are your account's highlights." line.
- **Setup cards (UM4):** the swipe row snaps to the 16 px page margin (`scroll-px-4`) instead of the screen edge.
- **Application rows (UM2):** on phones the status badge sits under the details, so titles use the full width (one or two lines instead of three).
- **Grant Search (UM3):** below 768 px the filters fold behind a **Filters** button (shows how many are on), with the result count beside it. Grant cards on phones are three lines: category · due date (with the match badges), title, then amount next to Apply / Save. The page went from **3,258 px to 2,006 px** (−38%; the plan's "about half" wasn't fully reached without hiding Apply behind a tap, which would be worse). Desktop cards are unchanged.

**Tests (2026-11-01):** typecheck clean; `pnpm test` 73/73; phase6-mobile 39/39 with 0 problems (new: phone New Application on screen, first setup card at 16 px, filters folded and reopenable, Grant Search under 2,200 px); phase6-matchmaking-ui 7+7; phase1-desktop 26/26; phase1-phone 10/10; phase2-desktop 25/25; phase2-phone 6/6; smoke 23+23.

### 2026-11-01: Step 6.6 done in code (virus scanning of uploads)

**Built:**
- `api-server/src/lib/virusScan.ts`: talks to a ClamAV daemon (clamd) with `zINSTREAM`, streaming the bytes in 64 KB chunks, so nothing touches the disk before it's checked and clamd needs no access to the upload folder. Address from `CLAMAV_SOCKET` (local socket) or `CLAMAV_HOST` + `CLAMAV_PORT`; **off when neither is set**.
- `storeUpload` scans **first**, before the type check and before sharp or the PDF/DOCX checks read the file. Flagged: 400 "This file didn't pass the virus scan, so it wasn't saved…", logged at warn with the signature, profile, purpose and SHA-256; nothing written. Scanner down or erroring: **503** "Uploads are paused for a moment…", logged as an error (fail closed). `CLAMAV_FAIL_OPEN=1` accepts uploads unscanned instead, with a warning per upload. `CLAMAV_TIMEOUT_MS` (default 30 s).
- `GET /admin/monitoring` gains `virusScan` (enabled, ok, failOpen, version, error; OpenAPI `VirusScanStatus`). **Admin → Settings → Monitoring** shows an "Upload virus scanning" card: Off / Scanning (with ClamAV version and signature date) / Not answering.
- Docs: `deploy/api.env.example` (commented `CLAMAV_SOCKET`), `docs/DEPLOY.md` **step 11** (memory check first, `clamav-daemon`, `ConcurrentDatabaseReload no`, EICAR test), `server.md` step 11 and §8, `docs/PROJECT.md`, `replit.md`.

**Decision needed (server memory):** clamd keeps its signatures in memory, about 1–1.2 GB. The VPS has 1.8 GB for four apps (46.5% used on 2026-10-31), so installing it there now would push the apps into swap. Options: add memory to the server first (4 GB is comfortable), or leave scanning off. The code is deployed either way and stays off until `CLAMAV_SOCKET` is set.

**Tests (2026-11-01):** typecheck clean; `pnpm test` 80/80 (7 new in `virusScan.test.ts` with an in-process clamd stand-in: off without settings, 200 KB streamed in chunks, the EICAR string refused (alone and inside a PDF) with its signature name, fail closed when down, fail open with `CLAMAV_FAIL_OPEN=1`, scanner ERROR reply, timeout, status). New `.unlazy/mock-clamd.mjs` (recognises only EICAR) and `.unlazy/phase6-virus.mjs` 6/6 against the test API with `CLAMAV_HOST`: EICAR as `.com`, `.png` and inside a PDF refused with nothing stored; a clean photo accepted; a clean GIF still refused by the type check; Settings shows Scanning (desktop); scanner stopped: 503, nothing stored, Settings shows Not answering (phone, no sideways scroll); scanner back: uploads work without a restart. Regressions with scanning on: phase2-desktop 25/25, phase2-phone 6/6, phase5-avatars 12/12, phase5-avatars-ui 6+6. Not tested against a real ClamAV (not installable here); the EICAR test on the server is in DEPLOY step 11.

**Strings in the repo:** the EICAR string is assembled from two parts in the tests so the source files don't set off antivirus software.

## 14. Phase 8 build plan: user dashboard balance cards (2026-11-02)

**Request (user, 2026-11-02):** three balance cards on the applicant home dashboard, in brand colours with different shades, replacing the current top of the dashboard. Tier logic will be specified later; build the UI now.

| # | Label | Figure | Line under the figure |
|---|---|---|---|
| 1 | **Eligible amount** | e.g. `$75,000.00` | "Largest open award at Tier 1" (tier 1–3, the applicant's own) |
| 2 | **Grant balance** | `$0.00` | `0` approved awards (count of approved applications; "1 approved award" singular) |
| 3 | **Successful deposit** | `$0.00` | "Covers card fees and commissions" |

### 14a. What exists already (no migration needed)
- `demo_profiles.tier` (1–3, set by an admin in the user inspector) is already returned by `GET /applicant/account` (`tier`).
- Grant balance: `balances.grant` (credited by the ledger when an application is approved).
- Deposits: `balances.deposit` (current balance) and the ledger's approved `Deposit` entries (lifetime total).
- Open grants and amounts: `api-server/src/lib/grantCatalog.ts` (12 sample grants, $2,500–$75,000, with deadlines).

### 14b. Plan (step 8.1)
1. **API:** `GET /applicant/dashboard` gains `balanceSummary { tier, eligibleAmount, grantBalance, approvedAwards, depositedTotal }`, computed server-side so the dashboard stays one request. OpenAPI + codegen. Placeholder rule until the tier rules arrive: `eligibleAmount` = largest open (deadline not passed) catalogue award, in one function (`eligibleAmountFor(tier)`) so the real tier logic drops in later.
2. **UI:** a `BalanceCards` component at the top of the dashboard, replacing the Grant Funding Tracker card (the chart stays on the Funding Tracker page).
   - Colours: three shades of the brand navy, white text, every pair ≥ 4.5:1 contrast: card 1 `#0F172A → #1E3A8A`, card 2 `#1E3A8A → #1E40AF`, card 3 `#1D4ED8 → #2563EB` (subtle gradient, small icon in a translucent white tile, faint decorative shape).
   - Desktop / tablet (md+): three equal columns.
   - Phone (390 px): Eligible amount full width, Grant balance and Successful deposit side by side below it (all three visible without scrolling or swiping).
   - Amounts in tabular figures; loading skeletons; `$0.00` / `0 approved awards` as the empty state; frozen account shows the existing frozen notice.
   - Each card links to its page: Eligible amount → Grant Search, Grant balance → My Applications (approved), Successful deposit → Add funds.
3. **Tests:** typecheck, `pnpm test` (+ unit test for the summary), new `.unlazy/phase8-balances-ui.mjs` (desktop + phone: figures match the API, singular/plural, tier text, links, no overflow at 390 px), phase1 desktop/phone, phase6-matchmaking-ui, smoke, and the `phase6-mobile` audit at 0 problems. Before/after screenshots at 1440 and 390 px.

### 14c. Answers (user, 2026-11-02) and what changes in the plan
1. **Only the Grant Funding Tracker card** (Total Grant Budget / Funds Allocated / chart) is replaced. Setup cards and Grant Highlights stay. The chart stays on the Funding Tracker page.
2. **Successful deposit = approved deposits minus the charges taken from them** (card funding fee, withdrawal fee, …). That is the existing **deposit balance** (`demo_profiles.deposit_cents`): approved deposits and deposit top-ups in, debits on the deposit account out, all through the ledger. Today charges are taken as admin debits on the deposit account (5.5); automatic fees aren't built yet.
3. Cards / Transactions pages keep their tiles for now; revisit once the dashboard cards are approved.
4. ("Level" vs "Tier" wording on the admin side) re-explained and asked again.
5. **The Eligible amount is set by the administrator**, the same way as withdrawal limits:
   - **Global, one amount per tier** (Tier 1, Tier 2, Tier 3) in Admin Settings, in the money section (today "Withdrawal limits", renamed **"Money"** to hold both).
   - **Per user** in the user inspector: "Use the Tier N amount" or "Custom amount for this user" (replaces the tier amount).
   - Effective amount = custom amount if set, otherwise the amount for the user's current tier; not set → `$0.00`.
   - Every change is audited; a per-user change notifies the applicant (like withdrawal limits).
   - The amount is shown only, for now: it doesn't limit what an applicant can request. The rest of the tier logic comes later.

### 14d. Build (step 8.1, revised)
- **Migration 0008:** `demo_settings.tier1_eligible_cents`, `tier2_eligible_cents`, `tier3_eligible_cents` (integer, null = not set); `demo_profiles.eligible_custom` (boolean, default false), `eligible_cents` (integer). No new table, so no new RLS policy.
- **Server:** `lib/eligibleAmount.ts` (effective amount, parsing $0.01–$10,000,000 with two decimals, description for the audit); `GET|PUT /admin/system/tier-amounts`; `PUT /admin/users/{userId}/eligible-amount`; the admin user profile gains `eligibleAmount { custom, amount, tierAmount }`; `GET /applicant/dashboard` gains `balanceSummary { tier, eligibleAmount, grantBalance, approvedAwards, depositBalance }`.
- **Admin UI:** Settings → Money: "Platform-wide limits" + new "Eligible amount per tier" (three fields). Inspector, Limits section: new "Eligible amount" card next to Withdrawal limits.
- **Applicant UI:** `BalanceCards` replaces the tracker card, as in 14b.
- **Tests:** unit tests for `eligibleAmount.ts`; new `.unlazy/phase8-balances.mjs` (API: validation, precedence custom > tier, tier change follows, audit, notification, dashboard summary) and `phase8-balances-ui.mjs` (admin + applicant, desktop + phone); regressions as in 14b plus phase5-limits(-ui) for the renamed Settings section.

### 2026-11-02: Step 8.1 done (dashboard balance cards, eligible amounts)

**Built:**
- **Dashboard:** three balance cards replace the Grant Funding Tracker card (setup cards and Grant Highlights unchanged; the chart stays on the Funding Tracker page). Shades of the brand navy, darkest first: **Eligible amount** (`#0B1739→#172554`, "Largest open award at Tier N", links to Grant Search), **Grant balance** (`#1E3A8A→#1E40AF`, "N approved award(s)", links to My Applications filtered to Approved), **Successful deposit** (`#1D4ED8→#2563EB`, the deposit balance: approved deposits minus charges, "Covers card fees and commissions", links to Add funds). Muted text is blue-100 on the dark cards and white on the bright one (≥ 4.5:1). Desktop and tablet: three columns. Phone: Eligible amount full width, the other two side by side (their icons hidden so labels stay on one line and figures line up).
- **My Applications** accepts `?status=approved` (or any filter name) to open filtered.
- **Admin → Settings → Money** (was "Withdrawal limits", same URL `/admin/settings/limits`): new "Eligible amount per tier" form (Tier 1/2/3, empty = not set, shows $0.00).
- **User inspector → Limits:** new "Eligible amount" card beside Withdrawal limits: "Use the Tier N amount" or "Custom for this user". A per-user change is audited and notifies the applicant when their amount changes; a tier change moves the amount unless it's custom.
- **Server:** migration `0008_eligible_amounts` (`demo_settings.tier1/2/3_eligible_cents`, `demo_profiles.eligible_custom`, `eligible_cents`); `lib/eligibleAmount.ts`; `GET|PUT /admin/system/tier-amounts`; `PUT /admin/users/{userId}/eligible-amount`; `AdminUserProfile.eligibleAmount`; `ApplicantDashboard.balanceSummary`.

**Tests (2026-11-02, test API on :8099 via the proxy, demo data restored before each suite):** typecheck clean; `pnpm test` 87/87 (4 new in `eligibleAmount.test.ts`); new `.unlazy/phase8-balances.mjs` 10/10 (API) and `phase8-balances-ui.mjs` 7/7 desktop + 7/7 phone; phase6-mobile 39/39 with 0 problems; smoke 23+23; phase1-desktop 26/26; phase1-phone 10/10; phase6-matchmaking-ui 7+7; phase5-limits-ui 6+6; phase5-users-ui 6+6. Screenshots reviewed at 1440 and 390 px.

**Tier wording (user, 2026-11-02):** "Level" is now "Tier" everywhere: the inspector header and tier buttons ("Tier 1/2/3", toast "Set to Tier 2"), the users directory ("Tier 2" instead of "L2"), the applicant's Settings ("Account tier: Tier 2") and the audit text ("tier (Tier 2)"). Re-run after the change: phase5-users-ui 6+6, phase3-desktop 22/22, phase3-phone 17/17, phase1-desktop 26/26, phase8-balances-ui 7+7, phase6-mobile 39/39 with 0 problems.

**Before it shows:** the Replit API workflow must be restarted (it serves a build); on the VPS, `deploy.sh` applies migration 0008.

---

## 15. Phase 9 build plan: the remaining backlog (2026-11-04)

**Request (user, 2026-11-04):** build the four open items: 6.7 shared rate limits, an admin queue for physical-card activation requests, automatic fees, and tier rules beyond showing the eligible amount. Plan first, then build.

**Order:** 9.1 and 9.2 need no product decisions, so they are built first. 9.3 (fees) and 9.4 (tier rules) wait for the answers in 15f; 9.4 comes after 9.3 because fees may differ per tier.

### 15a. What exists already
- **Cards** live in `demo_profiles.cards` (JSON list, `lib/cards.ts`). An applicant's "my physical card arrived" sets `activationRequestedAt` on a `Pending` physical card (6.2). The admin can already mark it issued (`changeCard(…, "activate")`, which clears the request), but only from the user inspector; there is no list of who is waiting.
- **Rate limits** (`lib/rateLimit.ts`): fixed one-minute / ten-minute windows in a `Map` in this process. Five limiters: per IP (600/min), writes per account (60/min), uploads (20/10 min), email hook (120/min), crash reports (20/min). Correct for one server; with two, each server counts separately, so the real limit doubles.
- **Charges** today are manual admin debits on the deposit balance (5.5, ledger kind `Debit`). The dashboard's "Successful deposit" card already says "Covers card fees and commissions". There is no `Fee` ledger kind and no fee settings.
- **Tiers** (1–3, `demo_profiles.tier`) are set by hand in the inspector. The only thing a tier drives is the eligible amount (8.1), which is shown, not enforced.

### 15b. Step 9.1: admin queue for card activation requests
- **API:** `GET /admin/card-requests?status=requested|awaiting` lists physical cards that are `Pending`: *Activation requested* (the user says it arrived; oldest first, with how long they've waited) and *Awaiting delivery* (issued, no request yet). Each row: user, card (network, •• last four), issued at, requested at. `POST /admin/card-requests/:userId/:cardId/decline` `{ reason }`: the card stays `Pending`, the request is cleared, the user is notified with the reason (e.g. "the card you have isn't the one we sent"), audited. Activating reuses the existing `changeCard(…, "activate")` (audit + notification already there). No migration: the list is a `jsonb_array_elements` query over `demo_profiles.cards`.
- **Dashboard:** a fifth KPI, "Card activations" (requests waiting), and the requests in the review queue.
- **Admin UI:** new page `/admin/cards` ("Card Requests" in the admin menu after KYC Page, with the waiting count), two tabs, Activate / Decline (decline asks for a reason, ≥ 5 characters, like the deposit and withdrawal queues). Cards on phones, as in 7.5.
- **Applicant UI:** after a decline the card shows "Activation declined: <reason>" and the "My card arrived" button again.
- **Tests:** API suite `.unlazy/phase9-cards.mjs` (list, both tabs, activate, decline with reason, already-decided refusal, frozen account, two admins deciding at once → one wins); UI suite desktop + phone; regressions `phase6-cards(-ui)`, `phase5-cards`, `phase6-mobile`.

### 15c. Step 9.2 (was 6.7): shared rate limits
- **Design:** the limiters get a pluggable counter store. Default stays **in memory** (one server, no change). With `RATE_LIMIT_REDIS_URL` set, counts go to **Redis** with one atomic step per hit (`INCR` + `PEXPIRE` on first hit, in a Lua script), keys `fnf:rl:<limiter>:<who>`, so every API server shares the same counts.
- **Why Redis and not Postgres:** the per-IP limit runs on every request; a Supabase round trip (VPS → Frankfurt) on each one would add latency and database load. Redis is the standard store for this and uses a few MB.
- **If Redis is unreachable:** fall back to the in-memory count for that request and log a warning (at most once a minute), rather than refusing traffic; the site keeps working, limits are per server until Redis is back. Admin Settings → Monitoring shows the store: "Memory (one server)" / "Shared (Redis)" / "Redis not answering, using memory".
- **Not needed today:** there is one API server, so this stays off on the VPS (Redis isn't installed there). `docs/DEPLOY.md` gets an optional step with install and memory notes.
- **Tests:** Vitest with a fake store (shared counts across two limiter instances, window reset, fallback when the store throws, headers unchanged); against a real Redis if one can run here, otherwise against a stand-in that speaks the Redis protocol.

### 15d. Step 9.3: automatic fees (superseded by §17, the user's answers of 2026-11-04)
Proposed shape, to be confirmed:
- **Admin → Settings → Money → Fees:** one setting per fee type (fixed amount, percentage, or percentage with a minimum), empty = no fee; optional per-tier values; per-user "waive fees" switch in the inspector. Every change audited.
- **Charging:** a fee is a ledger row of a new kind **`Fee`**, written in the same transaction as the action that causes it (withdrawal approval, card issue, …), with the audit entry and the notification. Paid from the **deposit balance** (matches "Covers card fees and commissions").
- **Before the user commits:** the Withdrawals / Cards screens show the fee ("Fee $5.00, paid from your deposit balance"); a request the deposit balance can't cover is refused with a clear message (or handled as decided in 15f).
- **Reporting:** "Fees" filter on both Transactions pages, fees in the CSV export, fee total on the admin dashboard.
- Migration for the fee settings and the waiver switch; the ledger `kind` is text, so `Fee` needs no schema change.

### 15e. Step 9.4: tier rules (waits for 15f)
Candidates, to be chosen by the user:
- Cap a grant application's requested amount at the user's eligible amount.
- Default withdrawal limits per tier (the user's custom limits still win).
- Fees per tier (part of 9.3).
- Automatic tier changes (e.g. Tier 2 once identity is verified, Tier 3 after N approved awards), with the admin able to pin a tier.

### 15f. Decisions needed
1. Which fees exist (withdrawal, card issue virtual / physical, card top-up, deposit).
2. How each is worked out (fixed, percentage, percentage with a minimum; per tier or not).
3. Where it's paid from, and what happens when the deposit balance can't cover it.
4. Which tier rules to build, and for automatic tier changes, the thresholds.

### 2026-11-04: Step 9.1 done (admin queue for card activation requests)

**Built** (plan §15b; no migration: cards stay in `demo_profiles.cards`):
- **Server** (`lib/cards.ts`):
  - `listCardRequests(status)`: one `jsonb_array_elements` query over pending physical cards. *Activation requested* = oldest request first; *Awaiting delivery* = oldest issue first. Both tab sizes are returned.
  - `declineCardActivation()`: reason 5–240 characters; the card stays `Pending`; the request is cleared and `activationDeclinedAt` / `activationDeclinedReason` are stored. Audited ("Activation declined for … · reason") and the user is notified. It's allowed while the account is frozen (nothing moves). With no request waiting it's refused ("may already have been decided"), and an active card gets "already active".
  - Asking again or activating clears the old decline.
  - API: `GET /admin/card-requests?status=requested|awaiting`, `POST /admin/card-requests/:userId/:cardId/decline`. Activating reuses `POST /admin/users/:userId/cards/:cardId/actions` `{ action: "activate" }`. `AdminDashboard.pendingCardActivations`, `UserCard.activationDeclinedAt` / `activationDeclinedReason`.
- **Admin UI:**
  - new page `/admin/cards` (`pages/admin-cards.tsx`): **Card Requests** in the menu after KYC Page, with a lime badge showing how many requests wait (refreshed every minute and after every decision)
  - two tabs kept in the address bar (`?tab=awaiting`) with their counts; rows show the user, the card, the issue and request dates and how long it's waited
  - Activate (with a confirmation) / Decline (with a reason); the awaiting tab offers "Mark as issued"
  - Activate is disabled with "Account is frozen" when the account is frozen
  - rows stack on phones with 44 px buttons
  - dashboard: a ninth KPI, **Card activations** (KPIs now 3 per row), and "Cards waiting to be activated" (oldest 5) under the application review queue
  - the inspector's card shows the last declined request
- **Applicant UI:** after a decline the card says "Activation declined: <reason>. Once you have the right card, ask us again." and the "It's arrived: activate" button is back.

**Tests (2026-11-04, test API on :8099 in demo mode, dev DB restored from a snapshot before each suite):**
- typecheck clean
- `pnpm test` 101/101
- new `.unlazy/phase9-cards.mjs` 9/9: tabs and order, dashboard count, reason rules, decline, decided twice, ask again, activate, frozen account, three decisions at once (exactly one wins and one is audited), 404 / 400
- new `phase9-cards-ui.mjs` 6/6 desktop + 6/6 phone
- regressions: phase6-cards 7/7, phase5-cards 9/9, phase5-cards-ui 5+5, phase6-cards-ui 6+6, smoke 23+23, phase3-api 24/24, phase6-mobile 41/41 with 0 problems (now covering `/admin/cards` and `?tab=awaiting`)

**Re-run after Phase 10 (2026-11-04):** typecheck clean, `pnpm test` 101/101, `phase9-cards.mjs` 9/9, `phase9-cards-ui.mjs` 6/6 desktop + 6/6 phone; dev DB restored after each.

**Still to do:** deploy (no migration; goes out with the Phase 10 deploy).

---

## 16. Phase 10 build plan: payment gateway (deposit and withdrawal methods) (2026-11-04)

**Request (user, 2026-11-04):** admins create the deposit and withdrawal methods the applicant chooses from.
- Admin menu: a new main item **Payment Gateway** with two sub-items, **Deposit** and **Withdrawal**.
- Deposit settings page → **Create deposit method** → a form: logo (upload a file or give a link to one), method name, amount rule (**minimum and maximum**, or **one fixed amount**, the admin picks which), then **extra fields** the admin adds to customise the method, and a field for the applicant to **upload payment proof**.
- Withdrawal methods work the same way, except there is no proof upload.
Plan first, then build.

### 16a. What exists already
- Requests are in `demo_requests` (`kind`, `amount_cents`, `note`, `status`, review columns). An applicant's request is just an amount and a note; there's no method, no form fields and no proof file.
- Placing a request (`createApplicantRequest`) and the admin decision (`approveRequest` / `rejectRequest`) already handle locks, freezes, KYC, the hold on available grant balance, withdrawal limits, ledger, audit and notification emails (§8 Phase 3, 5.1, 5.2). **None of that changes.** Methods add rules and data on top.
- Uploads (`lib/uploads.ts`): the real file type is read from the bytes, images are re-encoded with sharp, PDFs are checked, there's a 10 MB cap and virus scanning (6.6). Files are served **owner-only** today.
- The web app's CSP only allows images from the site itself (`img-src 'self' data: blob:`), so a logo hosted on another site won't display.
- The admin menu (`shell.tsx`) is a flat list: Dashboard, Users, Transactions, Deposit Page, Withdrawal Page, KYC Page, Settings. It has no sub-menus yet.

### 16b. Data (migration 0009 + Supabase migration 0004)
New table **`demo_payment_methods`** (RLS on, `app_api_all` policy, no Data API grants):

| Column | What |
|---|---|
| `id` | uuid |
| `kind` | `Deposit` \| `Withdrawal` |
| `name` | 2–60 characters, unique per kind |
| `logo_file_id` | the stored logo (`demo_files`) |
| `amount_mode` | `range` \| `fixed` |
| `min_cents`, `max_cents` | range mode; either one can be empty (no minimum / no maximum), min ≤ max, $0.01–$1,000,000 |
| `fixed_cents` | fixed mode: the applicant can only send exactly this amount |
| `fields` | jsonb list of the admin's extra fields (16c) |
| `proof_required` | deposits only (16f, question 3) |
| `instructions` | optional text shown to the applicant above the form (up to 1,000 characters) |
| `enabled` | off = hidden from applicants and kept for history |
| `sort_order`, `created_at`, `updated_at`, `created_by` | |

`demo_requests` gains:
- `method_id`
- `method_snapshot` (jsonb: name, amount rule and field labels **as they were when the request was placed**, so editing a method later never changes old requests)
- `field_values` (jsonb)
- `proof_file_id`

Old requests have no method and keep showing as today.

### 16c. Extra fields (the admin's form builder)
Each field has a **label**, **type**, **required** on/off, optional placeholder and help text, and is moved up or down with arrow buttons. Types:
- **Short text** (e.g. account holder, wallet address, transaction ID)
- **Long text**
- **Number**
- **Email**, **Phone**
- **Date**
- **Dropdown** (the admin types the options)
- **Information** (display only, filled in by the admin: e.g. "Send to IBAN DE89 …, reference = your email"). It shows to the applicant with a copy button and asks for no input. *Depends on 16f question 1.*

Limits: up to 20 fields per method, labels up to 60 characters, answers up to 500 characters. The server checks every answer against its field: required, type, dropdown option, length.

### 16d. Logo
- **Upload:** PNG, JPEG or WebP, up to 2 MB, re-encoded by sharp to a 256 px WebP (strips metadata), virus-scanned. **SVG is refused** because it can carry scripts.
- **Link:** the server downloads the image **once** when the method is saved and stores it like an upload. It isn't hot-linked, because the CSP would block it, the image could change or disappear, and every applicant's browser would contact a third-party site. Safeguards: `https://` only, refuses private and internal addresses (stops the server being used to reach internal services), redirects re-checked, 2 MB and 10 s caps, must decode as an image.
- Logos are the one kind of file shown to **every signed-in user**, from a new `GET /api/payment-methods/:id/logo` route. Other uploads stay owner-only.

### 16e. Screens and API
**Admin menu:** **Payment Gateway** becomes an expandable group with **Deposit** (`/admin/payment-gateway/deposit`) and **Withdrawal** (`/admin/payment-gateway/withdrawal`). It opens automatically on those pages and works the same in the phone drawer. Deposit Page and Withdrawal Page (the request queues) stay where they are (16f question 4).

**Method settings page (one per kind):**
- A list of methods with logo, name, amount rule ("$50–$5,000" / "Fixed $250"), number of fields, Enabled switch, number of requests, Edit.
- **Create deposit method** / **Create withdrawal method** opens the form as a dialog (full screen on phones): logo (Upload / Link tabs, with a preview), name, amount rule (radio: *Minimum and maximum* / *Fixed amount*), instructions, the field builder, and for deposits the **Payment proof** setting. The applicant's form is previewed live beside it on desktop.
- **Delete** works only for a method that was never used. A used method can only be disabled, so old requests keep their history.
- Every create, edit, enable, disable and delete is audited.

**API:** `GET|POST /admin/payment-methods?kind=`, `PATCH|DELETE /admin/payment-methods/:id`, `POST /admin/payment-methods/:id/logo` (file) and `{ url }`; `GET /applicant/payment-methods?kind=` (enabled methods only, without admin fields).

**Applicant, Add funds / Withdrawals:**
1. Choose a method: tiles with logo, name and amount rule.
2. Amount: fixed methods show the amount, locked; range methods show "Between $50 and $5,000".
3. The instructions, the admin's fields and, for deposits, **upload payment proof** (JPEG/PNG/WebP/PDF, 10 MB, virus-scanned).
4. Submit → the existing "request placed" panel with its reference.

If no method is enabled, the page says "No deposit methods are available yet. Contact support." (16f question 5).

**Placing a request (server, same transaction as today):** the method must exist, be enabled and match the kind. The amount must fit the method's rule. The answers are validated and the proof must be present when required. Then every current check still runs: freezes, KYC, and for withdrawals the available grant balance and the withdrawal limits. The proof is uploaded in the same `multipart` request, so no request ever exists without its proof.

**Admin queues (Deposit Page / Withdrawal Page):** each request shows the method's logo and name, the applicant's answers (labelled from the snapshot) and the payment proof, previewed in the existing document viewer with a download link. Admins can view proofs; the applicant can view their own. Approve and decline work as today. CSV export and header search include the method name.

### 16f. Questions for the user
1. **Extra fields:** do they ask the applicant for information (e.g. their transaction ID, their bank account for a withdrawal), or show the applicant information (e.g. *our* bank details or wallet address to pay to)? Proposed: both (the "Information" type in 16c).
2. **Fixed amount:** one exact amount per method, or several fixed choices (e.g. $100 / $250 / $500)? Proposed: one.
3. **Payment proof:** always required for deposits, or a per-method setting (required / optional / off)? Proposed: per method, required by default.
4. **Menu:** keep Deposit Page and Withdrawal Page (the queues) as their own items, or move them under Payment Gateway too (e.g. Payment Gateway → Deposit methods, Deposit requests, Withdrawal methods, Withdrawal requests)?
5. **The plain request form:** once methods exist, must every request use a method (the plain amount-and-note form goes away)? Proposed: yes.
6. **Withdrawals:** still paid from the grant balance, with the global/per-user withdrawal limits applying **on top of** the method's minimum and maximum? Proposed: yes, and the stricter rule wins.

### 16g. Steps
| Step | What | Done when |
|---|---|---|
| 10.1 | Migrations, method CRUD API, logo upload + link download, audit | Vitest (amount rules, field validation, URL safety) + `.unlazy/phase10-methods.mjs` |
| 10.2 | Admin Payment Gateway menu group + both method settings pages + form builder | `phase10-methods-ui.mjs` desktop + phone |
| 10.3 | Applicant method picker, dynamic form, proof upload; server-side checks on placing | `phase10-requests.mjs` (incl. method disabled mid-way, fixed amount, proof missing, edits don't change old requests) + UI suite |
| 10.4 | Admin queues show method, answers and proof; CSV export and search | regressions: phase3-api, phase5-withdrawals, phase5-limits, phase6-virus, phase6-mobile at 0 problems |

Every step: typecheck, `pnpm test` and its suites before its commit. On the VPS, `deploy.sh` applies migration 0009.

### 16h. Answers (user, 2026-11-04) and what changes in the plan
1. **Extra fields ask the applicant** for what's needed to complete the transaction (wallet address, network name, account number…). The display-only "Information" type is dropped. The platform's own payment details (where to send a deposit) go in the method's **instructions** text.
2. **Fixed amount = several choices.** `fixed_cents` becomes `fixed_amounts_cents` (an integer list, 1–10 choices, each $0.01–$1,000,000, no duplicates). The applicant picks one as a button. The list shows "Fixed: $100 / $250 / $500".
3. **Payment proof is a setting per method:** `proof_mode` = `required` (default) / `optional` / `off`, replacing `proof_required`. Deposits only.
4. **Deposit Page and Withdrawal Page stay where they are** (the request queues: see requests, approve, decline). Payment Gateway holds only the method settings. Change: **approving can carry an optional note** shown to the applicant in the notification and the email. New column `demo_requests.approve_note`, or reuse `review_note`. Declining keeps its required reason, so the applicant always knows why.
5. Explained again to the user (the plain amount-and-note form on Add funds / Withdrawals).
6. **New rule: an applicant can withdraw from the grant balance and from the "main balance".** On the admin user profile, the admin chooses which are open to that user: grant only / main only / both. Waiting on: what the "main balance" is, and the limits question explained again.
7. **Answers, second round (user, 2026-11-04):**
   - **5:** the old plain form goes away. Every deposit and withdrawal request uses a method. Requests placed before Phase 10 (no method) keep showing as today.
   - **Main balance = the deposit balance.**
   - **6 (limits):** no objection to the proposal, so **the stricter rule wins**: the method's minimum/maximum and the user's withdrawal limits (per request, 24 h) both apply.

**Withdrawal sources (added to the plan):**
- `demo_profiles.withdrawal_sources`: `grant` (default: today's behaviour, so nobody changes until an admin decides) / `deposit` / `both`. Set in the user inspector (Limits section: "Withdraw from: Grant balance / Deposit balance / Both"). Audited, and the applicant is notified.
- `demo_requests.source` (`grant` | `deposit`, null for deposits; existing withdrawals are backfilled to `grant`).
- **Placing:** the source must be allowed for the user. The amount must fit the **available amount of that balance** = balance − pending withdrawals from the same balance. Withdrawal limits count both sources together (one daily total per user).
- **Approval:** re-checks that the source is still allowed and that the balance covers it, then debits that balance. The ledger row is kind `Withdrawal`, account `grant` or `deposit`.
- **Admin debits (5.5):** the "can't eat into pending withdrawals" protection now applies to the deposit balance too.
- **Applicant:** with both open, Withdrawals shows a "Withdraw from" choice with each balance's available amount. With one, it shows that balance only. `ApplicantAccount.availableToWithdraw` becomes `{ grant, deposit }` plus `withdrawalSources`.
- If the admin closes a source while withdrawals from it are pending, those can't be approved: the approval re-check refuses them with "Withdrawals from the deposit balance are closed for this user", and the admin declines them.

Migration 0009 therefore also adds `demo_profiles.withdrawal_sources` and `demo_requests.source`. The optional approval note reuses `review_note` (one column, set by either decision).

### 2026-11-04: Steps 10.1–10.4 built and tested (payment gateway)

**Built** (plan §16, with the answers in §16h):
- **Database (migration 0009, Supabase 0004):** `demo_payment_methods`; `demo_requests.source`, `method_id`, `method_snapshot`, `field_values`, `proof_file_id` (existing withdrawals backfilled to `grant`); `demo_profiles.withdrawal_sources` (default `grant`). Applied on the Replit DB only.
- **Server:**
  - `lib/paymentRules.ts` (pure: method validation, amount rule, answers per field type, sources)
  - `lib/paymentMethods.ts` (list, create, edit, move, delete-if-unused, logos)
  - `lib/remoteImage.ts` (logo links: https only, private/internal addresses refused, the checked address is the one connected to, redirects re-checked, 2 MB / 10 s)
  - `routes/paymentMethods.ts`; `POST /applicant/requests` is now multipart (method, amount, source, answers JSON, optional proof in `file`); `POST /admin/requests/:id/approve` takes an optional `{ note }`; `PUT /admin/users/:id/withdrawal-sources`
  - upload kinds `logo` (WebP, 256 px, transparency kept) and `proof` (image or PDF)
  - debits protect pending withdrawals on the deposit balance too; money emails show the method, "Paid from" and the approval note
- **Admin UI:**
  - **Payment Gateway** group in the menu (Deposit / Withdrawal; opens by itself on those pages, also in the phone drawer)
  - method list (enable switch, up/down, edit, delete) and the create/edit dialog (logo Upload / Link, amount radio, fixed-amount chips, instructions, field builder, proof setting, live "What applicants see" preview; full screen with a pinned save bar on phones)
  - queues show method, answers, proof preview / download, and the balance paid from, plus an approval note
  - inspector Limits gets "Withdraw from"
- **Applicant UI:**
  - Add funds / Withdrawals: method tiles (picked automatically when there's only one), instructions with copy, amount box with the range or fixed-amount buttons, the method's fields, the proof upload, and "Withdraw from" with each balance's available amount when both are open
  - requests list shows the method, answers, proof link and the approval note
  - Help Centre answers updated

**Not done as planned:** CSV export and header search don't get a separate method column; the ledger reason already reads "Deposit via <method> approved", so both find it by name.

**Tests (2026-11-04, test API on :8099 in demo mode, dev DB restored from a snapshot before each suite):**
- typecheck clean; `pnpm test` 101/101 (14 new: `paymentRules.test.ts`, `remoteImage.test.ts`, 2 money-email tests)
- new `.unlazy/phase10-methods.mjs` 18/18 and `phase10-ui.mjs` 11/11 desktop + 11/11 phone
- regressions: phase3-api 24/24, phase5-withdrawals 11/11, phase5-limits 10/10, phase5-debits 8/8, phase3-desktop 22/22, phase3-phone 17/17, phase5-ui 4+4, phase5-limits-ui 6+6, phase6-mobile 39/39 (0 problems), smoke 23+23, phase1-desktop 26/26, phase8-balances-ui 7+7
- The older suites now place requests through a plain test method (`.unlazy/methods.mjs`). Some phase5-withdrawals assertions were updated for the intended changes: available amount per balance, and "released from your grant balance".

**Still to do:** commit; deploy (`deploy.sh` applies 0009 and Supabase 0004); then create the real methods in Payment Gateway. Until a method is enabled, applicants can't place deposit or withdrawal requests.

---

## 17. Step 9.3 build plan: fees, card types and card purchases (2026-11-04)

**Request (user, 2026-11-04), replacing the proposal in §15d:**
- **Withdrawal fee:** set on each **withdrawal method** when the admin creates or edits it. Never negative. Paid from the **main balance** (= the deposit balance, §16h).
- **Deposit fee:** set on each **deposit method**. Taken **out of the amount being deposited** (deposit $100 with a $3 fee → $97 is credited).
- **Card types:** in Admin Settings the admin chooses which card types users can get (on/off): **Visa Debit, Visa Credit, Mastercard Debit, Mastercard Credit, Amex Platinum**. Each type has its own **virtual** and **physical** settings.
- **Cards are bought.** For each type and kind the admin sets a **price** and a **fee** (fixed or a percentage of the price). The user pays **price + fee** from the main balance: $10 + 1% = **$10.10**; $10 + $1 = **$11.00**.
- **Who gets a card:** both. The applicant sees the enabled types with their prices and clicks to buy, **and** the admin can still issue one from the user's profile.
- **Card top-ups:** no fee. **Every top-up comes from the main balance.** Both the applicant and the admin can top up.
- **Fee rule for everything:** a fee is either a **fixed amount** or a **percentage**, never negative; 0 / empty = no fee. Withdrawal, card and top-up money comes from the main balance; the deposit fee comes out of the deposit itself.

**"Credit" cards (suggested, user to confirm):** no card network or credit line is connected, so a Credit card behaves like every other card here: it spends only what was topped up from the main balance. It stays a type name the admin can sell (and price differently). Admin Settings says so under the card list: "No credit line is connected: every card spends what's topped up from the main balance."

### 17a. What exists already
- Methods (`demo_payment_methods`, §16) have an amount rule but no fee. Placing (`createApplicantRequest`) and approval (`approveRequest`) lock settings and profile and hold pending withdrawals against the balance they come from (`availableCents`).
- Cards (`lib/cards.ts`, JSON in `demo_profiles.cards`) are issued **only by an admin**, free, network `Visa | Mastercard`, at most one non-cancelled card per kind.
- Card top-up is admin-only (`adjustBalance(…, "card")`): it **creates** money on `card_cents`; nothing pays for it.
- Ledger kinds: Top-up, Debit, Deposit, Withdrawal, Grant award, Opening balance.

### 17b. Fee rule (one shape everywhere, `lib/fees.ts`, pure + unit-tested)
- `{ mode: "fixed" | "percent", value }`: fixed $0–$1,000,000 (2 decimals); percent 0–100 (up to 2 decimals). Negative or malformed values are refused.
- `feeCents(rule, baseCents)`: fixed → the value; percent → `round(base × value / 100)` to the cent (half up). $10 at 1% → $0.10.
- Text: "Fee $1.00" / "Fee 1% ($0.10)".

### 17c. Data (migration 0010; no new tables, so no Supabase migration)
- `demo_payment_methods`: `fee_mode` (`fixed` | `percent`, default `fixed`), `fee_value` (integer, default 0: cents, or hundredths of a percent).
- `demo_requests`: `fee_cents` (integer, default 0): the fee **as worked out when the request was placed**, so editing a method never changes a placed request. The method snapshot also keeps the fee rule.
- `demo_settings.card_types` (jsonb): the fixed list of 5 types, each `{ key, enabled, virtual: { priceCents | null, fee }, physical: { priceCents | null, fee } }`. A kind with no price isn't sold. Price $0–$1,000,000 (a $0 card is free).
- Cards in `demo_profiles.cards` gain `type` (e.g. `visa-debit`), `pricePaidCents`, `feePaidCents`; `network` gains `Amex`. Old cards with no `type` read as Visa → Visa Debit, Mastercard → Mastercard Debit (worked out on read, no data rewrite).

### 17d. Withdrawals and deposits
- **Withdrawal, placing:** fee = method rule on the amount. The amount comes from the chosen balance, the fee from the main balance. Available main balance = deposit balance − pending withdrawals from it − **fees of all pending withdrawals**. Withdrawing from the main balance: amount + fee must fit. Refused with the numbers if it doesn't fit (provisional, see 17h).
- **Withdrawal, approval:** re-checks both balances, debits the amount (as today) and the stored fee from the main balance. Ledger: `Withdrawal −amount` + `Fee −fee` (account deposit). Declining charges nothing (the hold is released).
- **Deposit:** fee = method rule on the amount; it must be less than the amount. On approval the deposit balance gets amount − fee. Ledger: `Deposit +amount` + `Fee −fee`.
- **Applicant forms:** the method tile shows its fee; the amount box shows "Fee $2.00, paid from your main balance" (withdrawal) or "Fee $3.00 · you'll receive $97.00" (deposit) as they type.
- **Admin queues and emails:** show the fee and the net amount.
- Withdrawal limits still apply to the amount only (not the fee).

### 17e. Card types and purchases
- **Admin → Settings → Cards** (new section): a row per type with an on/off switch and, for Virtual and Physical, price + fee (fixed / %) + "Total the user pays". Saved together, audited ("Card types updated: …").
- **Applicant → Cards → Get a card:** the enabled types with their kinds and total price (e.g. "Visa Debit · Virtual $10.10 · Physical $25.00"). Buy → confirmation ("$10.00 + fee $0.10 = $10.10 from your main balance") → the card is issued (virtual: active now; physical: pending delivery, then the 9.1 activation flow).
- **Server (`buyCard`), one transaction with settings and profile locked:** type enabled and kind priced; platform and account not frozen; the existing one-card-per-kind rule; available main balance ≥ price + fee. Ledger `Card purchase −price` + `Fee −fee` (account deposit), card stored with what was paid, audited, user notified.
- **Admin issue (inspector):** the admin picks one of the enabled types. It charges the user the same price + fee from the main balance; a **"Free of charge"** tick-box issues it without charging (audited as such).

### 17f. Card top-ups (from the main balance, no fee)
- **Applicant:** "Top up" on an active card: amount → moves from the main balance (available amount) to the card balance. Ledger `Card top-up −x` (deposit) + `Card top-up +x` (card). Not on frozen or pending cards; not while the account or platform is frozen.
- **Admin:** the inspector's card "Top up" now does the same move from the user's main balance (it no longer creates money); refused if the main balance can't cover it.

### 17g. Reporting
- Ledger kinds `Fee`, `Card purchase`, `Card top-up`: filters on both Transactions pages, CSV export, the applicant's transaction list.
- Admin dashboard: **fees collected** (this month / all time).
- Help Centre answers: fees, buying a card, top-ups.

### 17h. Still open (user will answer later; provisional choices used meanwhile)
1. When the main balance can't cover a fee or a purchase: **refused** with a clear message (provisional).
2. Withdrawal fee: **held** when the request is placed, **taken** on approval, released on decline (provisional).
3. Card fee once per purchase; buying again after cancelling charges again (provisional, follows from "buy").
4. Can a user hold more than one card of a kind (e.g. a Visa Debit virtual and an Amex Platinum virtual)? Provisional: keep today's rule (one per kind).
5. Fees per tier (9.4), and whether "Credit" needs anything beyond a name.

### 17i. Steps
| Step | What | Done when |
|---|---|---|
| 9.3.1 | `lib/fees.ts`, migration 0010, method fee fields (API + Payment Gateway form + preview) | Vitest for fees; method API tests |
| 9.3.2 | Fees on placing and approving deposits / withdrawals; applicant forms, queues, emails | `.unlazy/phase93-fees.mjs` (holds, approval, decline, deposit net, edits don't change placed requests, concurrency) |
| 9.3.3 | Settings → Cards (types, on/off, prices, fees) | API + UI tests |
| 9.3.4 | Buying a card; admin issue with a type and "Free of charge" | `phase93-cards.mjs` + UI desktop / phone |
| 9.3.5 | Top-ups from the main balance (applicant + admin) | in `phase93-cards.mjs` |
| 9.3.6 | Ledger kinds, filters, CSV, dashboard fee total, Help Centre; regressions (phase10, phase9, phase5-cards, phase6-cards, phase5-withdrawals, phase5-limits, phase6-mobile) | all green |

Every step: typecheck and `pnpm test`; one commit when 9.3 is green. Deploy applies 0010 with `deploy.sh`.

### 2026-11-05: Step 9.3 built and tested (fees, card types, card purchases, top-ups)

**Built** (plan §17; migration **0010**, no Supabase migration):
- **Fee rule** (`lib/fees.ts`, pure): fixed or percentage, stored as whole numbers (cents; hundredths of a percent, 1% = 100). Never negative, at most two decimals, at most 100% / $1,000,000. A percentage is rounded to the cent, half up.
- **Method fees:**
  - admin: a Fee box ($ / %) on every deposit and withdrawal method, with help text saying who pays. Shown in the method list and the live preview; audited
  - applicant: the method tile shows the fee, and the form shows "Fee $2.00, paid from your deposit balance · total $102.00" or "Fee $3.00 · you'll receive $97.00" as they type
- **Withdrawals:** the fee is worked out when the request is placed and stored on it (`demo_requests.fee_cents`), so editing the method never changes it.
  - The deposit balance's available amount holds the fee of every pending withdrawal. From the grant balance: the grant must cover the amount and the deposit balance the fee. From the deposit balance: amount + fee must fit.
  - Approval re-checks both and writes `Withdrawal` + `Fee` ledger rows. Declining charges nothing.
- **Deposits:** the fee must be less than the amount. Approval credits amount − fee (ledger `Deposit +amount`, `Fee −fee`).
- **Queues, notifications and emails** show the fee and the net or total amount. The approval dialog says where each part comes from.
- **Card types** (`lib/cardTypes.ts`, `demo_settings.card_types`): the five types, each with on/off and a price and fee for virtual and physical. **Admin → Settings → Cards** shows the total the user pays and a note that credit cards have no credit line. Saving is audited.
- **Buying a card:** Cards → *Get a card* (applicant). One shared routine with the admin's Issue card (`issueCard`): settings and profile locked; price + fee from the deposit balance's available amount; ledger `Card purchase` + `Fee`; the card stores its type and what was paid; audited ("Bought …" / "Issued … · paid $26.00" / "· free of charge") and notified.
- **Admin issue:** any type (types that aren't on sale are marked), charged at its price unless **Free of charge** is ticked. A kind with no price is issued free. Older clients that send only `network` get that network's debit card.
- **Top-ups** (`topUpCard`): applicant and admin move money deposit → card account (ledger `Card top-up` on both accounts, no fee). Active cards only; not while the account or the platform is frozen.
  - The card account's plain Credit is gone: the server refuses it and the button is hidden.
  - The card account shows on the live virtual card, or on the active physical card when there's no virtual one.
- **Cards everywhere** now read by type ("physical Visa Debit card •• 1234"). Cards from before 9.3 read as that network's debit card.
- **Reporting:**
  - ledger kinds `Fee`, `Card purchase`, `Card top-up` in both Transactions filters and the CSV export
  - admin dashboard **Fees this month** (all time in the hint), linking to `/admin/transactions?type=Fee`
  - card top-ups are left out of the money in/out chart (a move between the user's own balances)
  - Help Centre: getting a card, top-ups, fees

**Tests (2026-11-05, test API on :8099 in demo mode, dev DB restored from a snapshot after each suite):**
- typecheck clean; `pnpm test` 114/114 (13 new: `fees.test.ts`, method fees in `paymentRules.test.ts`, fee rows in money emails)
- new `.unlazy/phase93-fees.mjs` 8/8, `phase93-cards.mjs` 12/12, `phase93-ui.mjs` 8/8 desktop + 8/8 phone
- regressions: phase10-methods 18/18, phase10-ui 11+11, phase9-cards 9/9, phase9-cards-ui 6+6, phase6-cards 7/7, phase6-cards-ui 6+6, phase5-cards 9/9, phase5-cards-ui 5+5, phase5-withdrawals 11/11, phase5-limits 10/10, phase5-limits-ui 6+6, phase5-debits 8/8, phase5-ui 4+4, phase3-api 24/24, phase3-desktop 22/22, phase3-phone 17/17, phase8-balances 10/10, phase8-balances-ui 7+7, smoke 23+23, phase6-mobile 42/42 with 0 problems (now covering `/admin/settings/cards`)
- Updated for intended changes:
  - card wording now names the type in phase5-cards, phase6-cards, phase9-cards and phase9-cards-ui
  - phase5-cards top-ups go through the card's Top up from the deposit balance
  - phase3-phone now counts 8 admin menu links. It was still 7: 9.1 added Card Requests, and 9.1's regression run didn't include this suite
- Found and fixed while testing: on phones the card fee boxes were 26 px wide (price and fee now stack), and the method list said "No fee" on every row (now shown only when there is a fee).
- The suites were run back to back, so the test API ran with `RATE_LIMIT_*` raised. With the default 60 writes a minute they trip the limit (429).

**Deployed 2026-11-05** at `dc386f9` (0010 applied). **Still to do:**; then set the card types and prices in Admin → Settings → Cards, and fees on the methods. Until a card type is on sale, applicants see "No cards are on sale right now". The provisional choices in §17h are waiting for the user's answers.
