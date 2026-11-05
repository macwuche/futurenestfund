import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { feeOn } from '@/components/fee-input';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useUpdateApplicantProfile, useCreateApplicantRequest, useListApplicantPaymentMethods, useGetApplicantApplication, getGetApplicantApplicationQueryKey,
  useWithdrawApplicantApplication, useRespondToApplicantApplication, getGetApplicantDashboardQueryKey,
  useUploadApplicantApplicationDocument, useDeleteApplicantApplicationDocument, useUploadApplicantAvatar, useDeleteApplicantAvatar,
  useGetApplicantKyc, useUploadApplicantKycDocument, getGetApplicantKycQueryKey, useUpdateApplicantPreferences, getGetApplicantAccountQueryKey,
  type ApplicantDashboard, type ApplicantKyc, type KycDocumentKind, type ApplicantAccount, type ApplicantApplication, type ApplicationDetail,
} from '@workspace/api-client-react';
import {
  Award, Check, ChevronDown, ChevronRight, Layers, CircleCheck, CircleX, Clock, FileText, PenLine, Sparkles,
  Search, ArrowDownLeft, Undo2, ArrowLeft, ArrowUpRight, Snowflake, Landmark, Wallet,
  CreditCard, BadgeCheck, Lock, Camera, Upload, Download, Trash2, IdCard, House as HouseIcon, Loader2, Nfc, type LucideIcon,
} from 'lucide-react';
import { Shell } from '@/components/shell';
import { AccountSecurity } from '@/components/security';
import { useAuth } from '@/lib/auth';
import { MatchPill, TopMatches, WhyMatch, useMatchmakingDialog } from '@/components/matchmaking';
import { OwnCardControls } from '@/components/card-self-service';
import { CardShop, CardTopUp } from '@/components/card-shop';
import { Avatar, Empty, ErrorState, Field, FILE_RULES, Modal, PageSkeleton, Skel, StatusBadge, checkFile, cx, dateFmt, fileSize, inputCls, money, statusLabel } from '@/components/bits';
import { apiError, matchesSearch, useApplicantAccount, useApplicantDashboard, useApplications, useDemo, useRefreshApplicant } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';
import { FixedAmountChoices, MethodFieldInputs, MethodInstructions, MethodLogo, ProofInput, RequestDetails, checkFieldValues, type FieldValues } from '@/components/payment-method';

export const card = 'rounded-2xl border border-[#E5E7EB] bg-white shadow-sm';
export const NAVY = '#1E3A8A';
export const GREY = '#B8C0CC';

export function Gate({ title, children }: { title: string; children: (d: ApplicantDashboard) => ReactNode }) {
  const q = useApplicantDashboard();
  return (
    <Shell title={title}>
      {q.isLoading ? <PageSkeleton /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : children(q.data)}
    </Shell>
  );
}

/* ---------- Dashboard ---------- */
export function DashboardPage() {
  return <Gate title="Dashboard">{(d) => <DashboardBody d={d} />}</Gate>;
}
function DashboardBody({ d }: { d: ApplicantDashboard }) {
  return (
    <div className="space-y-5 lg:space-y-6">
      <BalanceCards d={d} />
      <SetupCards d={d} />
      <Highlights d={d} />
    </div>
  );
}

export const usd0 = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export function Legend({ className }: { className?: string }) {
  return (
    <div className={cx('flex gap-4 text-sm text-slate-600', className)}>
      <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: NAVY }} />Submitted</span>
      <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: GREY }} />Review</span>
    </div>
  );
}

/**
 * The three balance cards at the top of the dashboard (Phase 8): three shades of the brand navy, darkest first.
 * Muted text is blue-100 on the two dark cards and white on the brighter one, so every line stays ≥ 4.5:1.
 */
const balanceTones = [
  { bg: 'bg-[linear-gradient(135deg,#0B1739_0%,#172554_100%)]', muted: 'text-blue-100' },
  { bg: 'bg-[linear-gradient(135deg,#1E3A8A_0%,#1E40AF_100%)]', muted: 'text-blue-100' },
  { bg: 'bg-[linear-gradient(135deg,#1D4ED8_0%,#2563EB_100%)]', muted: 'text-white' },
] as const;

function BalanceCard({ tone, href, label, icon: Icon, value, valueTestid, wide, testid, children }: {
  tone: 0 | 1 | 2; href: string; label: string; icon: LucideIcon; value: number | null; valueTestid: string; wide?: boolean; testid: string; children: ReactNode;
}) {
  const t = balanceTones[tone];
  return (
    <Link href={href} data-testid={testid}
      className={cx('press group relative isolate flex min-w-0 flex-col overflow-hidden rounded-2xl p-4 text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#1E3A8A]/30 sm:p-5', t.bg, wide && 'col-span-2 md:col-span-1')}>
      {/* Decorative rings, behind the text */}
      <span aria-hidden="true" className="absolute -right-10 -top-12 -z-10 h-36 w-36 rounded-full border-[18px] border-white/[0.06]" />
      <span aria-hidden="true" className="absolute -bottom-16 right-10 -z-10 h-28 w-28 rounded-full bg-white/[0.04]" />
      <div className="flex items-start justify-between gap-2">
        <p className={cx('text-sm font-medium', t.muted)}>{label}</p>
        {/* The two half-width cards on phones drop the icon so the label stays on one line and the figures line up. */}
        <span className={cx('h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15 transition group-hover:bg-white/15', wide ? 'grid' : 'hidden sm:grid')}><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
      </div>
      <p className={cx('mt-3 font-bold tracking-tight tabular-nums', wide ? 'text-[28px] leading-9 lg:text-[30px]' : 'text-xl leading-7 sm:text-2xl md:text-[28px] md:leading-9 lg:text-[30px]')} data-testid={valueTestid}>
        {money(value ?? 0)}
      </p>
      <p className={cx('mt-1 text-[13px] leading-snug sm:text-sm', t.muted)}>{children}</p>
    </Link>
  );
}

function BalanceCards({ d }: { d: ApplicantDashboard }) {
  const b = d.balanceSummary;
  return (
    <section aria-labelledby="balances-heading" data-testid="section-balances">
      <h2 id="balances-heading" className="sr-only">Balances</h2>
      {/* Phones: Eligible amount full width, the other two side by side; tablet and up: three columns. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        <BalanceCard tone={0} wide href="/grant-search" label="Eligible amount" icon={Award} value={b.eligibleAmount} valueTestid="text-eligible-amount" testid="card-balance-eligible">
          <span data-testid="text-eligible-tier">Largest open award at Tier {b.tier}</span>
        </BalanceCard>
        <BalanceCard tone={1} href="/applications?status=approved" label="Grant balance" icon={Landmark} value={b.grantBalance} valueTestid="text-grant-balance" testid="card-balance-grant">
          <span data-testid="text-approved-awards"><strong className="font-semibold text-white tabular-nums">{b.approvedAwards}</strong> approved {b.approvedAwards === 1 ? 'award' : 'awards'}</span>
        </BalanceCard>
        <BalanceCard tone={2} href="/deposits" label="Successful deposit" icon={Wallet} value={b.depositBalance} valueTestid="text-deposit-balance" testid="card-balance-deposit">
          Covers card fees and commissions
        </BalanceCard>
      </div>
    </section>
  );
}

const setupIcon: Record<string, LucideIcon> = { matchmaking: Sparkles, proposal: FileText };

function SetupCards({ d }: { d: ApplicantDashboard }) {
  const { openNewApp } = useDemo();
  const mm = useMatchmakingDialog();
  // Completion comes from the server: matchmaking once its answers are saved, the proposal step once an application is submitted.
  const act = (id: string) => (id === 'proposal' ? openNewApp() : mm.open());
  if (d.setupCards.length === 0) return null;
  return (
    <section aria-labelledby="setup-heading">
      <h2 id="setup-heading" className="sr-only">Setup and recommendations</h2>
      <div className="noscroll -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0" data-testid="list-setup-cards">
        {d.setupCards.map((c) => {
          const Icon = setupIcon[c.id] ?? Sparkles;
          return (
            <div key={c.id} data-testid={`card-setup-${c.id}`} className="flex min-w-[85%] snap-start flex-col rounded-2xl border border-[#DBEAFE] bg-[#EEF4FB] p-5 sm:min-w-[60%] md:min-w-0">
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-[#1E3A8A] shadow-sm"><Icon className="h-5 w-5" /></span>
                {!c.complete && <StatusBadge status="Recommended" dot={false} />}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{c.title}</h3>
              <p className="mt-1.5 flex-1 text-[15px] leading-relaxed text-slate-600">{c.description}</p>
              {c.complete ? (
                <span data-testid={`status-setup-${c.id}`} className="mt-4 inline-flex items-center gap-1.5 self-start rounded-full bg-[#DCFCE7] px-4 py-2 text-sm font-semibold text-[#166534]"><Check className="h-4 w-4" />Complete</span>
              ) : (
                <button data-testid={`button-setup-${c.id}`} onClick={() => act(c.id)} className="press mt-4 self-start rounded-full bg-[#1E3A8A] px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0F172A]">{c.actionLabel || 'Complete Setup'}</button>
              )}
            </div>
          );
        })}
      </div>
      {mm.dialog}
    </section>
  );
}

export const statusIcon: Record<string, LucideIcon> = { Submitted: FileText, Review: Clock, Approved: CircleCheck, 'Changes requested': PenLine, Declined: CircleX, Withdrawn: Undo2 };
const revenueRanges = [
  { k: 'all', label: 'All amounts', test: () => true },
  { k: 'lt10', label: 'Under $10,000', test: (n: number) => n < 10000 },
  { k: '10to25', label: '$10,000 – $24,999', test: (n: number) => n >= 10000 && n < 25000 },
  { k: 'gte25', label: '$25,000 and above', test: (n: number) => n >= 25000 },
] as const;

function Highlights({ d }: { d: ApplicantDashboard }) {
  const { search } = useDemo();
  const [range, setRange] = useState<(typeof revenueRanges)[number]['k']>('all');
  const test = revenueRanges.find((r) => r.k === range)!.test;
  const list = d.highlights.filter((a) => test(a.amount) && matchesSearch(a, search));
  return (
    <section className={cx(card, 'p-4 sm:p-5')} data-testid="section-highlights" aria-labelledby="highlights-heading">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="highlights-heading" className="text-lg font-semibold text-slate-900 lg:text-xl"><span className="lg:hidden">My Applications</span><span className="hidden lg:inline">Grant Highlights</span></h2>
        <label className="relative hidden sm:block">
          <span className="sr-only">Filter by amount</span>
          <select data-testid="select-revenue" value={range} onChange={(e) => setRange(e.target.value as typeof range)} className="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-sm font-medium text-slate-700 outline-none focus:border-[#1E3A8A] focus:ring-2 focus:ring-[#1E3A8A]/20">
            {revenueRanges.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        </label>
      </div>
      {list.length === 0 ? <Empty title="No applications match" hint="Clear the search or choose another amount range." /> : (
        <ul className="space-y-3" data-testid="list-applications">
          {list.map((a) => {
            const Icon = statusIcon[a.status] ?? FileText;
            return (
              <li key={a.id}>
                <Link href={`/applications/${a.id}`} data-testid={`row-application-${a.id}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-slate-300 hover:bg-slate-50 sm:px-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EEF4FB] text-[#1E3A8A]"><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block font-semibold text-slate-900" data-testid={`text-app-title-${a.id}`}>{a.title}</span>
                    <span className="block text-sm text-slate-500" data-testid={`text-app-meta-${a.id}`}>{a.category} · <span className="tabular-nums">{money(a.amount)}</span> · {dateFmt(a.submittedAt)}</span>
                    {/* Phones: the badge goes under the text, so the title gets the full width (finding UM2). */}
                    <span className="mt-1.5 block sm:hidden"><StatusBadge status={a.status} dot={false} testid={`badge-app-status-m-${a.id}`} /></span>
                  </span>
                  <span className="hidden sm:inline-flex"><StatusBadge status={a.status} dot={false} testid={`badge-app-status-${a.id}`} /></span>
                  <ChevronRight className="hidden h-5 w-5 shrink-0 text-slate-400 sm:block" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AppList({ list }: { list: ApplicantApplication[] }) {
  if (list.length === 0) return <Empty title="No applications match" hint="Clear the search, or start a new application." />;
  return (
    <ul className="divide-y divide-slate-100" data-testid="list-applications">
      {list.map((a) => (
        <li key={a.id}>
          <Link href={`/applications/${a.id}`} data-testid={`row-application-${a.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg py-3 transition hover:bg-slate-50 sm:px-2">
            <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
              <span className={cx('block truncate font-semibold', a.status === 'Withdrawn' ? 'text-slate-500' : 'text-slate-900')} data-testid={`text-app-title-${a.id}`}>{a.title}</span>
              <span className="block text-xs text-slate-500">{a.category} · Submitted {dateFmt(a.submittedAt)}</span>
            </span>
            <span className="text-sm font-semibold tabular-nums" data-testid={`text-app-amount-${a.id}`}>{money(a.amount)}</span>
            <StatusBadge status={a.status} dot={false} testid={`badge-app-status-${a.id}`} />
            <ChevronRight className="hidden h-5 w-5 shrink-0 text-slate-400 sm:block" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Grants ---------- */
export function GrantsPage() {
  return <Gate title="Grant categories">{(d) => <GrantsBody d={d} />}</Gate>;
}
export function GrantCard({ g }: { g: ApplicantDashboard['recommendations'][number] }) {
  const { openNewApp, savedGrants, toggleSavedGrant } = useDemo();
  const { toast } = useToast();
  const saved = savedGrants.includes(g.id);
  return (
    <div data-testid={`card-grant-${g.id}`} className={cx(card, 'lift flex flex-col p-4 sm:p-5')}>
      {/* Phones: category and deadline share one small line, and the amount sits beside the buttons (finding UM3). */}
      <div className="mb-1 flex items-start justify-between gap-2 sm:mb-3">
        <span className="pt-0.5 text-xs text-slate-500 sm:hidden">{g.category} · due {dateFmt(g.deadline)}</span>
        <span className="hidden rounded-full bg-[#EEF4FB] px-2.5 py-0.5 text-xs font-semibold text-[#1E3A8A] sm:inline">{g.category}</span>
        <span className="flex flex-wrap justify-end gap-1.5">{g.recommended && <StatusBadge status="Recommended" dot={false} />}<MatchPill g={g} /></span>
      </div>
      <h3 className="text-base font-semibold text-slate-900 sm:text-lg">{g.title}</h3>
      <p className="mt-1 hidden flex-wrap items-baseline gap-x-3 gap-y-0.5 sm:flex">
        <span className="text-lg font-bold tabular-nums text-[#1E3A8A] sm:text-xl">{money(g.amount)}</span>
        <span className="text-xs text-slate-500">Deadline {dateFmt(g.deadline)}</span>
      </p>
      <WhyMatch g={g} />
      <div className="mt-auto flex items-center gap-2 pt-2 sm:pt-4">
        <span className="mr-auto text-lg font-bold tabular-nums text-[#1E3A8A] sm:hidden">{money(g.amount)}</span>
        <button data-testid={`button-apply-${g.id}`} onClick={() => openNewApp({ title: g.title, category: g.category, amount: g.amount })} className="press rounded-full bg-[#1E3A8A] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0F172A]">Apply</button>
        <button data-testid={`button-save-${g.id}`} aria-pressed={saved} onClick={() => {
          const nowSaved = toggleSavedGrant(g.id);
          toast({ title: nowSaved ? 'Saved to your shortlist' : 'Removed from your shortlist' });
        }} className={cx('press rounded-full border px-4 py-1.5 text-sm font-semibold', saved ? 'border-[#1E3A8A] bg-[#EEF4FB] text-[#1E3A8A]' : 'border-slate-300 hover:border-[#1E3A8A]')}>{saved ? 'Saved' : 'Save'}</button>
      </div>
    </div>
  );
}

/**
 * Grant categories is an overview: your top matches, then one tile per category that opens Grant Search filtered to it.
 * The grant cards themselves live only in Grant Search (finding U2: the two pages used to show the same 12 cards).
 */
function GrantsBody({ d }: { d: ApplicantDashboard }) {
  const scored = d.recommendations.some((g) => g.matchScore !== undefined);
  const cats = useMemo(() => {
    const by = new Map<string, ApplicantDashboard['recommendations']>();
    for (const g of d.recommendations) by.set(g.category, [...(by.get(g.category) ?? []), g]);
    return [...by.entries()].map(([name, grants]) => ({
      name, grants,
      top: Math.max(...grants.map((g) => g.amount)),
      next: grants.map((g) => g.deadline).sort()[0],
      recommended: grants.filter((g) => g.recommended).length,
      best: Math.max(...grants.map((g) => g.matchScore ?? 0)),
    })).sort((x, y) => (scored ? y.best - x.best : 0) || x.name.localeCompare(y.name));
  }, [d, scored]);
  return (
    <div className="space-y-5">
      <TopMatches d={d} />
      <section aria-labelledby="categories-heading" data-testid="section-categories">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="categories-heading" className="text-lg font-semibold text-slate-900">Browse by category</h2>
          <Link href="/grant-search" data-testid="link-all-grants" className="inline-flex min-h-11 items-center text-sm font-semibold text-[#1E3A8A] hover:underline md:min-h-0">See all {d.recommendations.length} grants</Link>
        </div>
        {cats.length === 0 ? <Empty title="No grants open right now" /> : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cats.map((c) => (
              <li key={c.name}>
                <Link href={`/grant-search?category=${encodeURIComponent(c.name)}`} data-testid={`link-category-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  className={cx(card, 'lift group flex h-full items-start gap-3 p-4 transition hover:border-[#1E3A8A]')}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#EEF4FB] text-[#1E3A8A]"><Layers className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2"><span className="font-semibold text-slate-900">{c.name}</span><ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5" /></span>
                    <span className="mt-0.5 block text-sm text-slate-600">{c.grants.length} {c.grants.length === 1 ? 'grant' : 'grants'} · up to <span className="tabular-nums">{usd0(c.top)}</span></span>
                    <span className="mt-0.5 block text-xs text-slate-500">Next deadline {dateFmt(c.next)}</span>
                    {c.recommended > 0 && <span className="mt-2 inline-block"><StatusBadge status="Recommended" dot={false} label={`${c.recommended} recommended`} /></span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------- Applications ---------- */
export function ApplicationsPage() {
  return <Shell title="My Applications"><AppsBody /></Shell>;
}
const appFilters = ['All', 'Active', 'Changes requested', 'Approved', 'Withdrawn'] as const;
function AppsBody() {
  const { search, setSearch, openNewApp } = useDemo();
  const q = useApplications();
  // Links can open the list filtered, e.g. the dashboard's Grant balance card → /applications?status=approved.
  const wanted = new URLSearchParams(useSearch()).get('status')?.toLowerCase().replace(/-/g, ' ');
  const [filter, setFilter] = useState<(typeof appFilters)[number]>(() => appFilters.find((k) => k.toLowerCase() === wanted) ?? 'All');
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const keep = (s: string) => filter === 'All' || (filter === 'Active' ? ['Submitted', 'Review', 'Changes requested'].includes(s) : s === filter);
  const list = q.data.filter((a) => keep(a.status) && matchesSearch(a, search));
  return (
    <div className={cx(card, 'p-4 sm:p-5')}>
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input data-testid="input-search-applications" type="search" aria-label="Search applications" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title or category" className={cx(inputCls, 'pl-9')} />
        </div>
        <button data-testid="button-new-application-page" onClick={() => openNewApp()} className="press rounded-full bg-[#1E3A8A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F172A] sm:ml-auto">New application</button>
      </div>
      <div className="noscroll -mx-1 mb-3 flex gap-2 overflow-x-auto px-1" role="group" aria-label="Filter by status">
        {appFilters.map((k) => (
          <button key={k} aria-pressed={filter === k} data-testid={`filter-app-${k.toLowerCase().replace(/\s/g, '-')}`} onClick={() => setFilter(k)}
            className={cx('press whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold', filter === k ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-[#1E3A8A]')}>{k === 'Changes requested' ? 'Needs changes' : k}</button>
        ))}
      </div>
      <p className="mb-2 text-xs text-slate-500" data-testid="text-application-total">{list.length} shown · {q.data.length} total</p>
      <AppList list={list} />
    </div>
  );
}

/* ---------- Application detail ---------- */
const respondSchema = z.object({
  note: z.string().trim().min(5, 'Write at least 5 characters').max(1000, 'Keep it under 1,000 characters'),
  amount: z.coerce.number().min(100, 'Minimum is $100').max(10_000_000, 'Maximum is $10,000,000'),
});
const eventDot: Record<string, string> = { Submitted: '#16A34A', Review: '#F59E0B', Approved: '#1E3A8A', 'Changes requested': '#A855F7', Declined: '#DC2626', Withdrawn: '#94A3B8' };
const dateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function ApplicationDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const q = useGetApplicantApplication(id, { query: { queryKey: getGetApplicantApplicationQueryKey(id), enabled: !!id, retry: (n, e) => (e as { status?: number })?.status !== 404 && n < 1 } });
  const notFound = (q.error as { status?: number } | null)?.status === 404;
  return (
    <Shell title={q.data?.title ?? 'Application'}>
      <Link href="/applications" data-testid="link-back-applications" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1E3A8A] hover:underline"><ArrowLeft className="h-4 w-4" />My Applications</Link>
      {q.isLoading ? <PageSkeleton />
        : notFound ? <Empty title="Application not found" hint="It may have been removed, or the link is wrong." />
        : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
        : <AppDetail a={q.data} />}
    </Shell>
  );
}

function AppDetail({ a }: { a: ApplicationDetail }) {
  const qc = useQueryClient();
  const refresh = useRefreshApplicant();
  const { toast } = useToast();
  const withdraw = useWithdrawApplicantApplication();
  const respond = useRespondToApplicantApplication();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');
  const Icon = statusIcon[a.status] ?? FileText;
  const lastRequest = [...a.events].reverse().find((e) => e.status === 'Changes requested');
  const f = useForm<z.input<typeof respondSchema>, unknown, z.output<typeof respondSchema>>({ resolver: zodResolver(respondSchema), defaultValues: { note: '', amount: a.amount } });
  const done = (msg: string) => (d: ApplicationDetail) => { qc.setQueryData(getGetApplicantApplicationQueryKey(a.id), d); refresh(); toast({ title: msg }); };
  return (
    <div className="space-y-5">
      <section className={cx(card, 'p-5')} data-testid="section-application-header">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#EEF4FB] text-[#1E3A8A]"><Icon className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-slate-900" data-testid="text-application-title">{a.title}</h2>
            <p className="text-sm text-slate-500">{a.id} · {a.category}</p>
          </div>
          <StatusBadge status={a.status} dot={false} testid="badge-application-status" />
        </div>
        <dl className="mt-5 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <div><dt className="text-sm text-slate-500">Requested amount</dt><dd className="text-lg font-bold tabular-nums text-slate-900" data-testid="text-application-amount">{money(a.amount)}</dd></div>
          <div><dt className="text-sm text-slate-500">Submitted</dt><dd className="font-semibold text-slate-900">{dateFmt(a.submittedAt)}</dd></div>
          <div><dt className="text-sm text-slate-500">Last updated</dt><dd className="font-semibold text-slate-900">{dateFmt(a.updatedAt)}</dd></div>
        </dl>
      </section>

      {a.canRespond && (
        <section className="rounded-2xl border border-[#E9D5FF] bg-[#FAF5FF] p-5" aria-labelledby="respond-heading" data-testid="section-respond">
          <h2 id="respond-heading" className="text-lg font-semibold text-slate-900">Changes requested</h2>
          {lastRequest && <p className="mt-1 text-[15px] text-slate-700" data-testid="text-funder-request">“{lastRequest.note}”<span className="block text-xs text-slate-500">{lastRequest.actor} · {dateFmt(lastRequest.createdAt)}</span></p>}
          <form noValidate className="mt-4 space-y-4" onSubmit={f.handleSubmit((v) => {
            setErr('');
            respond.mutate({ applicationId: a.id, data: { note: v.note, ...(v.amount !== a.amount ? { amount: v.amount } : {}) } }, {
              onSuccess: (d) => { done('Application resubmitted')(d); f.reset({ note: '', amount: d.amount }); },
              onError: (e) => setErr(apiError(e, 'Could not resubmit. Please try again.')),
            });
          })}>
            <Field label="Your reply" error={f.formState.errors.note?.message}><textarea data-testid="input-respond-note" rows={4} placeholder="Explain what you changed…" className={cx(inputCls, 'resize-y')} {...f.register('note')} /></Field>
            <Field label="Requested amount (USD)" error={f.formState.errors.amount?.message}><input data-testid="input-respond-amount" type="number" inputMode="decimal" step="0.01" className={cx(inputCls, 'tabular-nums sm:max-w-xs')} {...f.register('amount')} /></Field>
            {err && <p role="alert" className="text-sm text-[#991B1B]">{err}</p>}
            <button data-testid="button-resubmit" type="submit" disabled={respond.isPending} className="press rounded-full bg-[#1E3A8A] px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0F172A] disabled:opacity-60">{respond.isPending ? 'Resubmitting…' : 'Resubmit application'}</button>
          </form>
        </section>
      )}

      <section className={cx(card, 'p-5')} aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="mb-4 text-lg font-semibold text-slate-900">Status history</h2>
        <ol className="relative space-y-5 border-l-2 border-slate-100 pl-6" data-testid="list-timeline">
          {[...a.events].reverse().map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full ring-4 ring-white" style={{ background: eventDot[e.status] ?? '#94A3B8' }} aria-hidden="true" />
              <p className="font-semibold text-slate-900">{statusLabel(e.status)}</p>
              {e.note && <p className="text-[15px] text-slate-600">{e.note}</p>}
              <p className="text-xs text-slate-500">{e.actor} · {dateTime(e.createdAt)}</p>
            </li>
          ))}
        </ol>
      </section>

      <AppDocuments a={a} onChange={(d) => { qc.setQueryData(getGetApplicantApplicationQueryKey(a.id), d); refresh(); }} />

      {a.canWithdraw && (
        <div className="flex justify-end">
          <button data-testid="button-withdraw-application" onClick={() => setConfirm(true)} className="press rounded-full border border-[#FECACA] bg-white px-4 py-2 text-sm font-semibold text-[#991B1B] hover:bg-[#FEF2F2]">Withdraw application</button>
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Withdraw this application?" testid="dialog-withdraw">
        <p className="text-[15px] text-slate-600">“{a.title}” will be withdrawn and the funder will stop reviewing it. This can’t be undone. You can always submit a new application.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button data-testid="button-withdraw-cancel" onClick={() => setConfirm(false)} className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Keep it</button>
          <button data-testid="button-withdraw-confirm" disabled={withdraw.isPending} onClick={() => withdraw.mutate({ applicationId: a.id }, {
            onSuccess: (d) => { setConfirm(false); done('Application withdrawn')(d); },
            onError: (e) => { setConfirm(false); toast({ title: 'Could not withdraw', description: apiError(e, 'Please try again.'), variant: 'destructive' }); },
          })} className="press rounded-full bg-[#991B1B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#7F1D1D] disabled:opacity-60">{withdraw.isPending ? 'Withdrawing…' : 'Withdraw'}</button>
        </div>
      </Modal>
    </div>
  );
}

const MAX_APP_DOCS = 5;
function AppDocuments({ a, onChange }: { a: ApplicationDetail; onChange: (d: ApplicationDetail) => void }) {
  const { toast } = useToast();
  const upload = useUploadApplicantApplicationDocument();
  const remove = useDeleteApplicantApplicationDocument();
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const [removing, setRemoving] = useState<ApplicationDetail['documents'][number] | null>(null);
  const canAdd = a.canAttach && a.documents.length < MAX_APP_DOCS;
  const pick = (file: File | undefined) => {
    if (!file) return;
    const problem = checkFile(file, 'proposal');
    setErr(problem);
    if (problem) return;
    upload.mutate({ applicationId: a.id, data: { file } }, {
      onSuccess: (d) => { onChange(d); toast({ title: 'Document attached', description: file.name }); },
      onError: (e) => setErr(apiError(e, 'The document could not be uploaded. Please try again.')),
    });
  };
  return (
    <section className={cx(card, 'p-5')} aria-labelledby="docs-heading" data-testid="section-documents">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="docs-heading" className="text-lg font-semibold text-slate-900">Documents</h2>
        {canAdd && (
          <button data-testid="button-attach-document" onClick={() => input.current?.click()} disabled={upload.isPending}
            className="press inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-[#1E3A8A] hover:border-[#1E3A8A] hover:bg-[#EEF4FB] disabled:opacity-60">
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{upload.isPending ? 'Uploading…' : 'Attach document'}
          </button>
        )}
        <input ref={input} type="file" accept={FILE_RULES.proposal.accept} hidden data-testid="input-attach-document" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {err && <p role="alert" className="mb-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-document-error">{err}</p>}
      {a.documents.length === 0 ? (
        <p className="text-sm text-slate-500" data-testid="text-no-documents">{a.canAttach ? 'No documents yet. Attach your proposal as a PDF or Word file (up to 10 MB).' : 'No documents were attached.'}</p>
      ) : (
        <ul className="space-y-2" data-testid="list-documents">
          {a.documents.map((d) => (
            <li key={d.id} data-testid={`row-document-${d.id}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EEF4FB] text-[#1E3A8A]"><FileText className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-slate-900">{d.name}</span>
                <span className="block text-xs text-slate-500">{fileSize(d.sizeBytes)} · {dateFmt(d.uploadedAt)}</span>
              </span>
              <a href={d.url} download={d.name} aria-label={`Download ${d.name}`} data-testid={`link-document-${d.id}`} className="grid h-10 w-10 place-items-center rounded-full text-slate-600 hover:bg-slate-100"><Download className="h-4 w-4" /></a>
              {a.canAttach && <button aria-label={`Remove ${d.name}`} data-testid={`button-remove-document-${d.id}`} onClick={() => setRemoving(d)} className="grid h-10 w-10 place-items-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {a.canAttach && a.documents.length >= MAX_APP_DOCS && <p className="mt-3 text-xs text-slate-500">You've attached the maximum of {MAX_APP_DOCS} documents. Remove one to add another.</p>}
      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Remove this document?" testid="dialog-remove-document">
        <p className="text-[15px] text-slate-600">“{removing?.name}” will be removed from this application.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setRemoving(null)} className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Keep it</button>
          <button data-testid="button-remove-document-confirm" disabled={remove.isPending} onClick={() => removing && remove.mutate({ applicationId: a.id, fileId: removing.id }, {
            onSuccess: (d) => { onChange(d); toast({ title: 'Document removed', description: removing.name }); setRemoving(null); },
            onError: (e) => { setRemoving(null); setErr(apiError(e, 'The document could not be removed.')); },
          })} className="press rounded-full bg-[#991B1B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#7F1D1D] disabled:opacity-60">{remove.isPending ? 'Removing…' : 'Remove'}</button>
        </div>
      </Modal>
    </section>
  );
}

/* ---------- Account-backed pages (Cards, Transactions, Withdrawals, Add funds) ---------- */
type Account = ApplicantAccount;
type Tx = Account['transactions'][number];

export function AccountGate({ title, children }: { title: string; children: (a: Account) => ReactNode }) {
  const q = useApplicantAccount();
  return (
    <Shell title={title}>
      {q.isLoading ? <PageSkeleton /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : children(q.data)}
    </Shell>
  );
}

function FrozenNotice({ a }: { a: Account }) {
  if (a.status !== 'Frozen' && !a.platformFrozen) return null;
  return (
    <div role="status" data-testid="banner-account-frozen" className="flex items-start gap-3 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]">
      <Snowflake className="mt-0.5 h-5 w-5 shrink-0" />
      <p><strong className="font-semibold">{a.status === 'Frozen' ? 'Your account is frozen.' : 'The platform is temporarily frozen.'}</strong> Deposits and withdrawals are paused. Your balances are safe.</p>
    </div>
  );
}

function StatTile({ label, value, icon: Icon, testid }: { label: string; value: number; icon: LucideIcon; testid: string }) {
  return (
    <div className={cx(card, 'flex items-center gap-3 p-4')}>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#EEF4FB] text-[#1E3A8A]"><Icon className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="truncate text-xl font-bold tabular-nums text-slate-900" data-testid={testid}>{money(value)}</p>
      </div>
    </div>
  );
}

function Balances({ a }: { a: Account }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatTile label="Grant balance" value={a.balances.grant} icon={Landmark} testid="text-balance-grant" />
      <StatTile label="Deposit balance" value={a.balances.deposit} icon={Wallet} testid="text-balance-deposit" />
      <StatTile label="Card balance" value={a.balances.card} icon={CreditCard} testid="text-balance-card" />
    </div>
  );
}

/* Cards */
export function CardsPage() {
  return <AccountGate title="Cards">{(a) => <CardsBody a={a} />}</AccountGate>;
}
function NetworkMark({ network }: { network: string }) {
  if (network === 'Mastercard') {
    return <span aria-label="Mastercard" className="flex"><i className="h-7 w-7 rounded-full bg-[#EB001B]/90" /><i className="-ml-3 h-7 w-7 rounded-full bg-[#F79E1B]/90" /></span>;
  }
  if (network === 'Amex') return <span aria-label="American Express" className="rounded bg-white/90 px-1.5 py-0.5 text-xs font-extrabold tracking-wider text-[#016FD0]">AMEX</span>;
  return <span className="text-xl font-extrabold italic tracking-wide">VISA</span>;
}
function CardsBody({ a }: { a: Account }) {
  const { data: d } = useApplicantDashboard();
  const live = a.cards.filter((c) => c.status !== 'Cancelled');
  const cancelled = a.cards.filter((c) => c.status === 'Cancelled');
  return (
    <div className="space-y-5">
      <FrozenNotice a={a} />
      <Balances a={a} />
      <section aria-labelledby="cards-heading" className="space-y-3">
        <h2 id="cards-heading" className="text-lg font-semibold text-slate-900">Your cards</h2>
        {live.length === 0 ? <Empty title="No cards on this account" hint="Buy one below, paid from your deposit balance." /> : (
          <div className="grid gap-4 md:grid-cols-2" data-testid="list-cards">
            {live.map((c) => (
              <div key={c.id} className={cx(card, 'p-4')} data-testid={`card-payment-${c.id}`}>
                <div className={cx('relative flex aspect-[1.586/1] flex-col overflow-hidden rounded-xl p-5 text-white',
                  c.kind === 'Physical' ? 'bg-gradient-to-br from-[#0F172A] to-[#334155]' : 'bg-gradient-to-br from-[#1E3A8A] to-[#3B63C4]',
                  c.status === 'Frozen' && 'opacity-60 grayscale')}>
                  {c.status === 'Frozen' && <span className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-1 text-xs font-bold uppercase tracking-widest text-slate-900" data-testid={`label-card-frozen-${c.id}`}>Frozen</span>}
                  <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10" />
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold tracking-tight">GrantApp</span>
                    <span className="text-xs font-semibold uppercase tracking-widest text-white/80">{c.typeName.replace(/^(Visa|Mastercard|Amex) /, '')} · {c.kind}</span>
                  </div>
                  <span className="mt-4 flex items-center gap-2" aria-hidden="true">
                    <span className="relative h-8 w-11 overflow-hidden rounded-md bg-gradient-to-br from-amber-200 to-amber-400"><i className="absolute inset-x-0 top-1/2 h-px bg-amber-600/40" /><i className="absolute inset-y-0 left-1/2 w-px bg-amber-600/40" /></span>
                    <Nfc className="h-6 w-6 text-white/80" />
                  </span>
                  <p className="mt-auto text-lg tracking-[0.2em] tabular-nums sm:text-xl">•••• •••• •••• {c.lastFour}</p>
                  <div className="mt-3 flex items-end justify-between">
                    <span className="text-sm font-medium uppercase tracking-wide text-white/85">{d?.profile.name ?? ''}</span>
                    <NetworkMark network={c.network} />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-500" data-testid={`text-card-type-${c.id}`}>{c.kind} {c.typeName}</p>
                    <p className="text-lg font-bold tabular-nums text-slate-900" data-testid={`text-card-balance-${c.id}`}>{c.status === 'Pending' ? 'Being issued' : money(c.balance)}</p>
                  </div>
                  <StatusBadge status={c.status} dot={false} testid={`badge-card-${c.id}`} />
                </div>
                <OwnCardControls c={c} accountFrozen={a.status === 'Frozen'} />
                <div className="mt-2"><CardTopUp c={c} a={a} /></div>
              </div>
            ))}
          </div>
        )}
        {cancelled.length > 0 && (
          <div className={cx(card, 'p-4')} data-testid="list-cancelled-cards">
            <h3 className="text-sm font-semibold text-slate-900">Cancelled cards</h3>
            <ul className="mt-2 space-y-2">{cancelled.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500" data-testid={`row-cancelled-card-${c.id}`}>
                <span>{c.kind} {c.typeName} •••• {c.lastFour}{c.statusReason ? ` · ${c.statusReason}` : ''}</span><StatusBadge status="Cancelled" dot={false} />
              </li>
            ))}</ul>
          </div>
        )}
        <p className="text-xs text-slate-500">Sample card designs. No real card network is connected.</p>
      </section>
      <CardShop a={a} />
    </div>
  );
}

/* Transactions */
const txTypes = ['All', 'Deposit', 'Withdrawal', 'Grant award', 'Top-up', 'Debit', 'Fee', 'Card purchase', 'Card top-up'] as const;
const txFilterLabel: Record<(typeof txTypes)[number], string> = { All: 'All', Deposit: 'Deposits', Withdrawal: 'Withdrawals', 'Grant award': 'Grant awards', 'Top-up': 'Top-ups', Debit: 'Debits', Fee: 'Fees', 'Card purchase': 'Card purchases', 'Card top-up': 'Card top-ups' };
const accountLabel: Record<string, string> = { grant: 'Grant', deposit: 'Deposit', card: 'Card' };

/** Deposit and withdrawal requests are reviewed by the finance team, so their statuses read as review outcomes. */
const requestStatusLabel: Record<string, string> = { Pending: 'Under review', Completed: 'Approved', Declined: 'Declined' };
export function TxRow({ t, showDetails = false }: { t: Tx; showDetails?: boolean }) {
  const incoming = t.direction === 'in';
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  return (
    <li data-testid={`row-transaction-${t.id}`} className="rounded-xl border border-slate-200 p-3 sm:px-4">
    <div className="flex items-center gap-3">
      <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-lg', incoming ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#EEF4FB] text-[#1E3A8A]')}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block font-semibold text-slate-900">{t.description}</span>
        <span className="block truncate text-sm text-slate-500">{t.type}{t.reference && <> · <span data-testid={`text-transaction-ref-${t.id}`}>Ref {t.reference}</span></>}<span className="hidden sm:inline"> · {accountLabel[t.account]} account</span> · {dateFmt(t.createdAt)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className={cx('font-semibold tabular-nums', t.status === 'Declined' ? 'text-slate-400 line-through' : incoming ? 'text-[#166534]' : 'text-slate-900')} data-testid={`text-transaction-amount-${t.id}`}>{incoming ? '+' : '−'}{money(t.amount)}</span>
        <StatusBadge status={t.status} dot={false} label={t.reference ? requestStatusLabel[t.status] : undefined} />
      </span>
    </div>
    {showDetails && <RequestDetails method={t.method} details={t.details} proofUrl={t.proofUrl} source={t.type === 'Withdrawal' ? t.source : undefined} testid={`details-transaction-${t.id}`} />}
    {showDetails && t.fee ? <p className="mt-2 text-xs tabular-nums text-slate-600" data-testid={`text-fee-${t.id}`}>{t.type === 'Deposit' ? `Fee ${money(t.fee)} · ${t.status === 'Completed' ? 'credited' : 'you receive'} ${money(Math.round((t.amount - t.fee) * 100) / 100)}` : `Fee ${money(t.fee)}, from your deposit balance`}</p> : null}
    {showDetails && t.status === 'Completed' && t.reviewNote && <p className="mt-2 text-xs text-slate-600" data-testid={`text-approve-note-${t.id}`}><span className="font-semibold">Note from our team:</span> {t.reviewNote}</p>}
    </li>
  );
}

export function TransactionsPage() {
  return <AccountGate title="Transactions">{(a) => <TxBody a={a} />}</AccountGate>;
}
function TxBody({ a }: { a: Account }) {
  const [type, setType] = useState<(typeof txTypes)[number]>('All');
  const list = a.transactions.filter((t) => type === 'All' || t.type === type);
  return (
    <section className={cx(card, 'p-4 sm:p-5')} aria-labelledby="tx-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="tx-heading" className="text-lg font-semibold text-slate-900">Activity</h2>
        <div className="noscroll -mx-1 flex gap-2 overflow-x-auto px-1" role="group" aria-label="Filter by type">
          {txTypes.map((k) => (
            <button key={k} aria-pressed={type === k} data-testid={`filter-tx-${k.toLowerCase().replace(' ', '-')}`} onClick={() => setType(k)}
              className={cx('press whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold', type === k ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-[#1E3A8A]')}>{txFilterLabel[k]}</button>
          ))}
        </div>
      </div>
      {list.length === 0
        ? <Empty title={type === 'All' ? 'No transactions yet' : `No ${txFilterLabel[type].toLowerCase()} yet`} hint="Deposits, withdrawals, grant awards and top-ups appear here." />
        : <ul className="space-y-3" data-testid="list-transactions">{list.map((t) => <TxRow key={t.id} t={t} />)}</ul>}
    </section>
  );
}

/* Withdrawals and Add funds */
function MoneyPage({ kind }: { kind: 'Deposit' | 'Withdrawal' }) {
  return <AccountGate title={kind === 'Deposit' ? 'Add funds' : 'Withdrawals'}>{(a) => <MoneyBody kind={kind} a={a} />}</AccountGate>;
}
type Source = 'grant' | 'deposit';
const sourceName: Record<Source, string> = { grant: 'Grant balance', deposit: 'Deposit balance' };

function MoneyBody({ kind, a }: { kind: 'Deposit' | 'Withdrawal'; a: Account }) {
  const refresh = useRefreshApplicant();
  const { toast } = useToast();
  const m = useCreateApplicantRequest();
  const methods = useListApplicantPaymentMethods({ kind });
  const isDeposit = kind === 'Deposit';
  const sources: Source[] = a.withdrawalSources === 'both' ? ['grant', 'deposit'] : [a.withdrawalSources];
  const [methodId, setMethodId] = useState('');
  const [source, setSource] = useState<Source | ''>(sources.length === 1 ? sources[0]! : '');
  const [amt, setAmt] = useState('');
  const [values, setValues] = useState<FieldValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [proof, setProof] = useState<File | null>(null);
  const [proofErr, setProofErr] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [placed, setPlaced] = useState<Tx | null>(null);
  const paused = a.status === 'Frozen' || a.platformFrozen;
  const method = methods.data?.find((x) => x.id === methodId);
  const available = isDeposit ? a.balances.deposit : source ? a.availableToWithdraw[source] : null;
  const mine = a.transactions.filter((t) => t.type === kind);
  const lim = a.withdrawalLimits;
  const leftToday = lim.dailyTotal === null ? null : Math.max(0, Math.round((lim.dailyTotal - lim.usedLast24h) * 100) / 100);
  const emailed = !!(a.permissions.emailOverride ?? a.permissions.emailNotifications);
  useEffect(() => { if (sources.length === 1) setSource(sources[0]!); }, [a.withdrawalSources]); // eslint-disable-line react-hooks/exhaustive-deps
  // A single method is chosen for the applicant; the choice resets if the admin disables it meanwhile.
  useEffect(() => {
    if (!methods.data) return;
    if (methods.data.length === 1 && !methodId) setMethodId(methods.data[0]!.id);
    if (methodId && !methods.data.some((x) => x.id === methodId)) setMethodId('');
  }, [methods.data, methodId]);
  const choose = (id: string) => { setMethodId(id); setAmt(''); setValues({}); setFieldErrors({}); setProof(null); setProofErr(''); setErr(''); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!method) return setErr(`Choose a ${kind.toLowerCase()} method.`);
    if (!isDeposit && !source) return setErr('Choose which balance to withdraw from.');
    const n = Number(amt);
    if (!amt || !(n >= 0.01)) return setErr(method.amountMode === 'fixed' ? 'Choose an amount.' : 'Enter an amount of at least $0.01.');
    if (Math.round(n * 100) !== Math.round(n * 100 * 1000) / 1000) return setErr('Use at most two decimal places.');
    if (method.amountMode === 'range') {
      if (method.minAmount !== null && n < method.minAmount) return setErr(`The minimum for ${method.name} is ${money(method.minAmount)}.`);
      if (method.maxAmount !== null && n > method.maxAmount) return setErr(`The maximum for ${method.name} is ${money(method.maxAmount)}.`);
    }
    const fee = feeOn(method.fee, n);
    if (isDeposit && fee > 0 && fee >= n) return setErr(`The ${money(fee)} fee is more than this deposit. Deposit a larger amount.`);
    if (!isDeposit && source === 'deposit' && fee > 0 && n + fee > a.availableToWithdraw.deposit) return setErr(`This withdrawal and its ${money(fee)} fee come to ${money(n + fee)}, more than the ${money(a.availableToWithdraw.deposit)} available in your deposit balance.`);
    if (!isDeposit && source === 'grant' && fee > a.availableToWithdraw.deposit) return setErr(`The ${money(fee)} fee is paid from your deposit balance, which has ${money(a.availableToWithdraw.deposit)} available. Add funds first.`);
    if (!isDeposit && available !== null && n > available) return setErr(`You can withdraw up to ${money(available)} from your ${sourceName[source as Source].toLowerCase()}.`);
    if (!isDeposit && lim.maxPerRequest !== null && n > lim.maxPerRequest) return setErr(`You can withdraw up to ${money(lim.maxPerRequest)} per request.`);
    if (!isDeposit && leftToday !== null && n > leftToday) return setErr(leftToday <= 0 ? `You've reached your ${money(lim.dailyTotal!)} daily withdrawal limit.` : `You have ${money(leftToday)} left of your ${money(lim.dailyTotal!)} daily withdrawal limit.`);
    const fe = checkFieldValues(method.fields, values);
    setFieldErrors(fe);
    if (method.proofMode === 'required' && !proof) setProofErr('Attach your payment proof.');
    if (Object.keys(fe).length || (method.proofMode === 'required' && !proof)) return setErr('Check the highlighted details.');
    setErr(''); setProofErr('');
    m.mutate({ data: {
      kind, methodId: method.id, amount: n.toFixed(2), values: JSON.stringify(values), ...(note.trim() ? { note: note.trim() } : {}),
      ...(!isDeposit && source ? { source } : {}), ...(proof ? { file: proof } : {}),
    } }, {
      onSuccess: (r) => {
        refresh();
        setAmt(''); setNote(''); setValues({}); setProof(null);
        setPlaced(r as Tx);
        toast({ title: `${kind} request placed`, description: `Reference ${r.reference}. We've sent you a notification${emailed ? ' and an email' : ''}.` });
      },
      onError: (e2) => setErr(apiError(e2, 'The request could not be submitted. Please try again.')),
    });
  };

  const noMethods = methods.data?.length === 0;
  return (
    <div className="space-y-5">
      <FrozenNotice a={a} />
      {placed && <RequestPlaced t={placed} emailed={emailed} onClose={() => setPlaced(null)} />}
      <div className="grid gap-5 lg:grid-cols-5">
        <form noValidate onSubmit={submit} className={cx(card, 'min-w-0 space-y-4 p-5 lg:col-span-2 lg:self-start')} data-testid="form-money">
          {isDeposit || sources.length === 1 ? (
            <div className="rounded-xl bg-[#EEF4FB] p-4">
              <p className="text-sm text-slate-600">{isDeposit ? 'Deposit balance' : `Available to withdraw · ${sourceName[sources[0]!].toLowerCase()}`}</p>
              <p className="text-2xl font-bold tabular-nums text-slate-900" data-testid="text-source-balance">{money(isDeposit ? a.balances.deposit : a.availableToWithdraw[sources[0]!])}</p>
              {!isDeposit && a.availableToWithdraw[sources[0]!] < a.balances[sources[0]!] && (
                <p className="mt-1 text-xs text-slate-500">{sourceName[sources[0]!]} {money(a.balances[sources[0]!])}, minus pending withdrawals.</p>
              )}
            </div>
          ) : (
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Withdraw from</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Withdraw from">
                {sources.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={source === s} disabled={paused} data-testid={`button-source-${s}`} onClick={() => { setSource(s); setErr(''); }}
                    className={cx('press min-h-11 rounded-xl border p-3 text-left', source === s ? 'border-[#1E3A8A] bg-[#EEF4FB] ring-2 ring-[#1E3A8A]/20' : 'border-slate-300 bg-white hover:border-[#1E3A8A]')}>
                    <span className="block text-sm text-slate-600">{sourceName[s]}</span>
                    <span className="block text-lg font-bold tabular-nums text-slate-900" data-testid={`text-available-${s}`}>{money(a.availableToWithdraw[s])}</span>
                    <span className="block text-xs text-slate-500">available</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {!isDeposit && (lim.maxPerRequest !== null || lim.dailyTotal !== null) && (
            <p className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600" data-testid="text-withdrawal-limits">
              <span className="font-semibold text-slate-900">Your limits: </span>
              {[lim.maxPerRequest !== null && `up to ${money(lim.maxPerRequest)} per request`,
                lim.dailyTotal !== null && `${money(lim.dailyTotal)} per 24 hours (${money(leftToday!)} left)`].filter(Boolean).join(' · ')}
            </p>
          )}

          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{isDeposit ? 'How will you pay?' : 'How do you want to be paid?'}</legend>
            {methods.isLoading ? <div className="space-y-2"><Skel className="h-16" /><Skel className="h-16" /></div>
              : methods.isError ? <ErrorState onRetry={() => methods.refetch()} />
              : noMethods ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600" data-testid="text-no-methods">No {kind.toLowerCase()} methods are available yet. Contact support.</p>
              : (
                <div className="grid gap-2" role="radiogroup" aria-label={`${kind} method`} data-testid="list-methods">
                  {methods.data!.map((x) => (
                    <button key={x.id} type="button" role="radio" aria-checked={methodId === x.id} disabled={paused} onClick={() => choose(x.id)} data-testid={`button-method-${x.id}`}
                      className={cx('press flex min-h-11 items-center gap-3 rounded-xl border p-3 text-left', methodId === x.id ? 'border-[#1E3A8A] bg-[#EEF4FB] ring-2 ring-[#1E3A8A]/20' : 'border-slate-300 bg-white hover:border-[#1E3A8A]')}>
                      <MethodLogo url={x.logoUrl} name={x.name} />
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-900">{x.name}</span><span className="block text-xs tabular-nums text-slate-500">{x.amountRule}{x.feeText !== 'No fee' ? ` · ${x.feeText}` : ''}</span></span>
                      {methodId === x.id && <CircleCheck className="h-5 w-5 shrink-0 text-[#1E3A8A]" aria-hidden />}
                    </button>
                  ))}
                </div>
              )}
          </fieldset>

          {method && (
            <div className="space-y-4" data-testid="panel-method-form">
              <MethodInstructions text={method.instructions} />
              {method.amountMode === 'fixed' ? (
                <div>
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</span>
                  <FixedAmountChoices amounts={method.fixedAmounts} value={amt} disabled={paused} onChange={(v) => { setAmt(v); setErr(''); }} activeClass="border-[#1E3A8A] bg-[#1E3A8A] text-white" />
                </div>
              ) : (
                <Field label={`Amount (USD)${method.amountRule !== 'Any amount' ? ` · ${method.amountRule}` : ''}`}>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
                    <input data-testid="input-money-amount" type="number" inputMode="decimal" min={method.minAmount ?? 0.01} max={method.maxAmount ?? undefined} step="0.01" value={amt} disabled={paused}
                      onChange={(e) => { setAmt(e.target.value); setErr(''); }} placeholder="0.00" className={cx(inputCls, 'min-h-11 pl-7 tabular-nums')} />
                  </div>
                </Field>
              )}
              <FeeSummary isDeposit={isDeposit} feeText={method.feeText} fee={method.fee.amount > 0 && Number(amt) > 0 ? feeOn(method.fee, Number(amt)) : null} amount={Number(amt) || 0} />
              <MethodFieldInputs fields={method.fields} values={values} errors={fieldErrors} disabled={paused} inputClass={inputCls} idPrefix="method"
                onChange={(v) => { setValues(v); setFieldErrors({}); }} />
              {isDeposit && <ProofInput mode={method.proofMode} file={proof} disabled={paused} error={proofErr} onChange={(f) => {
                if (f) { const bad = checkFile(f, 'identity'); if (bad) { setProofErr(bad); return; } }
                setProofErr(''); setProof(f);
              }} />}
              <Field label="Note (optional)"><input data-testid="input-money-note" maxLength={240} value={note} disabled={paused} onChange={(e) => setNote(e.target.value)} placeholder={isDeposit ? 'e.g. Paid from operating account' : 'e.g. Equipment purchase'} className={cx(inputCls, 'min-h-11')} /></Field>
            </div>
          )}
          {err && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-money-error">{err}</p>}
          <button data-testid="button-submit-money" type="submit" disabled={paused || m.isPending || !method} className="press min-h-11 w-full rounded-full bg-[#1E3A8A] py-2.5 text-[15px] font-semibold text-white hover:bg-[#0F172A] disabled:opacity-60">
            {m.isPending ? 'Submitting…' : isDeposit ? 'Request deposit' : 'Request withdrawal'}
          </button>
          {/* What happens after "Request" (finding U8). No payment processor is connected, so no timings are promised. */}
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600" data-testid="text-money-steps">
            <p className="mb-2 font-semibold text-slate-900">What happens next</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>You get a reference number{isDeposit ? '' : ', and the amount is held from the balance you chose'}.</li>
              <li>A finance administrator {isDeposit ? 'checks your payment and ' : ''}approves or declines it. You're told in the app{emailed ? ' and by email' : ''}, with the reason if it's declined.</li>
              <li>{isDeposit ? 'Once approved, the amount is added to your deposit balance.' : 'Once approved, the amount leaves that balance. A declined request releases the hold.'}</li>
            </ol>
          </div>
        </form>
        <section className={cx(card, 'min-w-0 p-4 sm:p-5 lg:col-span-3')} aria-labelledby="requests-heading">
          <h2 id="requests-heading" className="mb-4 text-lg font-semibold text-slate-900">Your {kind.toLowerCase()} requests</h2>
          {mine.length === 0
            ? <Empty title={`No ${kind.toLowerCase()} requests yet`} hint="Choose a method, fill in the form, and your request appears here." />
            : <ul className="space-y-3" data-testid="list-requests">{mine.map((t) => <TxRow key={t.id} t={t} showDetails />)}</ul>}
        </section>
      </div>
    </div>
  );
}
/** The method's fee as the applicant types an amount (9.3): withdrawals pay it from the deposit balance, deposits lose it from the amount. */
function FeeSummary({ isDeposit, feeText, fee, amount }: { isDeposit: boolean; feeText: string; fee: number | null; amount: number }) {
  if (feeText === 'No fee') return null;
  return (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="text-method-fee" aria-live="polite">
      {fee === null
        ? <>{feeText}{isDeposit ? ', taken out of the amount you deposit.' : ', paid from your deposit balance.'}</>
        : isDeposit
          ? <>Fee <span className="font-semibold tabular-nums">{money(fee)}</span> · you'll receive <span className="font-semibold tabular-nums" data-testid="text-fee-net">{money(Math.max(0, Math.round((amount - fee) * 100) / 100))}</span></>
          : <>Fee <span className="font-semibold tabular-nums">{money(fee)}</span>, paid from your deposit balance · total <span className="font-semibold tabular-nums" data-testid="text-fee-net">{money(Math.round((amount + fee) * 100) / 100)}</span></>}
    </p>
  );
}

/** Shown after a request is placed: its reference and what happens next. */
function RequestPlaced({ t, emailed, onClose }: { t: Tx; emailed: boolean; onClose: () => void }) {
  const withdrawal = t.type === 'Withdrawal';
  const steps = [
    { title: 'Request placed', text: `${money(t.amount)}, reference ${t.reference}. ${withdrawal ? 'The amount is held from your available balance.' : ''}` },
    { title: 'Finance team review', text: 'An administrator checks the request. It shows as Under review until then.' },
    { title: withdrawal ? 'Funds released' : 'Funds added', text: withdrawal ? 'Once approved, your funds are released. If it’s declined, the held amount is available again and you’ll see why.' : 'Once approved, the amount is added to your deposit balance.' },
  ];
  return (
    <section role="status" aria-labelledby="placed-heading" data-testid="panel-request-placed" className={cx(card, 'border-[#BBF7D0] bg-[#F0FDF4] p-5')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <CircleCheck className="mt-0.5 h-6 w-6 shrink-0 text-[#166534]" />
          <div>
            <h2 id="placed-heading" className="text-lg font-semibold text-slate-900">{withdrawal ? 'Withdrawal' : 'Deposit'} request placed</h2>
            <p className="text-sm text-slate-600">We’ve sent you a notification{emailed ? ' and an email' : ''} with the details. We’ll let you know as soon as it has been reviewed.</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" data-testid="button-close-placed" className="press -m-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-white"><CircleX className="h-5 w-5" /></button>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-xl bg-white p-3.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className={cx('grid h-6 w-6 place-items-center rounded-full text-xs', i === 0 ? 'bg-[#166534] text-white' : 'bg-slate-100 text-slate-600')}>{i === 0 ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>{s.title}
            </p>
            <p className="mt-1 text-sm text-slate-600">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
export const WithdrawalsPage = () => <MoneyPage kind="Withdrawal" />;
export const DepositsPage = () => <MoneyPage kind="Deposit" />;

/* ---------- Settings ---------- */
const profSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(100),
  phone: z.string().trim().max(40, 'At most 40 characters').regex(/^[+\d\s().-]*$/, 'Use digits, spaces and + ( ) - only'),
  telegram: z.string().trim().max(80).regex(/^(@[A-Za-z0-9_]{3,})?$/, 'Start with @ and use letters, numbers or _'),
});
export function SettingsPage() {
  return <Gate title="Settings">{(d) => <SettingsBody d={d} />}</Gate>;
}
function SettingsBody({ d }: { d: ApplicantDashboard }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useUpdateApplicantProfile();
  const acct = useApplicantAccount();
  const values = { name: d.profile.name, phone: d.profile.phone, telegram: d.profile.telegram };
  const f = useForm<z.infer<typeof profSchema>>({ resolver: zodResolver(profSchema), defaultValues: values });
  useEffect(() => { f.reset({ name: d.profile.name, phone: d.profile.phone, telegram: d.profile.telegram }); }, [d.profile.name, d.profile.phone, d.profile.telegram, f]);
  const a = acct.data;
  const signedIn = useAuth().status === 'signed-in';
  return (
    <div className="space-y-5">
      <ProfileHeader d={d} />
      <div className="grid gap-5 lg:grid-cols-5">
        <form data-testid="form-profile" noValidate className={cx(card, 'space-y-4 p-5 lg:col-span-3')} onSubmit={f.handleSubmit((v) => m.mutate({ data: v }, {
          onSuccess: () => { qc.invalidateQueries({ queryKey: getGetApplicantDashboardQueryKey() }); f.reset(v); toast({ title: 'Profile updated' }); },
          onError: () => toast({ title: 'Update failed', description: 'Please try again.', variant: 'destructive' }),
        }))}>
          <h2 className="text-lg font-semibold text-slate-900">Personal information</h2>
          <Field label="Full name" error={f.formState.errors.name?.message}><input data-testid="input-name" autoComplete="name" className={inputCls} {...f.register('name')} /></Field>
          <Field label="Email">
            <div className="relative"><input data-testid="input-email" disabled readOnly value={d.profile.email} className={cx(inputCls, 'pr-9')} /><Lock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /></div>
          </Field>
          <Field label="Organization">
            <div className="relative"><input data-testid="input-organization" disabled readOnly value={d.profile.organization} className={cx(inputCls, 'pr-9')} /><Lock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /></div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" error={f.formState.errors.phone?.message}><input data-testid="input-phone" type="tel" autoComplete="tel" className={inputCls} {...f.register('phone')} /></Field>
            <Field label="Telegram" error={f.formState.errors.telegram?.message}><input data-testid="input-telegram" placeholder="@username" className={inputCls} {...f.register('telegram')} /></Field>
          </div>
          <p className="text-xs text-slate-500">Email and organization are locked. Contact support to change them.</p>
          <div className="flex items-center gap-3">
            <button data-testid="button-save-profile" type="submit" disabled={m.isPending || !f.formState.isDirty} className="press inline-flex items-center gap-2 rounded-full bg-[#1E3A8A] px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0F172A] disabled:opacity-50">{m.isPending ? 'Saving…' : 'Save changes'}</button>
            {f.formState.isDirty && !m.isPending && <button type="button" onClick={() => f.reset(values)} className="text-sm font-semibold text-slate-600 hover:text-slate-900">Cancel</button>}
          </div>
        </form>
        <section className={cx(card, 'p-5 lg:col-span-2 lg:self-start')} aria-labelledby="account-heading" data-testid="section-account">
          <h2 id="account-heading" className="mb-3 text-lg font-semibold text-slate-900">Account</h2>
          {acct.isLoading ? <div className="space-y-2"><Skel className="h-10" /><Skel className="h-10" /><Skel className="h-10" /></div>
            : acct.isError || !a ? <ErrorState onRetry={() => acct.refetch()} />
            : (
              <dl className="divide-y divide-slate-100 text-sm">
                <div className="flex items-center justify-between gap-3 py-3"><dt className="text-slate-600">Identity verification</dt><dd><StatusBadge status={a.verificationLevel} dot={false} testid="badge-verification" /></dd></div>
                <div className="flex items-center justify-between gap-3 py-3"><dt className="text-slate-600">Account status</dt><dd><StatusBadge status={a.status} dot={false} testid="badge-account-status" /></dd></div>
                <div className="flex items-center justify-between gap-3 py-3"><dt className="text-slate-600">Account tier</dt><dd className="font-semibold text-slate-900" data-testid="text-tier">Tier {a.tier}</dd></div>
                <div className="flex items-center justify-between gap-3 py-3"><dt className="text-slate-600" id="label-email-notifications">Email notifications</dt><dd><EmailNotificationsSwitch on={a.permissions.emailOverride ?? a.permissions.emailNotifications} locked={typeof a.permissions.emailOverride === 'boolean'} /></dd></div>
                <div className="flex items-center justify-between gap-3 py-3"><dt className="text-slate-600">Verification needed to withdraw</dt><dd className="font-semibold text-slate-900">{a.permissions.withdrawalKycRequired ? 'Yes' : 'No'}</dd></div>
                <p className="pt-3 text-xs text-slate-500">{signedIn ? 'Email notifications are yours to change; the other settings are managed by your administrator.' : 'These settings are managed by your administrator.'}</p>
              </dl>
            )}
        </section>
      </div>
      <AccountSecurity tone="user" />
      <IdentitySection />
    </div>
  );
}

/** The applicant's own email-notification preference. Read-only in demo mode, and while an administrator overrides it. */
function EmailNotificationsSwitch({ on, locked }: { on: boolean; locked: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const signedIn = useAuth().status === 'signed-in';
  const m = useUpdateApplicantPreferences();
  if (locked) return (
    <span className="flex flex-col items-end text-right" data-testid="text-email-notifications">
      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900"><Lock className="h-3.5 w-3.5 text-slate-500" />{on ? 'On' : 'Off'}</span>
      <span className="text-xs text-slate-500">Set by your administrator</span>
    </span>
  );
  if (!signedIn) return <span className="font-semibold text-slate-900" data-testid="text-email-notifications">{on ? 'On' : 'Off'}</span>;
  const toggle = () => m.mutate({ data: { emailNotifications: !on } }, {
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: getGetApplicantAccountQueryKey() });
      toast({ title: r.emailNotifications ? 'Email notifications on' : 'Email notifications off', description: r.emailNotifications ? "We'll email you about updates to your applications and requests." : 'You will still see updates under the bell.' });
    },
    onError: (e) => toast({ title: "Couldn't save", description: apiError(e, 'Please try again.'), variant: 'destructive' }),
  });
  return (
    // A 44px tap area around the 28px switch, so it's easy to hit on a phone.
    <button type="button" role="switch" aria-checked={on} aria-labelledby="label-email-notifications" data-testid="switch-email-notifications" disabled={m.isPending} onClick={toggle}
      className="group relative -my-2 inline-flex h-11 w-14 shrink-0 items-center justify-end disabled:opacity-60">
      {m.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin text-slate-400" aria-label="Saving" />}
      <span className={cx('relative inline-flex h-7 w-12 items-center rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-[#1E3A8A]/40', on ? 'bg-[#1E3A8A]' : 'bg-slate-300')}>
        <span className={cx('absolute h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-6' : 'left-1')} />
      </span>
    </button>
  );
}

function ProfileHeader({ d }: { d: ApplicantDashboard }) {
  const { toast } = useToast();
  const refresh = useRefreshApplicant();
  const upload = useUploadApplicantAvatar();
  const remove = useDeleteApplicantAvatar();
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const busy = upload.isPending || remove.isPending;
  const pick = (file: File | undefined) => {
    if (!file) return;
    const problem = checkFile(file, 'image');
    setErr(problem);
    if (problem) return;
    upload.mutate({ data: { file } }, {
      onSuccess: () => { refresh(); toast({ title: 'Profile photo updated' }); },
      onError: (e) => setErr(apiError(e, 'The photo could not be uploaded. Please try again.')),
    });
  };
  return (
    <section className={cx(card, 'p-5')} data-testid="section-profile-header">
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative">
          <Avatar name={d.profile.name} url={d.profile.avatarUrl} className="h-16 w-16 text-2xl" testid="avatar-settings" />
          {busy && <span className="absolute inset-0 grid place-items-center rounded-full bg-black/40"><Loader2 className="h-6 w-6 animate-spin text-white" /></span>}
          <button aria-label={d.profile.avatarUrl ? 'Change profile photo' : 'Add profile photo'} data-testid="button-avatar-upload" disabled={busy} onClick={() => input.current?.click()}
            className="press absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-white text-[#1E3A8A] shadow ring-1 ring-slate-200 hover:bg-[#EEF4FB] disabled:opacity-60"><Camera className="h-4 w-4" /></button>
          <input ref={input} type="file" accept={FILE_RULES.image.accept} hidden data-testid="input-avatar-file" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xl font-semibold text-slate-900"><span className="truncate">{d.profile.name}</span>{d.profile.verified && <BadgeCheck aria-label="Verified" className="h-5 w-5 shrink-0 fill-[#16A34A] text-white" />}</p>
          <p className="truncate text-sm text-slate-600">{d.profile.organization} · {d.profile.email}</p>
          {d.profile.avatarUrl && (
            <button data-testid="button-avatar-remove" disabled={busy} onClick={() => remove.mutate(undefined, {
              onSuccess: () => { refresh(); toast({ title: 'Profile photo removed' }); },
              onError: (e) => setErr(apiError(e, 'The photo could not be removed.')),
            })} className="mt-1 text-sm font-semibold text-slate-600 hover:text-[#991B1B] disabled:opacity-60">Remove photo</button>
          )}
        </div>
      </div>
      {err && <p role="alert" className="mt-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-avatar-error">{err}</p>}
    </section>
  );
}

const KYC_KINDS: { kind: KycDocumentKind; hint: string; icon: LucideIcon }[] = [
  { kind: 'Government ID', hint: 'Passport, driver’s licence or national ID card', icon: IdCard },
  { kind: 'Proof of address', hint: 'Utility bill or bank statement from the last 3 months', icon: HouseIcon },
];
const kycIntro: Record<ApplicantKyc['verificationLevel'], string> = {
  Unsubmitted: 'Upload both documents to verify your identity. Verification is needed before you can withdraw funds.',
  Pending: 'Your documents are waiting for an administrator to review them. We’ll notify you when that’s done.',
  Verified: 'You’re verified. If a document changes (for example, you move), upload the new one. You stay verified while it’s reviewed.',
  Rejected: 'A document wasn’t accepted. Upload a clear, complete copy to try again.',
};

function IdentitySection() {
  const q = useGetApplicantKyc({ query: { queryKey: getGetApplicantKycQueryKey() } });
  const ref = useRef<HTMLElement>(null);
  const ready = !!q.data;
  useEffect(() => { if (ready && window.location.hash === '#verification') ref.current?.scrollIntoView({ block: 'start' }); }, [ready]);
  return (
    <section ref={ref} id="verification" className={cx(card, 'scroll-mt-20 p-5')} aria-labelledby="kyc-heading" data-testid="section-verification">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id="kyc-heading" className="text-lg font-semibold text-slate-900">Identity verification</h2>
        {q.data && <StatusBadge status={q.data.verificationLevel} dot={false} testid="badge-kyc-level" />}
      </div>
      {q.isLoading ? <div className="space-y-2 pt-2"><Skel className="h-16" /><Skel className="h-16" /></div>
        : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
        : (
          <>
            <p className="mb-4 text-sm text-slate-600" data-testid="text-kyc-intro">{kycIntro[q.data.verificationLevel]}</p>
            <ul className="space-y-3">
              {KYC_KINDS.map((k) => <KycRow key={k.kind} {...k} doc={q.data.documents.find((d) => d.kind === k.kind)} />)}
            </ul>
            <p className="mt-4 text-xs text-slate-500">Images (JPG, PNG, WebP) or PDF, up to 10 MB. Images are re-saved without location data. <strong className="font-semibold">Demo workspace: upload a sample or redacted document, not a real ID.</strong></p>
          </>
        )}
    </section>
  );
}

function KycRow({ kind, hint, icon: Icon, doc }: { kind: KycDocumentKind; hint: string; icon: LucideIcon; doc?: ApplicantKyc['documents'][number] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = useRefreshApplicant();
  const upload = useUploadApplicantKycDocument();
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const slug = kind === 'Government ID' ? 'id' : 'address';
  const pick = (file: File | undefined) => {
    if (!file) return;
    const problem = checkFile(file, 'identity');
    setErr(problem);
    if (problem) return;
    upload.mutate({ data: { kind, file } }, {
      onSuccess: (d) => { qc.setQueryData(getGetApplicantKycQueryKey(), d); refresh(); toast({ title: `${kind} uploaded`, description: 'Queued for review.' }); },
      onError: (e) => setErr(apiError(e, 'The document could not be uploaded. Please try again.')),
    });
  };
  return (
    <li className="rounded-xl border border-slate-200 p-3 sm:p-4" data-testid={`row-kyc-${slug}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EEF4FB] text-[#1E3A8A]"><Icon className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-slate-900">{kind}</span>
          <span className="block truncate text-sm text-slate-500" data-testid={`text-kyc-${slug}-file`}>
            {!doc ? hint : doc.sample ? `Sample document on file · ${dateFmt(doc.submittedAt)}` : `${doc.name} · ${dateFmt(doc.submittedAt)}`}
          </span>
        </span>
        <StatusBadge status={doc?.status ?? 'Unsubmitted'} dot={false} testid={`badge-kyc-${slug}`} />
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {doc?.url && <a href={doc.url} target="_blank" rel="noopener" data-testid={`link-kyc-${slug}`} className="rounded-full px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">View</a>}
          <button data-testid={`button-kyc-${slug}`} disabled={upload.isPending} onClick={() => input.current?.click()}
            className="press ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#1E3A8A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F172A] disabled:opacity-60 sm:ml-0">
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{upload.isPending ? 'Uploading…' : doc ? 'Replace' : 'Upload'}
          </button>
          <input ref={input} type="file" accept={FILE_RULES.identity.accept} hidden data-testid={`input-kyc-${slug}`} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </div>
      {doc?.status === 'Rejected' && doc.reviewNote && (
        <p className="mt-2 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid={`text-kyc-${slug}-review`}>Not accepted: {doc.reviewNote} Upload a new copy to try again.</p>
      )}
      {err && <p role="alert" className="mt-2 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid={`text-kyc-${slug}-error`}>{err}</p>}
    </li>
  );
}
