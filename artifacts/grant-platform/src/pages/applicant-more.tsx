import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateApplicantMilestone, useUpdateApplicantMilestone, useDeleteApplicantMilestone, getListApplicantMilestonesQueryKey,
  type ApplicantDashboard, type ApplicantApplication,
} from '@workspace/api-client-react';
import {
  Search, SlidersHorizontal, Download, FileText, ArrowLeftRight, ChartColumn, Plus, Trash2, Check, Mail, Clock,
  CreditCard, Settings, ChevronDown, type LucideIcon,
} from 'lucide-react';
import { Shell } from '@/components/shell';
import { Empty, ErrorState, Field, Modal, Skel, StatusBadge, cx, dateFmt, inputCls, money, statusLabel } from '@/components/bits';
import { apiError, useApplicantAccount, useApplicantDashboard, useApplications, useDemo, useMilestones, useRefreshApplicant, type Milestone } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';
import { Gate, GrantCard, GREY, Legend, NAVY, card, usd0 } from '@/pages/applicant';

/* ---------- shared helpers ---------- */
const STATUSES = ['Submitted', 'Review', 'Approved', 'Changes requested', 'Declined'] as const;
const statusColor: Record<string, string> = { Submitted: '#16A34A', Review: '#F59E0B', Approved: NAVY, 'Changes requested': '#A855F7', Declined: '#DC2626' };

/** Local-midnight date from "YYYY-MM-DD" (avoids the UTC off-by-one). */
const localDate = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
const daysUntil = (s: string) => Math.round((localDate(s).getTime() - today().getTime()) / 86_400_000);
const isoToday = () => { const t = today(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

/** Active (not withdrawn) applications from the server; the dashboard's highlights stand in while loading. */
function useAllApps(d: ApplicantDashboard): ApplicantApplication[] {
  const q = useApplications();
  return useMemo(() => (q.data ?? d.highlights).filter((a) => a.status !== 'Withdrawn'), [q.data, d.highlights]);
}

function Select({ label, value, onChange, children, testid }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; testid: string }) {
  return (
    <label className="relative block">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      <select data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputCls, 'appearance-none pr-9')}>{children}</select>
      <ChevronDown className="pointer-events-none absolute bottom-3 right-3 h-4 w-4 text-slate-500" />
    </label>
  );
}

function Tile({ label, value, hint, testid }: { label: string; value: string; hint?: string; testid: string }) {
  return (
    <div className={cx(card, 'p-4')}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900" data-testid={testid}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function BarRow({ label, value, max, color, right }: { label: string; value: number; max: number; color: string; right: string }) {
  return (
    <li>
      <div className="mb-1 flex justify-between gap-3 text-sm"><span className="text-slate-700">{label}</span><span className="font-semibold tabular-nums text-slate-900">{right}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color }} /></div>
    </li>
  );
}

/* ================================================================== */
/* Grant Search                                                        */
/* ================================================================== */
export function GrantSearchPage() {
  return <Gate title="Grant Search">{(d) => <GrantSearchBody d={d} />}</Gate>;
}
const amountBands = [
  { k: 'any', label: 'Any amount', test: () => true },
  { k: 'lt10', label: 'Under $10,000', test: (n: number) => n < 10000 },
  { k: '10to30', label: '$10,000 – $30,000', test: (n: number) => n >= 10000 && n <= 30000 },
  { k: 'gt30', label: 'Over $30,000', test: (n: number) => n > 30000 },
] as const;
function GrantSearchBody({ d }: { d: ApplicantDashboard }) {
  const { savedGrants } = useDemo();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [band, setBand] = useState<string>('any');
  const [within, setWithin] = useState('any');
  const [sort, setSort] = useState('deadline');
  const [savedOnly, setSavedOnly] = useState(false);
  const cats = useMemo(() => Array.from(new Set(d.recommendations.map((r) => r.category))).sort(), [d]);
  const test = amountBands.find((b) => b.k === band)!.test;
  const term = q.trim().toLowerCase();
  const list = d.recommendations
    .filter((g) => !term || g.title.toLowerCase().includes(term) || g.category.toLowerCase().includes(term))
    .filter((g) => cat === 'All' || g.category === cat)
    .filter((g) => test(g.amount))
    .filter((g) => { const n = daysUntil(g.deadline); return n >= 0 && (within === 'any' || n <= Number(within)); })
    .filter((g) => !savedOnly || savedGrants.includes(g.id))
    .sort((a, b) => sort === 'amount-desc' ? b.amount - a.amount : sort === 'amount-asc' ? a.amount - b.amount : a.deadline.localeCompare(b.deadline));
  const active = !!term || cat !== 'All' || band !== 'any' || within !== 'any' || savedOnly;
  const reset = () => { setQ(''); setCat('All'); setBand('any'); setWithin('any'); setSavedOnly(false); };
  return (
    <div className="space-y-5">
      <section className={cx(card, 'space-y-4 p-4 sm:p-5')} aria-label="Search filters">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input data-testid="input-grant-search" type="search" aria-label="Search grants" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search grants by name or category" className={cx(inputCls, 'py-3 pl-11 text-[15px]')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Category" value={cat} onChange={setCat} testid="select-search-category"><option>All</option>{cats.map((c) => <option key={c}>{c}</option>)}</Select>
          <Select label="Amount" value={band} onChange={setBand} testid="select-search-amount">{amountBands.map((b) => <option key={b.k} value={b.k}>{b.label}</option>)}</Select>
          <Select label="Deadline" value={within} onChange={setWithin} testid="select-search-deadline">
            <option value="any">Any open deadline</option><option value="30">Within 30 days</option><option value="60">Within 60 days</option><option value="90">Within 90 days</option>
          </Select>
          <Select label="Sort by" value={sort} onChange={setSort} testid="select-search-sort">
            <option value="deadline">Closing soonest</option><option value="amount-desc">Highest amount</option><option value="amount-asc">Lowest amount</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" data-testid="checkbox-saved-only" checked={savedOnly} onChange={(e) => setSavedOnly(e.target.checked)} className="h-4 w-4 accent-[#1E3A8A]" />Saved grants only
          </label>
          {active && <button data-testid="button-clear-filters" onClick={reset} className="text-sm font-semibold text-[#1E3A8A] hover:underline">Clear filters</button>}
          <p className="ml-auto text-sm text-slate-500" data-testid="text-search-count"><SlidersHorizontal className="mr-1 inline h-4 w-4" />{list.length} {list.length === 1 ? 'grant' : 'grants'} found</p>
        </div>
      </section>
      {list.length === 0
        ? <Empty title="No grants match your filters" hint="Try a broader search, or clear the filters.">{active && <button onClick={reset} className="rounded-full bg-[#1E3A8A] px-4 py-2 text-sm font-semibold text-white">Clear filters</button>}</Empty>
        : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="list-search-results">{list.map((g) => <GrantCard key={g.id} g={g} />)}</div>}
    </div>
  );
}

/* ================================================================== */
/* Grant Funding Tracker                                               */
/* ================================================================== */
export function FundingTrackerPage() {
  return <Gate title="Grant Funding Tracker">{(d) => <TrackerBody d={d} />}</Gate>;
}
function TrackerBody({ d }: { d: ApplicantDashboard }) {
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('monthly');
  const q = useApplicantDashboard(period);
  const trend = q.data?.fundingTrend ?? d.fundingTrend;
  const all = useAllApps(d);
  const pct = d.totalBudget > 0 ? Math.min(100, Math.max(0, (d.allocatedFunds / d.totalBudget) * 100)) : 0;
  const byStatus = STATUSES.map((s) => { const xs = all.filter((a) => a.status === s); return { s, n: xs.length, amt: xs.reduce((t, a) => t + a.amount, 0) }; });
  const byCat = Array.from(all.reduce((m, a) => m.set(a.category, (m.get(a.category) ?? 0) + a.amount), new Map<string, number>())).sort((a, b) => b[1] - a[1]);
  const maxStatus = Math.max(1, ...byStatus.map((x) => x.amt));
  const maxCat = Math.max(1, ...byCat.map((x) => x[1]));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Total Grant Budget" value={money(d.totalBudget)} testid="text-tracker-budget" />
        <Tile label="Funds Allocated" value={money(d.allocatedFunds)} hint={`${Math.round(pct)}% of budget`} testid="text-tracker-allocated" />
        <Tile label="Remaining" value={money(Math.max(0, d.totalBudget - d.allocatedFunds))} testid="text-tracker-remaining" />
      </div>
      <div className="h-3 overflow-hidden rounded-full" style={{ background: GREY }} role="progressbar" aria-label="Budget allocated" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: NAVY }} />
      </div>

      <section className={cx(card, 'p-5')} aria-labelledby="trend-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="trend-heading" className="text-lg font-semibold text-slate-900">Submitted vs. under review</h2><Legend className="mt-1" /></div>
          <div role="tablist" aria-label="Chart period" className="flex rounded-full bg-slate-100 p-0.5 text-sm font-semibold">
            {(['weekly', 'monthly'] as const).map((p) => (
              <button key={p} role="tab" aria-selected={period === p} data-testid={`tab-period-${p}`} onClick={() => setPeriod(p)} className={cx('rounded-full px-3.5 py-1.5 capitalize transition', period === p ? 'bg-[#1E3A8A] text-white' : 'text-slate-600 hover:text-slate-900')}>{p}</button>
            ))}
          </div>
        </div>
        <div className={cx('mt-4 h-64 transition-opacity sm:h-72', q.isFetching && 'opacity-60')} data-testid="chart-tracker">
          {q.isError ? <ErrorState onRetry={() => q.refetch()} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} tick={{ fill: '#475569' }} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={68} tick={{ fill: '#475569' }} tickFormatter={usd0} domain={[0, (max: number) => Math.max(5000, Math.ceil(max / 5000) * 5000)]} />
                <Tooltip cursor={{ fill: '#EEF4FB' }} formatter={(v: number) => money(v)} contentStyle={{ borderRadius: 12, borderColor: '#E5E7EB', fontSize: 13 }} />
                <Bar dataKey="submitted" name="Submitted" stackId="a" fill={NAVY} />
                <Bar dataKey="review" name="Review" stackId="a" fill={GREY} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={cx(card, 'p-5')} aria-labelledby="pipeline-heading" data-testid="section-pipeline">
          <h2 id="pipeline-heading" className="mb-4 text-lg font-semibold text-slate-900">Application pipeline</h2>
          <ul className="space-y-4">{byStatus.map((x) => <BarRow key={x.s} label={`${statusLabel(x.s)} · ${x.n}`} value={x.amt} max={maxStatus} color={statusColor[x.s]} right={money(x.amt)} />)}</ul>
        </section>
        <section className={cx(card, 'p-5')} aria-labelledby="category-heading" data-testid="section-by-category">
          <h2 id="category-heading" className="mb-4 text-lg font-semibold text-slate-900">Requested by category</h2>
          {byCat.length === 0 ? <Empty title="No applications yet" /> : <ul className="space-y-4">{byCat.map(([c, v]) => <BarRow key={c} label={c} value={v} max={maxCat} color={NAVY} right={money(v)} />)}</ul>}
        </section>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Reports                                                             */
/* ================================================================== */
const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function downloadCsv(name: string, header: string[], rows: unknown[][]) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportsPage() {
  return <Gate title="Reports">{(d) => <ReportsBody d={d} />}</Gate>;
}
function ReportsBody({ d }: { d: ApplicantDashboard }) {
  const all = useAllApps(d);
  const acct = useApplicantAccount();
  const { toast } = useToast();
  const requested = all.reduce((t, a) => t + a.amount, 0);
  const approved = all.filter((a) => a.status === 'Approved');
  const approvedAmt = approved.reduce((t, a) => t + a.amount, 0);
  const rate = all.length ? Math.round((approved.length / all.length) * 100) : 0;
  const tx = acct.data?.transactions ?? [];
  const sum = (type: string) => tx.filter((t) => t.type === type && t.status !== 'Declined').reduce((s, t) => s + t.amount, 0);
  const stamp = isoToday();
  const exports: { k: string; title: string; hint: string; icon: LucideIcon; disabled?: boolean; run: () => void }[] = [
    { k: 'applications', title: 'Applications', hint: `${all.length} rows · title, category, status, amount, date`, icon: FileText,
      run: () => downloadCsv(`applications-${stamp}.csv`, ['ID', 'Title', 'Category', 'Status', 'Amount (USD)', 'Submitted'], all.map((a) => [a.id, a.title, a.category, statusLabel(a.status), a.amount.toFixed(2), a.submittedAt.slice(0, 10)])) },
    { k: 'transactions', title: 'Transactions', hint: acct.data ? `${tx.length} rows · type, account, amount, status, date` : acct.isError ? 'Account data unavailable right now' : 'Loading account data…', icon: ArrowLeftRight, disabled: !acct.data,
      run: () => downloadCsv(`transactions-${stamp}.csv`, ['ID', 'Type', 'Account', 'Direction', 'Amount (USD)', 'Status', 'Description', 'Date'], tx.map((t) => [t.id, t.type, t.account, t.direction, t.amount.toFixed(2), t.status, t.description, t.createdAt])) },
    { k: 'funding', title: 'Funding trend', hint: `${d.fundingTrend.length} rows · monthly submitted vs. under review`, icon: ChartColumn,
      run: () => downloadCsv(`funding-trend-${stamp}.csv`, ['Period', 'Submitted (USD)', 'Under review (USD)'], d.fundingTrend.map((p) => [p.label, p.submitted, p.review])) },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Applications" value={String(all.length)} testid="text-report-apps" />
        <Tile label="Total requested" value={money(requested)} testid="text-report-requested" />
        <Tile label="Approved funding" value={money(approvedAmt)} hint={`${approved.length} approved`} testid="text-report-approved" />
        <Tile label="Approval rate" value={`${rate}%`} hint="Approved ÷ all applications" testid="text-report-rate" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={cx(card, 'p-5')} aria-labelledby="money-heading" data-testid="section-money-summary">
          <h2 id="money-heading" className="mb-3 text-lg font-semibold text-slate-900">Money movements</h2>
          {acct.isLoading ? <div className="space-y-2"><Skel className="h-10" /><Skel className="h-10" /><Skel className="h-10" /></div>
            : acct.isError ? <ErrorState onRetry={() => acct.refetch()} />
            : (
              <dl className="divide-y divide-slate-100 text-sm">
                <div className="flex justify-between gap-3 py-3"><dt className="text-slate-600">Deposits requested</dt><dd className="font-semibold tabular-nums text-slate-900">{money(sum('Deposit'))}</dd></div>
                <div className="flex justify-between gap-3 py-3"><dt className="text-slate-600">Withdrawals requested</dt><dd className="font-semibold tabular-nums text-slate-900">{money(sum('Withdrawal'))}</dd></div>
                <div className="flex justify-between gap-3 py-3"><dt className="text-slate-600">Grant awards received</dt><dd className="font-semibold tabular-nums text-[#166534]" data-testid="text-report-awards">{money(sum('Grant award'))}</dd></div>
                <div className="flex justify-between gap-3 py-3"><dt className="text-slate-600">Top-ups received</dt><dd className="font-semibold tabular-nums text-[#166534]">{money(sum('Top-up'))}</dd></div>
                <div className="flex justify-between gap-3 py-3"><dt className="text-slate-600">Awaiting review</dt><dd className="font-semibold tabular-nums text-slate-900">{tx.filter((t) => t.status === 'Pending').length}</dd></div>
              </dl>
            )}
        </section>
        <section className={cx(card, 'p-5')} aria-labelledby="exports-heading">
          <h2 id="exports-heading" className="mb-3 text-lg font-semibold text-slate-900">Download reports</h2>
          <ul className="space-y-3">
            {exports.map((x) => (
              <li key={x.k} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EEF4FB] text-[#1E3A8A]"><x.icon className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold text-slate-900">{x.title}</span><span className="block truncate text-sm text-slate-500">{x.hint}</span></span>
                <button data-testid={`button-export-${x.k}`} disabled={x.disabled} onClick={() => { x.run(); toast({ title: `${x.title} report downloaded` }); }}
                  className="press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-300 px-3.5 py-1.5 text-sm font-semibold text-slate-700 hover:border-[#1E3A8A] hover:text-[#1E3A8A] disabled:opacity-50"><Download className="h-4 w-4" />CSV</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Milestones                                                          */
/* ================================================================== */
const msSchema = z.object({
  title: z.string().trim().min(3, 'Enter at least 3 characters').max(120),
  grant: z.string().min(1),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a due date'),
});
function msState(m: Milestone) {
  if (m.done) return { label: 'Done', cls: 'bg-[#DCFCE7] text-[#166534]' };
  const n = daysUntil(m.due);
  if (n < 0) return { label: 'Overdue', cls: 'bg-[#FEE2E2] text-[#991B1B]' };
  if (n <= 14) return { label: n === 0 ? 'Due today' : `Due in ${n} day${n === 1 ? '' : 's'}`, cls: 'bg-[#FEF3C7] text-[#92400E]' };
  return { label: 'Scheduled', cls: 'bg-slate-100 text-slate-600' };
}

export function MilestonesPage() {
  return <Gate title="Milestones">{(d) => <MilestonesGate d={d} />}</Gate>;
}
function MilestonesGate({ d }: { d: ApplicantDashboard }) {
  const q = useMilestones();
  if (q.isLoading) return <div className="space-y-3"><Skel className="h-28" /><Skel className="h-64" /></div>;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  return <MilestonesBody d={d} milestones={q.data} />;
}
function MilestonesBody({ d, milestones }: { d: ApplicantDashboard; milestones: Milestone[] }) {
  const qc = useQueryClient();
  const key = getListApplicantMilestonesQueryKey();
  const update = useUpdateApplicantMilestone();
  const del = useDeleteApplicantMilestone();
  const fail = (e: unknown) => { qc.invalidateQueries({ queryKey: key }); toast({ title: 'Could not save that change', description: apiError(e, 'Please try again.'), variant: 'destructive' }); };
  // Optimistic: flip/remove locally, then reconcile with the server.
  const toggleMilestone = (id: string) => {
    const m = milestones.find((x) => x.id === id)!;
    qc.setQueryData<Milestone[]>(key, (p) => p?.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
    update.mutate({ milestoneId: id, data: { done: !m.done } }, { onError: fail });
  };
  const removeMilestone = (id: string) => {
    qc.setQueryData<Milestone[]>(key, (p) => p?.filter((x) => x.id !== id));
    del.mutate({ milestoneId: id }, { onError: fail });
  };
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const all = useAllApps(d);
  const grants = Array.from(new Set(['General', ...all.filter((a) => a.status === 'Approved').map((a) => a.title), ...milestones.map((m) => m.grant)]));
  const open = milestones.filter((m) => !m.done).sort((a, b) => a.due.localeCompare(b.due));
  const done = milestones.filter((m) => m.done).sort((a, b) => b.due.localeCompare(a.due));
  const overdue = open.filter((m) => daysUntil(m.due) < 0).length;
  const pct = milestones.length ? Math.round((done.length / milestones.length) * 100) : 0;
  const row = (m: Milestone) => {
    const st = msState(m);
    return (
      <li key={m.id} data-testid={`row-milestone-${m.id}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 sm:px-4">
        <button role="checkbox" aria-checked={m.done} aria-label={`Mark "${m.title}" ${m.done ? 'not done' : 'done'}`} data-testid={`checkbox-milestone-${m.id}`} onClick={() => toggleMilestone(m.id)}
          className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition', m.done ? 'border-[#16A34A] bg-[#16A34A] text-white' : 'border-slate-300 hover:border-[#1E3A8A]')}>{m.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}</button>
        <span className="min-w-0 flex-1">
          <span className={cx('block truncate font-semibold', m.done ? 'text-slate-500 line-through' : 'text-slate-900')}>{m.title}</span>
          <span className="block truncate text-sm text-slate-500">{m.grant}<span className="hidden sm:inline"> · Due {dateFmt(m.due)}</span></span>
          <span className="block text-sm text-slate-500 sm:hidden">Due {dateFmt(m.due)} · <span className={cx('font-semibold', st.label === 'Overdue' ? 'text-[#991B1B]' : st.label.startsWith('Due') ? 'text-[#92400E]' : 'text-slate-600')}>{st.label}</span></span>
        </span>
        <span className={cx('hidden shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold sm:inline', st.cls)} data-testid={`status-milestone-${m.id}`}>{st.label}</span>
        <button aria-label={`Delete "${m.title}"`} data-testid={`button-delete-milestone-${m.id}`} onClick={() => { removeMilestone(m.id); toast({ title: 'Milestone removed', description: m.title }); }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
      </li>
    );
  };
  return (
    <div className="space-y-5">
      <section className={cx(card, 'p-5')} data-testid="section-milestone-progress">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{done.length} of {milestones.length} milestones complete</h2>
            <p className="text-sm text-slate-500">{overdue > 0 ? <span className="font-semibold text-[#991B1B]">{overdue} overdue</span> : 'Nothing overdue'} · {open.length} still to do</p>
          </div>
          <button data-testid="button-add-milestone" onClick={() => setAdding(true)} className="press inline-flex items-center gap-1.5 rounded-full bg-[#1E3A8A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F172A]"><Plus className="h-4 w-4" />Add milestone</button>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Milestones complete" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-[#16A34A] transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
      </section>
      <section className={cx(card, 'p-4 sm:p-5')} aria-labelledby="ms-open">
        <h2 id="ms-open" className="mb-4 text-lg font-semibold text-slate-900">Upcoming</h2>
        {open.length === 0 ? <Empty title="All caught up" hint="Add a milestone to track your next deliverable." /> : <ul className="space-y-3" data-testid="list-milestones-open">{open.map(row)}</ul>}
      </section>
      {done.length > 0 && (
        <section className={cx(card, 'p-4 sm:p-5')} aria-labelledby="ms-done">
          <h2 id="ms-done" className="mb-4 text-lg font-semibold text-slate-900">Completed</h2>
          <ul className="space-y-3" data-testid="list-milestones-done">{done.map(row)}</ul>
        </section>
      )}
      <AddMilestoneModal open={adding} onClose={() => setAdding(false)} grants={grants} />
    </div>
  );
}
function AddMilestoneModal({ open, onClose, grants }: { open: boolean; onClose: () => void; grants: string[] }) {
  const create = useCreateApplicantMilestone();
  const refresh = useRefreshApplicant();
  const { toast } = useToast();
  const [err, setErr] = useState('');
  const f = useForm<z.infer<typeof msSchema>>({ resolver: zodResolver(msSchema), defaultValues: { title: '', grant: grants[1] ?? 'General', due: '' } });
  const close = () => { f.reset({ title: '', grant: grants[1] ?? 'General', due: '' }); setErr(''); onClose(); };
  return (
    <Modal open={open} onClose={close} title="Add milestone" testid="dialog-add-milestone">
      <form className="space-y-4" noValidate onSubmit={f.handleSubmit((v) => create.mutate({ data: v }, {
        onSuccess: () => { refresh(); toast({ title: 'Milestone added', description: v.title }); close(); },
        onError: (e) => setErr(apiError(e, 'Could not add the milestone. Please try again.')),
      }))}>
        <Field label="Milestone" error={f.formState.errors.title?.message}><input data-testid="input-milestone-title" placeholder="e.g. Submit interim report" className={inputCls} {...f.register('title')} /></Field>
        <Field label="Grant"><select data-testid="select-milestone-grant" className={inputCls} {...f.register('grant')}>{grants.map((g) => <option key={g}>{g}</option>)}</select></Field>
        <Field label="Due date" error={f.formState.errors.due?.message}><input data-testid="input-milestone-due" type="date" className={inputCls} {...f.register('due')} /></Field>
        {err && <p role="alert" className="text-sm text-[#991B1B]">{err}</p>}
        <button data-testid="button-submit-milestone" type="submit" disabled={create.isPending} className="press w-full rounded-full bg-[#1E3A8A] py-2.5 text-sm font-semibold text-white hover:bg-[#0F172A] disabled:opacity-60">{create.isPending ? 'Adding…' : 'Add milestone'}</button>
      </form>
    </Modal>
  );
}

/* ================================================================== */
/* Help Centre                                                         */
/* ================================================================== */
const topics = ['Applications', 'Funding & payments', 'Cards', 'Account & security'] as const;
const faqs: { topic: (typeof topics)[number]; q: string; a: string }[] = [
  { topic: 'Applications', q: 'How do I start a new application?', a: 'Select "New Application" on the dashboard, or "Apply" on any grant in Grant Search or Grant categories. The form is pre-filled with that grant’s details.' },
  { topic: 'Applications', q: 'What do the application statuses mean?', a: 'Submitted means the funder has received it. Under Review means it is being assessed. Changes requested means the funder needs more information. Approved and Declined are final decisions.' },
  { topic: 'Applications', q: 'Can I save a grant to apply later?', a: 'Yes. Select "Save" on a grant card. Use the "Saved grants only" filter in Grant Search to find your shortlist.' },
  { topic: 'Funding & payments', q: 'How long do withdrawals take?', a: 'Withdrawal requests show as Pending until an administrator approves or declines them; you are notified either way, with the reason if it is declined. Pending withdrawals are deducted from your available balance, so you can’t request the same funds twice. Approved withdrawals are paid out of your grant balance.' },
  { topic: 'Funding & payments', q: 'Why was my request refused?', a: 'Requests are refused when the amount is more than your available grant balance, when your account or the platform is frozen, or when identity verification is required and not yet complete.' },
  { topic: 'Funding & payments', q: 'Where can I see all my money movements?', a: 'The Transactions page lists deposits, withdrawals, grant awards and top-ups with their status. When an application is approved, the award is added to your grant balance and listed there. You can also download them as CSV from Reports.' },
  { topic: 'Cards', q: 'When will my physical card arrive?', a: 'A physical card shows "Being issued" until it is activated. Your virtual card can be used in the meantime.' },
  { topic: 'Account & security', q: 'How do I change my email or organization?', a: 'Email and organization are locked to protect your account. Contact support and we’ll update them after confirming your identity.' },
  { topic: 'Account & security', q: 'What is identity verification (KYC)?', a: 'We check a government ID and proof of address before money can be withdrawn. Upload both in Settings → Identity verification (images or PDF, up to 10 MB). An administrator reviews each document and you are notified of the result. If one isn’t accepted, the reason is shown next to it in Settings so you can upload a new copy.' },
  { topic: 'Applications', q: 'How do I attach my proposal?', a: 'Add a PDF or Word (.docx) file when you create an application, or open the application and choose Attach document. You can attach up to 5 files and remove them until a decision is made.' },
  { topic: 'Account & security', q: 'I forgot my password. What do I do?', a: 'On the sign-in page, choose “Forgot password?” and enter your email. We’ll send a link to choose a new password; it works once and expires after an hour. Sign out from the account menu (the … next to your name).' },
  { topic: 'Account & security', q: 'How do I change my profile photo?', a: 'In Settings, select the camera button on your photo and choose a JPG, PNG or WebP image. Photos are cropped to a square and re-saved without location data.' },
];
export function HelpPage() {
  return <Shell title="Help Centre"><HelpBody /></Shell>;
}
function HelpBody() {
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState<string>('All');
  const term = q.trim().toLowerCase();
  const list = faqs.filter((f) => (topic === 'All' || f.topic === topic) && (!term || f.q.toLowerCase().includes(term) || f.a.toLowerCase().includes(term)));
  const links: { href: string; label: string; icon: LucideIcon }[] = [
    { href: '/applications', label: 'My Applications', icon: FileText },
    { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
    { href: '/cards', label: 'Cards', icon: CreditCard },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[#DBEAFE] bg-[#EEF4FB] p-5 sm:p-8">
        <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">How can we help?</h2>
        <div className="relative mt-4 max-w-xl">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input data-testid="input-help-search" type="search" aria-label="Search help articles" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions" className={cx(inputCls, 'py-3 pl-11 text-[15px]')} />
        </div>
        <div className="noscroll -mx-1 mt-4 flex gap-2 overflow-x-auto px-1" role="group" aria-label="Topics">
          {['All', ...topics].map((t) => (
            <button key={t} aria-pressed={topic === t} data-testid={`filter-topic-${t.toLowerCase().replace(/[^a-z]+/g, '-')}`} onClick={() => setTopic(t)}
              className={cx('press whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold', topic === t ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-[#1E3A8A]')}>{t}</button>
          ))}
        </div>
      </section>
      <div className="grid gap-5 lg:grid-cols-3">
        <section className={cx(card, 'p-4 sm:p-5 lg:col-span-2')} aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="mb-3 text-lg font-semibold text-slate-900">Frequently asked questions</h2>
          {list.length === 0 ? <Empty title="No answers found" hint="Try different words, or contact support." /> : (
            <div className="divide-y divide-slate-100" data-testid="list-faqs">
              {list.map((f) => (
                <details key={f.q} className="group py-1">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 py-3 font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                    {f.q}<ChevronDown className="h-5 w-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="px-1 pb-3 text-[15px] leading-relaxed text-slate-600">{f.a}</p>
                </details>
              ))}
            </div>
          )}
        </section>
        <div className="space-y-5">
          <section className={cx(card, 'p-5')} aria-labelledby="contact-heading" data-testid="section-contact">
            <h2 id="contact-heading" className="mb-3 text-lg font-semibold text-slate-900">Contact support</h2>
            <p className="flex items-center gap-2 text-sm text-slate-700"><Mail className="h-4 w-4 text-[#1E3A8A]" /><span className="font-semibold">support@grantapp.mx</span></p>
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-700"><Clock className="h-4 w-4 text-[#1E3A8A]" />Mon–Fri, 9:00–17:00 · reply within 1 business day</p>
            <p className="mt-3 text-xs text-slate-500">Demo preview: this support inbox is a placeholder and isn’t monitored.</p>
          </section>
          <section className={cx(card, 'p-5')} aria-labelledby="links-heading">
            <h2 id="links-heading" className="mb-3 text-lg font-semibold text-slate-900">Quick links</h2>
            <ul className="space-y-1">
              {links.map((l) => (
                <li key={l.href}><Link href={l.href} className="flex items-center gap-3 rounded-lg px-2 py-2 text-[15px] text-slate-700 hover:bg-slate-100"><l.icon className="h-4 w-4 text-slate-500" />{l.label}</Link></li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

