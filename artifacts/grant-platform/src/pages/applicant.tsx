import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  useUpdateApplicantProfile, useCreateApplicantRequest,
  getGetApplicantDashboardQueryKey, getGetApplicantAccountQueryKey,
  type ApplicantDashboard, type ApplicantAccount,
} from '@workspace/api-client-react';
import {
  Check, ChevronDown, ChevronRight, CircleCheck, CircleX, Clock, FileText, PenLine, Sparkles,
  Search, ArrowDownLeft, ArrowUpRight, Snowflake, Landmark, Wallet,
  CreditCard, BadgeCheck, Lock, type LucideIcon,
} from 'lucide-react';
import { Shell } from '@/components/shell';
import { Empty, ErrorState, Field, PageSkeleton, Skel, StatusBadge, cx, dateFmt, inputCls, money, statusLabel } from '@/components/bits';
import { apiError, matchesSearch, useApplicantAccount, useApplicantDashboard, useDemo } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

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
      <FundingTracker d={d} />
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

function FundingTracker({ d }: { d: ApplicantDashboard }) {
  const pct = d.totalBudget > 0 ? Math.min(100, Math.max(0, (d.allocatedFunds / d.totalBudget) * 100)) : 0;
  return (
    <section className={cx(card, 'p-5 lg:p-6')} data-testid="card-funding-tracker" aria-labelledby="tracker-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="tracker-heading" className="text-lg font-semibold text-slate-900 lg:text-xl">Grant Funding Tracker</h2>
          <Legend className="mt-1 hidden md:flex" />
        </div>
        <dl className="hidden gap-8 md:flex">
          <div><dt className="text-sm text-slate-500">Total Grant Budget</dt><dd className="text-2xl font-bold tabular-nums text-slate-900" data-testid="text-total-budget">{money(d.totalBudget)}</dd></div>
          <div className="border-l border-slate-200 pl-8"><dt className="text-sm text-slate-500">Funds Allocated</dt><dd className="text-2xl font-bold tabular-nums text-slate-900" data-testid="text-allocated">{money(d.allocatedFunds)}</dd></div>
        </dl>
      </div>

      {/* Mobile summary: two figures side by side and a progress bar, as in the design */}
      <div className="md:hidden">
        <div className="mt-4 grid grid-cols-2 divide-x divide-slate-200">
          <div className="pr-3">
            <p className="text-[22px] font-bold tabular-nums text-slate-900" data-testid="text-total-budget-mobile">{money(d.totalBudget)}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600"><i className="h-2 w-2 shrink-0 rounded-full" style={{ background: GREY }} />Total Grant Budget</p>
          </div>
          <div className="pl-4">
            <p className="text-[22px] font-bold tabular-nums text-slate-900" data-testid="text-allocated-mobile">{money(d.allocatedFunds)}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600"><i className="h-2 w-2 shrink-0 rounded-full" style={{ background: NAVY }} />Funds Allocated</p>
          </div>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full" style={{ background: GREY }} role="progressbar" aria-label="Budget allocated" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: NAVY }} />
        </div>
      </div>

      <div className="mt-5 hidden h-64 md:block" data-testid="chart-funding">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={d.fundingTrend} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} tick={{ fill: '#475569' }} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={68} tick={{ fill: '#475569' }} tickFormatter={usd0}
              domain={[0, (max: number) => Math.max(10000, Math.ceil(max / 10000) * 10000)]} />
            <Tooltip cursor={{ fill: '#EEF4FB' }} formatter={(v: number) => money(v)} contentStyle={{ borderRadius: 12, borderColor: '#E5E7EB', fontSize: 13 }} />
            <Bar dataKey="submitted" name="Submitted" stackId="a" fill={NAVY} />
            <Bar dataKey="review" name="Review" stackId="a" fill={GREY} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const setupIcon: Record<string, LucideIcon> = { matchmaking: Sparkles, proposal: FileText };

function SetupCards({ d }: { d: ApplicantDashboard }) {
  const { doneSetup, openNewApp } = useDemo();
  const [, nav] = useLocation();
  // Matchmaking completes once a grant is saved; the proposal step completes once an application is submitted.
  const act = (id: string) => (id === 'proposal' ? openNewApp() : nav('/grants'));
  if (d.setupCards.length === 0) return null;
  return (
    <section aria-labelledby="setup-heading">
      <h2 id="setup-heading" className="sr-only">Setup and recommendations</h2>
      <div className="noscroll -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0" data-testid="list-setup-cards">
        {d.setupCards.map((c) => {
          const done = c.complete || doneSetup.includes(c.id);
          const Icon = setupIcon[c.id] ?? Sparkles;
          return (
            <div key={c.id} data-testid={`card-setup-${c.id}`} className="flex min-w-[85%] snap-start flex-col rounded-2xl border border-[#DBEAFE] bg-[#EEF4FB] p-5 sm:min-w-[60%] md:min-w-0">
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-[#1E3A8A] shadow-sm"><Icon className="h-5 w-5" /></span>
                <StatusBadge status="Recommended" dot={false} />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{c.title}</h3>
              <p className="mt-1.5 flex-1 text-[15px] leading-relaxed text-slate-600">{c.description}</p>
              {done ? (
                <span data-testid={`status-setup-${c.id}`} className="mt-4 inline-flex items-center gap-1.5 self-start rounded-full bg-[#DCFCE7] px-4 py-2 text-sm font-semibold text-[#166534]"><Check className="h-4 w-4" />Complete</span>
              ) : (
                <button data-testid={`button-setup-${c.id}`} onClick={() => act(c.id)} className="press mt-4 self-start rounded-full bg-[#1E3A8A] px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0F172A]">{c.actionLabel || 'Complete Setup'}</button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const statusIcon: Record<string, LucideIcon> = { Submitted: FileText, Review: Clock, Approved: CircleCheck, 'Changes requested': PenLine, Declined: CircleX };
const revenueRanges = [
  { k: 'all', label: 'All Revenue', test: () => true },
  { k: 'lt10', label: 'Under $10,000', test: (n: number) => n < 10000 },
  { k: '10to25', label: '$10,000 – $24,999', test: (n: number) => n >= 10000 && n < 25000 },
  { k: 'gte25', label: '$25,000 and above', test: (n: number) => n >= 25000 },
] as const;

function Highlights({ d }: { d: ApplicantDashboard }) {
  const { apps, search } = useDemo();
  const [range, setRange] = useState<(typeof revenueRanges)[number]['k']>('all');
  const test = revenueRanges.find((r) => r.k === range)!.test;
  const list = [...apps, ...d.highlights].filter((a) => test(a.amount) && matchesSearch(a, search));
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
                <Link href="/applications" data-testid={`row-application-${a.id}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-slate-300 hover:bg-slate-50 sm:px-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EEF4FB] text-[#1E3A8A]"><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-900" data-testid={`text-app-title-${a.id}`}>{a.title}</span>
                    <span className="block text-sm text-slate-500">{statusLabel(a.status)}</span>
                  </span>
                  <StatusBadge status={a.status} dot={false} testid={`badge-app-status-${a.id}`} />
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

function AppList({ list }: { list: ApplicantDashboard['highlights'] }) {
  if (list.length === 0) return <Empty title="No applications match" hint="Clear the search, or start a new application." />;
  return (
    <ul className="divide-y divide-slate-100" data-testid="list-applications">
      {list.map((a) => (
        <li key={a.id} data-testid={`row-application-${a.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3 sm:px-2">
          <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
            <p className="truncate font-semibold text-slate-900" data-testid={`text-app-title-${a.id}`}>{a.title}</p>
            <p className="text-xs text-slate-500">{a.category} · Submitted {dateFmt(a.submittedAt)}</p>
          </div>
          <span className="text-sm font-semibold tabular-nums" data-testid={`text-app-amount-${a.id}`}>{money(a.amount)}</span>
          <StatusBadge status={a.status} dot={false} testid={`badge-app-status-${a.id}`} />
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
  const { openNewApp, notify, savedGrants, toggleSavedGrant } = useDemo();
  const { toast } = useToast();
  const saved = savedGrants.includes(g.id);
  return (
    <div data-testid={`card-grant-${g.id}`} className={cx(card, 'lift flex flex-col p-5')}>
      <div className="mb-3 flex items-start justify-between gap-2"><span className="rounded-full bg-[#EEF4FB] px-2.5 py-0.5 text-xs font-semibold text-[#1E3A8A]">{g.category}</span>{g.recommended && <StatusBadge status="Recommended" dot={false} />}</div>
      <h3 className="text-lg font-semibold text-slate-900">{g.title}</h3>
      <p className="mt-1 text-xl font-bold tabular-nums text-[#1E3A8A]">{money(g.amount)}</p>
      <p className="mt-1 text-xs text-slate-500">Deadline {dateFmt(g.deadline)}</p>
      <div className="mt-auto flex gap-2 pt-4">
        <button data-testid={`button-apply-${g.id}`} onClick={() => openNewApp({ title: g.title, category: g.category, amount: g.amount })} className="press rounded-full bg-[#1E3A8A] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0F172A]">Apply</button>
        <button data-testid={`button-save-${g.id}`} aria-pressed={saved} onClick={() => {
          const nowSaved = toggleSavedGrant(g.id);
          notify(nowSaved ? `Saved "${g.title}"` : `Removed "${g.title}" from saved`);
          toast({ title: nowSaved ? 'Saved to your shortlist' : 'Removed from your shortlist' });
        }} className={cx('press rounded-full border px-4 py-1.5 text-sm font-semibold', saved ? 'border-[#1E3A8A] bg-[#EEF4FB] text-[#1E3A8A]' : 'border-slate-300 hover:border-[#1E3A8A]')}>{saved ? 'Saved' : 'Save'}</button>
      </div>
    </div>
  );
}

function GrantsBody({ d }: { d: ApplicantDashboard }) {
  const cats = useMemo(() => Array.from(new Set(d.recommendations.map((r) => r.category))), [d]);
  const [cat, setCat] = useState('All');
  const list = d.recommendations.filter((r) => cat === 'All' || r.category === cat);
  return (
    <div className="space-y-4">
      <div className="noscroll flex gap-2 overflow-x-auto">
        {['All', ...cats].map((c) => <button key={c} data-testid={`filter-category-${c.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} onClick={() => setCat(c)} className={cx('press whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold', cat === c ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white' : 'border-slate-300 bg-white text-slate-600')}>{c}</button>)}
      </div>
      {list.length === 0 ? <Empty title="No grants in this category" /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((g) => <GrantCard key={g.id} g={g} />)}
        </div>
      )}
    </div>
  );
}

/* ---------- Applications ---------- */
export function ApplicationsPage() {
  return <Gate title="My Applications">{(d) => <AppsBody d={d} />}</Gate>;
}
function AppsBody({ d }: { d: ApplicantDashboard }) {
  const { apps, search, setSearch, openNewApp } = useDemo();
  const list = [...apps, ...d.highlights].filter((a) => matchesSearch(a, search));
  return (
    <div className={cx(card, 'p-4 sm:p-5')}>
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input data-testid="input-search-applications" type="search" aria-label="Search applications" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title or category" className={cx(inputCls, 'pl-9')} />
        </div>
        <button data-testid="button-new-application-page" onClick={() => openNewApp()} className="press rounded-full bg-[#1E3A8A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F172A] sm:ml-auto">New application</button>
      </div>
      <p className="mb-2 text-xs text-slate-500" data-testid="text-application-total">{list.length} shown · {d.applicationCount + apps.length} total</p>
      <AppList list={list} />
    </div>
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
  return <span className="text-xl font-extrabold italic tracking-wide">VISA</span>;
}
function CardsBody({ a }: { a: Account }) {
  const { data: d } = useApplicantDashboard();
  return (
    <div className="space-y-5">
      <FrozenNotice a={a} />
      <Balances a={a} />
      <section aria-labelledby="cards-heading" className="space-y-3">
        <h2 id="cards-heading" className="text-lg font-semibold text-slate-900">Your cards</h2>
        {a.cards.length === 0 ? <Empty title="No cards on this account" /> : (
          <div className="grid gap-4 md:grid-cols-2" data-testid="list-cards">
            {a.cards.map((c) => (
              <div key={c.id} className={cx(card, 'p-4')} data-testid={`card-payment-${c.id}`}>
                <div className={cx('relative flex aspect-[1.586/1] flex-col overflow-hidden rounded-xl p-5 text-white',
                  c.kind === 'Physical' ? 'bg-gradient-to-br from-[#0F172A] to-[#334155]' : 'bg-gradient-to-br from-[#1E3A8A] to-[#3B63C4]')}>
                  <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10" />
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold tracking-tight">GrantApp</span>
                    <span className="text-xs font-semibold uppercase tracking-widest text-white/80">{c.kind}</span>
                  </div>
                  {c.kind === 'Physical' && <span className="mt-4 h-8 w-11 rounded-md bg-gradient-to-br from-amber-200 to-amber-400" aria-hidden="true" />}
                  <p className="mt-auto text-lg tracking-[0.2em] tabular-nums sm:text-xl">•••• •••• •••• {c.lastFour}</p>
                  <div className="mt-3 flex items-end justify-between">
                    <span className="text-sm font-medium uppercase tracking-wide text-white/85">{d?.profile.name ?? ''}</span>
                    <NetworkMark network={c.network} />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-500">{c.kind} {c.network}</p>
                    <p className="text-lg font-bold tabular-nums text-slate-900" data-testid={`text-card-balance-${c.id}`}>{c.status === 'Pending' ? 'Being issued' : money(c.balance)}</p>
                  </div>
                  <StatusBadge status={c.status} dot={false} />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-500">Sample card designs. No real card network is connected.</p>
      </section>
    </div>
  );
}

/* Transactions */
const txTypes = ['All', 'Deposit', 'Withdrawal', 'Top-up'] as const;
const txFilterLabel: Record<(typeof txTypes)[number], string> = { All: 'All', Deposit: 'Deposits', Withdrawal: 'Withdrawals', 'Top-up': 'Top-ups' };
const accountLabel: Record<string, string> = { grant: 'Grant', deposit: 'Deposit', card: 'Card' };

export function TxRow({ t }: { t: Tx }) {
  const incoming = t.direction === 'in';
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  return (
    <li data-testid={`row-transaction-${t.id}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 sm:px-4">
      <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-lg', incoming ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#EEF4FB] text-[#1E3A8A]')}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-slate-900">{t.description}</span>
        <span className="block truncate text-sm text-slate-500">{t.type}<span className="hidden sm:inline"> · {accountLabel[t.account]} account</span> · {dateFmt(t.createdAt)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className={cx('font-semibold tabular-nums', t.status === 'Declined' ? 'text-slate-400 line-through' : incoming ? 'text-[#166534]' : 'text-slate-900')} data-testid={`text-transaction-amount-${t.id}`}>{incoming ? '+' : '−'}{money(t.amount)}</span>
        <StatusBadge status={t.status} dot={false} />
      </span>
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
            <button key={k} aria-pressed={type === k} data-testid={`filter-tx-${k.toLowerCase()}`} onClick={() => setType(k)}
              className={cx('press whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold', type === k ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-[#1E3A8A]')}>{txFilterLabel[k]}</button>
          ))}
        </div>
      </div>
      {list.length === 0
        ? <Empty title={type === 'All' ? 'No transactions yet' : `No ${txFilterLabel[type].toLowerCase()} yet`} hint="Deposits, withdrawals and top-ups appear here." />
        : <ul className="space-y-3" data-testid="list-transactions">{list.map((t) => <TxRow key={t.id} t={t} />)}</ul>}
    </section>
  );
}

/* Withdrawals and Add funds */
function MoneyPage({ kind }: { kind: 'Deposit' | 'Withdrawal' }) {
  return <AccountGate title={kind === 'Deposit' ? 'Add funds' : 'Withdrawals'}>{(a) => <MoneyBody kind={kind} a={a} />}</AccountGate>;
}
const quickAmounts = [100, 500, 1000];
function MoneyBody({ kind, a }: { kind: 'Deposit' | 'Withdrawal'; a: Account }) {
  const qc = useQueryClient();
  const { notify } = useDemo();
  const { toast } = useToast();
  const m = useCreateApplicantRequest();
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const isDeposit = kind === 'Deposit';
  const paused = a.status === 'Frozen' || a.platformFrozen;
  const available = isDeposit ? a.balances.deposit : a.availableToWithdraw;
  const mine = a.transactions.filter((t) => t.type === kind);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amt);
    if (!amt || !(n >= 0.01)) return setErr('Enter an amount of at least $0.01.');
    if (Math.round(n * 100) !== Math.round(n * 100 * 1000) / 1000) return setErr('Use at most two decimal places.');
    if (!isDeposit && n > a.availableToWithdraw) return setErr(`You can withdraw up to ${money(a.availableToWithdraw)}.`);
    setErr('');
    m.mutate({ data: { kind, amount: n, note: note.trim() || undefined } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetApplicantAccountQueryKey() });
        setAmt(''); setNote('');
        notify(`${kind} request for ${money(n)} submitted`);
        toast({ title: `${kind} request submitted`, description: 'It will show as Pending until it is reviewed.' });
      },
      onError: (e2) => setErr(apiError(e2, 'The request could not be submitted. Please try again.')),
    });
  };
  return (
    <div className="space-y-5">
      <FrozenNotice a={a} />
      <div className="grid gap-5 lg:grid-cols-5">
        <form noValidate onSubmit={submit} className={cx(card, 'space-y-4 p-5 lg:col-span-2 lg:self-start')} data-testid="form-money">
          <div className="rounded-xl bg-[#EEF4FB] p-4">
            <p className="text-sm text-slate-600">{isDeposit ? 'Deposit balance' : 'Available to withdraw'}</p>
            <p className="text-2xl font-bold tabular-nums text-slate-900" data-testid="text-source-balance">{money(available)}</p>
            {!isDeposit && a.availableToWithdraw < a.balances.grant && (
              <p className="mt-1 text-xs text-slate-500">Grant balance {money(a.balances.grant)}, minus pending withdrawals.</p>
            )}
          </div>
          <Field label="Amount (USD)" error={err}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
              <input data-testid="input-money-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amt} disabled={paused}
                onChange={(e) => { setAmt(e.target.value); setErr(''); }} placeholder="0.00" aria-invalid={!!err} className={cx(inputCls, 'pl-7 tabular-nums')} />
            </div>
          </Field>
          {isDeposit && (
            <div className="flex flex-wrap gap-2">
              {quickAmounts.map((q) => (
                <button key={q} type="button" disabled={paused} data-testid={`button-quick-${q}`} onClick={() => { setAmt(String(q)); setErr(''); }}
                  className="press rounded-full border border-slate-300 px-3.5 py-1.5 text-sm font-semibold text-slate-700 hover:border-[#1E3A8A] disabled:opacity-50">{money(q).replace('.00', '')}</button>
              ))}
            </div>
          )}
          <Field label="Note (optional)"><input data-testid="input-money-note" maxLength={240} value={note} disabled={paused} onChange={(e) => setNote(e.target.value)} placeholder={isDeposit ? 'e.g. Wire from operating account' : 'e.g. Equipment purchase'} className={inputCls} /></Field>
          <button data-testid="button-submit-money" type="submit" disabled={paused || m.isPending} className="press w-full rounded-full bg-[#1E3A8A] py-2.5 text-[15px] font-semibold text-white hover:bg-[#0F172A] disabled:opacity-60">
            {m.isPending ? 'Submitting…' : isDeposit ? 'Request deposit' : 'Request withdrawal'}
          </button>
          <p className="text-xs text-slate-500">Demo: requests are recorded as Pending for review. No real money moves.</p>
        </form>
        <section className={cx(card, 'p-4 sm:p-5 lg:col-span-3')} aria-labelledby="requests-heading">
          <h2 id="requests-heading" className="mb-4 text-lg font-semibold text-slate-900">Your {kind.toLowerCase()} requests</h2>
          {mine.length === 0
            ? <Empty title={`No ${kind.toLowerCase()} requests yet`} hint="Submit the form and your request appears here." />
            : <ul className="space-y-3" data-testid="list-requests">{mine.map((t) => <TxRow key={t.id} t={t} />)}</ul>}
        </section>
      </div>
    </div>
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
  return (
    <div className="space-y-5">
      <section className={cx(card, 'flex flex-wrap items-center gap-4 p-5')} data-testid="section-profile-header">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#1E3A8A] text-2xl font-semibold text-white">{d.profile.name.charAt(0)}</span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xl font-semibold text-slate-900"><span className="truncate">{d.profile.name}</span>{d.profile.verified && <BadgeCheck aria-label="Verified" className="h-5 w-5 shrink-0 fill-[#16A34A] text-white" />}</p>
          <p className="truncate text-sm text-slate-600">{d.profile.organization} · {d.profile.email}</p>
        </div>
      </section>
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
                <div className="flex items-center justify-between gap-3 py-3"><dt className="text-slate-600">Account tier</dt><dd className="font-semibold text-slate-900" data-testid="text-tier">Level {a.tier}</dd></div>
                <div className="flex items-center justify-between gap-3 py-3"><dt className="text-slate-600">Email notifications</dt><dd className="font-semibold text-slate-900">{a.permissions.emailNotifications ? 'On' : 'Off'}</dd></div>
                <div className="flex items-center justify-between gap-3 py-3"><dt className="text-slate-600">Verification needed to withdraw</dt><dd className="font-semibold text-slate-900">{a.permissions.withdrawalKycRequired ? 'Yes' : 'No'}</dd></div>
                <p className="pt-3 text-xs text-slate-500">These settings are managed by your administrator.</p>
              </dl>
            )}
        </section>
      </div>
    </div>
  );
}
