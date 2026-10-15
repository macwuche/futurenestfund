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

### 8e. Decisions needed

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
