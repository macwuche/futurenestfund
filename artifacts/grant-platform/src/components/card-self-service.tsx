import { useState } from 'react';
import { useChangeApplicantCard, type ApplicantCardActionInputAction, type UserCard } from '@workspace/api-client-react';
import { Info, Loader2, Snowflake } from 'lucide-react';
import { Modal, cx, dateFmt, statusLabel } from '@/components/bits';
import { apiError, useRefreshApplicant } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

const primary = 'press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[#1E3A8A] px-4 text-sm font-semibold text-white hover:bg-[#0F172A] disabled:opacity-60';
const outline = 'press inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60';
const sentence = (s: string) => `${s}${/[.!?]$/.test(s) ? '' : '.'}`;

/**
 * The applicant's own card controls: freeze, unfreeze a card they froze (an administrator's freeze stays locked),
 * ask for a delivered physical card to be activated, and a details sheet. Cards are samples with no card network.
 */
export function OwnCardControls({ c, accountFrozen }: { c: UserCard; accountFrozen: boolean }) {
  const change = useChangeApplicantCard();
  const refresh = useRefreshApplicant();
  const { toast } = useToast();
  const [details, setDetails] = useState(false);
  const byAdmin = c.status === 'Frozen' && c.frozenBy !== 'user';
  const run = (action: ApplicantCardActionInputAction) => change.mutate({ cardId: c.id, data: { action } }, {
    onSuccess: () => {
      refresh();
      toast({
        freeze: { title: `Card •• ${c.lastFour} frozen`, description: 'Unfreeze it any time from this page.' },
        unfreeze: { title: `Card •• ${c.lastFour} is active again` },
        'request-activation': { title: 'Activation requested', description: 'An administrator will activate your card. You’ll get a notification.' },
      }[action]);
    },
    onError: (e) => toast({ title: 'Couldn’t change the card', description: apiError(e, 'Please try again.'), variant: 'destructive' }),
  });
  const busy = (action: ApplicantCardActionInputAction) => change.isPending && change.variables?.data.action === action;
  const spin = (action: ApplicantCardActionInputAction) => busy(action) && <Loader2 className="h-4 w-4 animate-spin" />;
  return (
    <>
      {c.status === 'Frozen' && (
        <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900" data-testid={`text-card-frozen-${c.id}`}>
          {byAdmin
            ? <>Frozen by an administrator{c.statusReason ? `: ${sentence(c.statusReason)}` : '.'} Only they can unfreeze it; contact support if you think this is a mistake.</>
            : <>You froze this card. It can’t be topped up until you unfreeze it.</>}
        </p>
      )}
      {c.status === 'Pending' && c.kind === 'Physical' && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid={`text-card-activation-${c.id}`}>
          {c.activationRequestedAt
            ? `You asked for this card to be activated on ${dateFmt(c.activationRequestedAt)}. An administrator will activate it and you’ll get a notification.`
            : c.activationDeclinedReason
              ? <><span className="font-semibold text-slate-900" data-testid={`text-card-declined-${c.id}`}>Activation declined: {sentence(c.activationDeclinedReason)}</span> Once you have the right card, ask us again.</>
              : 'Has your card arrived? Ask us to activate it.'}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {c.status === 'Active' && (
          <button data-testid={`button-own-card-freeze-${c.id}`} disabled={change.isPending} onClick={() => run('freeze')} className={outline}>
            {spin('freeze') || <Snowflake className="h-4 w-4" />}Freeze card
          </button>
        )}
        {c.status === 'Frozen' && !byAdmin && (
          <button data-testid={`button-own-card-unfreeze-${c.id}`} disabled={change.isPending || accountFrozen} title={accountFrozen ? 'Your account is frozen' : undefined} onClick={() => run('unfreeze')} className={primary}>
            {spin('unfreeze')}Unfreeze card
          </button>
        )}
        {c.status === 'Pending' && c.kind === 'Physical' && !c.activationRequestedAt && (
          <button data-testid={`button-own-card-activate-${c.id}`} disabled={change.isPending || accountFrozen} title={accountFrozen ? 'Your account is frozen' : undefined} onClick={() => run('request-activation')} className={primary}>
            {spin('request-activation')}It’s arrived: activate
          </button>
        )}
        <button data-testid={`button-card-details-${c.id}`} onClick={() => setDetails(true)} className={outline}><Info className="h-4 w-4" />Card details</button>
      </div>
      <Modal open={details} onClose={() => setDetails(false)} title={`${c.kind} ${c.network} card`} testid="dialog-card-details">
        <dl className="divide-y divide-slate-100 text-sm" data-testid={`list-card-details-${c.id}`}>
          {[
            ['Card number', `•••• •••• •••• ${c.lastFour}`],
            ['Type', c.kind],
            ['Network', c.network],
            ['Status', c.status === 'Pending' ? 'Being issued' : c.status === 'Frozen' ? `Frozen by ${byAdmin ? 'an administrator' : 'you'}` : statusLabel(c.status)],
            ...(c.issuedAt ? [['Issued', dateFmt(c.issuedAt)]] : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium tabular-nums text-slate-900">{v}</dd></div>
          ))}
        </dl>
        <p className={cx('mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600')}>
          This is a sample card. No card network is connected, so there is no full card number, expiry date or security code to show.
        </p>
      </Modal>
    </>
  );
}
