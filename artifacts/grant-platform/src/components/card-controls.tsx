import { useState } from 'react';
import { useChangeUserCard, useIssueUserCard, useListAdminCardTypes, useTopUpUserCard, type AdminUserProfile, type CardActionInputAction, type CardTypeKey, type UserCard } from '@workspace/api-client-react';
import { CreditCard, Loader2, Plus } from 'lucide-react';
import { Empty, Field, Modal, StatusBadge, cx, dateFmt, money } from '@/components/bits';
import { ainput, dark, ghost, lime, ReasonModal, useAdminRefresh } from '@/components/admin-bits';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

const small = 'inline-flex min-h-11 items-center gap-1 text-xs md:min-h-0 md:!py-1.5';

/**
 * Admin card controls on the user profile: issue a card, mark a physical card as issued, freeze (with a reason),
 * unfreeze, cancel (with a reason). Cards are samples; no card network is connected.
 */
export function CardControls({ u }: { u: AdminUserProfile }) {
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const change = useChangeUserCard();
  const [issuing, setIssuing] = useState(false);
  const [topping, setTopping] = useState<UserCard | null>(null);
  const [asking, setAsking] = useState<null | { card: UserCard; action: 'freeze' | 'cancel' }>(null);
  const [error, setError] = useState('');
  const accountFrozen = u.status === 'Frozen';
  const live = u.cards.filter((c) => c.status !== 'Cancelled');
  const cancelled = u.cards.filter((c) => c.status === 'Cancelled');
  const run = (card: UserCard, action: CardActionInputAction, reason?: string) => {
    setError('');
    change.mutate({ userId: u.id, cardId: card.id, data: { action, ...(reason ? { reason } : {}) } }, {
      onSuccess: () => {
        refresh(); setAsking(null);
        toast({ title: `Card •• ${card.lastFour} ${{ activate: 'is now active', freeze: 'frozen', unfreeze: 'unfrozen', cancel: 'cancelled' }[action]}`, description: `${u.name} has been notified.` });
      },
      onError: (e) => { const msg = apiError(e, 'The card could not be changed.'); if (asking) setError(msg); else toast({ title: "Couldn't change the card", description: msg, variant: 'destructive' }); },
    });
  };
  const busy = (card: UserCard, action: CardActionInputAction) => change.isPending && change.variables?.cardId === card.id && change.variables.data.action === action;
  return (
    <div className="mt-4 space-y-3" data-testid="section-cards">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Cards</h4>
        <button data-testid="button-issue-card" disabled={accountFrozen} title={accountFrozen ? 'Unfreeze the account first' : undefined} onClick={() => setIssuing(true)} className={cx(dark, small)}><Plus className="h-3.5 w-3.5" />Issue card</button>
      </div>
      {accountFrozen && <p className="text-xs text-slate-500">Card changes are paused while the account is frozen.</p>}
      {live.length === 0 ? <Empty title="No cards issued" hint="Issue a virtual card (active at once) or a physical card (pending until delivered)." /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {live.map((c) => (
            <div key={c.id} data-testid={`card-user-${c.id}`} className={cx('rounded-xl p-4 text-white', c.kind === 'Physical' ? 'bg-[#111]' : 'bg-gradient-to-br from-slate-800 to-slate-600', c.status === 'Frozen' && 'opacity-90 ring-2 ring-sky-300')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{c.kind} {c.typeName} <span className="font-num opacity-70">•• {c.lastFour}</span></p>
                  <p className="font-num text-lg" data-testid={`text-user-card-balance-${c.id}`}>{c.status === 'Pending' ? 'Awaiting delivery' : money(c.balance)}</p>
                  <StatusBadge status={c.status} testid={`badge-card-${c.id}`} />
                  {c.statusReason && <p className="mt-1 break-words text-xs text-white/80" data-testid={`text-card-reason-${c.id}`}>{c.statusReason}</p>}
                  {c.status === 'Frozen' && c.frozenBy === 'user' && <p className="mt-1 text-xs text-white/80" data-testid={`text-card-frozen-by-${c.id}`}>Frozen by the user. Freeze it yourself to lock it.</p>}
                  {c.status === 'Pending' && c.activationRequestedAt && <p className="mt-1 text-xs font-semibold text-[#C6F432]" data-testid={`text-card-activation-requested-${c.id}`}>User says it arrived · activation requested {dateFmt(c.activationRequestedAt)}</p>}
                  {c.status === 'Pending' && !c.activationRequestedAt && c.activationDeclinedReason && <p className="mt-1 text-xs text-slate-300" data-testid={`text-card-activation-declined-${c.id}`}>Last activation request declined{c.activationDeclinedAt ? ` ${dateFmt(c.activationDeclinedAt)}` : ''}: {c.activationDeclinedReason}</p>}
                </div>
                <CreditCard className="h-5 w-5 shrink-0 opacity-60" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {c.status === 'Pending' && <button data-testid={`button-card-activate-${c.id}`} disabled={change.isPending || accountFrozen} onClick={() => run(c, 'activate')} className={cx(lime, small)}>{busy(c, 'activate') && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Mark as issued</button>}
                {c.status === 'Active' && <button data-testid={`button-topup-${c.id}`} disabled={accountFrozen} onClick={() => setTopping(c)} className={cx(lime, small)}>Top up</button>}
                {(c.status === 'Active' || (c.status === 'Frozen' && c.frozenBy === 'user')) && <button data-testid={`button-card-freeze-${c.id}`} disabled={change.isPending || accountFrozen} onClick={() => { setError(''); setAsking({ card: c, action: 'freeze' }); }} className={cx(ghost, small)}>Freeze</button>}
                {c.status === 'Frozen' && <button data-testid={`button-card-unfreeze-${c.id}`} disabled={change.isPending || accountFrozen} onClick={() => run(c, 'unfreeze')} className={cx(lime, small)}>{busy(c, 'unfreeze') && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Unfreeze</button>}
                <button data-testid={`button-card-cancel-${c.id}`} disabled={change.isPending || accountFrozen} onClick={() => { setError(''); setAsking({ card: c, action: 'cancel' }); }} className={cx('press rounded-lg px-3 font-semibold text-red-200 hover:bg-white/10 disabled:opacity-50', small)}>Cancel card</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {cancelled.length > 0 && (
        <details className="text-sm" data-testid="list-cancelled-cards">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">Cancelled cards ({cancelled.length})</summary>
          <ul className="mt-2 space-y-1">{cancelled.map((c) => <li key={c.id} className="text-xs text-slate-500">{c.kind} {c.typeName} •• {c.lastFour}{c.statusReason ? ` · ${c.statusReason}` : ''}</li>)}</ul>
        </details>
      )}
      <IssueCardModal open={issuing} onClose={() => setIssuing(false)} u={u} />
      <TopUpModal card={topping} onClose={() => setTopping(null)} u={u} />
      <ReasonModal open={!!asking} testid={`card-${asking?.action ?? 'freeze'}`} pending={change.isPending} error={error}
        title={asking?.action === 'cancel' ? `Cancel card •• ${asking.card.lastFour}?` : `Freeze card •• ${asking?.card.lastFour ?? ''}?`}
        intro={asking?.action === 'cancel'
          ? <p>Cancelling is permanent: the card can't be used or reactivated. {asking.card.kind === 'Virtual' ? 'The card account balance stays on the account and can be moved to a new card.' : ''} {u.name} is notified with your reason.</p>
          : <p>A frozen card can't be topped up until it's unfrozen{asking?.card.status === 'Frozen' ? ', and the user can no longer unfreeze it themselves' : ''}. {u.name} is notified with your reason.</p>}
        confirmLabel={asking?.action === 'cancel' ? 'Cancel card' : 'Freeze card'}
        onClose={() => setAsking(null)} onSubmit={(reason) => asking && run(asking.card, asking.action, reason)} />
    </div>
  );
}

function IssueCardModal({ open, onClose, u }: { open: boolean; onClose: () => void; u: AdminUserProfile }) {
  const issue = useIssueUserCard();
  const types = useListAdminCardTypes();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [kind, setKind] = useState<'Virtual' | 'Physical'>('Virtual');
  const [type, setType] = useState<CardTypeKey>('visa-debit');
  const [free, setFree] = useState(false);
  const [error, setError] = useState('');
  const taken = (k: string) => u.cards.some((c) => c.kind === k && c.status !== 'Cancelled');
  const chosen = types.data?.find((t) => t.key === type);
  const price = chosen ? (kind === 'Virtual' ? chosen.virtual : chosen.physical) : undefined;
  const charge = !free && price?.total ? price.total : 0;
  return (
    <Modal open={open} onClose={() => { setError(''); onClose(); }} title="Issue a card" testid="dialog-issue-card">
      <form className="space-y-3" noValidate onSubmit={(e) => {
        e.preventDefault();
        if (taken(kind)) return setError(`${u.name} already has a ${kind.toLowerCase()} card. Cancel it before issuing another.`);
        if (charge > u.balances.deposit) return setError(`This card costs ${money(charge)} and ${u.name}'s deposit balance is ${money(u.balances.deposit)}. Tick "Free of charge" to issue it without charging.`);
        setError('');
        issue.mutate({ userId: u.id, data: { kind, type, ...(free ? { freeOfCharge: true } : {}) } }, {
          onSuccess: () => { refresh(); onClose(); toast({ title: kind === 'Virtual' ? 'Virtual card issued and active' : 'Physical card issued: pending delivery', description: `${charge ? `${money(charge)} charged to the deposit balance. ` : ''}${u.name} has been notified.` }); },
          onError: (e2) => setError(apiError(e2, 'The card could not be issued.')),
        });
      }}>
        <p className="rounded-lg bg-[#F7FADC] p-3 text-xs text-slate-700">Sample card: no card network is connected and the number is random. A virtual card is active at once; a physical card stays pending until you mark it as issued. One card of each kind per user.</p>
        <Field label="Virtual or physical"><select data-testid="select-card-kind" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setError(''); }} className={ainput}>
          <option value="Virtual">Virtual{taken('Virtual') ? ' (already has one)' : ''}</option><option value="Physical">Physical{taken('Physical') ? ' (already has one)' : ''}</option>
        </select></Field>
        <Field label="Card type"><select data-testid="select-card-type" value={type} onChange={(e) => { setType(e.target.value as CardTypeKey); setError(''); }} className={ainput}>
          {(types.data ?? []).map((t) => <option key={t.key} value={t.key}>{t.name}{t.enabled ? '' : ' (not on sale)'}</option>)}
        </select></Field>
        <p className="font-num rounded-lg bg-slate-50 px-3 py-2 text-sm" data-testid="text-issue-price">
          {!price || price.price === null ? 'No price set for this card: issued free.'
            : free ? `Free of charge (price ${money(price.total ?? 0)} waived).`
            : `${money(price.price)}${price.total !== price.price ? ` + fee ${money((price.total ?? 0) - price.price)}` : ''} = ${money(price.total ?? 0)}, charged to ${u.name}'s deposit balance (${money(u.balances.deposit)}).`}
        </p>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={free} onChange={(e) => { setFree(e.target.checked); setError(''); }} className="h-5 w-5 accent-[#111]" data-testid="check-issue-free" />
          Free of charge (don't charge the user)
        </label>
        {error && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-issue-error">{error}</p>}
        <button data-testid="button-issue-confirm" disabled={issue.isPending} className={cx(lime, 'w-full')}>{issue.isPending ? 'Issuing…' : charge ? `Issue and charge ${money(charge)}` : `Issue ${kind.toLowerCase()} card`}</button>
      </form>
    </Modal>
  );
}

/** Top up a card from the user's deposit balance (no fee). */
function TopUpModal({ card: c, onClose, u }: { card: UserCard | null; onClose: () => void; u: AdminUserProfile }) {
  const top = useTopUpUserCard();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const n = Number(amount);
  return (
    <Modal open={!!c} onClose={() => { setError(''); setAmount(''); onClose(); }} title="Top up card" testid="dialog-topup-card">
      {c && <form className="space-y-3" noValidate onSubmit={(e) => {
        e.preventDefault();
        if (!(n >= 0.01) || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return setError('Enter an amount of at least $0.01 with at most two decimals.');
        if (n > u.balances.deposit) return setError(`${u.name}'s deposit balance is ${money(u.balances.deposit)}.`);
        setError('');
        top.mutate({ userId: u.id, cardId: c.id, data: { amount: n } }, {
          onSuccess: () => { refresh(); setAmount(''); onClose(); toast({ title: `${money(n)} moved to the card`, description: `From ${u.name}'s deposit balance. They have been notified.` }); },
          onError: (e2) => setError(apiError(e2, 'The top-up was refused.')),
        });
      }}>
        <p className="text-sm text-slate-600">Moves money from {u.name}'s deposit balance to their card account ({c.typeName} •• {c.lastFour}). No fee. A ledger entry and an audit record are written, and the user is notified.</p>
        <Field label="Amount (USD)"><input data-testid="input-topup-amount" type="number" min={0.01} step="0.01" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} className={cx(ainput, 'font-num min-h-11')} /></Field>
        <p className="font-num text-sm" data-testid="text-topup-change">Deposit {money(u.balances.deposit)}{n > 0 ? ` → ${money(Math.round((u.balances.deposit - n) * 100) / 100)}` : ''} · Card {money(u.balances.card)}{n > 0 ? ` → ${money(Math.round((u.balances.card + n) * 100) / 100)}` : ''}</p>
        {error && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-topup-error">{error}</p>}
        <button data-testid="button-topup-confirm" disabled={top.isPending} className={cx(lime, 'w-full')}>{top.isPending ? 'Moving…' : 'Top up from deposit balance'}</button>
      </form>}
    </Modal>
  );
}
