import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateApplicantPaymentCard, getListApplicantPaymentCardsQueryKey, type CardNetwork, type SavedCard,
} from '@workspace/api-client-react';
import { CircleAlert, CreditCard, Lock, Plus, ShieldCheck } from 'lucide-react';
import { Modal, cx } from '@/components/bits';
import { apiError } from '@/lib/demo-state';

/**
 * Card payments (Phase 13): the pieces customers see when they save the physical card they collected at the office and
 * pick it for a deposit or withdrawal. The card visual is also used on the admin side.
 */

/** Same rules as the server's cardRules.ts, so the preview and the network mark follow the digits as they're typed. */
export function networkOf(digits: string): CardNetwork {
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^(5061|5078|5079|650002|650027|507865|507866)/.test(digits)) return 'verve';
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(digits)) return 'mastercard';
  if (/^(6011|65|64[4-9])/.test(digits)) return 'discover';
  return 'other';
}
export const NETWORK_NAME: Record<CardNetwork, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', verve: 'Verve', discover: 'Discover', other: 'Card' };

function luhnOk(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
}
/** Group characters as a card prints them: 4-4-4-4…, Amex 4-6-5. */
function groupChars(s: string, amex: boolean) {
  if (amex) return [s.slice(0, 4), s.slice(4, 10), s.slice(10, 15)].filter(Boolean).join(' ');
  return (s.match(/.{1,4}/g) ?? []).join(' ');
}
export const groupDigits = (digits: string) => groupChars(digits, networkOf(digits) === 'amex');

/** The network's mark, drawn (no third-party images). `tone` light = for a coloured card face. */
export function NetworkMark({ network, tone = 'dark', className }: { network: CardNetwork; tone?: 'dark' | 'light'; className?: string }) {
  const light = tone === 'light';
  if (network === 'mastercard') {
    return (
      <span className={cx('relative inline-flex h-6 w-10 shrink-0 items-center', className)} aria-label="Mastercard" role="img">
        <span className="absolute left-0 h-6 w-6 rounded-full bg-[#EB001B]" />
        <span className="absolute left-4 h-6 w-6 rounded-full bg-[#F79E1B] mix-blend-multiply" style={{ opacity: 0.9 }} />
      </span>
    );
  }
  if (network === 'visa') return <span role="img" aria-label="Visa" className={cx('shrink-0 text-lg font-black italic tracking-tight', light ? 'text-white' : 'text-[#1A1F71]', className)}>VISA</span>;
  if (network === 'amex') return <span role="img" aria-label="American Express" className={cx('shrink-0 rounded bg-[#2E77BC] px-1.5 py-0.5 text-[10px] font-black tracking-wider text-white', className)}>AMEX</span>;
  if (network === 'verve') return <span role="img" aria-label="Verve" className={cx('shrink-0 text-base font-extrabold', light ? 'text-white' : 'text-[#00425F]', className)}>Verve</span>;
  if (network === 'discover') return <span role="img" aria-label="Discover" className={cx('shrink-0 text-xs font-black tracking-wider', light ? 'text-white' : 'text-[#E55C20]', className)}>DISCOVER</span>;
  return <CreditCard aria-label="Card" className={cx('h-6 w-6 shrink-0', light ? 'text-white' : 'text-slate-500', className)} />;
}

/** A network mark in a small tile, for lists (like the reference's method rows). */
export function NetworkTile({ network }: { network: CardNetwork }) {
  return <span className="grid h-11 w-14 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white"><NetworkMark network={network} className="scale-90" /></span>;
}

/**
 * The card's face: brand colour with a dotted texture, chip, number, holder and expiry. `digits` shows a number as it's
 * typed (preview); otherwise only the last four are known.
 */
export function CardFace({ network, lastFour, digits, holderName, expiry, muted, className, testid }: {
  network: CardNetwork; lastFour?: string; digits?: string; holderName?: string; expiry?: string; muted?: boolean; className?: string; testid?: string;
}) {
  const amex = network === 'amex';
  // While typing: the digits so far, the rest as dots, grouped the way the card prints them.
  const shown = digits !== undefined
    ? groupChars(digits.padEnd(Math.max(digits.length, amex ? 15 : 16), '•'), amex)
    : amex ? `•••• •••••• •${lastFour ?? '••••'}` : `•••• •••• •••• ${lastFour ?? '••••'}`;
  return (
    <div data-testid={testid} className={cx('relative aspect-[1.586] w-full overflow-hidden rounded-2xl p-5 text-[var(--brand-fg)] shadow-lg', muted && 'grayscale', className)}
      style={{ background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand-dark) 100%)', containerType: 'inline-size' }}>
      {/* Dotted texture, like the printed card. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-25" style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1.2px)', backgroundSize: '7px 7px', maskImage: 'linear-gradient(200deg, black 0%, transparent 60%)', WebkitMaskImage: 'linear-gradient(200deg, black 0%, transparent 60%)' }} />
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10" />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <NetworkMark network={network} tone="light" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] opacity-80">Physical card</span>
        </div>
        <div>
          <p className="font-num whitespace-nowrap font-semibold tracking-[0.1em]" style={{ fontSize: 'clamp(0.7rem, 5.6cqw, 1.4rem)' }} data-testid={testid ? `${testid}-number` : undefined}>{shown}</p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-widest opacity-70">Card holder</p>
              <p className="truncate text-sm font-semibold uppercase tracking-wide">{holderName?.trim() || 'Your name'}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[9px] uppercase tracking-widest opacity-70">Expires</p>
              <p className="font-num text-sm font-semibold">{expiry || 'MM/YY'}</p>
            </div>
            {/* The chip. */}
            <span aria-hidden className="hidden h-8 w-11 shrink-0 rounded-md border border-white/40 bg-gradient-to-br from-amber-200/80 to-amber-400/70 sm:block" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** What the card's status means for the customer. */
export function cardStatusText(c: SavedCard) {
  if (c.status === 'Blocked') return c.blockedReason ?? 'Blocked. Contact support.';
  if (c.expired) return 'Expired';
  if (c.status === 'Pending') return 'Being checked by our team';
  return 'Verified';
}
export function CardStatusChip({ c }: { c: SavedCard }) {
  const bad = c.status === 'Blocked' || c.expired || !c.usable;
  const tone = bad ? 'bg-red-50 text-red-800' : c.status === 'Pending' ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-800';
  const label = c.status === 'Blocked' ? 'Blocked' : c.expired ? 'Expired' : !c.usable ? "Can't be used" : c.status === 'Pending' ? 'Being checked' : 'Verified';
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', tone)} data-testid={`chip-card-status-${c.id}`}>{c.status === 'Verified' && !bad && <ShieldCheck className="h-3 w-3" />}{label}</span>;
}

/* ---------- adding a card ---------- */

const onlyDigits = (s: string) => s.replace(/\D/g, '');
/** "0829" → "08/29" while typing. */
function formatExpiry(raw: string, prev: string) {
  const d = onlyDigits(raw).slice(0, 4);
  if (raw.length < prev.length && prev.endsWith('/') && !raw.includes('/')) return d.slice(0, 1);
  if (d.length === 1 && Number(d) > 1) return `0${d}/`;
  if (d.length >= 2) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return d;
}

type Errors = Partial<Record<'holderName' | 'number' | 'expiry' | 'cvv', string>>;
function check(v: { holderName: string; digits: string; expiry: string; cvv: string }): Errors {
  const e: Errors = {};
  const network = networkOf(v.digits);
  if (v.holderName.trim().length < 2) e.holderName = 'Enter the name on the card.';
  else if (/\d/.test(v.holderName)) e.holderName = "The name can't contain numbers.";
  if (!v.digits) e.number = 'Enter the card number.';
  else if (v.digits.length < 12) e.number = 'A card number has 12 to 19 digits.';
  else if (!luhnOk(v.digits)) e.number = "This number isn't valid. Check it against your card.";
  const m = /^(\d{2})\/(\d{2})$/.exec(v.expiry);
  if (!m) e.expiry = 'Use MM/YY.';
  else {
    const month = Number(m[1]); const year = 2000 + Number(m[2]); const now = new Date();
    if (month < 1 || month > 12) e.expiry = 'The month is 01 to 12.';
    else if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) e.expiry = 'This card has expired.';
  }
  const len = network === 'amex' ? 4 : 3;
  if (!new RegExp(`^\\d{${len}}$`).test(v.cvv)) e.cvv = `${len} digits.`;
  return e;
}

/** The Add Card sheet: a live card preview, then the card's details. */
export function AddCardDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (c: SavedCard) => void }) {
  const qc = useQueryClient();
  const m = useCreateApplicantPaymentCard();
  const [holderName, setHolder] = useState('');
  const [digits, setDigits] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setHolder(''); setDigits(''); setExpiry(''); setCvv(''); setErrors({}); setErr(''); } }, [open]);
  const network = networkOf(digits);
  const maxLen = network === 'amex' ? 15 : 19;
  const complete = holderName.trim().length >= 2 && digits.length >= 12 && expiry.length === 5 && cvv.length >= 3;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const found = check({ holderName, digits, expiry, cvv });
    setErrors(found);
    if (Object.keys(found).length) return;
    setErr('');
    m.mutate({ data: { holderName: holderName.trim(), number: digits, expiry, cvv } }, {
      onSuccess: (card) => { qc.invalidateQueries({ queryKey: getListApplicantPaymentCardsQueryKey() }); onSaved?.(card); onClose(); },
      onError: (e2) => setErr(apiError(e2, "The card couldn't be saved. Please try again.")),
    });
  };
  const box = (bad?: string) => cx('w-full min-h-12 rounded-xl border px-3.5 text-sm outline-none transition focus:bg-white focus:ring-2 focus:ring-[var(--brand-ink)]/20',
    bad ? 'border-red-400 bg-red-50' : 'border-transparent bg-slate-100 focus:border-[var(--brand-ink)]');
  return (
    <Modal open={open} onClose={onClose} title="Add card" testid="dialog-add-card">
      <form noValidate onSubmit={submit} className="space-y-4">
        <CardFace network={network} digits={digits} holderName={holderName} expiry={expiry} testid="preview-add-card" />
        <p className="flex items-start gap-2 rounded-xl bg-[var(--brand-soft)] px-3 py-2 text-xs text-slate-700">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-ink)]" />
          Only the physical card you collected at our office can be used. Our team checks each card before paying to it.
        </p>
        <h3 className="text-sm font-semibold text-slate-900">Card info</h3>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Card holder name</span>
          <input data-testid="input-card-holder" autoComplete="cc-name" maxLength={80} value={holderName} placeholder="Enter your name as on the card" aria-invalid={!!errors.holderName}
            onChange={(e) => { setHolder(e.target.value); setErrors((x) => ({ ...x, holderName: undefined })); }} className={box(errors.holderName)} />
          {errors.holderName && <span role="alert" className="mt-1 block text-xs text-red-700">{errors.holderName}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Card number <span className="text-red-700">*</span></span>
          <div className="relative">
            <input data-testid="input-card-number" autoComplete="cc-number" inputMode="numeric" value={groupDigits(digits)} placeholder="Enter your card number" aria-invalid={!!errors.number}
              onChange={(e) => { setDigits(onlyDigits(e.target.value).slice(0, maxLen)); setErrors((x) => ({ ...x, number: undefined })); }} className={cx(box(errors.number), 'font-num pr-16 tracking-wide')} />
            {digits.length > 0 && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><NetworkMark network={network} className="scale-75" /></span>}
          </div>
          {errors.number && <span role="alert" className="mt-1 block text-xs text-red-700">{errors.number}</span>}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Expiry date MM/YY <span className="text-red-700">*</span></span>
            <input data-testid="input-card-expiry" autoComplete="cc-exp" inputMode="numeric" value={expiry} placeholder="MM/YY" aria-invalid={!!errors.expiry}
              onChange={(e) => { setExpiry(formatExpiry(e.target.value, expiry)); setErrors((x) => ({ ...x, expiry: undefined })); }} className={cx(box(errors.expiry), 'font-num')} />
            {errors.expiry && <span role="alert" className="mt-1 block text-xs text-red-700">{errors.expiry}</span>}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">CVV <span className="text-red-700">*</span></span>
            <input data-testid="input-card-cvv" autoComplete="cc-csc" inputMode="numeric" type="password" value={cvv} placeholder={network === 'amex' ? '••••' : '•••'} aria-invalid={!!errors.cvv}
              onChange={(e) => { setCvv(onlyDigits(e.target.value).slice(0, network === 'amex' ? 4 : 3)); setErrors((x) => ({ ...x, cvv: undefined })); }} className={cx(box(errors.cvv), 'font-num')} />
            {errors.cvv && <span role="alert" className="mt-1 block text-xs text-red-700">{errors.cvv}</span>}
          </label>
        </div>
        {err && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-add-card-error">{err}</p>}
        <button data-testid="button-save-card" type="submit" disabled={m.isPending}
          className={cx('press min-h-12 w-full rounded-full text-[15px] font-semibold transition', complete ? 'bg-[var(--brand)] text-[var(--brand-fg)] hover:bg-[var(--brand-dark)]' : 'bg-slate-200 text-slate-600', 'disabled:opacity-60')}>
          {m.isPending ? 'Saving…' : 'Save card'}
        </button>
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-500"><Lock className="h-3.5 w-3.5" />Your card details are encrypted and only seen by our finance team.</p>
      </form>
    </Modal>
  );
}

/* ---------- choosing a card for a deposit or withdrawal ---------- */

/** The saved cards as a radio list (like the reference's "Payment Method" list), with "+ Add new card". */
export function SavedCardPicker({ cards, value, onChange, onAdd, disabled, kind }: {
  cards: SavedCard[]; value: string; onChange: (id: string) => void; onAdd: () => void; disabled?: boolean; kind: 'Deposit' | 'Withdrawal';
}) {
  return (
    <fieldset data-testid="picker-saved-cards">
      <div className="mb-2 flex items-center justify-between gap-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">{kind === 'Deposit' ? 'Card to charge' : 'Card to pay to'}</legend>
        <button type="button" onClick={onAdd} disabled={disabled} data-testid="button-picker-add-card" className="press inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[var(--brand-ink)] hover:underline"><Plus className="h-3.5 w-3.5" />Add new card</button>
      </div>
      {cards.length === 0 ? (
        <button type="button" onClick={onAdd} disabled={disabled} data-testid="button-picker-empty" className="press flex w-full items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-left hover:border-[var(--brand-ink)]">
          <span className="grid h-11 w-14 place-items-center rounded-xl bg-[var(--brand-soft)]"><CreditCard className="h-5 w-5 text-[var(--brand-ink)]" /></span>
          <span><span className="block font-semibold text-slate-900">Add your physical card</span><span className="block text-xs text-slate-500">The card you collected at our office</span></span>
        </button>
      ) : (
        <div className="grid gap-2" role="radiogroup" aria-label={kind === 'Deposit' ? 'Card to charge' : 'Card to pay to'}>
          {cards.map((c) => {
            const on = value === c.id;
            const off = disabled || !c.usable;
            return (
              <button key={c.id} type="button" role="radio" aria-checked={on} disabled={off} onClick={() => onChange(c.id)} data-testid={`radio-saved-card-${c.id}`}
                className={cx('press flex min-h-16 items-center gap-3 rounded-2xl border bg-white p-3 text-left transition', on ? 'border-[var(--brand-ink)] ring-2 ring-[var(--brand-ink)]/20' : 'border-slate-200 hover:border-slate-400', !c.usable && 'cursor-not-allowed opacity-60')}>
                <NetworkTile network={c.network} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{c.holderName}</span>
                  <span className="font-num block text-xs text-slate-500">•••• <span className="font-semibold text-slate-800">{c.lastFour}</span> · exp {c.expiry}</span>
                  <span className="mt-1 block"><CardStatusChip c={c} /></span>
                  {!c.usable && <span className="mt-0.5 block text-xs text-red-700">{cardStatusText(c)}</span>}
                </span>
                <span aria-hidden className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', on ? 'border-[var(--brand-ink)]' : 'border-slate-300')}>
                  {on && <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand-ink)]" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
