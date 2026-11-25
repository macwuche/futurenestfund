import { useDeferredValue, useEffect, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { keepPreviousData } from '@tanstack/react-query';
import {
  useGetAdminCardPaymentsOverview, useListAdminPaymentCards, useGetAdminPaymentCard, useDecideAdminPaymentCard, useListAdminReportedCards,
  useCreateAdminReportedCard, useClearAdminReportedCard, useListAdminRequests, getListAdminPaymentCardsQueryKey, getGetAdminPaymentCardQueryKey,
  type AdminSavedCard, type CardPaymentsOverview, type ListAdminPaymentCardsFilter, type CardDecisionInputReason, type ReportCardInputReason, type ReportedCard,
} from '@workspace/api-client-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownToLine, ArrowUpFromLine, Ban, Check, CircleAlert, Plus, Search, ShieldCheck, ShieldOff, Undo2, X } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Empty, ErrorState, Field, Modal, Skel, StatusBadge, cx, dateFmt, money } from '@/components/bits';
import { card, ainput, dark, ghost, lime, danger, Stat, SectionTitle, useAdminRefresh } from '@/components/admin-bits';
import { CardFace, NetworkMark, NetworkTile, groupDigits } from '@/components/payment-cards';
import { FlagChips, RevealCardButton, SavedCardStatus } from '@/components/admin-payment-cards';
import { RequestRow } from '@/pages/admin-ops';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/**
 * Card Payments (Phase 13): customers pay in from, and are paid out to, the physical cards they collected at the office.
 * Administrators see how card payments are doing, review each saved card (approve / decline; block one that's lost, stolen or not ours), keep the list of cards reported
 * lost, stolen or expired, and work the queue of card requests.
 */

type Tab = 'overview' | 'cards' | 'reported' | 'requests';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'cards', label: 'Saved cards' },
  { key: 'reported', label: 'Reported cards' },
  { key: 'requests', label: 'Card requests' },
];

export function AdminCardPaymentsPage() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const overview = useGetAdminCardPaymentsOverview();
  const o = overview.data;
  const counts: Partial<Record<Tab, number>> = o ? { cards: o.cards.pending, reported: o.reportedOpen, requests: o.pending.deposits + o.pending.withdrawals } : {};
  return (
    <Shell admin title="Card Payments">
      <div className="space-y-5">
        <div role="tablist" aria-label="Card payments" className="noscroll -mx-1 flex gap-2 overflow-x-auto px-1">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} data-testid={`tab-card-payments-${t.key}`}
              onClick={() => navigate(t.key === 'overview' ? '/admin/card-payments' : `/admin/card-payments?tab=${t.key}`, { replace: true })}
              className={cx('press inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold', tab === t.key ? 'bg-[#111] text-white' : 'border border-[#E2E8F0] bg-white text-slate-700 hover:bg-slate-50')}>
              {t.label}
              {!!counts[t.key] && <span className={cx('font-num grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px]', tab === t.key ? 'bg-[var(--brand)] text-[var(--brand-fg)]' : 'bg-slate-100 text-slate-700')}>{counts[t.key]}</span>}
            </button>
          ))}
        </div>
        {tab === 'overview' && (overview.isLoading ? <Skel className="h-96" /> : overview.isError || !o ? <ErrorState onRetry={() => overview.refetch()} /> : <Overview o={o} />)}
        {tab === 'cards' && <SavedCards initialCard={params.get('card') ?? ''} />}
        {tab === 'reported' && <Reported />}
        {tab === 'requests' && <CardRequests />}
      </div>
    </Shell>
  );
}

/* ---------- overview ---------- */

function Overview({ o }: { o: CardPaymentsOverview }) {
  const enabled = o.methods.filter((m) => m.enabled);
  const has = (k: 'Deposit' | 'Withdrawal') => enabled.some((m) => m.kind === k);
  const maxNetwork = Math.max(1, ...o.byNetwork.map((n) => n.count));
  return (
    <div className="space-y-5">
      {(!has('Deposit') || !has('Withdrawal')) && (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" data-testid="notice-card-methods">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{!has('Deposit') && !has('Withdrawal') ? 'Card payments are off' : `Card ${has('Deposit') ? 'withdrawals' : 'deposits'} are off`}</p>
            <p className="mt-0.5">Customers pick their saved card through a payment method of type <strong>Saved card</strong>. Create one in Payment Gateway, with its amounts and fee.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!has('Deposit') && <Link href="/admin/payment-gateway/deposit?new=card" className={cx(dark, '!py-1.5 text-xs')} data-testid="link-new-card-deposit-method">New card deposit method</Link>}
            {!has('Withdrawal') && <Link href="/admin/payment-gateway/withdrawal?new=card" className={cx(dark, '!py-1.5 text-xs')} data-testid="link-new-card-withdrawal-method">New card withdrawal method</Link>}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat id="cp-cards" accent label="Saved cards" value={o.cards.total} hint={`${o.cards.customers} customer${o.cards.customers === 1 ? '' : 's'}`} href="/admin/card-payments?tab=cards" />
        <Stat id="cp-to-review" label="Cards to review" value={o.cards.pending} hint={`${o.cards.active} active · ${o.cards.blocked} blocked · ${o.cards.declined} declined`} href="/admin/card-payments?tab=cards&filter=Pending" />
        <Stat id="cp-flagged" label="Flagged cards" value={o.cards.flagged} hint={`${o.cards.reported} reported · ${o.cards.expired} expired`} href="/admin/card-payments?tab=cards&filter=flagged" />
        <Stat id="cp-pending" label="Card requests waiting" value={o.pending.deposits + o.pending.withdrawals} hint={money(o.pending.depositAmount + o.pending.withdrawalAmount)} href="/admin/card-payments?tab=requests" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat id="cp-in-month" label="Charged to cards this month" value={money(o.thisMonth.deposited)} hint={`${money(o.allTime.deposited)} all time`} />
        <Stat id="cp-out-month" label="Paid to cards this month" value={money(o.thisMonth.withdrawn)} hint={`${money(o.allTime.withdrawn)} all time`} />
        <Stat id="cp-approval" label="Approval rate" value={o.allTime.approvalRate === null ? '–' : `${o.allTime.approvalRate}%`} hint={`${o.allTime.approved} approved · ${o.allTime.declined} declined`} />
        <Stat id="cp-fees" label="Card fees collected" value={money(o.allTime.fees)} hint="All time" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <section className={cx(card, 'min-w-0 p-5 lg:col-span-2')} data-testid="section-card-trend">
          <SectionTitle>Card money, last six months</SectionTitle>
          <div className="h-60" aria-label="Bar chart of money charged to and paid to cards per month">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={o.trend} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={64} tickFormatter={(v: number) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                <Tooltip formatter={(v: number) => money(v)} cursor={{ fill: '#F4F5F8' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => <span className="text-slate-700">{v}</span>} />
                <Bar dataKey="deposits" name="Charged to cards (deposits)" fill="#111111" radius={[4, 4, 0, 0]} />
                <Bar dataKey="withdrawals" name="Paid to cards (withdrawals)" fill="var(--brand)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className={cx(card, 'min-w-0 p-5')} data-testid="section-card-networks">
          <SectionTitle>Cards by network</SectionTitle>
          {o.byNetwork.length === 0 ? <Empty title="No cards yet" hint="Saved cards appear here." /> : (
            <ul className="space-y-3">
              {o.byNetwork.map((n) => (
                <li key={n.network}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2"><NetworkMark network={n.network} className="scale-75" />{n.networkName}</span><span className="font-num font-semibold">{n.count}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#111]" style={{ width: `${(n.count / maxNetwork) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 border-t pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Card methods</p>
            {o.methods.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : (
              <ul className="space-y-1.5 text-sm" data-testid="list-card-methods">
                {o.methods.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/payment-gateway/${m.kind.toLowerCase()}`} className="flex min-w-0 items-center gap-2 hover:underline">
                      {m.kind === 'Deposit' ? <ArrowDownToLine className="h-4 w-4 shrink-0 text-slate-400" /> : <ArrowUpFromLine className="h-4 w-4 shrink-0 text-slate-400" />}<span className="truncate">{m.name}</span>
                    </Link>
                    <StatusBadge status={m.enabled ? 'Active' : 'Inactive'} label={m.enabled ? 'On' : 'Off'} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
      <section className={cx(card, 'p-5')} data-testid="section-card-recent">
        <SectionTitle action={<Link href="/admin/card-payments?tab=requests" className="text-xs font-semibold hover:underline">Open card requests</Link>}>Latest card requests</SectionTitle>
        {o.recent.length === 0 ? <Empty title="No card requests yet" hint="Deposits and withdrawals made with a saved card appear here." /> : (
          <ul className="divide-y">
            {o.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                {r.kind === 'Deposit' ? <ArrowDownToLine className="h-4 w-4 text-slate-400" /> : <ArrowUpFromLine className="h-4 w-4 text-slate-400" />}
                <span className="min-w-0 flex-1"><Link href={`/admin/users/${r.userId}`} className="font-semibold hover:underline">{r.userName}</Link><span className="block text-xs text-slate-500">{r.kind} · {r.card} · ref <span className="font-num">{r.reference}</span> · {dateFmt(r.createdAt)}</span></span>
                <span className="font-num font-semibold">{money(r.amount)}</span>
                <StatusBadge status={r.status === 'Completed' ? 'Approved' : r.status === 'Pending' ? 'Review' : r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------- saved cards ---------- */

const FILTERS: { key: ListAdminPaymentCardsFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'Pending', label: 'To review' }, { key: 'flagged', label: 'Flagged' },
  { key: 'Active', label: 'Active' }, { key: 'Declined', label: 'Declined' }, { key: 'Blocked', label: 'Blocked' }, { key: 'Removed', label: 'Removed' },
];

function SavedCards({ initialCard }: { initialCard: string }) {
  const params = new URLSearchParams(useSearch());
  const [filter, setFilter] = useState<ListAdminPaymentCardsFilter>((FILTERS.find((f) => f.key === params.get('filter'))?.key) ?? 'all');
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q.trim());
  const [open, setOpen] = useState(initialCard);
  useEffect(() => { if (initialCard) setOpen(initialCard); }, [initialCard]);
  const query = { filter, ...(dq ? { q: dq } : {}) };
  const list = useListAdminPaymentCards(query, { query: { queryKey: getListAdminPaymentCardsQueryKey(query), placeholderData: keepPreviousData } });
  return (
    <section className={cx(card, 'p-5')} data-testid="section-saved-cards">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="noscroll -mx-1 flex gap-2 overflow-x-auto px-1" role="group" aria-label="Filter cards">
          {FILTERS.map((f) => (
            <button key={f.key} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} data-testid={`filter-cards-${f.key}`}
              className={cx('press min-h-11 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold', filter === f.key ? 'border-[#111] bg-[#111] text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-[#111]')}>{f.label}</button>
          ))}
        </div>
        <label className="relative w-full sm:w-72">
          <span className="sr-only">Search cards</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, name on card or last 4" data-testid="input-search-cards" className={cx(ainput, 'min-h-11 pl-9')} />
        </label>
      </div>
      <p className="mb-4 text-xs text-slate-500">Cards customers saved from the office's physical cards. Each new card waits for your review: check it against the office's records, then approve it or decline it with a reason the customer sees. You also approve each deposit and withdrawal made with a card. Block a card that's lost, stolen or not ours. Numbers stay hidden until you open a card's details, and every view is audited.</p>
      {list.isLoading ? <div className="space-y-2">{[1, 2, 3].map((i) => <Skel key={i} className="h-16" />)}</div>
        : list.isError || !list.data ? <ErrorState onRetry={() => list.refetch()} />
        : list.data.length === 0 ? <Empty title={dq ? 'No cards match' : filter === 'all' ? 'No saved cards yet' : 'Nothing here'} hint="When a customer saves their card, it appears here." />
        : (
          <>
            <ul className="divide-y md:hidden" data-testid="list-saved-cards-phone">
              {list.data.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setOpen(c.id)} className="press flex w-full items-start gap-3 py-3 text-left" data-testid={`card-saved-${c.id}`}>
                    <NetworkTile network={c.network} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{c.userName}</span>
                      <span className="font-num block text-xs text-slate-500">{c.networkName} •• {c.lastFour} · exp {c.expiry}</span>
                      <span className="mt-1 block"><FlagChips flags={c.flags} hideReview /></span>
                    </span>
                    <SavedCardStatus status={c.status} expired={c.expired} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-left text-sm" data-testid="table-saved-cards">
                <thead><tr className="border-b text-xs uppercase tracking-wide text-slate-500"><th className="py-2 pr-3">Card</th><th>Customer</th><th>Status</th><th>Flags</th><th className="text-right">In / out</th><th className="pl-4">Added</th></tr></thead>
                <tbody>
                  {list.data.map((c) => (
                    <tr key={c.id} onClick={() => setOpen(c.id)} className="cursor-pointer border-b align-top hover:bg-slate-50" data-testid={`row-saved-card-${c.id}`}>
                      <td className="py-3 pr-3"><span className="flex items-center gap-3"><NetworkTile network={c.network} /><span><span className="font-num block font-semibold">•• {c.lastFour}</span><span className="block text-xs text-slate-500">{c.holderName} · exp {c.expiry}</span></span></span></td>
                      <td className="py-3"><Link href={`/admin/users/${c.userId}`} onClick={(e) => e.stopPropagation()} className="font-semibold hover:underline">{c.userName}</Link><span className="block text-xs text-slate-500">{c.organization}</span></td>
                      <td className="py-3"><SavedCardStatus status={c.status} expired={c.expired} /></td>
                      <td className="max-w-[16rem] py-3"><FlagChips flags={c.flags} hideReview />{c.flags.every((f) => f.kind === 'review') && <span className="text-xs text-slate-400">None</span>}</td>
                      <td className="font-num py-3 text-right text-xs"><span className="block text-slate-900">+{money(c.deposited)}</span><span className="block text-slate-500">−{money(c.withdrawn)}</span></td>
                      <td className="py-3 pl-4 text-xs text-slate-500">{dateFmt(c.createdAt)}{c.pendingRequests > 0 && <span className="mt-1 block font-semibold text-amber-800">{c.pendingRequests} waiting</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      <CardInspector cardId={open} onClose={() => setOpen('')} />
    </section>
  );
}

const BLOCK_REASONS: CardDecisionInputReason[] = ['Lost', 'Stolen', 'Expired', 'Not our card', 'Other'];
const REPORT_REASONS: ReportCardInputReason[] = ['Lost', 'Stolen', 'Expired', 'Damaged', 'Other'];

/** One saved card: details, flags, actions, its requests, the same card elsewhere, and its reports. */
function CardInspector({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const q = useGetAdminPaymentCard(cardId, { query: { queryKey: getGetAdminPaymentCardQueryKey(cardId), enabled: !!cardId } });
  const decide = useDecideAdminPaymentCard();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [blocking, setBlocking] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [err, setErr] = useState('');
  const c = q.data;
  const act = (data: Parameters<typeof decide.mutate>[0]['data'], done: string) => decide.mutate({ cardId, data }, {
    onSuccess: () => { refresh(); setBlocking(false); setDeclining(false); setErr(''); toast({ title: done }); },
    onError: (e) => setErr(apiError(e, 'That was refused.')),
  });
  return (
    <Modal open={!!cardId} onClose={onClose} title={c ? `${c.networkName} •• ${c.lastFour}` : 'Card'} testid="dialog-card-inspector" wide>
      {q.isLoading ? <Skel className="h-80" /> : q.isError || !c ? <ErrorState onRetry={() => q.refetch()} /> : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-2">
            <CardFace network={c.network} lastFour={c.lastFour} holderName={c.holderName} expiry={c.expiry} muted={c.status !== 'Active'} />
            <div className="flex flex-wrap gap-2">
              <RevealCardButton cardId={c.id} network={c.network} />
            </div>
            <dl className="divide-y divide-slate-100 rounded-xl border text-sm">
              <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-slate-500">Customer</dt><dd className="text-right"><Link href={`/admin/users/${c.userId}`} className="font-semibold hover:underline">{c.userName}</Link><span className="block text-xs text-slate-500">{c.organization}</span></dd></div>
              <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-slate-500">Status</dt><dd><SavedCardStatus status={c.status} expired={c.expired} /></dd></div>
              <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-slate-500">Name on card</dt><dd className="font-semibold">{c.holderName}</dd></div>
              <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-slate-500">Expires</dt><dd className="font-num font-semibold">{c.expiry}</dd></div>
              <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-slate-500">Saved</dt><dd>{dateFmt(c.createdAt)}</dd></div>
              {c.reviewedBy && <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-slate-500">Last decision</dt><dd className="text-right text-xs">{c.reviewedBy}{c.reviewedAt && <span className="block text-slate-500">{dateFmt(c.reviewedAt)}</span>}</dd></div>}
              {c.blockNote && <div className="px-3 py-2"><dt className="text-slate-500">{c.status === 'Declined' ? 'Declined' : `Blocked: ${c.blockReason}`}</dt><dd className="mt-0.5 text-xs text-slate-700">“{c.blockNote}” (shown to the customer)</dd></div>}
            </dl>
          </div>
          <div className="space-y-5 lg:col-span-3">
            <section>
              <h3 className="mb-2 text-sm font-bold">Checks</h3>
              {c.flags.length ? <FlagChips flags={c.flags} testid="flags-inspector" /> : <p className="flex items-center gap-1.5 text-sm text-green-800"><ShieldCheck className="h-4 w-4" />Nothing to flag.</p>}
              <p className="mt-2 text-xs text-slate-500">Compare the card with the office's records before approving it or paying to it. A card waiting for review, declined, blocked, reported or expired can't be used for new requests, and requests made with it can't be approved.</p>
            </section>
            {c.status !== 'Removed' && (
              <section className="flex flex-wrap gap-2" data-testid="actions-card-inspector">
                {c.status === 'Pending' && <>
                  <button type="button" disabled={decide.isPending} onClick={() => act({ action: 'approve' }, 'Card approved')} className={cx(lime, 'inline-flex items-center gap-1.5')} data-testid="button-approve-card"><Check className="h-4 w-4" />Approve card</button>
                  <button type="button" onClick={() => { setErr(''); setDeclining(true); }} className={cx(danger, 'inline-flex items-center gap-1.5')} data-testid="button-decline-card"><X className="h-4 w-4" />Decline</button>
                </>}
                {c.status === 'Pending' || c.status === 'Declined' ? null : c.status !== 'Blocked'
                  ? <button type="button" onClick={() => { setErr(''); setBlocking(true); }} className={cx(danger, 'inline-flex items-center gap-1.5')} data-testid="button-block-card"><Ban className="h-4 w-4" />Block</button>
                  : <button type="button" disabled={decide.isPending} onClick={() => act({ action: 'unblock' }, 'Card unblocked')} className={cx(ghost, 'inline-flex items-center gap-1.5')} data-testid="button-unblock-card"><Undo2 className="h-4 w-4" />Unblock</button>}
                {!c.reports.some((r) => !r.clearedAt) && <button type="button" onClick={() => { setErr(''); setReporting(true); }} className={cx(ghost, 'inline-flex items-center gap-1.5')} data-testid="button-report-card"><ShieldOff className="h-4 w-4" />Add to reported list</button>}
              </section>
            )}
            {err && !blocking && !declining && !reporting && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-inspector-error">{err}</p>}
            <section className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Charged</p><p className="font-num font-semibold">{money(c.deposited)}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Paid to it</p><p className="font-num font-semibold">{money(c.withdrawn)}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Requests</p><p className="font-num font-semibold">{c.requestCount}</p></div>
            </section>
            <section>
              <h3 className="mb-2 text-sm font-bold">Requests with this card</h3>
              {c.requests.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : (
                <ul className="divide-y rounded-xl border" data-testid="list-inspector-requests">
                  {c.requests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      {r.kind === 'Deposit' ? <ArrowDownToLine className="h-4 w-4 text-slate-400" /> : <ArrowUpFromLine className="h-4 w-4 text-slate-400" />}
                      <span className="min-w-0 flex-1">{r.kind} · ref <span className="font-num">{r.reference}</span><span className="block text-xs text-slate-500">{dateFmt(r.createdAt)}{r.reviewNote ? ` · ${r.reviewNote}` : ''}</span></span>
                      <span className="font-num font-semibold">{money(r.amount)}</span>
                      <StatusBadge status={r.status === 'Completed' ? 'Approved' : r.status === 'Pending' ? 'Review' : r.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {c.sameCard.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-bold">Same card on other accounts</h3>
                <ul className="space-y-1 text-sm" data-testid="list-same-card">
                  {c.sameCard.map((s) => <li key={s.cardId} className="flex items-center justify-between gap-2"><Link href={`/admin/users/${s.userId}`} className="font-semibold hover:underline">{s.userName}</Link><SavedCardStatus status={s.status} /></li>)}
                </ul>
              </section>
            )}
            {c.reports.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-bold">Reports for this card</h3>
                <ul className="space-y-1 text-sm">{c.reports.map((r) => <li key={r.id} className="text-slate-700"><span className="font-semibold">{r.reason}</span> · {dateFmt(r.createdAt)} by {r.reportedBy}{r.note ? ` · ${r.note}` : ''}{r.clearedAt ? ` · cleared ${dateFmt(r.clearedAt)}` : ''}</li>)}</ul>
              </section>
            )}
          </div>
          <BlockDialog open={blocking} onClose={() => setBlocking(false)} pending={decide.isPending} error={err} label={`${c.networkName} •• ${c.lastFour}`}
            onSubmit={(reason, note) => act({ action: 'block', reason, note }, 'Card blocked')} />
          <DeclineDialog open={declining} onClose={() => setDeclining(false)} pending={decide.isPending} error={err} label={`${c.networkName} •• ${c.lastFour}`}
            onSubmit={(note) => act({ action: 'decline', note }, 'Card declined')} />
          <ReportDialog open={reporting} onClose={() => setReporting(false)} cardId={c.id} label={`${c.networkName} •• ${c.lastFour}`} />
        </div>
      )}
    </Modal>
  );
}

function DeclineDialog({ open, onClose, onSubmit, pending, error, label }: { open: boolean; onClose: () => void; onSubmit: (note: string) => void; pending: boolean; error: string; label: string }) {
  const [note, setNote] = useState('');
  const [local, setLocal] = useState('');
  useEffect(() => { if (open) { setNote(''); setLocal(''); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={`Decline ${label}?`} testid="dialog-decline-card">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (note.trim().length < 5) return setLocal('Write at least 5 characters.'); onSubmit(note.trim()); }}>
        <p className="text-sm text-slate-600">The card can't be used. The customer is told why by email and in the app, and can remove it and add it again.</p>
        <Field label="Reason for the customer" error={local || error}><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} rows={3} className={ainput} data-testid="input-decline-note" placeholder="e.g. The name doesn't match the card we issued. Visit the office." /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="press rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-100">Cancel</button>
          <button disabled={pending} className={danger} data-testid="button-decline-confirm">{pending ? 'Declining…' : 'Decline card'}</button>
        </div>
      </form>
    </Modal>
  );
}

function BlockDialog({ open, onClose, onSubmit, pending, error, label }: { open: boolean; onClose: () => void; onSubmit: (r: CardDecisionInputReason, note: string) => void; pending: boolean; error: string; label: string }) {
  const [reason, setReason] = useState<CardDecisionInputReason>('Lost');
  const [note, setNote] = useState('');
  const [local, setLocal] = useState('');
  useEffect(() => { if (open) { setReason('Lost'); setNote(''); setLocal(''); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={`Block ${label}?`} testid="dialog-block-card">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (note.trim().length < 5) return setLocal('Write at least 5 characters.'); onSubmit(reason, note.trim()); }}>
        <p className="text-sm text-slate-600">The customer can't use this card for new requests, and its waiting requests can't be approved until you unblock it. They're told why.</p>
        <Field label="Why"><select value={reason} onChange={(e) => setReason(e.target.value as CardDecisionInputReason)} className={cx(ainput, 'min-h-11')} data-testid="select-block-reason">{BLOCK_REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Message for the customer" error={local || error}><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} rows={3} className={ainput} data-testid="input-block-note" placeholder="e.g. This card was reported lost. Visit the office for a new one." /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="press rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-100">Cancel</button>
          <button disabled={pending} className={danger} data-testid="button-block-confirm">{pending ? 'Blocking…' : 'Block card'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Report a card: from a saved card (cardId) or by its full number. */
function ReportDialog({ open, onClose, cardId, label }: { open: boolean; onClose: () => void; cardId?: string; label?: string }) {
  const m = useCreateAdminReportedCard();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [number, setNumber] = useState('');
  const [reason, setReason] = useState<ReportCardInputReason>('Lost');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setNumber(''); setReason('Lost'); setNote(''); setErr(''); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={label ? `Report ${label}` : 'Report a card'} testid="dialog-report-card">
      <form noValidate className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        m.mutate({ data: { reason, ...(note.trim() ? { note: note.trim() } : {}), ...(cardId ? { cardId } : { number: number.replace(/\D/g, '') }) } }, {
          onSuccess: (r) => { refresh(); onClose(); toast({ title: 'Card reported', description: `${r.networkName} •• ${r.lastFour} · ${r.reason}` }); },
          onError: (e2) => setErr(apiError(e2, "The card couldn't be reported.")),
        });
      }}>
        <p className="text-sm text-slate-600">Any saved card with this number, on any account, is flagged and can't be used or paid until the report is cleared. A customer who saves it later is blocked at once.</p>
        {!cardId && <Field label="Full card number"><input value={groupDigits(number.replace(/\D/g, '').slice(0, 19))} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" autoComplete="off" className={cx(ainput, 'font-num min-h-11 tracking-wide')} data-testid="input-report-number" placeholder="As printed on the card" /></Field>}
        <Field label="Reason"><select value={reason} onChange={(e) => setReason(e.target.value as ReportCardInputReason)} className={cx(ainput, 'min-h-11')} data-testid="select-report-reason">{REPORT_REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Note (optional, for administrators)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} className={cx(ainput, 'min-h-11')} data-testid="input-report-note" placeholder="e.g. Customer called on 20 Nov" /></Field>
        {err && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-report-error">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="press rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-100">Cancel</button>
          <button disabled={m.isPending} className={dark} data-testid="button-report-confirm">{m.isPending ? 'Saving…' : 'Add to reported list'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- reported cards ---------- */

function Reported() {
  const [cleared, setCleared] = useState(false);
  const q = useListAdminReportedCards(cleared ? { cleared: true } : undefined);
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState<ReportedCard | null>(null);
  return (
    <section className={cx(card, 'p-5')} data-testid="section-reported-cards">
      <SectionTitle action={<button type="button" onClick={() => setAdding(true)} className={cx(dark, 'inline-flex items-center gap-1.5 !py-1.5 text-xs')} data-testid="button-new-report"><Plus className="h-3.5 w-3.5" />Report a card</button>}>
        Cards reported lost, stolen or expired
      </SectionTitle>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs text-slate-500">Add a card here when a customer tells the office it's lost or stolen, or a batch expires. Only a fingerprint of the number and its last four are kept. Matching saved cards are flagged everywhere.</p>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={cleared} onChange={(e) => setCleared(e.target.checked)} data-testid="toggle-show-cleared" className="h-4 w-4" />Show cleared</label>
      </div>
      {q.isLoading ? <Skel className="h-24" /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
        : q.data.length === 0 ? <Empty title="No reported cards" hint="Cards you report appear here." />
        : (
          <ul className="divide-y" data-testid="list-reported-cards">
            {q.data.map((r) => (
              <li key={r.id} className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 py-3', r.clearedAt && 'opacity-60')} data-testid={`row-report-${r.id}`}>
                <NetworkTile network={r.network} />
                <span className="min-w-0 flex-1">
                  <span className="font-num block font-semibold">{r.networkName} •• {r.lastFour}</span>
                  <span className="block text-xs text-slate-500">{r.reason}{r.note ? ` · ${r.note}` : ''} · {dateFmt(r.createdAt)} by {r.reportedBy}{r.clearedAt ? ` · cleared ${dateFmt(r.clearedAt)} by ${r.clearedBy}` : ''}</span>
                </span>
                <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', (r.matchingCards ?? 0) > 0 ? 'bg-red-100 text-red-900' : 'bg-slate-100 text-slate-600')} data-testid={`text-report-matches-${r.id}`}>{r.matchingCards ?? 0} saved card{r.matchingCards === 1 ? '' : 's'}</span>
                {!r.clearedAt && <button type="button" onClick={() => setClearing(r)} className={cx(ghost, '!py-1.5 text-xs')} data-testid={`button-clear-report-${r.id}`}>Clear</button>}
              </li>
            ))}
          </ul>
        )}
      <ReportDialog open={adding} onClose={() => setAdding(false)} />
      <ClearDialog r={clearing} onClose={() => setClearing(null)} />
    </section>
  );
}

function ClearDialog({ r, onClose }: { r: ReportedCard | null; onClose: () => void }) {
  const m = useClearAdminReportedCard();
  const refresh = useAdminRefresh();
  const [err, setErr] = useState('');
  useEffect(() => setErr(''), [r]);
  return (
    <Modal open={!!r} onClose={onClose} title="Clear this report?" testid="dialog-clear-report">
      {r && <p className="text-sm text-slate-600">{r.networkName} •• {r.lastFour} comes off the reported list. Saved cards with this number can be used again, unless they're blocked. The report stays in the history.</p>}
      {err && <p role="alert" className="mt-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="press rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-100">Cancel</button>
        <button type="button" disabled={m.isPending} className={dark} data-testid="button-clear-report-confirm" onClick={() => r && m.mutate({ reportId: r.id }, { onSuccess: () => { refresh(); onClose(); }, onError: (e) => setErr(apiError(e, "The report couldn't be cleared.")) })}>{m.isPending ? 'Clearing…' : 'Clear report'}</button>
      </div>
    </Modal>
  );
}

/* ---------- card requests: the deposit and withdrawal queues, card requests only ---------- */

function CardRequests() {
  const deposits = useListAdminRequests({ kind: 'Deposit', status: 'pending', via: 'card' });
  const withdrawals = useListAdminRequests({ kind: 'Withdrawal', status: 'pending', via: 'card' });
  const block = (title: string, hint: string, q: typeof deposits, testid: string) => (
    <section className={cx(card, 'p-5')} data-testid={testid}>
      <SectionTitle>{title}</SectionTitle>
      <p className="-mt-2 mb-4 text-xs text-slate-500">{hint}</p>
      {q.isLoading ? <Skel className="h-20" /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
        : q.data.length === 0 ? <Empty title="Queue is clear" />
        : <ul className="space-y-3">{q.data.map((r) => <RequestRow key={r.id} r={r} />)}</ul>}
    </section>
  );
  return (
    <div className="space-y-5">
      {block('Card deposits to charge', 'Charge the card for the amount, then approve: the account balance is credited (less any fee). Decline if the charge fails.', deposits, 'section-card-deposits')}
      {block('Withdrawals to pay to cards', 'Send the amount to the card, then approve: it leaves the balance the customer chose. A flagged card can’t be approved until the flag is resolved.', withdrawals, 'section-card-withdrawals')}
    </div>
  );
}
