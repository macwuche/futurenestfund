import { useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  useGetAdminDashboard, useListAdminUsers, useGetAdminUser, useUpdateAdminUser, useListAdminApplications,
  getGetAdminUserQueryKey, getListAdminUsersQueryKey, type ListAdminUsersSort, type ListAdminUsersDir, type AdminDashboard, type AdminUserProfile, type AdminUserSummary,
} from '@workspace/api-client-react';
import { keepPreviousData } from '@tanstack/react-query';
import { Camera, Minus, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, FileText, Plus, Snowflake, ArrowLeft, Lock, Loader2, ShieldCheck } from 'lucide-react';
import { Shell, GlobalFreezeDialog } from '@/components/shell';
import { AccountSecurity } from '@/components/security';
import { GlobalWithdrawalLimits, UserWithdrawalLimits } from '@/components/withdrawal-limits';
import { CardControls } from '@/components/card-controls';
import { Empty, ErrorState, Field, Modal, PageSkeleton, Skel, StatusBadge, cx, dateFmt, initials, money } from '@/components/bits';
import { card, ainput, lime, dark, ghost, Stat, SectionTitle, useAdminRefresh, KycPreview, KycDecision, CreditModal } from '@/components/admin-bits';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

function DashGate({ title, children }: { title: string; children: (d: AdminDashboard) => ReactNode }) {
  const q = useGetAdminDashboard();
  return <Shell admin title={title}>{q.isLoading ? <PageSkeleton /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : children(q.data)}</Shell>;
}

export const appReviewHref = (a: { id: string; userId: string }) => `/admin/users/${a.userId}/applications/${a.id}`;

/* ---------- Dashboard ---------- */
export function AdminOverviewPage() {
  return <DashGate title="Dashboard">{(d) => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat id="total-users" label="Total users" value={d.totalUsers} accent hint={`${d.activeUsers} active`} href="/admin/users" />
        <Stat id="grant-balances" label="Grant balances" value={money(d.totalGrantBalances)} />
        <Stat id="deposit-balances" label="Deposit balances" value={money(d.totalDepositBalances)} />
        <Stat id="active-users" label="Active users" value={d.activeUsers} hint={`${d.totalUsers - d.activeUsers} frozen`} />
        <Stat id="pending-applications" label="Pending applications" value={d.pendingApplications} hint="Submitted or under review" href="#review-queue" />
        <Stat id="pending-kyc" label="Pending KYC" value={d.pendingKyc} hint="Users with documents to review" href="/admin/kyc" />
        <Stat id="pending-deposits" label="Pending deposits" value={d.pendingDeposits} href="/admin/deposits" />
        <Stat id="pending-withdrawals" label="Pending withdrawals" value={d.pendingWithdrawals} href="/admin/withdrawals" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={cx(card, 'min-w-0 p-5 lg:col-span-2')} data-testid="card-money-trend">
          <SectionTitle action={<Link href="/admin/transactions" className="text-xs font-semibold hover:underline">Open ledger</Link>}>Money movement</SectionTitle>
          <p className="-mt-2 mb-3 text-xs text-slate-500">Ledger credits and debits per month (UTC), last six months. Opening balances excluded.</p>
          <div className="h-56" aria-label="Bar chart of money in and out per month">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.moneyTrend} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={64} tickFormatter={(v: number) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                <Tooltip formatter={(v: number) => money(v)} cursor={{ fill: '#F4F5F8' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => <span className="text-slate-700">{v}</span>} />
                <Bar dataKey="inflow" name="Money in" fill="#111111" radius={[4, 4, 0, 0]} />
                <Bar dataKey="outflow" name="Money out" fill="#A3C92A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className={cx(card, 'p-5')} data-testid="card-system-health">
          <SectionTitle>System health</SectionTitle>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center justify-between gap-2"><span>API</span><StatusBadge status={d.systemHealth.api} testid="health-api" /></li>
            <li className="flex items-center justify-between gap-2"><span>Database</span><StatusBadge status={d.systemHealth.database} testid="health-database" /></li>
            <li className="flex items-center justify-between gap-2"><span title="Audit log, ledger and application history refuse edits and deletes">Audit log (append-only)</span><StatusBadge status={d.systemHealth.auditLog} testid="health-audit-log" /></li>
            <li className="flex items-center justify-between gap-2"><span>4-Eyes approval</span><StatusBadge status={d.systemHealth.fourEyes ? 'Active' : 'Not active'} testid="health-four-eyes" /></li>
            <li className="flex items-center justify-between gap-2"><span>Global freeze</span><StatusBadge status={d.globalFrozen ? 'Frozen' : 'Off'} testid="health-global-freeze" /></li>
          </ul>
          {!d.systemHealth.fourEyes && <p className="mt-3 text-xs text-slate-500">Approvals need one administrator in this demo. Two-person sign-off needs real admin accounts.</p>}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ReviewQueue />
        <div className="min-w-0 space-y-4">
          <section className={cx(card, 'p-5')} data-testid="card-status-groups">
            <SectionTitle>Applications by status</SectionTitle>
            {d.applicationsByStatus.map((s) => {
              const max = Math.max(1, ...d.applicationsByStatus.map((x) => x.count));
              return (
                <div key={s.status} className="mb-3" data-testid={`row-status-${s.status}`}>
                  <div className="mb-1 flex justify-between text-sm"><span>{s.status === 'Review' ? 'Under review' : s.status}</span><span className="font-num font-semibold">{s.count}</span></div>
                  <div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#111] transition-all duration-700" style={{ width: `${(s.count / max) * 100}%` }} /></div>
                </div>
              );
            })}
          </section>
          <section className={cx(card, 'p-5')} data-testid="card-recent-activity">
            <SectionTitle action={<Link href="/admin/audit" data-testid="link-activity-audit" className="text-xs font-semibold hover:underline">View full audit log</Link>}>Recent activity</SectionTitle>
            {d.recentActivity.length === 0 ? <Empty title="No activity" /> : (
              <ul className="space-y-3">{d.recentActivity.map((a) => (
                <li key={a.id} data-testid={`row-activity-${a.id}`} className="border-l-2 border-[#C6F432] pl-3 text-sm"><p className="break-words font-semibold">{a.action}</p><p className="text-xs text-slate-500">{a.subject} · {dateFmt(a.createdAt)}</p></li>
              ))}</ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )}</DashGate>;
}

function ReviewQueue() {
  const q = useListAdminApplications({ status: 'pending' });
  return (
    <section id="review-queue" className={cx(card, 'min-w-0 scroll-mt-24 p-5 lg:col-span-2 lg:self-start')} data-testid="card-review-queue">
      <SectionTitle>Applications awaiting a decision</SectionTitle>
      {q.isLoading ? <div className="space-y-2">{[1, 2, 3].map((i) => <Skel key={i} className="h-14" />)}</div>
        : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
        : q.data.length === 0 ? <Empty title="Nothing to review" hint="New and resubmitted applications appear here, oldest first." />
        : (
          <ul className="divide-y" data-testid="list-review-queue">{q.data.map((a) => (
            <li key={a.id}>
              <Link href={appReviewHref(a)} data-testid={`link-review-app-${a.id}`} className="group flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:bg-[#F7FADC] sm:flex-nowrap sm:px-2">
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{a.title}</span><span className="block truncate text-xs text-slate-500">{a.userName} · {a.organization} · {a.id} · {dateFmt(a.submittedAt)}</span></span>
                <span className="font-num text-sm font-semibold">{money(a.amount)}</span>
                <StatusBadge status={a.status} />
                <ChevronRight className="hidden h-4 w-4 text-slate-400 transition group-hover:translate-x-1 sm:block" />
              </Link>
            </li>
          ))}</ul>
        )}
    </section>
  );
}

/* ---------- Users directory ---------- */
type UserSort = ListAdminUsersSort;
const SORT_LABEL: Record<UserSort, string> = { name: 'Name', joined: 'Joined', tier: 'Tier', status: 'Status', grant: 'Grant balance', deposit: 'Deposit balance' };
/** Same defaults as the API: names, tiers and statuses A→Z / low→high; dates and balances newest / largest first. */
const defaultDir = (s: UserSort): ListAdminUsersDir => (s === 'joined' || s === 'grant' || s === 'deposit' ? 'desc' : 'asc');
const joinedFmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function UserTable({ items, sort, dir, onSort }: { items: AdminUserSummary[]; sort: UserSort; dir: ListAdminUsersDir; onSort: (s: UserSort) => void }) {
  const th = (key: UserSort, label: string, className = '') => (
    <th className={className} aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" data-testid={`sort-${key}`} onClick={() => onSort(key)} className={cx('inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-900', sort === key && 'text-slate-900', className.includes('text-right') && 'flex-row-reverse')}>
        {label}{sort === key ? (dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />) : <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />}
      </button>
    </th>
  );
  return (
    <>
      {/* Phones: one card per user, so nothing scrolls sideways. */}
      <ul className="space-y-2 md:hidden" data-testid="list-users">{items.map((u) => (
        <li key={u.id}><Link href={`/admin/users/${u.id}`} data-testid={`card-user-${u.id}`} className="flex items-center gap-3 rounded-xl border p-3 hover:bg-[#F7FADC]">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#111] text-xs font-bold text-[#C6F432]">{initials(u.name)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{u.name}</span>
            <span className="block truncate text-xs text-slate-500">{u.organization}</span>
            <span className="block text-xs text-slate-500" data-testid={`text-card-joined-${u.id}`}>L{u.tier} · joined {joinedFmt(u.joinedAt)}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1"><StatusBadge status={u.status} /><StatusBadge status={u.verificationLevel} />{u.pendingKycDocuments > 0 && <span className="text-xs text-slate-500">{u.pendingKycDocuments} to review</span>}</span>
          </span>
          <span className="shrink-0 text-right"><span className="font-num block text-sm font-semibold">{money(u.grantBalance)}</span><span className="block text-[11px] text-slate-500">grant</span></span>
        </Link></li>
      ))}</ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] text-left text-sm" data-testid="table-users">
          <thead><tr className="border-b text-xs text-slate-500">
            {th('name', 'User', 'py-2 pr-3')}{th('joined', 'Joined')}{th('tier', 'Tier')}<th className="uppercase tracking-wide">KYC</th>{th('status', 'Status')}
            {th('grant', 'Grant', 'text-right')}{th('deposit', 'Deposit', 'text-right')}<th />
          </tr></thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} data-testid={`row-user-${u.id}`} className="group border-b transition hover:bg-[#F7FADC]">
                <td className="py-3 pr-3"><Link href={`/admin/users/${u.id}`} data-testid={`link-user-${u.id}`} className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#111] text-xs font-bold text-[#C6F432]">{initials(u.name)}</span>
                  <span><span className="block font-semibold">{u.name}</span><span className="block text-xs text-slate-500">{u.email} · {u.organization} · <span className="font-num">{u.id}</span></span></span></Link></td>
                <td className="whitespace-nowrap text-xs text-slate-600">{joinedFmt(u.joinedAt)}</td>
                <td className="font-num">L{u.tier}</td>
                <td><span className="flex flex-wrap items-center gap-1"><StatusBadge status={u.verificationLevel} />{u.pendingKycDocuments > 0 && <span className="text-xs text-slate-500" data-testid={`text-pending-docs-${u.id}`}>{u.pendingKycDocuments} to review</span>}</span></td>
                <td><StatusBadge status={u.status} /></td>
                <td className="font-num text-right">{money(u.grantBalance)}</td>
                <td className="font-num text-right">{money(u.depositBalance)}</td>
                <td className="pl-2"><ChevronRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const PAGE_SIZE = 25;
const SORTS = Object.keys(SORT_LABEL) as UserSort[];
const STATUSES = ['all', 'active', 'frozen'] as const;

export function AdminUsersPage() {
  const query = useSearch();
  const [, navigate] = useLocation();
  // Search, status, sort and page live in the address bar, so "back" from a user returns to the same page of the list.
  const u = new URLSearchParams(query);
  const status = (STATUSES as readonly string[]).includes(u.get('status') ?? '') ? u.get('status') as (typeof STATUSES)[number] : 'all';
  const sort = (SORTS as string[]).includes(u.get('sort') ?? '') ? u.get('sort') as UserSort : 'name';
  const dir: ListAdminUsersDir = u.get('dir') === 'asc' || u.get('dir') === 'desc' ? u.get('dir') as ListAdminUsersDir : defaultDir(sort);
  const page = Math.max(1, Number.parseInt(u.get('page') ?? '1', 10) || 1);
  const urlSearch = u.get('q') ?? '';
  const [search, setSearch] = useState(urlSearch);
  useEffect(() => { setSearch(urlSearch); }, [urlSearch]);
  const go = (changes: Record<string, string | number | null>) => {
    const next = new URLSearchParams(query);
    for (const [k, v] of Object.entries(changes)) { if (v === null || v === '') next.delete(k); else next.set(k, String(v)); }
    if (!('page' in changes)) next.delete('page'); // a new search, filter or sort starts again at page 1
    if (next.get('status') === 'all') next.delete('status');
    if (next.get('sort') === 'name') next.delete('sort');
    if (next.get('dir') === defaultDir((next.get('sort') as UserSort) ?? 'name')) next.delete('dir');
    if (next.get('page') === '1') next.delete('page');
    navigate(`/admin/users${next.size ? `?${next}` : ''}`, { replace: !('page' in changes) && !('sort' in changes) });
  };
  const s = useDeferredValue(search.trim());
  useEffect(() => { if (s !== urlSearch.trim()) go({ q: s }); }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const params = { ...(urlSearch.trim() ? { search: urlSearch.trim() } : {}), status, sort, dir, page, pageSize: PAGE_SIZE };
  const q = useListAdminUsers(params, { query: { placeholderData: keepPreviousData, queryKey: getListAdminUsersQueryKey(params) } });
  const onSort = (k: UserSort) => go({ sort: k, dir: k === sort ? (dir === 'asc' ? 'desc' : 'asc') : defaultDir(k) });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const first = q.data && q.data.total ? (q.data.page - 1) * q.data.pageSize + 1 : 0;
  const last = q.data ? Math.min(q.data.total, first + q.data.items.length - 1) : 0;
  return (
    <Shell admin title="Users">
      <div className={cx(card, 'p-5')}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input data-testid="input-user-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, organization" aria-label="Search users" className={cx(ainput, 'sm:max-w-xs')} />
          <div role="group" aria-label="Status filter" className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
            {STATUSES.map((k) => <button key={k} aria-pressed={status === k} data-testid={`filter-status-${k}`} onClick={() => go({ status: k })} className={cx('press rounded-md px-3 py-1.5 capitalize transition', status === k ? 'bg-[#111] text-[#C6F432]' : 'text-slate-600')}>{k}</button>)}
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 md:hidden">Sort by
            <select data-testid="select-user-sort" value={`${sort}:${dir}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); go({ sort: k!, dir: d! }); }} className={cx(ainput, '!w-auto !py-1.5 text-sm')}>
              {SORTS.flatMap((k) => (['asc', 'desc'] as const).map((d) => (
                <option key={`${k}:${d}`} value={`${k}:${d}`}>{SORT_LABEL[k]} · {k === 'name' || k === 'status' ? (d === 'asc' ? 'A→Z' : 'Z→A') : k === 'joined' ? (d === 'asc' ? 'oldest' : 'newest') : (d === 'asc' ? 'lowest' : 'highest')}</option>
              )))}
            </select>
          </label>
          <span className="ml-auto text-sm text-slate-500" data-testid="text-user-total">{q.data ? `${q.data.total} ${q.data.total === 1 ? 'user' : 'users'}` : ''}</span>
        </div>
        {q.isLoading ? <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skel key={i} className="h-14" />)}</div>
          : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
          : q.data.items.length === 0 ? <Empty title="No users match" hint={page > 1 ? 'This page is empty. Go back to page 1.' : 'Try a different search or status filter.'} />
          : (
            <>
              <UserTable items={q.data.items} sort={sort} dir={dir} onSort={onSort} />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-slate-500" data-testid="text-user-range">Showing {first}–{last} of {q.data.total}</span>
                <div className="flex gap-2">
                  <button data-testid="button-users-prev" disabled={page <= 1} onClick={() => go({ page: page - 1 })} className={cx(ghost, 'inline-flex min-h-11 items-center gap-1 text-xs md:min-h-0 md:!py-1.5')}><ChevronLeft className="h-3.5 w-3.5" />Previous</button>
                  <button data-testid="button-users-next" disabled={page >= pages} onClick={() => go({ page: page + 1 })} className={cx(ghost, 'inline-flex min-h-11 items-center gap-1 text-xs md:min-h-0 md:!py-1.5')}>Next<ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </>
          )}
      </div>
    </Shell>
  );
}

/* ---------- User inspector ---------- */
const profSchema = z.object({ name: z.string().trim().min(2, 'At least 2 characters').max(100), phone: z.string().max(40), telegram: z.string().max(80) });

export function AdminUserPage() {
  const { userId = '' } = useParams<{ userId: string }>();
  const q = useGetAdminUser(userId, { query: { enabled: !!userId, queryKey: getGetAdminUserQueryKey(userId) } });
  return (
    <Shell admin title="User inspector">
      <Link href="/admin/users" data-testid="link-back-users" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"><ArrowLeft className="h-4 w-4" />All users</Link>
      {q.isLoading ? <PageSkeleton /> : q.isError || !q.data ? <ErrorState message="This user could not be loaded." onRetry={() => q.refetch()} /> : <Inspector u={q.data} />}
    </Shell>
  );
}

/** One mutation per control group, so saving one setting never shows "Saving" on (or disables) another. */
function useUserPatch(u: AdminUserProfile) {
  const m = useUpdateAdminUser();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const run = (data: Parameters<typeof m.mutate>[0]['data'], msg: string, onSuccess?: () => void) =>
    m.mutate({ userId: u.id, data }, {
      onSuccess: () => { refresh(); toast({ title: msg }); onSuccess?.(); },
      onError: (e) => toast({ title: 'Update failed', description: apiError(e, 'Please try again.'), variant: 'destructive' }),
    });
  return { run, pending: m.isPending, variables: m.variables };
}

/** Admin override for one notification channel: left to the user, forced on or forced off. The admin's choice wins. */
function NotificationOverride({ u, perms, k, label, userChoice }: {
  u: AdminUserProfile; perms: ReturnType<typeof useUserPatch>; k: 'emailOverride' | 'inAppOverride'; label: string; userChoice: string;
}) {
  const value = u.permissions[k] ?? null;
  const options = [[null, userChoice], [true, 'Always on'], [false, 'Always off']] as const;
  const saving = perms.pending && (perms.variables?.data.permissions?.[k] ?? null) !== value;
  return (
    <div className="space-y-2 rounded-lg border px-3 py-2.5 text-sm" data-testid={`group-${k}`}>
      <span id={`label-${k}`} className="flex items-center gap-2">{label}{saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-label="Saving" />}</span>
      <div role="radiogroup" aria-labelledby={`label-${k}`} className="grid grid-cols-3 gap-1.5">
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} data-testid={`button-${k}-${v === null ? 'user' : v ? 'on' : 'off'}`} disabled={perms.pending}
            onClick={() => value !== v && perms.run({ permissions: { ...u.permissions, [k]: v } }, `${label}: ${v === null ? "left to the user" : v ? 'always on' : 'always off'}`)}
            className={cx('press min-h-11 rounded-lg border px-2 py-1.5 text-xs font-semibold leading-tight transition', value === v ? 'border-[#111] bg-[#111] text-[#C6F432]' : 'border-slate-300 hover:border-[#111]')}>{text}</button>
        ))}
      </div>
    </div>
  );
}

function Inspector({ u }: { u: AdminUserProfile }) {
  const { toast } = useToast();
  const profile = useUserPatch(u), tier = useUserPatch(u), perms = useUserPatch(u), freeze = useUserPatch(u);
  const [credit, setCredit] = useState<null | 'grant' | 'deposit' | 'card'>(null);
  const [debit, setDebit] = useState<null | 'grant' | 'deposit' | 'card'>(null);
  const [doc, setDoc] = useState<AdminUserProfile['documents'][number] | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (avatar) URL.revokeObjectURL(avatar); }, [avatar]);
  const frozen = u.status === 'Frozen';
  const f = useForm<z.infer<typeof profSchema>>({ resolver: zodResolver(profSchema), defaultValues: { name: u.name, phone: u.phone, telegram: u.telegram } });
  useEffect(() => { f.reset({ name: u.name, phone: u.phone, telegram: u.telegram }); }, [u.name, u.phone, u.telegram, f]);
  const permList = [
    ['withdrawalKycRequired', 'Withdrawal requires KYC'], ['depositKycRequired', 'Deposit requires KYC'],
  ] as const;
  const savingPerm = perms.pending ? Object.keys(perms.variables?.data.permissions ?? {}).find((k) => perms.variables?.data.permissions?.[k as keyof typeof u.permissions] !== u.permissions[k as keyof typeof u.permissions]) : undefined;
  return (
    <div className="space-y-5">
      <section className={cx(card, 'flex flex-wrap items-center gap-4 p-5')} data-testid="section-user-header">
        <div className="relative">
          <span className="grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-[#111] font-display text-xl font-bold text-[#C6F432]" data-testid="avatar-inspector">{avatar ?? u.avatarUrl ? <img src={avatar ?? u.avatarUrl} alt={avatar ? `${u.name} avatar preview` : `${u.name} profile photo`} className="h-full w-full object-cover" /> : initials(u.name)}</span>
          <button aria-label="Choose avatar (preview only, not uploaded)" title="Preview only, not uploaded" data-testid="button-avatar-upload" onClick={() => file.current?.click()} className="press absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-[#C6F432] text-[#111] ring-2 ring-white"><Camera className="h-3.5 w-3.5" /></button>
          <input ref={file} type="file" accept="image/*" hidden data-testid="input-avatar-file" onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ''; if (fl) { setAvatar(URL.createObjectURL(fl)); toast({ title: 'Avatar preview only', description: 'Not uploaded. The applicant can set their photo in Settings.' }); } }} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-bold" data-testid="text-user-name">{u.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <StatusBadge status={u.verificationLevel} testid="badge-verification" /><StatusBadge status={u.status} testid="badge-user-status" />
            <span className="font-num" data-testid="text-masked-id">{u.maskedId}</span><span className="font-num text-xs text-slate-500">{u.id}</span><span>{u.organization}</span>
          </div>
        </div>
        <button data-testid="button-toggle-freeze" disabled={freeze.pending} onClick={() => freeze.run({ status: frozen ? 'Active' : 'Frozen' }, frozen ? 'Account unfrozen' : 'Account frozen')} className={cx('press inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60', frozen ? 'bg-[#C6F432] text-[#111]' : 'bg-red-700 text-white')}>
          {freeze.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Snowflake className="h-4 w-4" />}{frozen ? 'Unfreeze account' : 'Freeze account'}
        </button>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <form className={cx(card, 'space-y-3 p-5')} data-testid="form-user-profile" onSubmit={f.handleSubmit((v) => profile.run(v, 'Profile saved'))}>
          <h3 className="font-display font-bold">Personal information</h3>
          <Field label="Full name" error={f.formState.errors.name?.message}><input data-testid="input-user-name" className={ainput} {...f.register('name')} /></Field>
          <Field label="Email (locked)"><div className="relative"><input data-testid="input-user-email" disabled readOnly value={u.email} className={ainput} /><Lock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /></div></Field>
          <Field label="Phone" error={f.formState.errors.phone?.message}><input data-testid="input-user-phone" className={ainput} {...f.register('phone')} /></Field>
          <Field label="Telegram" error={f.formState.errors.telegram?.message}><input data-testid="input-user-telegram" className={ainput} {...f.register('telegram')} /></Field>
          <button data-testid="button-save-user" disabled={profile.pending || !f.formState.isDirty} className={lime}>{profile.pending ? 'Saving…' : 'Save Updates'}</button>
        </form>

        <div className={cx(card, 'space-y-4 p-5')}>
          <h3 className="font-display font-bold">Access controls</h3>
          <div role="radiogroup" aria-label="Tier" className="grid grid-cols-3 gap-2" data-testid="group-tier">
            {[1, 2, 3].map((t) => {
              const saving = tier.pending && tier.variables?.data.tier === t;
              return <button key={t} role="radio" aria-checked={u.tier === t} data-testid={`button-tier-${t}`} disabled={tier.pending} onClick={() => u.tier !== t && tier.run({ tier: t }, `Tier set to Level ${t}`)} className={cx('press inline-flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-semibold transition', u.tier === t ? 'border-[#111] bg-[#111] text-[#C6F432]' : 'border-slate-300 hover:border-[#111]')}>{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Level {t}</button>;
            })}
          </div>
          {permList.map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
              <span id={`label-${k}`} className="flex items-center gap-2">{label}{savingPerm === k && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-label="Saving" />}</span>
              {/* All switches wait while one saves: each update sends the full permission set. */}
              <button type="button" role="switch" aria-checked={u.permissions[k]} aria-labelledby={`label-${k}`} data-testid={`switch-${k}`} disabled={perms.pending} onClick={() => perms.run({ permissions: { ...u.permissions, [k]: !u.permissions[k] } }, `${label} ${u.permissions[k] ? 'off' : 'on'}`)}
                className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-70', u.permissions[k] ? 'bg-[#111]' : 'bg-slate-300')}>
                <span className={cx('absolute top-0.5 h-5 w-5 rounded-full transition-all', u.permissions[k] ? 'left-[22px] bg-[#C6F432]' : 'left-0.5 bg-white')} />
              </button>
            </div>
          ))}
          <NotificationOverride u={u} perms={perms} k="emailOverride" label="Email notifications"
            userChoice={`User's choice (${u.permissions.emailNotifications ? 'on' : 'off'})`} />
          <NotificationOverride u={u} perms={perms} k="inAppOverride" label="In-app notifications" userChoice="User's choice (on)" />
        </div>
      </div>

      <UserWithdrawalLimits u={u} />

      <section className={cx(card, 'p-5')} data-testid="section-balances">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-display font-bold">Balances and cards</h3><span className="text-xs text-slate-500">Sample balances. Credits and debits write a ledger entry; no real transfer.</span></div>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['grant', 'deposit', 'card'] as const).map((a) => (
            <div key={a} className="rounded-xl bg-[#F4F5F8] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{a} account</p>
              <p className="font-num my-1 text-xl font-semibold" data-testid={`text-balance-${a}`}>{money(u.balances[a])}</p>
              <div className="flex flex-wrap gap-2">
                <button data-testid={`button-adjust-${a}`} onClick={() => setCredit(a)} className={cx(dark, 'inline-flex min-h-11 items-center gap-1 text-xs md:min-h-0 md:!py-1.5')}><Plus className="h-3.5 w-3.5" />Credit</button>
                <button data-testid={`button-debit-${a}`} disabled={u.balances[a] <= 0} title={u.balances[a] <= 0 ? 'Nothing to remove' : undefined} onClick={() => setDebit(a)} className={cx(ghost, 'inline-flex min-h-11 items-center gap-1 text-xs md:min-h-0 md:!py-1.5')}><Minus className="h-3.5 w-3.5" />Debit</button>
              </div>
            </div>
          ))}
        </div>
        <CardControls u={u} onTopUp={() => setCredit('card')} />
      </section>

      <UserApplications userId={u.id} />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={cx(card, 'p-5')} data-testid="section-kyc">
          <h3 className="mb-3 font-display font-bold">KYC documents</h3>
          {u.documents.length === 0 ? <Empty title="No documents submitted" /> : u.documents.map((d) => (
            <div key={d.id} className="mb-2 rounded-xl border p-3" data-testid={`row-doc-${d.id}`}>
              <button data-testid={`button-doc-${d.id}`} onClick={() => setDoc(d)} className="press flex w-full items-center gap-3 text-left">
                <FileText className="h-5 w-5 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate font-semibold hover:underline">{d.name}</span><span className="block text-xs text-slate-500">{d.kind} · {d.sample ? `Sample · OCR confidence (demo) ${d.confidence ?? 0}%` : `Uploaded ${dateFmt(d.submittedAt)} · not machine-checked`}</span></span><StatusBadge status={d.status} />
              </button>
              <div className="mt-2 pl-8"><KycDecision doc={d} /></div>
            </div>
          ))}
        </section>
        <section className={cx(card, 'p-5')} data-testid="section-audit">
          <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-display font-bold">Audit trail</h3><Link href={`/admin/audit?userId=${encodeURIComponent(u.id)}`} data-testid="link-user-audit" className="text-xs font-semibold hover:underline">View all</Link></div>
          {u.audit.length === 0 ? <Empty title="No audit entries" /> : <ul className="max-h-[28rem] space-y-3 overflow-y-auto">{u.audit.map((a) => <li key={a.id} data-testid={`row-audit-${a.id}`} className="border-l-2 border-[#C6F432] pl-3 text-sm"><p className="break-words font-semibold">{a.action}</p><p className="text-xs text-slate-500">{a.actor} · {dateFmt(a.createdAt)}</p></li>)}</ul>}
        </section>
      </div>

      <CreditModal open={!!credit} onClose={() => setCredit(null)} user={u} account={credit ?? 'grant'} />
      <CreditModal open={!!debit} onClose={() => setDebit(null)} user={u} account={debit ?? 'grant'} direction="debit" balances={u.balances} />
      <Modal open={!!doc} onClose={() => setDoc(null)} title={doc?.name ?? 'Document'} testid="dialog-document">
        {doc && <div className="space-y-4"><KycPreview doc={doc} userName={u.name} /><KycDecision doc={doc} onDone={() => setDoc(null)} /></div>}
      </Modal>
    </div>
  );
}

function UserApplications({ userId }: { userId: string }) {
  const q = useListAdminApplications({ userId });
  return (
    <section className={cx(card, 'p-5')} data-testid="section-user-applications">
      <h3 className="mb-3 font-display font-bold">Applications</h3>
      {q.isLoading ? <Skel className="h-24" /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
        : q.data.length === 0 ? <Empty title="No applications" />
        : (
          <ul className="divide-y">{q.data.map((a) => (
            <li key={a.id}>
              <Link href={appReviewHref(a)} data-testid={`link-user-app-${a.id}`} className="group flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:bg-[#F7FADC] sm:flex-nowrap sm:px-2">
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{a.title}</span><span className="block text-xs text-slate-500">{a.category} · {a.id} · {dateFmt(a.submittedAt)}</span></span>
                <span className="font-num text-sm font-semibold">{money(a.amount)}</span>
                <StatusBadge status={a.status} />
                <ChevronRight className="hidden h-4 w-4 text-slate-400 transition group-hover:translate-x-1 sm:block" />
              </Link>
            </li>
          ))}</ul>
        )}
    </section>
  );
}

/* ---------- Settings ---------- */
export function AdminSettingsPage() {
  const [confirm, setConfirm] = useState(false);
  return <DashGate title="Settings">{(d) => (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={cx(card, 'p-5')}>
        <SectionTitle>Global freeze</SectionTitle>
        <p className="mb-3 text-sm text-slate-600">Pauses every money movement on the platform: balance credits, approvals of deposits, withdrawals and grant awards, and new applicant deposit or withdrawal requests. Declining requests still works.</p>
        <div className="mb-4"><StatusBadge status={d.globalFrozen ? 'Frozen' : 'Off'} testid="status-global-freeze" /></div>
        <button data-testid="button-settings-freeze" className={d.globalFrozen ? lime : 'press rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800'} onClick={() => setConfirm(true)}>
          <span className="inline-flex items-center gap-1.5"><Snowflake className="h-4 w-4" />{d.globalFrozen ? 'Lift freeze' : 'Enable freeze'}</span>
        </button>
        <GlobalFreezeDialog open={confirm} onClose={() => setConfirm(false)} frozen={d.globalFrozen} />
      </section>
      <section className={cx(card, 'p-5')}>
        <SectionTitle>Security rules</SectionTitle>
        <ul className="space-y-3 text-sm">
          <li className="flex items-start justify-between gap-3"><span>Audit log, ledger and application history are append-only (edits and deletes are refused by the database)</span><StatusBadge status={d.systemHealth.auditLog} /></li>
          <li className="flex items-start justify-between gap-3"><span>4-eyes sign-off is not used: one finance administrator approves or declines each request.</span><StatusBadge status={d.systemHealth.fourEyes ? 'Active' : 'Not active'} /></li>
          <li className="flex items-start justify-between gap-3"><span>Approvals re-check freezes, balances and each user's KYC requirement at the moment of approval</span><StatusBadge status="Active" /></li>
          <li className="flex items-start gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 shrink-0" />Per-user KYC requirements, tiers, notification overrides and custom withdrawal limits are set on each user's profile.</li>
        </ul>
      </section>
      <GlobalWithdrawalLimits />
      <section className={cx(card, 'p-5')} data-testid="card-settings-audit">
        <SectionTitle>Audit log</SectionTitle>
        <p className="mb-4 text-sm text-slate-600">Every change made by administrators and applicants: approvals, declines, limits, freezes, profile and permission edits. Search, filter by user, admin or date, and export to CSV. Entries can't be edited or deleted.</p>
        <Link href="/admin/audit" data-testid="link-settings-audit" className={cx(lime, 'inline-flex items-center gap-1.5')}>Open audit log</Link>
      </section>
      <div className="lg:col-span-2"><AccountSecurity tone="admin" /></div>
    </div>
  )}</DashGate>;
}
