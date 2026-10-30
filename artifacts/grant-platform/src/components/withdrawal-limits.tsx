import { useEffect, useState } from 'react';
import {
  useGetWithdrawalLimits, useUpdateWithdrawalLimits, useUpdateUserWithdrawalLimits, type AdminUserProfile, type WithdrawalLimits,
} from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';
import { Field, cx, money } from '@/components/bits';
import { card, ainput, lime, SectionTitle, useAdminRefresh } from '@/components/admin-bits';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/** "$500.00 per request · $1,000.00 per 24 hours", with "no limit" for empty ones. */
export const limitsText = (l: WithdrawalLimits) =>
  `${l.maxPerRequest === null ? 'No limit per request' : `${money(l.maxPerRequest)} per request`} · ${l.dailyTotal === null ? 'no daily limit' : `${money(l.dailyTotal)} per 24 hours`}`;

const toInput = (v: number | null) => (v === null ? '' : String(v));
/** Empty = no limit; otherwise a positive amount with at most two decimals. */
function parse(max: string, daily: string): WithdrawalLimits | string {
  const one = (v: string, label: string): number | null | string => {
    if (!v.trim()) return null;
    const n = Number(v);
    if (!(n >= 0.01) || n > 1_000_000) return `Enter a ${label} between $0.01 and $1,000,000, or leave it empty.`;
    if (Math.round(n * 100) !== Math.round(n * 100 * 1000) / 1000) return 'Use at most two decimal places.';
    return n;
  };
  const m = one(max, 'limit per request'); if (typeof m === 'string') return m;
  const d = one(daily, 'daily total'); if (typeof d === 'string') return d;
  if (m !== null && d !== null && d < m) return "The daily total can't be lower than the limit per request.";
  return { maxPerRequest: m, dailyTotal: d };
}

function LimitFields({ max, daily, setMax, setDaily, disabled, prefix }: {
  max: string; daily: string; setMax: (v: string) => void; setDaily: (v: string) => void; disabled?: boolean; prefix: string;
}) {
  const input = (value: string, set: (v: string) => void, testid: string) => (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
      <input data-testid={testid} type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="No limit" value={value} disabled={disabled}
        onChange={(e) => set(e.target.value)} className={cx(ainput, 'pl-7 tabular-nums')} />
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Max per request">{input(max, setMax, `input-${prefix}-max`)}</Field>
      <Field label="Daily total (24 hours)">{input(daily, setDaily, `input-${prefix}-daily`)}</Field>
    </div>
  );
}

/** Admin Settings: the global limits every user follows unless they have custom ones. */
export function GlobalWithdrawalLimits() {
  const q = useGetWithdrawalLimits();
  const m = useUpdateWithdrawalLimits();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [max, setMax] = useState(''), [daily, setDaily] = useState(''), [err, setErr] = useState('');
  useEffect(() => { if (q.data) { setMax(toInput(q.data.maxPerRequest)); setDaily(toInput(q.data.dailyTotal)); } }, [q.data]);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const data = parse(max, daily);
    if (typeof data === 'string') return setErr(data);
    setErr('');
    m.mutate({ data }, {
      onSuccess: (r) => { refresh(); toast({ title: 'Global withdrawal limits saved', description: limitsText(r) }); },
      onError: (e2) => setErr(apiError(e2, 'The limits could not be saved. Please try again.')),
    });
  };
  return (
    <form noValidate onSubmit={save} className={cx(card, 'space-y-3 p-5')} data-testid="form-global-limits">
      <SectionTitle>Withdrawal limits</SectionTitle>
      <p className="text-sm text-slate-600">Apply to every user unless their profile has custom limits. Checked when an applicant places a withdrawal; the daily total counts requests under review or approved in the last 24 hours. Leave a field empty for no limit.</p>
      <LimitFields prefix="global" max={max} daily={daily} setMax={(v) => { setMax(v); setErr(''); }} setDaily={(v) => { setDaily(v); setErr(''); }} disabled={!q.data} />
      {err && <p role="alert" className="text-sm text-red-700" data-testid="error-global-limits">{err}</p>}
      <button data-testid="button-save-global-limits" disabled={m.isPending || !q.data} className={cx(lime, 'inline-flex items-center gap-2')}>
        {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{m.isPending ? 'Saving…' : 'Save limits'}
      </button>
    </form>
  );
}

/** Admin user profile: follow the global limits, or custom ones that replace them for this user. */
export function UserWithdrawalLimits({ u }: { u: AdminUserProfile }) {
  const global = useGetWithdrawalLimits();
  const m = useUpdateUserWithdrawalLimits();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const l = u.withdrawalLimits;
  const [custom, setCustom] = useState(l.custom);
  const [max, setMax] = useState(toInput(l.maxPerRequest)), [daily, setDaily] = useState(toInput(l.dailyTotal)), [err, setErr] = useState('');
  useEffect(() => { setCustom(l.custom); setMax(toInput(l.maxPerRequest)); setDaily(toInput(l.dailyTotal)); }, [l.custom, l.maxPerRequest, l.dailyTotal]);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const data = custom ? parse(max, daily) : { maxPerRequest: null, dailyTotal: null };
    if (typeof data === 'string') return setErr(data);
    setErr('');
    m.mutate({ userId: u.id, data: { custom, ...data } }, {
      onSuccess: () => { refresh(); toast({ title: 'Withdrawal limits saved', description: `${u.name} has been notified.` }); },
      onError: (e2) => setErr(apiError(e2, 'The limits could not be saved. Please try again.')),
    });
  };
  const dirty = custom !== l.custom || (custom && (max !== toInput(l.maxPerRequest) || daily !== toInput(l.dailyTotal)));
  const option = (value: boolean, title: string, text: string) => (
    <button type="button" role="radio" aria-checked={custom === value} data-testid={`button-limits-${value ? 'custom' : 'global'}`} onClick={() => { setCustom(value); setErr(''); }}
      className={cx('press min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition', custom === value ? 'border-[#111] bg-[#111] text-[#C6F432]' : 'border-slate-300 hover:border-[#111]')}>
      <span className="block font-semibold">{title}</span><span className={cx('block text-xs', custom === value ? 'text-white/80' : 'text-slate-500')}>{text}</span>
    </button>
  );
  return (
    <form noValidate onSubmit={save} className={cx(card, 'space-y-3 p-5')} data-testid="form-user-limits">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display font-bold">Withdrawal limits</h3>
        <span className="text-xs text-slate-500" data-testid="text-user-limits-used">{money(l.usedLast24h)} withdrawn in the last 24 hours</span>
      </div>
      <p className="text-sm text-slate-700" data-testid="text-user-limits-current">Now: {limitsText(l)}{l.custom ? ' (custom)' : ' (global)'}</p>
      <div role="radiogroup" aria-label="Withdrawal limits" className="grid gap-2 sm:grid-cols-2">
        {option(false, 'Use global limits', global.data ? limitsText(global.data) : 'Set in Settings')}
        {option(true, 'Custom for this user', 'Replaces the global limits. Empty = no limit.')}
      </div>
      {custom && <LimitFields prefix="user" max={max} daily={daily} setMax={(v) => { setMax(v); setErr(''); }} setDaily={(v) => { setDaily(v); setErr(''); }} />}
      {err && <p role="alert" className="text-sm text-red-700" data-testid="error-user-limits">{err}</p>}
      <button data-testid="button-save-user-limits" disabled={m.isPending || !dirty} className={cx(lime, 'inline-flex items-center gap-2')}>
        {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{m.isPending ? 'Saving…' : 'Save limits'}
      </button>
    </form>
  );
}
