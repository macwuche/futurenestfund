import { useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useGetAdminDashboard, useListAdminUsers, useGetAdminUser, useUpdateAdminUser, useCreateUserBalanceAdjustment, useUpdateGlobalFreeze,
  getGetAdminDashboardQueryKey, getListAdminUsersQueryKey, getGetAdminUserQueryKey,
  type AdminUserProfile, type AdminUserSummary,
} from '@workspace/api-client-react';
import { Camera, ChevronRight, FileText, Plus, Snowflake, ArrowLeft, Lock } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Empty, ErrorState, Field, Modal, PageSkeleton, Skel, StatusBadge, cx, dateFmt, initials, money } from '@/components/bits';
import { useDemo } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

const card = 'rounded-2xl border border-[#E2E8F0] bg-white shadow-sm';
const ainput = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#111] focus:ring-2 focus:ring-[#C6F432] disabled:bg-slate-100 disabled:text-slate-500';
const lime = 'press rounded-lg bg-[#C6F432] px-4 py-2 text-sm font-semibold text-[#111] hover:brightness-95 disabled:opacity-60';
const dark = 'press rounded-lg bg-[#111] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60';

function Stat({ label, value, id, accent }: { label: string; value: string | number; id: string; accent?: boolean }) {
  return (
    <div className={cx(card, 'lift p-4', accent && 'bg-[#111] text-white border-[#111]')}>
      <p className={cx('text-xs font-semibold uppercase tracking-wide', accent ? 'text-[#C6F432]' : 'text-slate-500')}>{label}</p>
      <p className="font-num mt-2 text-2xl font-semibold" data-testid={`stat-${id}`}>{value}</p>
    </div>
  );
}

function useDash() { return useGetAdminDashboard(); }
function DashGate({ title, children }: { title: string; children: (d: NonNullable<ReturnType<typeof useDash>['data']>) => ReactNode }) {
  const q = useDash();
  return <Shell admin title={title}>{q.isLoading ? <PageSkeleton /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : children(q.data)}</Shell>;
}

/* ---------- Overview ---------- */
export function AdminOverviewPage() {
  return <DashGate title="Dashboard">{(d) => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat id="total-users" label="Total users" value={d.totalUsers} accent />
        <Stat id="active-users" label="Active users" value={d.activeUsers} />
        <Stat id="grant-balances" label="Grant balances" value={money(d.totalGrantBalances)} />
        <Stat id="deposit-balances" label="Deposit balances" value={money(d.totalDepositBalances)} />
        <Stat id="pending-applications" label="Pending applications" value={d.pendingApplications} />
        <Stat id="pending-kyc" label="Pending KYC" value={d.pendingKyc} />
        <Stat id="pending-deposits" label="Pending deposits" value={d.pendingDeposits} />
        <Stat id="pending-withdrawals" label="Pending withdrawals" value={d.pendingWithdrawals} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className={cx(card, 'p-5')} data-testid="card-status-groups">
          <h2 className="mb-3 font-display font-bold">Applications by status</h2>
          {d.applicationsByStatus.map((s) => {
            const max = Math.max(1, ...d.applicationsByStatus.map((x) => x.count));
            return (
              <div key={s.status} className="mb-3" data-testid={`row-status-${s.status}`}>
                <div className="mb-1 flex justify-between text-sm"><span>{s.status}</span><span className="font-num font-semibold">{s.count}</span></div>
                <div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#111] transition-all duration-700" style={{ width: `${(s.count / max) * 100}%` }} /></div>
              </div>
            );
          })}
        </div>
        <div className={cx(card, 'p-5')} data-testid="card-system-health">
          <h2 className="mb-3 font-display font-bold">System health</h2>
          <ul className="space-y-3 text-sm">
            {([['API', d.systemHealth.api], ['Database', d.systemHealth.database], ['Audit log', d.systemHealth.auditLog]] as const).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between"><span>{k}</span><StatusBadge status={v} testid={`health-${k.toLowerCase().replace(' ', '-')}`} /></li>
            ))}
            <li className="flex items-center justify-between"><span>4-Eyes approval {d.systemHealth.fourEyes ? '' : '(not enabled, demo config)'}</span><StatusBadge status={d.systemHealth.fourEyes ? 'Active' : 'Pending'} testid="health-four-eyes" /></li>
            <li className="flex items-center justify-between"><span>Global freeze</span><StatusBadge status={d.globalFrozen ? 'Frozen' : 'Active'} testid="health-global-freeze" /></li>
          </ul>
        </div>
        <div className={cx(card, 'p-5')} data-testid="card-recent-activity">
          <h2 className="mb-3 font-display font-bold">Recent activity</h2>
          {d.recentActivity.length === 0 ? <Empty title="No activity" /> : (
            <ul className="space-y-3">{d.recentActivity.map((a) => (
              <li key={a.id} data-testid={`row-activity-${a.id}`} className="border-l-2 border-[#C6F432] pl-3 text-sm"><p className="font-semibold">{a.action}</p><p className="text-xs text-slate-500">{a.subject} · {dateFmt(a.createdAt)}</p></li>
            ))}</ul>
          )}
        </div>
      </div>
    </div>
  )}</DashGate>;
}

/* ---------- Users directory ---------- */
function UserTable({ items }: { items: AdminUserSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm" data-testid="table-users">
        <thead><tr className="border-b text-xs uppercase tracking-wide text-slate-500"><th className="py-2 pr-3">User</th><th>Tier</th><th>KYC</th><th>Status</th><th className="text-right">Grant</th><th className="text-right">Deposit</th><th /></tr></thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.id} data-testid={`row-user-${u.id}`} className="group border-b transition hover:bg-[#F7FADC]">
              <td className="py-3 pr-3"><Link href={`/admin/users/${u.id}`} data-testid={`link-user-${u.id}`} className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#111] text-xs font-bold text-[#C6F432]">{initials(u.name)}</span>
                <span><span className="block font-semibold">{u.name}</span><span className="block text-xs text-slate-500">{u.email} · {u.organization}</span></span></Link></td>
              <td className="font-num">L{u.tier}</td>
              <td><StatusBadge status={u.verificationLevel} /></td>
              <td><StatusBadge status={u.status} /></td>
              <td className="font-num text-right">{money(u.grantBalance)}</td>
              <td className="font-num text-right">{money(u.depositBalance)}</td>
              <td className="pl-2"><ChevronRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function AdminUsersPage() {
  const { adminSearch, setAdminSearch } = useDemo();
  const [status, setStatus] = useState<'all' | 'active' | 'frozen'>('all');
  const s = useDeferredValue(adminSearch);
  const q = useListAdminUsers({ search: s || undefined, status });
  return (
    <Shell admin title="Users">
      <div className={cx(card, 'p-5')}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input data-testid="input-user-search" value={adminSearch} onChange={(e) => setAdminSearch(e.target.value)} placeholder="Search name, email, organization" className={cx(ainput, 'sm:max-w-xs')} />
          <div role="group" aria-label="Status filter" className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
            {(['all', 'active', 'frozen'] as const).map((k) => <button key={k} aria-pressed={status === k} data-testid={`filter-status-${k}`} onClick={() => setStatus(k)} className={cx('press rounded-md px-3 py-1.5 capitalize transition', status === k ? 'bg-[#111] text-[#C6F432]' : 'text-slate-600')}>{k}</button>)}
          </div>
          <span className="ml-auto text-sm text-slate-500" data-testid="text-user-total">{q.data ? `${q.data.total} users` : ''}</span>
        </div>
        {q.isLoading ? <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skel key={i} className="h-14" />)}</div>
          : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
          : q.data.items.length === 0 ? <Empty title="No users match" hint="Try a different search or status filter." />
          : <UserTable items={q.data.items} />}
      </div>
    </Shell>
  );
}

/* ---------- Inspector ---------- */
const profSchema = z.object({ name: z.string().min(2, 'At least 2 characters').max(100), phone: z.string().max(40), telegram: z.string().max(80) });
const adjSchema = z.object({
  account: z.enum(['grant', 'deposit', 'card']),
  amount: z.coerce.number().min(0.01, 'Minimum $0.01'),
  reason: z.string().min(5, 'At least 5 characters').max(240),
});

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

function Inspector({ u }: { u: AdminUserProfile }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const upd = useUpdateAdminUser();
  const [adj, setAdj] = useState<null | 'grant' | 'deposit' | 'card'>(null);
  const [doc, setDoc] = useState<AdminUserProfile['documents'][number] | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetAdminUserQueryKey(u.id) });
    qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
    qc.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
  };
  const patch = (data: Parameters<typeof upd.mutate>[0]['data'], msg: string) =>
    upd.mutate({ userId: u.id, data }, { onSuccess: () => { refresh(); toast({ title: msg }); }, onError: () => toast({ title: 'Update failed', variant: 'destructive' }) });
  const frozen = u.status === 'Frozen';
  const f = useForm<z.infer<typeof profSchema>>({ resolver: zodResolver(profSchema), defaultValues: { name: u.name, phone: u.phone, telegram: u.telegram } });
  useEffect(() => { f.reset({ name: u.name, phone: u.phone, telegram: u.telegram }); }, [u.name, u.phone, u.telegram, f]);
  const perms = [
    ['emailNotifications', 'Email notifications'], ['withdrawalKycRequired', 'Withdrawal requires KYC'], ['depositKycRequired', 'Deposit requires KYC'],
  ] as const;
  return (
    <div className="space-y-5">
      <section className={cx(card, 'flex flex-wrap items-center gap-4 p-5')} data-testid="section-user-header">
        <div className="relative">
          <span className="grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-[#111] font-display text-xl font-bold text-[#C6F432]">{avatar ? <img src={avatar} alt={`${u.name} avatar preview`} className="h-full w-full object-cover" /> : initials(u.name)}</span>
          <button aria-label="Choose avatar (preview only, not uploaded)" title="Preview only, not uploaded" data-testid="button-avatar-upload" onClick={() => file.current?.click()} className="press absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-[#C6F432] text-[#111] ring-2 ring-white"><Camera className="h-3.5 w-3.5" /></button>
          <input ref={file} type="file" accept="image/*" hidden data-testid="input-avatar-file" onChange={(e) => { const fl = e.target.files?.[0]; if (fl) { setAvatar(URL.createObjectURL(fl)); toast({ title: 'Avatar preview only', description: 'Not uploaded to any server.' }); } }} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-bold" data-testid="text-user-name">{u.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <StatusBadge status={u.verificationLevel} testid="badge-verification" /><StatusBadge status={u.status} testid="badge-user-status" />
            <span className="font-num" data-testid="text-masked-id">{u.maskedId}</span><span>{u.organization}</span>
          </div>
        </div>
        <button data-testid="button-toggle-freeze" disabled={upd.isPending} onClick={() => patch({ status: frozen ? 'Active' : 'Frozen' }, frozen ? 'Account unfrozen' : 'Account frozen')} className={cx('press inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60', frozen ? 'bg-[#C6F432] text-[#111]' : 'bg-red-700 text-white')}>
          <Snowflake className="h-4 w-4" />{frozen ? 'Unfreeze account' : 'Freeze account'}
        </button>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <form className={cx(card, 'space-y-3 p-5')} data-testid="form-user-profile" onSubmit={f.handleSubmit((v) => patch(v, 'Profile saved'))}>
          <h3 className="font-display font-bold">Personal information</h3>
          <Field label="Full name" error={f.formState.errors.name?.message}><input data-testid="input-user-name" className={ainput} {...f.register('name')} /></Field>
          <Field label="Email (locked)"><div className="relative"><input data-testid="input-user-email" disabled readOnly value={u.email} className={ainput} /><Lock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /></div></Field>
          <Field label="Phone" error={f.formState.errors.phone?.message}><input data-testid="input-user-phone" className={ainput} {...f.register('phone')} /></Field>
          <Field label="Telegram" error={f.formState.errors.telegram?.message}><input data-testid="input-user-telegram" className={ainput} {...f.register('telegram')} /></Field>
          <button data-testid="button-save-user" disabled={upd.isPending} className={lime}>{upd.isPending ? 'Saving...' : 'Save Updates'}</button>
        </form>

        <div className={cx(card, 'space-y-4 p-5')}>
          <h3 className="font-display font-bold">Access controls</h3>
          <div role="radiogroup" aria-label="Tier" className="grid grid-cols-3 gap-2" data-testid="group-tier">
            {[1, 2, 3].map((t) => <button key={t} role="radio" aria-checked={u.tier === t} data-testid={`button-tier-${t}`} disabled={upd.isPending} onClick={() => u.tier !== t && patch({ tier: t }, `Tier set to Level ${t}`)} className={cx('press rounded-lg border py-2 text-sm font-semibold transition', u.tier === t ? 'border-[#111] bg-[#111] text-[#C6F432]' : 'border-slate-300 hover:border-[#111]')}>Level {t}</button>)}
          </div>
          {perms.map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 text-sm">
              <span>{label}</span>
              <button type="button" role="switch" aria-checked={u.permissions[k]} aria-label={label} data-testid={`switch-${k}`} disabled={upd.isPending} onClick={() => patch({ permissions: { ...u.permissions, [k]: !u.permissions[k] } }, `${label} updated`)}
                className={cx('relative h-6 w-11 rounded-full transition-colors', u.permissions[k] ? 'bg-[#111]' : 'bg-slate-300')}>
                <span className={cx('absolute top-0.5 h-5 w-5 rounded-full transition-all', u.permissions[k] ? 'left-[22px] bg-[#C6F432]' : 'left-0.5 bg-white')} />
              </button>
            </label>
          ))}
        </div>
      </div>

      <section className={cx(card, 'p-5')} data-testid="section-balances">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-display font-bold">Balances and cards</h3><span className="text-xs text-slate-500">Demo ledger adjustments only. No real transfer.</span></div>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['grant', 'deposit', 'card'] as const).map((a) => (
            <div key={a} className="rounded-xl bg-[#F4F5F8] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{a} account</p>
              <p className="font-num my-1 text-xl font-semibold" data-testid={`text-balance-${a}`}>{money(u.balances[a])}</p>
              <button data-testid={`button-adjust-${a}`} onClick={() => setAdj(a)} className={cx(dark, 'inline-flex items-center gap-1 !py-1.5 text-xs')}><Plus className="h-3.5 w-3.5" />Adjust</button>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {u.cards.length === 0 && <Empty title="No cards issued" />}
          {u.cards.map((c) => (
            <div key={c.id} data-testid={`card-user-${c.id}`} className={cx('lift flex items-center justify-between gap-3 rounded-xl p-4', c.kind === 'Physical' ? 'bg-[#111] text-white' : 'bg-gradient-to-br from-slate-800 to-slate-600 text-white')}>
              <div><p className="text-sm font-semibold">{c.kind} {c.network} <span className="font-num opacity-70">•• {c.lastFour}</span></p><p className="font-num text-lg" data-testid={`text-user-card-balance-${c.id}`}>{money(c.balance)}</p><StatusBadge status={c.status} /></div>
              <button data-testid={`button-topup-${c.id}`} disabled={c.status !== 'Active'} title={c.status === 'Active' ? 'Top up the demo card account' : 'Card must be active before funding'} onClick={() => setAdj('card')} className="press rounded-lg bg-[#C6F432] px-3 py-1.5 text-xs font-semibold text-[#111] disabled:cursor-not-allowed disabled:opacity-50">{c.status === 'Pending' ? 'Awaiting issuance' : 'Top up'}</button>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={cx(card, 'p-5')} data-testid="section-kyc">
          <h3 className="mb-3 font-display font-bold">KYC documents</h3>
          <p className="mb-2 text-xs text-slate-500">Sample documents only. Nothing is uploaded to a server.</p>
          {u.documents.length === 0 ? <Empty title="No documents submitted" /> : u.documents.map((d) => (
            <button key={d.id} data-testid={`button-doc-${d.id}`} onClick={() => setDoc(d)} className="press mb-2 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition hover:border-[#111] hover:bg-[#F7FADC]">
              <FileText className="h-5 w-5" /><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{d.name}</span><span className="block text-xs text-slate-500">{d.kind} · OCR confidence (demo) {d.confidence}%</span></span><StatusBadge status={d.status} />
            </button>
          ))}
        </section>
        <section className={cx(card, 'p-5')} data-testid="section-audit">
          <h3 className="mb-3 font-display font-bold">Audit trail</h3>
          {u.audit.length === 0 ? <Empty title="No audit entries" /> : <ul className="space-y-3">{u.audit.map((a) => <li key={a.id} data-testid={`row-audit-${a.id}`} className="border-l-2 border-[#C6F432] pl-3 text-sm"><p className="font-semibold">{a.action}</p><p className="text-xs text-slate-500">{a.actor} · {dateFmt(a.createdAt)}</p></li>)}</ul>}
        </section>
      </div>

      <AdjustModal u={u} account={adj} onClose={() => setAdj(null)} onDone={refresh} />
      <Modal open={!!doc} onClose={() => setDoc(null)} title={doc?.name ?? 'Document'} testid="dialog-document">
        {doc && (
          <div>
            <div className="relative grid aspect-[1.5/1] place-items-center overflow-hidden rounded-xl bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_10px,#e2e8f0_10px,#e2e8f0_20px)]">
              <span className="rotate-[-12deg] rounded border-2 border-slate-400 px-4 py-2 font-display text-2xl font-extrabold uppercase tracking-widest text-slate-400">Sample document</span>
            </div>
            <p className="mt-3 text-sm font-semibold" data-testid="text-doc-label">Sample document: {doc.kind}</p>
            <div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#111]" style={{ width: `${doc.confidence}%` }} /></div>
            <p className="mt-1 text-xs text-slate-500" data-testid="text-doc-confidence">OCR confidence {doc.confidence}% is demonstration data, not a real scan.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function AdjustModal({ u, account, onClose, onDone }: { u: AdminUserProfile; account: null | 'grant' | 'deposit' | 'card'; onClose: () => void; onDone: () => void }) {
  const m = useCreateUserBalanceAdjustment();
  const { toast } = useToast();
  const f = useForm<z.input<typeof adjSchema>, unknown, z.output<typeof adjSchema>>({ resolver: zodResolver(adjSchema), defaultValues: { account: 'grant', amount: 100, reason: '' } });
  useEffect(() => { if (account) f.reset({ account, amount: 100, reason: '' }); }, [account, f]);
  return (
    <Modal open={!!account} onClose={onClose} title="Demo ledger adjustment" testid="dialog-adjustment">
      <form className="space-y-3" onSubmit={f.handleSubmit((v) => m.mutate({ userId: u.id, data: v }, {
        onSuccess: () => { onDone(); toast({ title: `Added ${money(v.amount)} to ${v.account} ledger (demo)` }); onClose(); },
        onError: (e) => toast({ title: 'Adjustment refused', description: (e as { data?: { error?: string; message?: string }; message?: string })?.data?.error ?? (e as { data?: { message?: string } })?.data?.message ?? 'Refused: platform is frozen or the account is not Active.', variant: 'destructive' }),
      }))}>
        <p className="rounded-lg bg-[#F7FADC] p-3 text-xs text-slate-700">Credits the demo ledger for {u.name} and writes an audit entry. Refused while the global freeze is on or the account is not Active. No real transfer occurs.</p>
        <Field label="Account"><select data-testid="select-adjust-account" className={ainput} {...f.register('account')}><option value="grant">Grant</option><option value="deposit">Deposit</option><option value="card">Card</option></select></Field>
        <Field label="Amount (USD)" error={f.formState.errors.amount?.message}><input data-testid="input-adjust-amount" type="number" step="any" className={ainput} {...f.register('amount')} /></Field>
        <Field label="Reason" error={f.formState.errors.reason?.message}><textarea data-testid="input-adjust-reason" className={cx(ainput, 'h-20')} {...f.register('reason')} /></Field>
        <button data-testid="button-submit-adjustment" disabled={m.isPending} className={cx(lime, 'w-full')}>{m.isPending ? 'Recording...' : 'Record adjustment'}</button>
      </form>
    </Modal>
  );
}

/* ---------- Supporting admin views ---------- */
function UsersView({ title, filter, cols }: { title: string; filter?: (u: AdminUserSummary) => boolean; cols?: (u: AdminUserSummary) => ReactNode }) {
  const q = useListAdminUsers();
  const items = q.data?.items.filter(filter ?? (() => true)) ?? [];
  return (
    <Shell admin title={title}>
      <div className={cx(card, 'p-5')}>
        {q.isLoading ? <PageSkeleton /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : items.length === 0 ? <Empty title="Nothing in this queue" /> : cols ? (
          <ul className="divide-y" data-testid="list-queue">{items.map((u) => (
            <li key={u.id} data-testid={`row-queue-${u.id}`} className="flex flex-wrap items-center gap-3 py-3">
              <Link href={`/admin/users/${u.id}`} data-testid={`link-queue-${u.id}`} className="min-w-0 flex-1 font-semibold hover:underline">{u.name}<span className="block text-xs font-normal text-slate-500">{u.organization}</span></Link>
              {cols(u)}
            </li>))}</ul>
        ) : <UserTable items={items} />}
      </div>
    </Shell>
  );
}
export const AdminDepositsPage = () => (
  <DashGate title="Deposit Page">{(d) => (
    <div className="space-y-4">
      <Stat id="queue-pending-deposits" label="Pending deposits" value={d.pendingDeposits} accent />
      <UsersViewInner cols={(u) => <><span className="font-num text-sm">{money(u.depositBalance)}</span><Link href={`/admin/users/${u.id}`} data-testid={`link-inject-${u.id}`} className={cx(dark, '!py-1.5 text-xs')}>Adjust in inspector</Link></>} />
    </div>
  )}</DashGate>
);
export const AdminWithdrawalsPage = () => (
  <DashGate title="Withdrawal Page">{(d) => (
    <div className="space-y-4">
      <Stat id="queue-pending-withdrawals" label="Awaiting 4-eyes sign-off" value={d.pendingWithdrawals} accent />
      <UsersViewInner cols={(u) => <><span className="font-num text-sm">{money(u.grantBalance)}</span><StatusBadge status={u.status} /></>} />
    </div>
  )}</DashGate>
);
export const AdminTransactionsPage = () => (
  <DashGate title="Transactions">{(d) => (
    <div className={cx(card, 'p-5')}>
      <p className="mb-3 text-sm text-slate-600">Ledger activity feed from sample records. Open a user to see their full audit trail.</p>
      {d.recentActivity.length === 0 ? <Empty title="No ledger activity" /> : (
        <ul className="divide-y" data-testid="list-ledger">{d.recentActivity.map((a) => <li key={a.id} data-testid={`row-ledger-${a.id}`} className="flex justify-between gap-3 py-3 text-sm"><span><b>{a.action}</b><span className="block text-xs text-slate-500">{a.subject}</span></span><span className="text-xs text-slate-500">{dateFmt(a.createdAt)}</span></li>)}</ul>
      )}
    </div>
  )}</DashGate>
);
export const AdminKycPage = () => (
  <UsersView title="KYC Page" filter={(u) => u.verificationLevel !== 'Verified'} cols={(u) => <><StatusBadge status={u.verificationLevel} /><Link href={`/admin/users/${u.id}`} data-testid={`link-review-${u.id}`} className={cx(lime, '!py-1.5 text-xs')}>Inspect documents</Link></>} />
);
function UsersViewInner({ cols }: { cols: (u: AdminUserSummary) => ReactNode }) {
  const q = useListAdminUsers();
  return (
    <div className={cx(card, 'p-5')}>
      {q.isLoading ? <PageSkeleton /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? <Empty title="No accounts" /> : (
        <ul className="divide-y" data-testid="list-queue">{q.data.items.map((u) => (
          <li key={u.id} data-testid={`row-queue-${u.id}`} className="flex flex-wrap items-center gap-3 py-3">
            <Link href={`/admin/users/${u.id}`} data-testid={`link-queue-${u.id}`} className="min-w-0 flex-1 font-semibold hover:underline">{u.name}<span className="block text-xs font-normal text-slate-500">{u.organization}</span></Link>
            {cols(u)}
          </li>))}</ul>
      )}
    </div>
  );
}

export function AdminSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useUpdateGlobalFreeze();
  return <DashGate title="Settings">{(d) => (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={cx(card, 'p-5')}>
        <h2 className="font-display font-bold">Global freeze</h2>
        <p className="my-2 text-sm text-slate-600">Demo flag that represents pausing platform-wide ledger activity.</p>
        <div className="mb-4"><StatusBadge status={d.globalFrozen ? 'Frozen' : 'Active'} testid="status-global-freeze" /></div>
        <button data-testid="button-settings-freeze" disabled={m.isPending} className={lime} onClick={() => m.mutate({ data: { frozen: !d.globalFrozen, reason: 'Toggled from settings (demo)' } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() }); toast({ title: 'Freeze state updated' }); }, onError: () => toast({ title: 'Update failed', variant: 'destructive' }) })}>{d.globalFrozen ? 'Lift freeze' : 'Enable freeze'}</button>
      </div>
      <div className={cx(card, 'p-5')}>
        <h2 className="font-display font-bold">Security rules</h2>
        <ul className="mt-3 space-y-3 text-sm">
          <li className="flex justify-between"><span>4-eyes sign-off (real two-person authorization is not enabled)</span><StatusBadge status={d.systemHealth.fourEyes ? 'Active' : 'Pending'} /></li>
          <li className="flex justify-between"><span>Audit log</span><StatusBadge status={d.systemHealth.auditLog} /></li>
          <li className="text-xs text-slate-500">Per-user KYC requirements and tiers are managed in each user inspector.</li>
        </ul>
      </div>
    </div>
  )}</DashGate>;
}
