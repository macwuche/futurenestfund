import { useEffect, useState } from 'react';
import { useRevealAdminPaymentCard, type CardFlag, type CardReveal, type CardNetwork } from '@workspace/api-client-react';
import { CalendarX, CircleAlert, Copy, Eye, EyeOff, ShieldAlert, ShieldQuestion, Users } from 'lucide-react';
import { Modal, cx } from '@/components/bits';
import { ghost } from '@/components/admin-bits';
import { CardFace } from '@/components/payment-cards';
import { apiError } from '@/lib/demo-state';

/** Card payments (Phase 13), admin side: what each flag looks like, and the audited "Show card details". */

const FLAG_STYLE: Record<CardFlag['kind'], { cls: string; Icon: typeof CircleAlert }> = {
  blocked: { cls: 'bg-red-100 text-red-900', Icon: ShieldAlert },
  reported: { cls: 'bg-red-100 text-red-900', Icon: ShieldAlert },
  expired: { cls: 'bg-red-50 text-red-800', Icon: CalendarX },
  expiring: { cls: 'bg-amber-50 text-amber-900', Icon: CalendarX },
  duplicate: { cls: 'bg-amber-50 text-amber-900', Icon: Users },
  review: { cls: 'bg-slate-100 text-slate-700', Icon: ShieldQuestion },
};

export function FlagChips({ flags, testid, hideReview }: { flags: CardFlag[]; testid?: string; hideReview?: boolean }) {
  const shown = hideReview ? flags.filter((f) => f.kind !== 'review') : flags;
  if (!shown.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" data-testid={testid}>
      {shown.map((f) => {
        const { cls, Icon } = FLAG_STYLE[f.kind];
        return <li key={f.kind + f.text} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', cls)} data-testid={testid ? `${testid}-${f.kind}` : undefined}><Icon className="h-3 w-3 shrink-0" />{f.text}</li>;
      })}
    </ul>
  );
}

/** A saved card's status, admin wording. */
export function SavedCardStatus({ status, expired }: { status: string; expired?: boolean }) {
  const map: Record<string, string> = { Pending: 'bg-amber-50 text-amber-900', Active: 'bg-green-50 text-green-800', Declined: 'bg-red-50 text-red-800', Blocked: 'bg-red-100 text-red-900', Removed: 'bg-slate-100 text-slate-600' };
  return (
    <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', expired && status !== 'Blocked' && status !== 'Removed' ? 'bg-red-50 text-red-800' : map[status] ?? map.Active)} data-testid={`badge-saved-card-${status}`}>
      {status === 'Pending' ? 'To review' : status}{expired && status !== 'Removed' ? ' · expired' : ''}
    </span>
  );
}

function CopyRow({ label, value, testid, mono = true }: { label: string; value: string; testid: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className={cx('truncate text-base font-semibold text-slate-900', mono && 'font-num tracking-wider')} data-testid={testid}>{value}</p>
      </div>
      <button type="button" aria-label={`Copy ${label}`} onClick={() => navigator.clipboard?.writeText(value.replace(/ /g, mono ? '' : ' ')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {})}
        className="press inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-white"><Copy className="h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

/**
 * "Show card details": asks the server for the full number and CVV (each view is written to the audit log), shows them
 * in a dialog, and forgets them when it closes.
 */
export function RevealCardButton({ cardId, network, small, label = 'Show card details' }: { cardId: string; network: CardNetwork; small?: boolean; label?: string }) {
  const m = useRevealAdminPaymentCard();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CardReveal | null>(null);
  const [err, setErr] = useState('');
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (!open) { setData(null); setErr(''); setHidden(false); } }, [open]);
  // Closing after two minutes keeps the details from sitting on an unattended screen.
  useEffect(() => { if (!data) return; const t = setTimeout(() => setOpen(false), 120_000); return () => clearTimeout(t); }, [data]);
  const show = () => {
    setOpen(true);
    m.mutate({ cardId }, { onSuccess: setData, onError: (e) => setErr(apiError(e, "The card details couldn't be opened.")) });
  };
  return (
    <>
      <button type="button" onClick={show} data-testid={`button-reveal-card-${cardId}`} className={cx(ghost, 'inline-flex items-center gap-1.5', small && '!py-1.5 text-xs')}>
        <Eye className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} />{label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Card details" testid="dialog-reveal-card">
        {m.isPending && !data ? <p className="text-sm text-slate-500">Opening…</p>
          : err ? <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]">{err}</p>
          : data && (
            <div className="space-y-3">
              <CardFace network={network} digits={hidden ? undefined : data.number.replace(/ /g, '')} lastFour={data.number.slice(-4)} holderName={data.holderName} expiry={data.expiry} />
              <div className="flex justify-end">
                <button type="button" onClick={() => setHidden((h) => !h)} className="press inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900" data-testid="button-toggle-card-digits">
                  {hidden ? <><Eye className="h-3.5 w-3.5" />Show</> : <><EyeOff className="h-3.5 w-3.5" />Hide</>}
                </button>
              </div>
              {!hidden && (
                <>
                  <CopyRow label="Card number" value={data.number} testid="text-reveal-number" />
                  <div className="grid grid-cols-2 gap-2">
                    <CopyRow label="Expiry" value={data.expiry} testid="text-reveal-expiry" />
                    <CopyRow label="CVV" value={data.cvv} testid="text-reveal-cvv" />
                  </div>
                  <CopyRow label="Name on card" value={data.holderName} testid="text-reveal-holder" mono={false} />
                </>
              )}
              <p className="flex items-start gap-2 text-xs text-slate-500"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />This view was recorded in the audit log. The details close by themselves after two minutes.</p>
            </div>
          )}
      </Modal>
    </>
  );
}
