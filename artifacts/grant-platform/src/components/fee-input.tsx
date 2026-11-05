import type { FeeRule } from '@workspace/api-client-react';
import { cx, money } from '@/components/bits';
import { ainput } from '@/components/admin-bits';

/** A fee as the admin types it: a mode and the text in the box ("" = no fee). */
export type FeeDraft = { mode: FeeRule['mode']; amount: string };
export const feeDraft = (f?: FeeRule): FeeDraft => ({ mode: f?.mode ?? 'fixed', amount: f && f.amount > 0 ? String(f.amount) : '' });

/** The typed fee as a rule, or what's wrong with it (same rules as the server: never negative, two decimals, ≤ 100%). */
export function feeFromDraft(d: FeeDraft, what = 'The fee'): FeeRule | string {
  const t = d.amount.trim().replace(/[$%,\s]/g, '');
  if (!t) return { mode: d.mode, amount: 0 };
  const n = Number(t);
  if (!Number.isFinite(n)) return `${what} must be a number.`;
  if (n < 0) return `${what} can't be negative.`;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return `${what} can have at most two decimals.`;
  if (d.mode === 'percent' && n > 100) return `${what} can't be more than 100%.`;
  if (d.mode === 'fixed' && n > 1_000_000) return `${what} can't be more than $1,000,000.`;
  return { mode: d.mode, amount: n };
}

/** The fee on `base` dollars, rounded to the cent like the server. */
export function feeOn(rule: FeeRule, base: number) {
  if (!(rule.amount > 0)) return 0;
  if (rule.mode === 'fixed') return rule.amount;
  const cents = Math.round(base * 100);
  return Math.floor((cents * Math.round(rule.amount * 100) + 5000) / 10000) / 100;
}

export const feeLabel = (rule: FeeRule) => (!(rule.amount > 0) ? 'No fee' : rule.mode === 'fixed' ? `Fee ${money(rule.amount)}` : `Fee ${rule.amount}%`);

/** Fixed / % switch with one amount box. Negative numbers can't be typed in (min=0) and are refused on save. */
export function FeeInput({ value, onChange, label, testid }: { value: FeeDraft; onChange: (v: FeeDraft) => void; label: string; testid: string }) {
  return (
    <div className="flex items-stretch gap-2">
      <div role="radiogroup" aria-label={`${label}: type`} className="flex shrink-0 rounded-lg border border-slate-300 p-0.5">
        {(['fixed', 'percent'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={value.mode === m} onClick={() => onChange({ ...value, mode: m })} data-testid={`${testid}-mode-${m}`}
            className={cx('press min-h-10 min-w-11 rounded-md px-2 text-sm font-semibold', value.mode === m ? 'bg-[#111] text-white' : 'text-slate-600 hover:bg-slate-100')}>
            {m === 'fixed' ? '$' : '%'}
          </button>
        ))}
      </div>
      <input type="number" min={0} step="0.01" inputMode="decimal" value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })}
        placeholder={value.mode === 'fixed' ? '0.00' : '0'} aria-label={label} data-testid={testid} className={cx(ainput, 'font-num min-h-11 w-full min-w-0')} />
    </div>
  );
}
