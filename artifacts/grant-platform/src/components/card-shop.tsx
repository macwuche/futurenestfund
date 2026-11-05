import { useState } from 'react';
import { useBuyApplicantCard, useListApplicantCardTypes, useTopUpApplicantCard, type ApplicantAccount, type ApplicantCardType, type CardKindPrice, type UserCard } from '@workspace/api-client-react';
import { CreditCard, Loader2, Plus } from 'lucide-react';
import { ErrorState, Field, Modal, Skel, cx, money } from '@/components/bits';
import { apiError, useRefreshApplicant } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/*
 * Step 9.3: applicants buy a card from the types the admin put on sale (price + fee from the deposit balance),
 * and top up an active card from the deposit balance (no fee).
 */

const primary = 'press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-[#1E3A8A] px-4 text-sm font-semibold text-white hover:bg-[#0F172A] disabled:opacity-60';
const outline = 'press inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60';
const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#1E3A8A] focus:ring-2 focus:ring-[#1E3A8A]/20';
type Kind = 'Virtual' | 'Physical';
type Choice = { t: ApplicantCardType; kind: Kind; p: CardKindPrice };

const breakdown = (p: CardKindPrice) => (p.total !== null && p.price !== null && p.total > p.price ? `${money(p.price)} + ${money(Math.round((p.total - p.price) * 100) / 100)} fee` : '');

/** "Get a card": the card types on sale, each kind with what it costs in all. */
export function CardShop({ a }: { a: ApplicantAccount }) {
  const q = useListApplicantCardTypes();
  const [choice, setChoice] = useState<Choice | null>(null);
  const holds = (k: Kind) => a.cards.some((c) => c.kind === k && c.status !== 'Cancelled');
  const paused = a.status === 'Frozen' || a.platformFrozen;
  return (
    <section aria-labelledby="shop-heading" className="space-y-3" data-testid="section-card-shop">
      <div>
        <h2 id="shop-heading" className="text-lg font-semibold text-slate-900">Get a card</h2>
        <p className="text-sm text-slate-500">Paid from your deposit balance ({money(a.availableToWithdraw.deposit)} available). You can hold one virtual and one physical card.</p>
      </div>
      {q.isLoading ? <div className="grid gap-3 md:grid-cols-2"><Skel className="h-32" /><Skel className="h-32" /></div>
        : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
        : q.data.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600" data-testid="text-no-card-types">No cards are on sale right now. Contact support if you need one.</p>
        : (
          <ul className="grid gap-3 md:grid-cols-2" data-testid="list-card-types">
            {q.data.map((t) => (
              <li key={t.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={`card-type-${t.key}`}>
                <p className="flex items-center gap-2 font-semibold text-slate-900"><CreditCard className="h-5 w-5 text-[#1E3A8A]" aria-hidden />{t.name}</p>
                <div className="mt-3 space-y-2">
                  {(['Virtual', 'Physical'] as const).map((kind) => {
                    const p = kind === 'Virtual' ? t.virtual : t.physical;
                    if (!p || p.total === null) return null;
                    const has = holds(kind);
                    return (
                      <div key={kind} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-800">{kind}</span>
                          <span className="block text-xs tabular-nums text-slate-500" data-testid={`text-card-price-${t.key}-${kind.toLowerCase()}`}>
                            {p.total === 0 ? 'Free' : money(p.total)}{breakdown(p) ? ` (${breakdown(p)})` : ''}
                          </span>
                        </span>
                        <button type="button" className={outline} disabled={has || paused} title={has ? `You already have a ${kind.toLowerCase()} card` : paused ? 'Your account is paused' : undefined}
                          onClick={() => setChoice({ t, kind, p })} data-testid={`button-buy-${t.key}-${kind.toLowerCase()}`}>
                          {has ? 'You have one' : 'Buy'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      <BuyCardModal choice={choice} a={a} onClose={() => setChoice(null)} />
    </section>
  );
}

function BuyCardModal({ choice, a, onClose }: { choice: Choice | null; a: ApplicantAccount; onClose: () => void }) {
  const buy = useBuyApplicantCard();
  const refresh = useRefreshApplicant();
  const { toast } = useToast();
  const [error, setError] = useState('');
  const close = () => { setError(''); onClose(); };
  const total = choice?.p.total ?? 0;
  const short = total > a.availableToWithdraw.deposit;
  return (
    <Modal open={!!choice} onClose={close} title={choice ? `Buy a ${choice.kind.toLowerCase()} ${choice.t.name} card?` : ''} testid="dialog-buy-card">
      {choice && (
        <div className="space-y-4">
          <dl className="space-y-1 rounded-xl bg-slate-50 p-4 text-sm tabular-nums" data-testid="text-buy-summary">
            <div className="flex justify-between"><dt>Card</dt><dd>{money(choice.p.price ?? 0)}</dd></div>
            <div className="flex justify-between"><dt>Fee</dt><dd>{money(Math.round((total - (choice.p.price ?? 0)) * 100) / 100)}</dd></div>
            <div className="flex justify-between border-t pt-1 font-semibold"><dt>Total, from your deposit balance</dt><dd>{money(total)}</dd></div>
          </dl>
          <p className="text-sm text-slate-600">{choice.kind === 'Virtual' ? 'Your virtual card is ready to use straight away.' : 'Your physical card is posted to you. Once it arrives, ask us to activate it from this page.'} Sample card: no real card network is connected.</p>
          {short && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="text-buy-short">Your deposit balance has {money(a.availableToWithdraw.deposit)} available. Add funds first.</p>}
          {error && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-buy-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="press min-h-11 rounded-full px-4 text-sm font-semibold hover:bg-slate-100">Cancel</button>
            <button type="button" className={primary} disabled={buy.isPending || short} data-testid="button-buy-confirm" onClick={() => {
              setError('');
              buy.mutate({ data: { type: choice.t.key, kind: choice.kind } }, {
                onSuccess: () => { refresh(); close(); toast({ title: `${choice.t.name} ${choice.kind.toLowerCase()} card bought`, description: total ? `${money(total)} was paid from your deposit balance.` : undefined }); },
                onError: (e) => setError(apiError(e, 'The card could not be bought. Please try again.')),
              });
            }}>{buy.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{total ? `Pay ${money(total)}` : 'Get it free'}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** "Top up" on an active card: moves money from the deposit balance to the card account, with no fee. */
export function CardTopUp({ c, a }: { c: UserCard; a: ApplicantAccount }) {
  const top = useTopUpApplicantCard();
  const refresh = useRefreshApplicant();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  if (c.status !== 'Active') return null;
  const paused = a.status === 'Frozen' || a.platformFrozen;
  const available = a.availableToWithdraw.deposit;
  const n = Number(amount);
  const close = () => { setOpen(false); setAmount(''); setError(''); };
  return (
    <>
      <button type="button" className={primary} disabled={paused} onClick={() => setOpen(true)} data-testid={`button-own-card-topup-${c.id}`}><Plus className="h-4 w-4" />Top up</button>
      <Modal open={open} onClose={close} title={`Top up ${c.typeName} •• ${c.lastFour}`} testid="dialog-own-topup">
        <form className="space-y-3" noValidate onSubmit={(e) => {
          e.preventDefault();
          if (!(n >= 0.01) || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return setError('Enter an amount of at least $0.01 with at most two decimals.');
          if (n > available) return setError(`Your deposit balance has ${money(available)} available.`);
          setError('');
          top.mutate({ cardId: c.id, data: { amount: n } }, {
            onSuccess: () => { refresh(); close(); toast({ title: `${money(n)} added to your card`, description: 'From your deposit balance.' }); },
            onError: (e2) => setError(apiError(e2, 'The top-up could not be made. Please try again.')),
          });
        }}>
          <p className="text-sm text-slate-600">Moves money from your deposit balance ({money(available)} available) to your card. No fee.</p>
          <Field label="Amount (USD)">
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
              <input type="number" min={0.01} step="0.01" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }}
                placeholder="0.00" className={cx(inputCls, 'min-h-11 pl-7 tabular-nums')} data-testid="input-own-topup-amount" />
            </div>
          </Field>
          {error && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-own-topup-error">{error}</p>}
          <button className={cx(primary, 'w-full')} disabled={top.isPending} data-testid="button-own-topup-confirm">{top.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Top up{n > 0 ? ` ${money(n)}` : ''}</button>
        </form>
      </Modal>
    </>
  );
}
