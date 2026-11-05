import { useEffect, useState } from 'react';
import { useListAdminCardTypes, useUpdateAdminCardTypes, getListAdminCardTypesQueryKey, type AdminCardType, type CardTypeKey, type FeeRule } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { CreditCard, Loader2 } from 'lucide-react';
import { ErrorState, Skel, cx, money } from '@/components/bits';
import { ainput, card, lime, SectionTitle } from '@/components/admin-bits';
import { FeeInput, feeDraft, feeFromDraft, feeOn, type FeeDraft } from '@/components/fee-input';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/*
 * Admin Settings → Cards (Step 9.3): which card types applicants can buy, and the price and fee of each type's
 * virtual and physical card. The user pays price + fee from their deposit (main) balance.
 */

type KindDraft = { price: string; fee: FeeDraft };
type Row = { key: CardTypeKey; name: string; enabled: boolean; virtual: KindDraft; physical: KindDraft };
const KINDS = [['virtual', 'Virtual'], ['physical', 'Physical']] as const;

const toRow = (t: AdminCardType): Row => ({
  key: t.key, name: t.name, enabled: t.enabled,
  virtual: { price: t.virtual.price === null ? '' : String(t.virtual.price), fee: feeDraft(t.virtual.fee) },
  physical: { price: t.physical.price === null ? '' : String(t.physical.price), fee: feeDraft(t.physical.fee) },
});

/** The typed price: null = not sold; a number ≥ 0 with two decimals; or what's wrong. */
function priceOf(s: string, what: string): number | null | { error: string } {
  const t = s.trim().replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return { error: `${what}: the price must be a number.` };
  if (n < 0) return { error: `${what}: the price can't be negative.` };
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { error: `${what}: the price can have at most two decimals.` };
  if (n > 1_000_000) return { error: `${what}: the price can't be more than $1,000,000.` };
  return n;
}

function totalText(k: KindDraft) {
  const p = priceOf(k.price, '');
  const f = feeFromDraft(k.fee);
  if (p === null) return 'Not sold';
  if (typeof p === 'object' || typeof f === 'string') return '';
  const fee = feeOn(f, p);
  return `User pays ${money(Math.round((p + fee) * 100) / 100)}${fee ? ` (${money(p)} + ${money(fee)} fee)` : ''}`;
}

export function CardTypeSettings() {
  const q = useListAdminCardTypes();
  const m = useUpdateAdminCardTypes();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => { if (q.data) setRows(q.data.map(toRow)); }, [q.data]);
  const set = (key: CardTypeKey, patch: Partial<Row>) => { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))); setErr(''); };
  const setKind = (key: CardTypeKey, kind: 'virtual' | 'physical', patch: Partial<KindDraft>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [kind]: { ...r[kind], ...patch } } : r)));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const types: { key: CardTypeKey; enabled: boolean; virtual: { price: number | null; fee: FeeRule }; physical: { price: number | null; fee: FeeRule } }[] = [];
    for (const r of rows) {
      const out = { key: r.key, enabled: r.enabled } as (typeof types)[number];
      for (const [k, label] of KINDS) {
        const what = `${r.name} ${label.toLowerCase()}`;
        const price = priceOf(r[k].price, what);
        if (price !== null && typeof price === 'object') return setErr(price.error);
        const fee = feeFromDraft(r[k].fee, `${what}: the fee`);
        if (typeof fee === 'string') return setErr(fee);
        out[k] = { price, fee };
      }
      if (r.enabled && out.virtual.price === null && out.physical.price === null) return setErr(`${r.name} is on but has no price. Give its virtual or physical card a price (0 for free), or switch it off.`);
      types.push(out);
    }
    setErr('');
    m.mutate({ data: { types } }, {
      onSuccess: (data) => {
        qc.setQueryData(getListAdminCardTypesQueryKey(), data);
        const on = data.filter((t) => t.enabled).map((t) => t.name);
        toast({ title: 'Card types saved', description: on.length ? `On sale: ${on.join(', ')}` : 'No card types are on sale.' });
      },
      onError: (e2) => setErr(apiError(e2, 'The card types could not be saved. Please try again.')),
    });
  };

  if (q.isLoading) return <div className={cx(card, 'space-y-3 p-5')}><Skel className="h-6 w-40" /><Skel className="h-28" /><Skel className="h-28" /></div>;
  if (q.isError || !q.data) return <div className={cx(card, 'p-5')}><ErrorState onRetry={() => q.refetch()} /></div>;
  return (
    <form noValidate onSubmit={save} className={cx(card, 'space-y-4 p-5')} data-testid="form-card-types">
      <div>
        <SectionTitle>Card types</SectionTitle>
        <p className="text-sm text-slate-600">Switch on the cards applicants can buy, and set the price and fee of each one's virtual and physical card. The user pays <b>price + fee</b> from their deposit balance (e.g. $10 + 1% = $10.10). Leave a price empty to not sell that kind; 0 makes it free.</p>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.key} className={cx('rounded-xl border p-4', r.enabled ? 'border-[#111]' : 'border-slate-200 bg-slate-50')} data-testid={`row-card-type-${r.key}`}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input type="checkbox" checked={r.enabled} onChange={(e) => set(r.key, { enabled: e.target.checked })} className="h-5 w-5 accent-[#111]" data-testid={`switch-card-type-${r.key}`} />
              <CreditCard className="h-5 w-5 text-slate-500" aria-hidden />
              <span className="font-semibold">{r.name}</span>
              <span className={cx('ml-auto rounded-full px-2 py-0.5 text-xs font-semibold', r.enabled ? 'bg-[#C6F432] text-[#111]' : 'bg-slate-200 text-slate-600')}>{r.enabled ? 'On sale' : 'Off'}</span>
            </label>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {KINDS.map(([k, label]) => (
                <fieldset key={k} className="min-w-0 rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label} card</legend>
                  <div className="grid gap-2 xl:grid-cols-2">
                    <label className="block min-w-0">
                      <span className="mb-1 block text-xs font-semibold text-slate-600">Price</span>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
                        <input type="number" min={0} step="0.01" inputMode="decimal" value={r[k].price} placeholder="Not sold" onChange={(e) => { setKind(r.key, k, { price: e.target.value }); setErr(''); }}
                          aria-label={`${r.name} ${label.toLowerCase()} price`} data-testid={`input-card-price-${r.key}-${k}`} className={cx(ainput, 'font-num min-h-11 pl-6')} />
                      </div>
                    </label>
                    <div className="min-w-0">
                      <span className="mb-1 block text-xs font-semibold text-slate-600">Fee</span>
                      <FeeInput value={r[k].fee} onChange={(fee) => { setKind(r.key, k, { fee }); setErr(''); }} label={`${r.name} ${label.toLowerCase()} fee`} testid={`input-card-fee-${r.key}-${k}`} />
                    </div>
                  </div>
                  <p className="font-num mt-2 text-xs text-slate-600" data-testid={`text-card-total-${r.key}-${k}`}>{totalText(r[k])}</p>
                </fieldset>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600" data-testid="text-credit-note">No card network or credit line is connected. Credit cards are a card type you can sell and price separately; like every card, they spend only what's topped up from the deposit balance. Top-ups have no fee.</p>
      {err && <p role="alert" className="text-sm text-red-700" data-testid="error-card-types">{err}</p>}
      <button data-testid="button-save-card-types" disabled={m.isPending} className={cx(lime, 'inline-flex min-h-11 items-center gap-2')}>
        {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{m.isPending ? 'Saving…' : 'Save card types'}
      </button>
    </form>
  );
}
