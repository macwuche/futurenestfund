import { useEffect, useState } from 'react';
import {
  useGetTierAmounts, useUpdateTierAmounts, useUpdateUserEligibleAmount, type AdminUserProfile, type TierAmounts,
} from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';
import { Field, cx, money } from '@/components/bits';
import { card, ainput, lime, SectionTitle, useAdminRefresh } from '@/components/admin-bits';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/**
 * The applicant's "Eligible amount" (dashboard card "Largest open award at Tier N"): one amount per tier in
 * Settings → Money, and an optional custom amount per user that replaces it. Shown to the applicant only, for now.
 */

const TIERS = [1, 2, 3] as const;
const amountText = (v: number | null) => (v === null ? 'Not set' : money(v));
const toInput = (v: number | null) => (v === null ? '' : String(v));

/** Empty = not set; otherwise $0.01 to $10,000,000 with at most two decimals. */
function parseAmount(v: string, label: string): number | null | { error: string } {
  if (!v.trim()) return null;
  const n = Number(v);
  if (!(n >= 0.01) || n > 10_000_000) return { error: `Enter ${label} between $0.01 and $10,000,000, or leave it empty.` };
  if (Math.round(n * 100) !== Math.round(n * 100 * 1000) / 1000) return { error: 'Use at most two decimal places.' };
  return n;
}

function MoneyInput({ value, set, testid, disabled, label }: { value: string; set: (v: string) => void; testid: string; disabled?: boolean; label: string }) {
  return (
    <Field label={label}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
        <input data-testid={testid} type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="Not set" value={value} disabled={disabled}
          onChange={(e) => set(e.target.value)} className={cx(ainput, 'pl-7 tabular-nums')} />
      </div>
    </Field>
  );
}

/** Admin Settings → Money: the eligible amount for each tier. */
export function GlobalTierAmounts() {
  const q = useGetTierAmounts();
  const m = useUpdateTierAmounts();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [vals, setVals] = useState<Record<1 | 2 | 3, string>>({ 1: '', 2: '', 3: '' });
  const [err, setErr] = useState('');
  useEffect(() => { if (q.data) setVals({ 1: toInput(q.data.tier1), 2: toInput(q.data.tier2), 3: toInput(q.data.tier3) }); }, [q.data]);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const data: TierAmounts = { tier1: null, tier2: null, tier3: null };
    for (const t of TIERS) {
      const v = parseAmount(vals[t], `the Tier ${t} amount`);
      if (v !== null && typeof v === 'object') return setErr(v.error);
      data[`tier${t}`] = v;
    }
    setErr('');
    m.mutate({ data }, {
      onSuccess: (r) => { refresh(); toast({ title: 'Eligible amounts saved', description: TIERS.map((t) => `Tier ${t}: ${amountText(r[`tier${t}`])}`).join(' · ') }); },
      onError: (e2) => setErr(apiError(e2, 'The amounts could not be saved. Please try again.')),
    });
  };
  return (
    <form noValidate onSubmit={save} className={cx(card, 'space-y-3 p-5')} data-testid="form-tier-amounts">
      <SectionTitle>Eligible amount per tier</SectionTitle>
      <p className="text-sm text-slate-600">Shown on each applicant's dashboard as their eligible amount ("Largest open award at Tier 1"). A user's custom amount, set on their profile, replaces their tier's. Leave a field empty to show $0.00.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {TIERS.map((t) => (
          <MoneyInput key={t} label={`Tier ${t}`} testid={`input-tier-amount-${t}`} value={vals[t]} disabled={!q.data}
            set={(v) => { setVals((o) => ({ ...o, [t]: v })); setErr(''); }} />
        ))}
      </div>
      {err && <p role="alert" className="text-sm text-red-700" data-testid="error-tier-amounts">{err}</p>}
      <button data-testid="button-save-tier-amounts" disabled={m.isPending || !q.data} className={cx(lime, 'inline-flex items-center gap-2')}>
        {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{m.isPending ? 'Saving…' : 'Save amounts'}
      </button>
    </form>
  );
}

/** Admin user profile: the amount for the user's tier, or a custom one that replaces it. */
export function UserEligibleAmount({ u }: { u: AdminUserProfile }) {
  const m = useUpdateUserEligibleAmount();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const e = u.eligibleAmount;
  const [custom, setCustom] = useState(e.custom);
  const [amount, setAmount] = useState(e.custom ? toInput(e.amount) : ''), [err, setErr] = useState('');
  useEffect(() => { setCustom(e.custom); setAmount(e.custom ? toInput(e.amount) : ''); }, [e.custom, e.amount]);
  const save = (ev: React.FormEvent) => {
    ev.preventDefault();
    const v = custom ? parseAmount(amount, 'an amount') : null;
    if (v !== null && typeof v === 'object') return setErr(v.error);
    setErr('');
    m.mutate({ userId: u.id, data: { custom, amount: v } }, {
      onSuccess: () => { refresh(); toast({ title: 'Eligible amount saved', description: `${u.name}'s dashboard shows the new amount.` }); },
      onError: (e2) => setErr(apiError(e2, 'The amount could not be saved. Please try again.')),
    });
  };
  const dirty = custom !== e.custom || (custom && amount !== toInput(e.amount));
  const option = (value: boolean, title: string, text: string) => (
    <button type="button" role="radio" aria-checked={custom === value} data-testid={`button-eligible-${value ? 'custom' : 'tier'}`} onClick={() => { setCustom(value); setErr(''); }}
      className={cx('press min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition', custom === value ? 'border-[#111] bg-[#111] text-[#C6F432]' : 'border-slate-300 hover:border-[#111]')}>
      <span className="block font-semibold">{title}</span><span className={cx('block text-xs', custom === value ? 'text-white/80' : 'text-slate-500')}>{text}</span>
    </button>
  );
  return (
    <form noValidate onSubmit={save} className={cx(card, 'space-y-3 p-5')} data-testid="form-user-eligible">
      <h3 className="font-display font-bold">Eligible amount</h3>
      <p className="text-sm text-slate-700" data-testid="text-user-eligible-current">Now: <span className="font-semibold tabular-nums">{amountText(e.amount)}</span>{e.custom ? ' (custom)' : ` (Tier ${u.tier})`}</p>
      <div role="radiogroup" aria-label="Eligible amount" className="grid gap-2 sm:grid-cols-2">
        {option(false, `Use the Tier ${u.tier} amount`, `${amountText(e.tierAmount)} · set in Settings → Money`)}
        {option(true, 'Custom for this user', 'Replaces the tier amount. Empty = not set.')}
      </div>
      {custom && <MoneyInput label="Custom amount" testid="input-user-eligible" value={amount} set={(v) => { setAmount(v); setErr(''); }} />}
      {err && <p role="alert" className="text-sm text-red-700" data-testid="error-user-eligible">{err}</p>}
      <button data-testid="button-save-user-eligible" disabled={m.isPending || !dirty} className={cx(lime, 'inline-flex items-center gap-2')}>
        {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{m.isPending ? 'Saving…' : 'Save amount'}
      </button>
    </form>
  );
}
