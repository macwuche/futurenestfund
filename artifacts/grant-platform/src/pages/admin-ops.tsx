import { useDeferredValue, useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import {
  useListAdminRequests, useApproveAdminRequest, useRejectAdminRequest, useListAdminTransactions, getListAdminTransactionsQueryKey, getExportAdminTransactionsUrl,
  useListAdminUsers, useListAdminAudit, getListAdminAuditQueryKey, getExportAdminAuditUrl, useGetAdminKycQueue, useGetAdminApplication, useDecideAdminApplication, getGetAdminApplicationQueryKey,
  type AdminRequest, type AdminKycItem, type ListAdminTransactionsType, type ApplicationDecisionInputStatus,
} from '@workspace/api-client-react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, FileText, Plus, Info, X } from 'lucide-react';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { Shell } from '@/components/shell';
import { PlanLogo } from '@/components/grant-plan';
import { balanceName, Empty, ErrorState, Field, Modal, PageSkeleton, Skel, StatusBadge, cx, dateFmt, fileSize, money, statusLabel } from '@/components/bits';
import { card, ainput, lime, dark, ghost, danger, Stat, SectionTitle, useAdminRefresh, ReasonModal, KycPreview, KycDecision, CreditModal } from '@/components/admin-bits';
import { apiError } from '@/lib/demo-state';
import { RequestDetails } from '@/components/payment-method';
import { useToast } from '@/hooks/use-toast';

/** User dropdowns list everyone by name (up to 500; a searchable picker would replace them beyond that). */
const USER_PICKER = { pageSize: 500, sort: 'name' } as const;
const dateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const signed = (n: number) => `${n < 0 ? '−' : '+'}${money(Math.abs(n))}`;

/* ================================================================== */
/* Deposit Page and Withdrawal Page: request queues                    */
/* ================================================================== */

function RequestQueuePage({ kind }: { kind: 'Deposit' | 'Withdrawal' }) {
  const pending = useListAdminRequests({ kind, status: 'pending' });
  const decided = useListAdminRequests({ kind, status: 'decided' });
  const users = useListAdminUsers(USER_PICKER);
  const [inject, setInject] = useState(false);
  const deposit = kind === 'Deposit';
  const total = pending.data?.reduce((s, r) => s + r.amount, 0) ?? 0;
  return (
    <Shell admin title={deposit ? 'Deposit Page' : 'Withdrawal Page'}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat id={`queue-pending-${kind.toLowerCase()}s`} accent label={deposit ? 'Pending deposits' : 'Pending withdrawals'} value={pending.data?.length ?? '–'} />
          <Stat id={`queue-total-${kind.toLowerCase()}s`} label="Amount waiting" value={pending.data ? money(total) : '–'} />
        </div>
        {!deposit && (
          <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600" data-testid="text-four-eyes-note">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />Your approval releases the payout. The applicant is told in the app and by email, whether you approve or decline.
          </p>
        )}
        <section className={cx(card, 'p-5')} data-testid="section-request-queue">
          <SectionTitle action={deposit && <button data-testid="button-manual-injection" onClick={() => setInject(true)} className={cx(dark, 'inline-flex items-center gap-1.5 !py-1.5 text-xs')}><Plus className="h-3.5 w-3.5" />Manual balance injection</button>}>
            {deposit ? 'Deposits awaiting approval' : 'Payouts awaiting sign-off'}
          </SectionTitle>
          <p className="-mt-2 mb-4 text-xs text-slate-500">
            {deposit ? 'Approving credits the account balance and writes a ledger entry.' : 'Approving pays the amount out of the balance the applicant chose (grant or deposit) and writes a ledger entry.'} Oldest first. No real money moves.
          </p>
          {pending.isLoading ? <div className="space-y-2">{[1, 2].map((i) => <Skel key={i} className="h-16" />)}</div>
            : pending.isError || !pending.data ? <ErrorState onRetry={() => pending.refetch()} />
            : pending.data.length === 0 ? <Empty title="Queue is clear" hint={`New ${kind.toLowerCase()} requests from applicants appear here.`} />
            : <ul className="space-y-3" data-testid="list-queue">{pending.data.map((r) => <RequestRow key={r.id} r={r} />)}</ul>}
        </section>
        <section className={cx(card, 'p-5')} data-testid="section-request-history">
          <SectionTitle>Recent decisions</SectionTitle>
          {decided.isLoading ? <Skel className="h-24" /> : decided.isError || !decided.data ? <ErrorState onRetry={() => decided.refetch()} />
            : decided.data.length === 0 ? <Empty title="No decisions yet" />
            : (
              <>
              <ul className="divide-y md:hidden" data-testid="list-decided">{decided.data.map((r) => (
                <li key={r.id} className="py-3" data-testid={`card-decided-${r.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0"><Link href={`/admin/users/${r.userId}`} className="block truncate font-semibold hover:underline">{r.userName}</Link><span className="block text-xs text-slate-500">{dateFmt(r.createdAt)} · ref <span className="font-num">{r.reference}</span>{r.method ? ` · ${r.method.name}` : ''}{r.source === 'deposit' ? ' · from account balance' : ''}</span></span>
                    <span className="shrink-0 text-right"><span className="font-num block font-semibold">{money(r.amount)}</span><StatusBadge status={r.status === 'Completed' ? 'Approved' : r.status} /></span>
                  </div>
                  {(r.reviewNote ?? r.note) && <p className="mt-1 text-xs text-slate-600">{r.reviewNote ?? r.note}</p>}
                  <p className="mt-0.5 text-xs text-slate-500">{r.reviewedAt ? `${dateTime(r.reviewedAt)} · ` : ''}{r.reviewedBy}</p>
                </li>
              ))}</ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead><tr className="border-b text-xs uppercase tracking-wide text-slate-500"><th className="py-2 pr-3">User</th><th className="text-right">Amount</th><th className="pl-4">Decision</th><th>Reviewed</th><th>Note</th></tr></thead>
                  <tbody>{decided.data.map((r) => (
                    <tr key={r.id} className="border-b align-top" data-testid={`row-decided-${r.id}`}>
                      <td className="py-2.5 pr-3"><Link href={`/admin/users/${r.userId}`} className="font-semibold hover:underline">{r.userName}</Link><span className="block text-xs text-slate-500">{dateFmt(r.createdAt)} · ref <span className="font-num">{r.reference}</span>{r.method ? ` · ${r.method.name}` : ''}{r.source === 'deposit' ? ' · from account balance' : ''}</span></td>
                      <td className="font-num py-2.5 text-right">{money(r.amount)}</td>
                      <td className="py-2.5 pl-4"><StatusBadge status={r.status === 'Completed' ? 'Approved' : r.status} /></td>
                      <td className="py-2.5 text-xs text-slate-500">{r.reviewedAt ? dateTime(r.reviewedAt) : '–'}<span className="block">{r.reviewedBy}</span></td>
                      <td className="max-w-[16rem] py-2.5 text-xs text-slate-600">{r.reviewNote ?? r.note}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              </>
            )}
        </section>
      </div>
      {deposit && <CreditModal open={inject} onClose={() => setInject(false)} account="deposit" users={users.data?.items} />}
    </Shell>
  );
}

/** Why an approval would be refused right now, so the button can say so before the server does. */
function blocker(r: AdminRequest) {
  if (r.userStatus === 'Frozen') return 'Account is frozen';
  if (r.kycRequired && r.verificationLevel !== 'Verified') return 'Identity not verified';
  if (r.kind === 'Withdrawal') {
    const src = r.source ?? 'grant';
    if (r.withdrawalSources !== 'both' && r.withdrawalSources !== src) return `Withdrawals from the ${balanceName(src)} balance are closed for this user`;
    if (src === 'deposit' && r.amount + r.fee > r.depositBalance) return r.fee ? 'Amount + fee more than the account balance' : 'More than the account balance';
    if (src === 'grant' && r.amount > r.grantBalance) return 'More than the grant balance';
    if (src === 'grant' && r.fee > r.depositBalance) return 'Fee more than the account balance';
  }
  return '';
}

/** The applicant's payment proof: an image preview, or a link (PDFs download). */
function ProofPreview({ url, name }: { url: string; name: string }) {
  const [isImage, setIsImage] = useState(true);
  return (
    <div className="mt-2">
      {isImage && (
        <a href={url} target="_blank" rel="noopener" className="block max-w-xs overflow-hidden rounded-lg border bg-slate-50">
          <img src={url} alt={`Payment proof from ${name}`} className="max-h-48 w-full object-contain" onError={() => setIsImage(false)} data-testid="img-proof-preview" />
        </a>
      )}
      <a href={`${url}?download`} className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-semibold underline" data-testid="link-proof-download"><Download className="h-3.5 w-3.5" />{isImage ? 'Download proof' : 'Download payment proof (PDF)'}</a>
    </div>
  );
}

function RequestRow({ r }: { r: AdminRequest }) {
  const approve = useApproveAdminRequest();
  const reject = useRejectAdminRequest();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState('');
  const why = blocker(r);
  const deposit = r.kind === 'Deposit';
  const src = deposit ? 'deposit' : r.source ?? 'grant';
  const srcBalance = src === 'deposit' ? r.depositBalance : r.grantBalance;
  const [note, setNote] = useState('');
  return (
    <li className="rounded-xl border border-[#E2E8F0] p-4" data-testid={`row-request-${r.id}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <Link href={`/admin/users/${r.userId}`} className="font-semibold hover:underline">{r.userName}</Link>
          <p className="text-xs text-slate-500">{r.organization} · requested {dateTime(r.createdAt)} · ref <span className="font-num" data-testid={`text-request-ref-${r.id}`}>{r.reference}</span></p>
          {r.note && <p className="mt-1 text-sm text-slate-700">“{r.note}”</p>}
          <RequestDetails method={r.method} details={r.details} source={deposit ? undefined : r.source} testid={`details-request-${r.id}`} />
          {r.proofUrl ? <ProofPreview url={r.proofUrl} name={r.userName} /> : deposit && r.method && <p className="mt-2 text-xs text-slate-500" data-testid={`text-no-proof-${r.id}`}>No payment proof attached.</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge status={r.verificationLevel} /><StatusBadge status={r.userStatus} />
            <span className="text-slate-500">{deposit ? `Account balance ${money(r.depositBalance)}` : `${src === 'deposit' ? 'Account' : 'Grant'} balance ${money(srcBalance)}`}</span>
          </div>
          {r.limitWarning && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" data-testid={`text-limit-warning-${r.id}`}>{r.limitWarning} Limits are checked when a request is placed; you can still approve it.</p>}
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="font-num text-xl font-semibold" data-testid={`text-request-amount-${r.id}`}>{money(r.amount)}</span>
          {r.fee > 0 && <span className="font-num text-right text-xs text-slate-600" data-testid={`text-request-fee-${r.id}`}>{deposit ? `Fee ${money(r.fee)} · credits ${money(r.net)}` : `Fee ${money(r.fee)} from account balance`}</span>}
          <div className="flex gap-2">
            <button data-testid={`button-reject-${r.id}`} onClick={() => { setError(''); setDeclining(true); }} className={cx(ghost, 'inline-flex items-center gap-1 !py-1.5 text-xs')}><X className="h-3.5 w-3.5" />Decline</button>
            <button data-testid={`button-approve-${r.id}`} disabled={!!why} title={why || undefined} onClick={() => { setError(''); setNote(''); setConfirm(true); }} className={cx(lime, 'inline-flex items-center gap-1 !py-1.5 text-xs disabled:cursor-not-allowed')}><Check className="h-3.5 w-3.5" />Approve</button>
          </div>
          {why && <p className="text-xs text-red-700" data-testid={`text-blocker-${r.id}`}>{why}</p>}
        </div>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Approve ${money(r.amount)} ${deposit ? 'deposit' : 'withdrawal'}?`} testid="dialog-approve-request">
        <p className="text-sm text-slate-600">
          {deposit ? `${r.userName}'s account balance goes from ${money(r.depositBalance)} to ${money(Math.round((r.depositBalance + r.net) * 100) / 100)}${r.fee ? ` (${money(r.amount)} less the ${money(r.fee)} fee)` : ''}.`
            : src === 'deposit'
              ? `${money(r.amount)}${r.fee ? ` and the ${money(r.fee)} fee` : ''} ${r.fee ? 'are' : 'is'} paid out of ${r.userName}'s account balance, leaving ${money(Math.round((srcBalance - r.amount - r.fee) * 100) / 100)}.`
              : `${money(r.amount)} is paid out of ${r.userName}'s grant balance, leaving ${money(Math.round((srcBalance - r.amount) * 100) / 100)}.${r.fee ? ` The ${money(r.fee)} fee comes from the account balance, leaving ${money(Math.round((r.depositBalance - r.fee) * 100) / 100)}.` : ''}`} A ledger entry and an audit record are written, and the applicant is notified in the app and by email (if their email notifications are on).
        </p>
        <Field label="Note for the applicant (optional)">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} rows={2} className={cx(ainput, 'mt-1')} data-testid="input-approve-note" placeholder="e.g. Received, thank you." />
        </Field>
        {error && <p role="alert" className="mt-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-approve-error">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button data-testid="button-approve-cancel" onClick={() => setConfirm(false)} className="press rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-100">Cancel</button>
          <button data-testid="button-approve-confirm" disabled={approve.isPending} className={dark} onClick={() => approve.mutate({ requestId: r.id, data: note.trim() ? { note: note.trim() } : {} }, {
            onSuccess: () => { refresh(); setConfirm(false); toast({ title: `${r.kind} approved`, description: `${money(r.amount)} · ${r.userName}` }); },
            onError: (e) => setError(apiError(e, 'The approval was refused.')),
          })}>{approve.isPending ? 'Approving…' : 'Approve'}</button>
        </div>
      </Modal>
      <ReasonModal open={declining} onClose={() => setDeclining(false)} testid="dialog-decline-request" title={`Decline ${money(r.amount)} ${deposit ? 'deposit' : 'withdrawal'}?`} confirmLabel="Decline request"
        intro={<p>No money moves{deposit ? '' : ' and the held amount is available to them again'}. {r.userName} is notified in the app and by email with your reason.</p>} pending={reject.isPending} error={error}
        onSubmit={(reason) => reject.mutate({ requestId: r.id, data: { reason } }, {
          onSuccess: () => { refresh(); setDeclining(false); toast({ title: `${r.kind} declined` }); },
          onError: (e) => setError(apiError(e, 'The request could not be declined.')),
        })} />
    </li>
  );
}

export const AdminDepositsPage = () => <RequestQueuePage kind="Deposit" />;
export const AdminWithdrawalsPage = () => <RequestQueuePage kind="Withdrawal" />;

/* ================================================================== */
/* Transactions: the ledger                                            */
/* ================================================================== */

const LEDGER_TYPES: { value: ListAdminTransactionsType; label: string }[] = [
  { value: 'all', label: 'All types' }, { value: 'Deposit', label: 'Deposits' }, { value: 'Withdrawal', label: 'Withdrawals' },
  { value: 'Grant award', label: 'Grant awards' }, { value: 'Top-up', label: 'Top-ups' }, { value: 'Debit', label: 'Debits' }, { value: 'Opening balance', label: 'Opening balances' },
  { value: 'Fee', label: 'Fees' }, { value: 'Application fee', label: 'Application fees' }, { value: 'Card purchase', label: 'Card purchases' }, { value: 'Card top-up', label: 'Card top-ups' },
];

export function AdminTransactionsPage() {
  const urlParams = new URLSearchParams(useSearch());
  const initial = urlParams.get('q') ?? '';
  const typeParam = urlParams.get('type');
  const initialType = LEDGER_TYPES.some((t) => t.value === typeParam) ? (typeParam as ListAdminTransactionsType) : 'all';
  const [type, setType] = useState<ListAdminTransactionsType>(initialType);
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState(initial);
  const [page, setPage] = useState(1);
  useEffect(() => { setSearch(initial); }, [initial]);
  const s = useDeferredValue(search.trim());
  const filters = { type, ...(userId ? { userId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(s ? { search: s } : {}) };
  useEffect(() => { setPage(1); }, [type, userId, from, to, s]);
  const badRange = !!from && !!to && from > to;
  const params = { ...filters, page };
  const q = useListAdminTransactions(params, { query: { enabled: !badRange, placeholderData: keepPreviousData, queryKey: getListAdminTransactionsQueryKey(params) } });
  const users = useListAdminUsers(USER_PICKER);
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const filtered = type !== 'all' || !!userId || !!from || !!to || !!s;
  return (
    <Shell admin title="Transactions">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat id="ledger-count" accent label={filtered ? 'Matching entries' : 'Ledger entries'} value={q.data?.total ?? '–'} />
          <Stat id="ledger-inflow" label="Money in" value={q.data ? money(q.data.inflow) : '–'} />
          <Stat id="ledger-outflow" label="Money out" value={q.data ? money(q.data.outflow) : '–'} />
        </div>
        <section className={cx(card, 'p-5')} data-testid="section-ledger">
          <SectionTitle action={
            <a data-testid="link-export-csv" href={getExportAdminTransactionsUrl(filters)} download className={cx(lime, 'inline-flex items-center gap-1.5 !py-1.5 text-xs', (badRange || q.data?.total === 0) && 'pointer-events-none opacity-50')} aria-disabled={badRange || q.data?.total === 0}>
              <Download className="h-3.5 w-3.5" />Export CSV
            </a>
          }>Immutable ledger</SectionTitle>
          <p className="-mt-2 mb-4 text-xs text-slate-500">Every credit and debit, newest first. Entries can't be edited or deleted. Dates are UTC; the export includes all matching entries (up to 10,000).</p>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Search"><input data-testid="input-ledger-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID, reason or user" className={ainput} /></Field>
            <Field label="Type"><select data-testid="select-ledger-type" value={type} onChange={(e) => setType(e.target.value as ListAdminTransactionsType)} className={ainput}>{LEDGER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
            <Field label="User"><select data-testid="select-ledger-user" value={userId} onChange={(e) => setUserId(e.target.value)} className={ainput}><option value="">All users</option>{users.data?.items.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="From"><input data-testid="input-ledger-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={ainput} /></Field>
            <Field label="To" error={badRange ? '“To” is before “From”.' : undefined}><input data-testid="input-ledger-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={ainput} /></Field>
          </div>
          {filtered && <button data-testid="button-ledger-clear" onClick={() => { setType('all'); setUserId(''); setFrom(''); setTo(''); setSearch(''); }} className="mb-3 text-xs font-semibold hover:underline">Clear filters</button>}
          {q.isLoading ? <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skel key={i} className="h-12" />)}</div>
            : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
            : q.data.items.length === 0 ? <Empty title="No matching entries" hint={filtered ? 'Try different filters.' : 'Approved deposits, withdrawals, grant awards and credits appear here.'} />
            : (
              <>
                {/* Phones: one card per entry, amount always visible, nothing scrolls sideways (finding AM1). */}
                <ul className="divide-y md:hidden" data-testid="list-ledger">{q.data.items.map((t) => (
                  <li key={t.id} className="py-3" data-testid={`card-ledger-${t.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <Link href={`/admin/users/${t.userId}`} className="block truncate font-semibold hover:underline">{t.userName}</Link>
                        <span className="block text-xs text-slate-500">{t.kind} · <span className="capitalize">{t.account}</span></span>
                      </span>
                      <span className={cx('font-num shrink-0 text-right font-semibold', t.amount < 0 ? 'text-slate-900' : 'text-[#166534]')} data-testid={`text-ledger-card-amount-${t.id}`}>{signed(t.amount)}</span>
                    </div>
                    <p className="mt-1 break-words text-sm text-slate-700">{t.reason}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {dateTime(t.createdAt)} · {t.actor}
                      {t.applicationId ? <> · <Link href={`/admin/users/${t.userId}/applications/${t.applicationId}`} className="font-num hover:underline">{t.applicationId}</Link></>
                        : t.requestId ? <> · <span className="font-num">Request {t.requestId.slice(0, 8)}</span></> : null}
                    </p>
                  </li>
                ))}</ul>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[820px] text-left text-sm" data-testid="table-ledger">
                    <thead><tr className="border-b text-xs uppercase tracking-wide text-slate-500"><th className="py-2 pr-3">Date</th><th>User</th><th>Type</th><th>Account</th><th>Reason</th><th className="text-right">Amount</th><th className="pl-4">Reference</th></tr></thead>
                    <tbody>{q.data.items.map((t) => (
                      <tr key={t.id} className="border-b align-top" data-testid={`row-ledger-${t.id}`}>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-slate-600">{dateTime(t.createdAt)}<span className="font-num block text-slate-400" title={t.id}>{t.id.slice(0, 8)}</span></td>
                        <td className="py-2.5"><Link href={`/admin/users/${t.userId}`} className="font-semibold hover:underline">{t.userName}</Link></td>
                        <td className="whitespace-nowrap py-2.5">{t.kind}</td>
                        <td className="py-2.5 capitalize">{t.account}</td>
                        <td className="max-w-[18rem] py-2.5 text-slate-700"><span className="break-words">{t.reason}</span><span className="block text-xs text-slate-500">{t.actor}</span></td>
                        <td className={cx('font-num whitespace-nowrap py-2.5 text-right font-semibold', t.amount < 0 ? 'text-slate-900' : 'text-[#166534]')} data-testid={`text-ledger-amount-${t.id}`}>{signed(t.amount)}</td>
                        <td className="font-num py-2.5 pl-4 text-xs">
                          {t.applicationId ? <Link href={`/admin/users/${t.userId}/applications/${t.applicationId}`} className="hover:underline">{t.applicationId}</Link>
                            : t.requestId ? <span title={t.requestId}>Request {t.requestId.slice(0, 8)}</span> : <span className="text-slate-400">–</span>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-500" data-testid="text-ledger-page">Page {q.data.page} of {pages}</span>
                  <div className="flex gap-2">
                    <button data-testid="button-ledger-prev" disabled={page <= 1} onClick={() => setPage(page - 1)} className={cx(ghost, 'inline-flex items-center gap-1 !py-1.5 text-xs')}><ChevronLeft className="h-3.5 w-3.5" />Previous</button>
                    <button data-testid="button-ledger-next" disabled={page >= pages} onClick={() => setPage(page + 1)} className={cx(ghost, 'inline-flex items-center gap-1 !py-1.5 text-xs')}>Next<ChevronRight className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </>
            )}
        </section>
      </div>
    </Shell>
  );
}

/* ================================================================== */
/* Audit log: every recorded change, filterable and exportable          */
/* ================================================================== */

const AUDIT_KEYS = ['search', 'userId', 'actor', 'from', 'to'] as const;
type AuditFilterState = Record<(typeof AUDIT_KEYS)[number], string>;

export function AdminAuditPage() {
  const query = useSearch();
  const [, navigate] = useLocation();
  // Filters live in the URL, so a link such as /admin/audit?userId=usr-jane opens the page already filtered.
  const fromUrl = (): AuditFilterState => { const u = new URLSearchParams(query); return Object.fromEntries(AUDIT_KEYS.map((k) => [k, u.get(k) ?? ''])) as AuditFilterState; };
  const [f, setF] = useState<AuditFilterState>(fromUrl);
  const [page, setPage] = useState(1);
  useEffect(() => { setF(fromUrl()); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof AuditFilterState, v: string) => {
    const next = { ...f, [k]: v };
    setF(next);
    const u = new URLSearchParams(Object.entries(next).filter(([, val]) => val));
    navigate(`/admin/audit${u.size ? `?${u}` : ''}`, { replace: true });
  };
  const s = useDeferredValue(f.search.trim());
  const filters = { ...(s ? { search: s } : {}), ...(f.userId ? { userId: f.userId } : {}), ...(f.actor ? { actor: f.actor } : {}), ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) };
  useEffect(() => { setPage(1); }, [s, f.userId, f.actor, f.from, f.to]);
  const badRange = !!f.from && !!f.to && f.from > f.to;
  const params = { ...filters, page };
  const q = useListAdminAudit(params, { query: { enabled: !badRange, placeholderData: keepPreviousData, queryKey: getListAdminAuditQueryKey(params) } });
  const users = useListAdminUsers(USER_PICKER);
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const filtered = Object.keys(filters).length > 0;
  return (
    <Shell admin title="Audit log">
      <section className={cx(card, 'p-5')} data-testid="section-audit">
        <SectionTitle action={
          <a data-testid="link-export-audit" href={getExportAdminAuditUrl(filters)} download className={cx(lime, 'inline-flex items-center gap-1.5 !py-1.5 text-xs', (badRange || q.data?.total === 0) && 'pointer-events-none opacity-50')} aria-disabled={badRange || q.data?.total === 0}>
            <Download className="h-3.5 w-3.5" />Export CSV
          </a>
        }>Audit log</SectionTitle>
        <p className="-mt-2 mb-4 text-xs text-slate-500">
          Every change made by administrators and applicants, newest first. Entries can't be edited or deleted. Dates are UTC; the export includes all matching entries (up to 10,000).
          {q.data && <> <span className="font-semibold text-slate-700" data-testid="text-audit-count">{q.data.total.toLocaleString('en-US')} {filtered ? 'matching' : ''} {q.data.total === 1 ? 'entry' : 'entries'}</span>.</>}
        </p>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Search"><input data-testid="input-audit-search" type="search" value={f.search} onChange={(e) => set('search', e.target.value)} placeholder="Action, user, admin or entry ID" className={ainput} /></Field>
          <Field label="User"><select data-testid="select-audit-user" value={f.userId} onChange={(e) => set('userId', e.target.value)} className={ainput}>
            <option value="">All users</option><option value="platform">Platform-wide (no user)</option>
            {users.data?.items.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            {f.userId && f.userId !== 'platform' && users.data && !users.data.items.some((u) => u.id === f.userId) && <option value={f.userId}>{f.userId}</option>}
          </select></Field>
          <Field label="Done by"><select data-testid="select-audit-actor" value={f.actor} onChange={(e) => set('actor', e.target.value)} className={ainput}>
            <option value="">Anyone</option>
            {q.data?.actors.map((a) => <option key={a} value={a}>{a}</option>)}
            {f.actor && q.data && !q.data.actors.includes(f.actor) && <option value={f.actor}>{f.actor}</option>}
          </select></Field>
          <Field label="From"><input data-testid="input-audit-from" type="date" value={f.from} max={f.to || undefined} onChange={(e) => set('from', e.target.value)} className={ainput} /></Field>
          <Field label="To" error={badRange ? '“To” is before “From”.' : undefined}><input data-testid="input-audit-to" type="date" value={f.to} min={f.from || undefined} onChange={(e) => set('to', e.target.value)} className={ainput} /></Field>
        </div>
        {filtered && <button data-testid="button-audit-clear" onClick={() => { setF({ search: '', userId: '', actor: '', from: '', to: '' }); navigate('/admin/audit', { replace: true }); }} className="mb-3 text-xs font-semibold hover:underline">Clear filters</button>}
        {q.isLoading ? <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skel key={i} className="h-12" />)}</div>
          : q.isError || !q.data ? <ErrorState message={apiError(q.error, 'The audit log could not be loaded.')} onRetry={() => q.refetch()} />
          : q.data.items.length === 0 ? <Empty title="No matching entries" hint={filtered ? 'Try different filters.' : 'Changes made in the app appear here.'} />
          : (
            <>
              {/* Phones get one card per entry, so the action is readable without scrolling sideways. */}
              <ul className="space-y-3 sm:hidden" data-testid="list-audit">{q.data.items.map((a) => (
                <li key={a.id} className="border-l-2 border-[var(--brand)] pl-3 text-sm" data-testid={`item-audit-entry-${a.id}`}>
                  <p className="break-words font-semibold text-slate-900">{a.action}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {a.userId ? <Link href={`/admin/users/${a.userId}`} className="font-semibold text-slate-700 hover:underline">{a.userName ?? a.userId}</Link> : 'Platform'}
                    {' · '}<span className="break-all">{a.actor}</span>{' · '}{dateTime(a.createdAt)} · <span className="font-num">{a.id.slice(0, 8)}</span>
                  </p>
                </li>
              ))}</ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[720px] text-left text-sm" data-testid="table-audit">
                  <thead><tr className="border-b text-xs uppercase tracking-wide text-slate-500"><th className="py-2 pr-3">Date</th><th className="pr-3">User</th><th className="pr-3">Action</th><th>Done by</th></tr></thead>
                  <tbody>{q.data.items.map((a) => (
                    <tr key={a.id} className="border-b align-top" data-testid={`row-audit-entry-${a.id}`}>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-slate-600">{dateTime(a.createdAt)}<span className="font-num block text-slate-400" title={a.id}>{a.id.slice(0, 8)}</span></td>
                      <td className="py-2.5 pr-3">{a.userId ? <Link href={`/admin/users/${a.userId}`} className="font-semibold hover:underline">{a.userName ?? a.userId}</Link> : <span className="text-slate-500">Platform</span>}</td>
                      <td className="max-w-[26rem] py-2.5 pr-3 text-slate-800"><span className="break-words">{a.action}</span></td>
                      <td className="py-2.5 text-xs text-slate-600"><span className="break-all">{a.actor}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500" data-testid="text-audit-page">Page {q.data.page} of {pages}</span>
                <div className="flex gap-2">
                  <button data-testid="button-audit-prev" disabled={page <= 1} onClick={() => setPage(page - 1)} className={cx(ghost, 'inline-flex items-center gap-1 !py-1.5 text-xs')}><ChevronLeft className="h-3.5 w-3.5" />Previous</button>
                  <button data-testid="button-audit-next" disabled={page >= pages} onClick={() => setPage(page + 1)} className={cx(ghost, 'inline-flex items-center gap-1 !py-1.5 text-xs')}>Next<ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </>
          )}
      </section>
    </Shell>
  );
}

/* ================================================================== */
/* KYC Page: global document queue                                     */
/* ================================================================== */

export function AdminKycPage() {
  const q = useGetAdminKycQueue();
  const [doc, setDoc] = useState<AdminKycItem | null>(null);
  const users = new Set(q.data?.pending.map((d) => d.userId));
  return (
    <Shell admin title="KYC Page">
      {q.isLoading ? <PageSkeleton /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat id="kyc-pending-docs" accent label="Documents to review" value={q.data.pending.length} />
            <Stat id="kyc-pending-users" label="Users waiting" value={users.size} />
          </div>
          <section className={cx(card, 'p-5')} data-testid="section-kyc-queue">
            <SectionTitle>Identity documents awaiting review</SectionTitle>
            <p className="-mt-2 mb-4 text-xs text-slate-500">Oldest first. A user becomes Verified once both their Government ID and proof of address are approved. Uploaded files are not machine-checked; OCR scores appear on sample documents only and are demonstration data.</p>
            {q.data.pending.length === 0 ? <Empty title="Queue is clear" hint="Documents applicants upload in Settings appear here." /> : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2" data-testid="list-kyc-queue">{q.data.pending.map((d) => (
                <li key={d.id} className="flex flex-col gap-3 rounded-xl border border-[#E2E8F0] p-4" data-testid={`row-kyc-${d.id}`}>
                  <button onClick={() => setDoc(d)} data-testid={`button-view-kyc-${d.id}`} className="press flex items-start gap-3 text-left">
                    <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border bg-slate-50">
                      {d.url && d.mimeType?.startsWith('image/') ? <img src={d.url} alt="" className="h-full w-full object-cover" /> : <FileText className="h-6 w-6 text-slate-400" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{d.kind}</span>
                      <span className="block truncate text-xs text-slate-500">{d.userName} · {d.organization}</span>
                      <span className="block text-xs text-slate-500">{d.sample ? `Sample · OCR ${d.confidence ?? 0}% (demo)` : `${d.name} · ${dateFmt(d.submittedAt)}`}</span>
                    </span>
                    <StatusBadge status={d.verificationLevel} />
                  </button>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/admin/users/${d.userId}`} className="text-xs font-semibold hover:underline">Open user</Link>
                    <KycDecision doc={d} />
                  </div>
                </li>
              ))}</ul>
            )}
          </section>
          <section className={cx(card, 'p-5')} data-testid="section-kyc-reviewed">
            <SectionTitle>Recent decisions</SectionTitle>
            {q.data.reviewed.length === 0 ? <Empty title="No decisions yet" /> : (
              <ul className="divide-y">{q.data.reviewed.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm" data-testid={`row-kyc-reviewed-${d.id}`}>
                  <span className="min-w-0 flex-1"><Link href={`/admin/users/${d.userId}`} className="font-semibold hover:underline">{d.userName}</Link> · {d.kind}
                    <span className="block text-xs text-slate-500">{d.reviewedAt && dateTime(d.reviewedAt)} · {d.reviewedBy}{d.reviewNote ? ` · “${d.reviewNote}”` : ''}</span></span>
                  <StatusBadge status={d.status} />
                </li>
              ))}</ul>
            )}
          </section>
        </div>
      )}
      <Modal open={!!doc} onClose={() => setDoc(null)} title={doc ? `${doc.kind} · ${doc.userName}` : 'Document'} testid="dialog-document">
        {doc && <div className="space-y-4"><KycPreview doc={doc} userName={doc.userName} /><KycDecision doc={doc} onDone={() => setDoc(null)} /></div>}
      </Modal>
    </Shell>
  );
}

/* ================================================================== */
/* Application review (reached from Users and the Dashboard queue)     */
/* ================================================================== */

const decisionCopy: Record<ApplicationDecisionInputStatus, { label: string; title: string; intro: string; needsNote: boolean; confirm: string }> = {
  Review: { label: 'Start review', title: 'Move to review?', intro: 'The applicant sees the application as under review.', needsNote: false, confirm: 'Move to review' },
  'Changes requested': { label: 'Request changes', title: 'Request changes?', intro: 'The applicant is asked to update the application and resubmit. Explain what is needed.', needsNote: true, confirm: 'Request changes' },
  Declined: { label: 'Decline', title: 'Decline this application?', intro: 'This is final. The applicant is notified with your reason. No money moves.', needsNote: true, confirm: 'Decline' },
  Approved: { label: 'Approve funding', title: 'Approve funding?', intro: '', needsNote: false, confirm: 'Approve and release funds' },
};

export function AdminApplicationPage() {
  const { userId = '', applicationId = '' } = useParams<{ userId: string; applicationId: string }>();
  const q = useGetAdminApplication(applicationId, { query: { enabled: !!applicationId, queryKey: getGetAdminApplicationQueryKey(applicationId), retry: false } });
  const decide = useDecideAdminApplication();
  const qc = useQueryClient();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [open, setOpen] = useState<ApplicationDecisionInputStatus | null>(null);
  const [error, setError] = useState('');
  const a = q.data && q.data.userId === userId ? q.data : undefined;
  const run = (status: ApplicationDecisionInputStatus, note?: string) => decide.mutate({ applicationId, data: { status, ...(note ? { note } : {}) } }, {
    onSuccess: (d) => { qc.setQueryData(getGetAdminApplicationQueryKey(applicationId), d); refresh(); setOpen(null); toast({ title: `Application ${statusLabel(d.status).toLowerCase()}`, description: d.title }); },
    onError: (e) => setError(apiError(e, 'The decision could not be saved.')),
  });
  const approveBlocked = a && (a.platformFrozen ? 'Approvals are paused by the global freeze.' : a.userStatus === 'Frozen' ? 'Unfreeze this account before approving funding.' : '');
  // Phase 11: approving a plan application also charges its fee from the account balance, even below $0.
  const fee = a?.fee ?? 0;
  const afterFee = a ? Math.round((a.accountBalance - fee) * 100) / 100 : 0;
  const approveText = a ? `${money(a.amount)} is added to ${a.userName}'s grant balance${fee > 0 ? ` and the ${money(fee)} application fee is charged from their account balance (${money(a.accountBalance)} → ${money(afterFee)}${afterFee < 0 ? ', below $0' : ''})` : ''}. Both are recorded in the ledger and the applicant is notified.` : '';
  return (
    <Shell admin title="Application review">
      <Link href={`/admin/users/${userId}`} data-testid="link-back-user" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"><ArrowLeft className="h-4 w-4" />Back to user</Link>
      {q.isLoading ? <PageSkeleton /> : !a ? (q.isError && (q.error as { status?: number } | null)?.status !== 404 ? <ErrorState onRetry={() => q.refetch()} /> : <Empty title="Application not found" hint="It may belong to a different user, or the link is wrong." />) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="min-w-0 space-y-5 lg:col-span-2">
            <section className={cx(card, 'p-5')} data-testid="section-application">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {a.plan && <PlanLogo url={a.plan.logoUrl} name={a.plan.name} initials={a.plan.initials} className="h-12 w-12" />}
                  <div className="min-w-0">
                  <p className="font-num text-xs text-slate-500">{a.id}</p>
                  <h2 className="font-display text-2xl font-bold" data-testid="text-application-title">{a.title}</h2>
                  <p className="text-sm text-slate-600"><Link href={`/admin/users/${a.userId}`} className="font-semibold hover:underline">{a.userName}</Link> · {a.organization} · {a.category}</p>
                  </div>
                </div>
                <StatusBadge status={a.status} testid="badge-application-status" />
              </div>
              <dl className={cx('mt-4 grid grid-cols-2 gap-3 text-sm', a.plan ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
                <div className="rounded-xl bg-[#F4F5F8] p-3"><dt className="text-xs uppercase tracking-wide text-slate-500">{a.plan ? 'Award' : 'Requested'}</dt><dd className="font-num text-lg font-semibold">{money(a.amount)}</dd></div>
                {a.plan && <div className="rounded-xl bg-[#F4F5F8] p-3"><dt className="text-xs uppercase tracking-wide text-slate-500">Application fee</dt><dd className="font-num text-lg font-semibold" data-testid="text-admin-app-fee">{money(fee)}</dd><dd className="text-xs text-slate-500">{fee > 0 ? (a.feeCharged ? 'Charged on approval' : a.status === 'Declined' || a.status === 'Withdrawn' ? 'Not charged' : 'Charged on approval') : 'No fee'}</dd></div>}
                <div className="rounded-xl bg-[#F4F5F8] p-3"><dt className="text-xs uppercase tracking-wide text-slate-500">Submitted</dt><dd className="font-semibold">{dateFmt(a.submittedAt)}</dd></div>
                <div className="rounded-xl bg-[#F4F5F8] p-3"><dt className="text-xs uppercase tracking-wide text-slate-500">Last change</dt><dd className="font-semibold">{dateFmt(a.updatedAt)}</dd></div>
              </dl>
            </section>
            {!!a.answers?.length && (
              <section className={cx(card, 'p-5')} data-testid="section-application-answers">
                <SectionTitle>Application form</SectionTitle>
                <dl className="divide-y divide-slate-100 rounded-xl border">
                  {a.answers.map((x, i) => (
                    <div key={x.fieldId} className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
                      <dt className="text-slate-500">{x.label}</dt>
                      <dd className="min-w-0 break-words" data-testid={`text-admin-answer-${i}`}>
                        {x.file ? <a href={x.file.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-semibold underline"><FileText className="h-4 w-4 shrink-0" />{x.file.name}<span className="font-normal text-slate-500">({fileSize(x.file.sizeBytes)})</span></a>
                          : x.value ? <span className="font-medium">{x.value}</span> : <span className="text-slate-400">Not given</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {(!a.plan || a.documents.length > 0) && <section className={cx(card, 'p-5')} data-testid="section-application-documents">
              <SectionTitle>Proposal documents</SectionTitle>
              {a.documents.length === 0 ? <Empty title="No documents attached" /> : (
                <ul className="space-y-2">{a.documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 rounded-xl border p-3" data-testid={`row-app-doc-${d.id}`}>
                    <FileText className="h-5 w-5 shrink-0" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{d.name}</span><span className="block text-xs text-slate-500">{fileSize(d.sizeBytes)} · {dateFmt(d.uploadedAt)}</span></span>
                    <a href={d.url} data-testid={`link-app-doc-${d.id}`} className={cx(ghost, 'inline-flex items-center gap-1 !py-1.5 text-xs')}><Download className="h-3.5 w-3.5" />Download</a>
                  </li>
                ))}</ul>
              )}
            </section>}
            <section className={cx(card, 'p-5')} data-testid="section-application-history">
              <SectionTitle>Status history</SectionTitle>
              <ol className="space-y-3">{a.events.map((e) => (
                <li key={e.id} className="border-l-2 border-[var(--brand)] pl-3 text-sm" data-testid={`row-event-${e.id}`}>
                  <div className="flex flex-wrap items-center gap-2"><StatusBadge status={e.status} dot={false} /><span className="text-xs text-slate-500">{dateTime(e.createdAt)} · {e.actor}</span></div>
                  {e.note && <p className="mt-1 break-words text-slate-700">{e.note}</p>}
                </li>
              ))}</ol>
            </section>
          </div>
          <aside className={cx(card, 'space-y-3 p-5 lg:sticky lg:top-24 lg:self-start')} data-testid="section-decision">
            <h3 className="font-display font-bold">Decision</h3>
            {a.allowedDecisions.length === 0 ? (
              <p className="text-sm text-slate-600" data-testid="text-no-decision">
                {a.status === 'Changes requested' ? 'Waiting for the applicant to update and resubmit.' : `This application is ${statusLabel(a.status).toLowerCase()}. No further decisions.`}
              </p>
            ) : (
              <>
                {(['Review', 'Approved', 'Changes requested', 'Declined'] as const).filter((d) => a.allowedDecisions.includes(d)).map((d) => (
                  <button key={d} data-testid={`button-decision-${d.toLowerCase().replace(' ', '-')}`} disabled={d === 'Approved' && !!approveBlocked} title={d === 'Approved' ? approveBlocked || undefined : undefined}
                    onClick={() => { setError(''); setOpen(d); }}
                    className={cx('w-full', d === 'Approved' ? lime : d === 'Declined' ? danger : d === 'Review' ? dark : ghost, 'disabled:cursor-not-allowed')}>{decisionCopy[d].label}</button>
                ))}
                {approveBlocked && <p className="text-xs text-red-700" data-testid="text-approve-blocked">{approveBlocked}</p>}
                <p className="text-xs text-slate-500" data-testid="text-approve-effect">{approveText} Sample data; no real funds move.</p>
              </>
            )}
          </aside>
          {open && (
            <ReasonModal open onClose={() => setOpen(null)} testid="dialog-decision" title={decisionCopy[open].title} confirmLabel={decisionCopy[open].confirm}
              intro={<p>{open === 'Approved' ? approveText : decisionCopy[open].intro}</p>}
              label={open === 'Changes requested' ? 'What needs to change (shared with the applicant)' : open === 'Declined' ? 'Reason (shared with the applicant)' : 'Note for the history (shared with the applicant)'}
              optional={!decisionCopy[open].needsNote} maxLength={1000} pending={decide.isPending} error={error} onSubmit={(note) => run(open, note || undefined)} />
          )}
        </div>
      )}
    </Shell>
  );
}
