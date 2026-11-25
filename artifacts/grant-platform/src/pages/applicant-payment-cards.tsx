import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useListApplicantPaymentCards, useDeleteApplicantPaymentCard, getListApplicantPaymentCardsQueryKey, type SavedCard } from '@workspace/api-client-react';
import { ArrowDownToLine, ArrowUpFromLine, CreditCard, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Empty, ErrorState, Modal, PageSkeleton, cx, dateFmt } from '@/components/bits';
import { AddCardDialog, CardFace, CardStatusChip, NetworkTile, cardStatusText } from '@/components/payment-cards';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

const panel = 'rounded-2xl border border-[#E5E7EB] bg-white shadow-sm';

/**
 * Payment cards (Phase 13): the physical cards a customer collected at the office and saved, to add funds from or be paid
 * to. A saved card is under review until the team approves it (the customer is emailed when it's added and when it's
 * decided); the finance team also approves each deposit and withdrawal made with it. The number and CVV are never shown
 * back here.
 */
export function PaymentCardsPage() {
  const q = useListApplicantPaymentCards();
  return (
    <Shell title="Payment cards">
      {q.isLoading ? <PageSkeleton /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : <Body cards={q.data} />}
    </Shell>
  );
}

function Body({ cards }: { cards: SavedCard[] }) {
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(cards[0]?.id ?? '');
  // A card just saved isn't in the list until it refreshes: keep it selected until then instead of falling back.
  const justSaved = useRef('');
  useEffect(() => {
    if (cards.some((c) => c.id === justSaved.current)) justSaved.current = '';
    if (selected !== justSaved.current && !cards.some((c) => c.id === selected)) setSelected(cards[0]?.id ?? '');
  }, [cards, selected]);
  const card = cards.find((c) => c.id === selected);
  return (
    <div className="space-y-5">
      {cards.length === 0 ? (
        <section className={cx(panel, 'p-6 sm:p-10')} data-testid="section-no-payment-cards">
          <div className="mx-auto grid max-w-3xl items-center gap-8 md:grid-cols-2">
            <div className="mx-auto w-full max-w-sm -rotate-3"><CardFace network="visa" lastFour="0000" holderName="Your name" expiry="MM/YY" /></div>
            <div>
              <h2 className="font-display text-2xl font-bold text-slate-900">Use your physical card</h2>
              <p className="mt-2 text-sm text-slate-600">Collected a card at our office? Save it here to add funds from it, or to have your withdrawals paid straight to it.</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-[var(--brand-ink)]" />Our team reviews every card before it can be used</li>
                <li className="flex gap-2"><Lock className="h-4 w-4 shrink-0 text-[var(--brand-ink)]" />Card details are encrypted</li>
              </ul>
              <button type="button" onClick={() => setAdding(true)} data-testid="button-add-first-card" className="press mt-6 inline-flex min-h-12 items-center gap-2 rounded-full bg-[var(--brand)] px-6 text-[15px] font-semibold text-[var(--brand-fg)] hover:bg-[var(--brand-dark)]">
                <Plus className="h-4 w-4" />Add card
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-5">
          <section className={cx(panel, 'min-w-0 p-5 lg:col-span-2 lg:self-start')} aria-label="Selected card">
            {card && <CardDetail c={card} />}
          </section>
          <section className={cx(panel, 'min-w-0 p-5 lg:col-span-3')} aria-labelledby="cards-heading">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="cards-heading" className="text-lg font-semibold text-slate-900">Your cards</h2>
              <button type="button" onClick={() => setAdding(true)} disabled={cards.length >= 5} data-testid="button-add-card"
                className="press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--brand-fg)] hover:bg-[var(--brand-dark)] disabled:opacity-50">
                <Plus className="h-4 w-4" />Add card
              </button>
            </div>
            <ul className="space-y-2" data-testid="list-payment-cards">
              {cards.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setSelected(c.id)} aria-pressed={selected === c.id} data-testid={`button-payment-card-${c.id}`}
                    className={cx('press flex min-h-16 w-full items-center gap-3 rounded-2xl border bg-white p-3 text-left', selected === c.id ? 'border-[var(--brand-ink)] ring-2 ring-[var(--brand-ink)]/20' : 'border-slate-200 hover:border-slate-400')}>
                    <NetworkTile network={c.network} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{c.networkName} · {c.holderName}</span>
                      <span className="font-num block text-xs text-slate-500">•••• {c.lastFour} · exp {c.expiry}</span>
                    </span>
                    <CardStatusChip c={c} />
                  </button>
                </li>
              ))}
            </ul>
            {cards.length >= 5 && <p className="mt-3 text-xs text-slate-500">You can save up to 5 cards. Remove one to add another.</p>}
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Link href="/deposits" data-testid="link-cards-add-funds" className="press flex min-h-14 items-center gap-3 rounded-xl bg-[var(--brand-soft)] px-4 text-sm font-semibold text-slate-900 hover:brightness-95"><ArrowDownToLine className="h-5 w-5 text-[var(--brand-ink)]" />Add funds from a card</Link>
              <Link href="/withdrawals" data-testid="link-cards-withdraw" className="press flex min-h-14 items-center gap-3 rounded-xl bg-[var(--brand-soft)] px-4 text-sm font-semibold text-slate-900 hover:brightness-95"><ArrowUpFromLine className="h-5 w-5 text-[var(--brand-ink)]" />Withdraw to a card</Link>
            </div>
          </section>
        </div>
      )}
      <section className={cx(panel, 'p-5 text-sm text-slate-600')} data-testid="section-card-help">
        <h2 className="mb-2 flex items-center gap-2 font-semibold text-slate-900"><CreditCard className="h-4 w-4" />How card payments work</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Save the physical card.</li>
          <li>Our team reviews it. You can use it once it's approved, and we email you when that happens.</li>
          <li>Choose a card method in <Link href="/deposits" className="font-semibold underline">Add funds</Link> or <Link href="/withdrawals" className="font-semibold underline">Withdrawals</Link>, then pick your card.</li>
          <li>Our finance team reviews each deposit and withdrawal before any money moves.</li>
          <li>If your card is lost or stolen, contact support at once so we can block it.</li>
        </ol>
      </section>
      <AddCardDialog open={adding} onClose={() => setAdding(false)} onSaved={(c) => { justSaved.current = c.id; setSelected(c.id); }} />
    </div>
  );
}

function CardDetail({ c }: { c: SavedCard }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const del = useDeleteApplicantPaymentCard();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div data-testid={`detail-payment-card-${c.id}`}>
      <CardFace network={c.network} lastFour={c.lastFour} holderName={c.holderName} expiry={c.expiry} muted={!c.usable} testid="face-selected-card" />
      <dl className="mt-5 divide-y divide-slate-100 text-sm">
        <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-slate-500">Status</dt><dd><CardStatusChip c={c} /></dd></div>
        {!c.usable && <p className={cx('rounded-lg px-3 py-2 text-xs', c.status === 'Pending' && !c.expired ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-800')} data-testid="text-card-unusable">{cardStatusText(c)}</p>}
        <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-slate-500">Card</dt><dd className="font-num font-semibold text-slate-900">{c.networkName} •••• {c.lastFour}</dd></div>
        <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-slate-500">Expires</dt><dd className="font-num font-semibold text-slate-900">{c.expiry}</dd></div>
        <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-slate-500">Added</dt><dd className="text-slate-900">{dateFmt(c.createdAt)}</dd></div>
      </dl>
      <button type="button" onClick={() => { setErr(''); setConfirm(true); }} data-testid="button-remove-card" className="press mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
        <Trash2 className="h-4 w-4" />Remove card
      </button>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Remove this card?" testid="dialog-remove-card">
        <p className="text-sm text-slate-600">{c.networkName} •••• {c.lastFour} won't be offered for deposits or withdrawals any more. You can add it again later.</p>
        {err && <p role="alert" className="mt-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-remove-card-error">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirm(false)} className="press min-h-11 rounded-full px-4 text-sm font-semibold hover:bg-slate-100">Keep it</button>
          <button type="button" disabled={del.isPending} data-testid="button-remove-card-confirm" className="press min-h-11 rounded-full bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
            onClick={() => del.mutate({ cardId: c.id }, {
              onSuccess: () => { qc.invalidateQueries({ queryKey: getListApplicantPaymentCardsQueryKey() }); setConfirm(false); toast({ title: 'Card removed' }); },
              onError: (e) => setErr(apiError(e, "The card couldn't be removed.")),
            })}>{del.isPending ? 'Removing…' : 'Remove'}</button>
        </div>
      </Modal>
    </div>
  );
}
