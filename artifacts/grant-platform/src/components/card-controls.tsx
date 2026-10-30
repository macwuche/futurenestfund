import { useState } from 'react';
import { useChangeUserCard, useIssueUserCard, type AdminUserProfile, type CardActionInputAction, type UserCard } from '@workspace/api-client-react';
import { CreditCard, Loader2, Plus } from 'lucide-react';
import { Empty, Field, Modal, StatusBadge, cx, money } from '@/components/bits';
import { ainput, dark, ghost, lime, ReasonModal, useAdminRefresh } from '@/components/admin-bits';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

const small = 'inline-flex min-h-11 items-center gap-1 text-xs md:min-h-0 md:!py-1.5';

/**
 * Admin card controls on the user profile: issue a card, mark a physical card as issued, freeze (with a reason),
 * unfreeze, cancel (with a reason). Cards are samples; no card network is connected.
 */
export function CardControls({ u, onTopUp }: { u: AdminUserProfile; onTopUp: () => void }) {
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const change = useChangeUserCard();
  const [issuing, setIssuing] = useState(false);
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
                  <p className="text-sm font-semibold">{c.kind} {c.network} <span className="font-num opacity-70">•• {c.lastFour}</span></p>
                  <p className="font-num text-lg" data-testid={`text-user-card-balance-${c.id}`}>{c.status === 'Pending' ? 'Awaiting delivery' : money(c.balance)}</p>
                  <StatusBadge status={c.status} testid={`badge-card-${c.id}`} />
                  {c.statusReason && <p className="mt-1 break-words text-xs text-white/80" data-testid={`text-card-reason-${c.id}`}>{c.statusReason}</p>}
                </div>
                <CreditCard className="h-5 w-5 shrink-0 opacity-60" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {c.status === 'Pending' && <button data-testid={`button-card-activate-${c.id}`} disabled={change.isPending || accountFrozen} onClick={() => run(c, 'activate')} className={cx(lime, small)}>{busy(c, 'activate') && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Mark as issued</button>}
                {c.status === 'Active' && <button data-testid={`button-topup-${c.id}`} disabled={accountFrozen} onClick={onTopUp} className={cx(lime, small)}>Top up</button>}
                {c.status === 'Active' && <button data-testid={`button-card-freeze-${c.id}`} disabled={change.isPending || accountFrozen} onClick={() => { setError(''); setAsking({ card: c, action: 'freeze' }); }} className={cx(ghost, small)}>Freeze</button>}
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
          <ul className="mt-2 space-y-1">{cancelled.map((c) => <li key={c.id} className="text-xs text-slate-500">{c.kind} {c.network} •• {c.lastFour}{c.statusReason ? ` · ${c.statusReason}` : ''}</li>)}</ul>
        </details>
      )}
      <IssueCardModal open={issuing} onClose={() => setIssuing(false)} u={u} />
      <ReasonModal open={!!asking} testid={`card-${asking?.action ?? 'freeze'}`} pending={change.isPending} error={error}
        title={asking?.action === 'cancel' ? `Cancel card •• ${asking.card.lastFour}?` : `Freeze card •• ${asking?.card.lastFour ?? ''}?`}
        intro={asking?.action === 'cancel'
          ? <p>Cancelling is permanent: the card can't be used or reactivated. {asking.card.kind === 'Virtual' ? 'The card account balance stays on the account and can be moved to a new card.' : ''} {u.name} is notified with your reason.</p>
          : <p>A frozen card can't be topped up until it's unfrozen. {u.name} is notified with your reason.</p>}
        confirmLabel={asking?.action === 'cancel' ? 'Cancel card' : 'Freeze card'}
        onClose={() => setAsking(null)} onSubmit={(reason) => asking && run(asking.card, asking.action, reason)} />
    </div>
  );
}

function IssueCardModal({ open, onClose, u }: { open: boolean; onClose: () => void; u: AdminUserProfile }) {
  const issue = useIssueUserCard();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [kind, setKind] = useState<'Virtual' | 'Physical'>('Virtual');
  const [network, setNetwork] = useState<'Visa' | 'Mastercard'>('Visa');
  const [error, setError] = useState('');
  const taken = (k: string) => u.cards.some((c) => c.kind === k && c.status !== 'Cancelled');
  return (
    <Modal open={open} onClose={() => { setError(''); onClose(); }} title="Issue a card" testid="dialog-issue-card">
      <form className="space-y-3" noValidate onSubmit={(e) => {
        e.preventDefault();
        if (taken(kind)) return setError(`${u.name} already has a ${kind.toLowerCase()} card. Cancel it before issuing another.`);
        setError('');
        issue.mutate({ userId: u.id, data: { kind, network } }, {
          onSuccess: () => { refresh(); onClose(); toast({ title: kind === 'Virtual' ? 'Virtual card issued and active' : 'Physical card issued: pending delivery', description: `${u.name} has been notified.` }); },
          onError: (e2) => setError(apiError(e2, 'The card could not be issued.')),
        });
      }}>
        <p className="rounded-lg bg-[#F7FADC] p-3 text-xs text-slate-700">Sample card: no card network is connected and the number is random. A virtual card is active at once; a physical card stays pending until you mark it as issued. One card of each kind per user.</p>
        <Field label="Card type"><select data-testid="select-card-kind" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setError(''); }} className={ainput}>
          <option value="Virtual">Virtual{taken('Virtual') ? ' (already has one)' : ''}</option><option value="Physical">Physical{taken('Physical') ? ' (already has one)' : ''}</option>
        </select></Field>
        <Field label="Network"><select data-testid="select-card-network" value={network} onChange={(e) => setNetwork(e.target.value as typeof network)} className={ainput}>
          <option value="Visa">Visa</option><option value="Mastercard">Mastercard</option>
        </select></Field>
        {error && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-issue-error">{error}</p>}
        <button data-testid="button-issue-confirm" disabled={issue.isPending} className={cx(lime, 'w-full')}>{issue.isPending ? 'Issuing…' : `Issue ${kind.toLowerCase()} card`}</button>
      </form>
    </Modal>
  );
}
