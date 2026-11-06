import { useEffect, useMemo, useState } from 'react';
import {
  useGetAdminTierSettings, useUpdateAdminTierSettings, useListAdminCardTypes, getGetAdminTierSettingsQueryKey,
  type AdminCardType, type AdminTierSetting, type AdminTierSettings, type CardTypeKey, type TierSettingsUpdate,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { ErrorState, Field, Skel, cx, money } from '@/components/bits';
import { ainput, card, lime, SectionTitle } from '@/components/admin-bits';
import { FieldBuilder, PLAN_FIELD_TYPES, checkDraftFields, fieldsOut, toDraftFields, type DraftField } from '@/components/field-builder';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/*
 * Admin Settings → Tiers (Step 9.4). Per tier: withdrawal limits (the standard every user on it follows, unless their
 * profile has custom limits), card top-up limits, the cards it may buy, and — Tier 2 and 3 — the upgrade form users fill
 * in to move up to it. One save for all three tiers.
 */

type Limit = { max: string; daily: string };
type CardRule = { key: CardTypeKey; name: string; virtual: boolean; physical: boolean };
type Draft = { tier: number; withdrawal: Limit; topUp: Limit; cards: CardRule[]; formOn: boolean; intro: string; fields: DraftField[] };

const str = (v: number | null) => (v === null ? '' : String(v));
const toDraft = (t: AdminTierSetting): Draft => ({
  tier: t.tier,
  withdrawal: { max: str(t.withdrawal.maxPerRequest), daily: str(t.withdrawal.dailyTotal) },
  topUp: { max: str(t.topUp.maxPerRequest), daily: str(t.topUp.dailyTotal) },
  cards: t.cards.map((c) => ({ ...c })),
  formOn: !!t.upgradeForm, intro: t.upgradeForm?.intro ?? '', fields: toDraftFields(t.upgradeForm?.fields),
});

/** Empty = no limit; otherwise $0.01–$1,000,000 with two decimals, and a daily total no lower than the per-item limit. */
function parseLimit(l: Limit, what: string): { maxPerRequest: number | null; dailyTotal: number | null } | string {
  const one = (v: string, label: string): number | null | string => {
    if (!v.trim()) return null;
    const n = Number(v);
    if (!(n >= 0.01) || n > 1_000_000) return `${what}: enter a ${label} between $0.01 and $1,000,000, or leave it empty.`;
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return `${what}: use at most two decimal places.`;
    return n;
  };
  const m = one(l.max, 'limit per request'); if (typeof m === 'string') return m;
  const d = one(l.daily, 'daily total'); if (typeof d === 'string') return d;
  if (m !== null && d !== null && d < m) return `${what}: the daily total can't be lower than the limit per request.`;
  return { maxPerRequest: m, dailyTotal: d };
}

/** The same rule the server warns about: a physical card on sale for a tier with no virtual card on sale for it. */
export function liveWarnings(drafts: Draft[], types: AdminCardType[] | undefined) {
  if (!types) return [];
  const sold = (key: CardTypeKey, kind: 'virtual' | 'physical') => { const t = types.find((x) => x.key === key); return !!t && t.enabled && t[kind].price !== null; };
  return drafts.flatMap((d) => {
    const physical = d.cards.filter((c) => c.physical && sold(c.key, 'physical')).map((c) => c.name);
    const virtual = d.cards.some((c) => c.virtual && sold(c.key, 'virtual'));
    return physical.length && !virtual
      ? [`Tier ${d.tier} can buy the ${physical.join(', ')} physical card${physical.length > 1 ? 's' : ''}, but no virtual card, and a physical card needs a virtual card first. Nobody on Tier ${d.tier} can get ${physical.length > 1 ? 'them' : 'it'}: allow a virtual card for Tier ${d.tier}.`]
      : [];
  });
}

function MoneyInput({ value, onChange, label, testid }: { value: string; onChange: (v: string) => void; label: string; testid: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
      <input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="No limit" value={value} aria-label={label} data-testid={testid}
        onChange={(e) => onChange(e.target.value)} className={cx(ainput, 'font-num min-h-11 pl-7')} />
    </div>
  );
}

function LimitPair({ title, hint, value, onChange, prefix, unit }: { title: string; hint: string; value: Limit; onChange: (l: Limit) => void; prefix: string; unit: string }) {
  return (
    <fieldset className="min-w-0 rounded-xl border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <p className="mb-3 text-xs text-slate-500">{hint}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Max per ${unit}`}><MoneyInput value={value.max} onChange={(max) => onChange({ ...value, max })} label={`${title}: max per ${unit}`} testid={`input-${prefix}-max`} /></Field>
        <Field label="Daily total (24 hours)"><MoneyInput value={value.daily} onChange={(daily) => onChange({ ...value, daily })} label={`${title}: daily total`} testid={`input-${prefix}-daily`} /></Field>
      </div>
    </fieldset>
  );
}

export function TierSettings() {
  const q = useGetAdminTierSettings();
  const types = useListAdminCardTypes();
  const m = useUpdateAdminTierSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState(1);
  const [err, setErr] = useState('');
  useEffect(() => { if (q.data) setDrafts(q.data.tiers.map(toDraft)); }, [q.data]);
  const warnings = useMemo(() => liveWarnings(drafts, types.data), [drafts, types.data]);
  const set = (tier: number, patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => {
    setDrafts((ds) => ds.map((d) => (d.tier === tier ? { ...d, ...(typeof patch === 'function' ? patch(d) : patch) } : d)));
    setErr('');
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const tiers: TierSettingsUpdate['tiers'] = [];
    for (const d of drafts) {
      const withdrawal = parseLimit(d.withdrawal, `Tier ${d.tier} withdrawals`);
      if (typeof withdrawal === 'string') { setActive(d.tier); return setErr(withdrawal); }
      const topUp = parseLimit(d.topUp, `Tier ${d.tier} card top-ups`);
      if (typeof topUp === 'string') { setActive(d.tier); return setErr(topUp); }
      let upgradeForm: TierSettingsUpdate['tiers'][number]['upgradeForm'] = null;
      if (d.tier > 1 && d.formOn) {
        if (!d.fields.length) { setActive(d.tier); return setErr(`Tier ${d.tier}: add at least one field to the upgrade form, or switch the form off.`); }
        const problem = checkDraftFields(d.fields);
        if (problem) { setActive(d.tier); return setErr(`Tier ${d.tier} upgrade form: ${problem}`); }
        upgradeForm = { intro: d.intro.trim(), fields: fieldsOut(d.fields) as NonNullable<typeof upgradeForm>['fields'] };
      }
      tiers.push({ tier: d.tier, withdrawal, topUp, cards: d.cards.map(({ key, virtual, physical }) => ({ key, virtual, physical })), upgradeForm });
    }
    setErr('');
    m.mutate({ data: { tiers } }, {
      onSuccess: (data: AdminTierSettings) => {
        qc.setQueryData(getGetAdminTierSettingsQueryKey(), data);
        toast({ title: 'Tier settings saved', description: data.warnings.length ? 'Saved with a warning: see the top of the page.' : 'They apply to new requests straight away.' });
      },
      onError: (e2) => setErr(apiError(e2, 'The tier settings could not be saved. Please try again.')),
    });
  };

  if (q.isLoading) return <div className={cx(card, 'space-y-3 p-5')}><Skel className="h-6 w-40" /><Skel className="h-28" /><Skel className="h-28" /></div>;
  if (q.isError || !q.data) return <div className={cx(card, 'p-5')}><ErrorState onRetry={() => q.refetch()} /></div>;
  const d = drafts.find((x) => x.tier === active);
  return (
    <form noValidate onSubmit={save} className={cx(card, 'space-y-4 p-5')} data-testid="form-tier-settings">
      <div>
        <SectionTitle>Tier rules</SectionTitle>
        <p className="text-sm text-slate-600">Every user is on Tier 1, 2 or 3. Their tier sets how much they can withdraw and put on their cards, and which cards they can buy. A user's own limits (set in their profile) replace their tier's withdrawal limits. Users move up one tier at a time by sending the next tier's upgrade form, which you approve in <b>Tier Upgrades</b>.</p>
      </div>
      {warnings.length > 0 && (
        <div role="status" className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="text-tier-warnings">
          {warnings.map((w) => <p key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{w}</p>)}
        </div>
      )}
      <div role="tablist" aria-label="Tiers" className="flex flex-wrap gap-2">
        {drafts.map((x) => (
          <button key={x.tier} type="button" role="tab" aria-selected={active === x.tier} onClick={() => setActive(x.tier)} data-testid={`tab-tier-${x.tier}`}
            className={cx('press min-h-11 rounded-full px-4 text-sm font-semibold', active === x.tier ? 'bg-[#111] text-[var(--brand-glow)]' : 'border border-slate-300 bg-white text-slate-700 hover:border-[#111]')}>
            Tier {x.tier}
          </button>
        ))}
      </div>
      {d && (
        <div className="space-y-4" data-testid={`panel-tier-${d.tier}`}>
          <div className="grid gap-4 xl:grid-cols-2">
            <LimitPair title="Withdrawals" unit="request" prefix={`tier${d.tier}-withdrawal`} value={d.withdrawal} onChange={(withdrawal) => set(d.tier, { withdrawal })}
              hint="Checked when a user places a withdrawal; the daily total counts requests under review or approved in the last 24 hours. Empty = no limit." />
            <LimitPair title="Card top-ups" unit="top-up" prefix={`tier${d.tier}-topup`} value={d.topUp} onChange={(topUp) => set(d.tier, { topUp })}
              hint="How much a user can move from their account balance to their cards, per top-up and in any 24 hours. Your own top-ups aren't limited. Empty = no limit." />
          </div>
          <fieldset className="min-w-0 rounded-xl border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold">Cards Tier {d.tier} can buy</legend>
            <p className="mb-3 text-xs text-slate-500">Settings → Cards still decides what's on sale and its price. A physical card always needs a virtual card first. You can issue any card from a user's profile.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-sm" data-testid={`table-tier-cards-${d.tier}`}>
                <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-2 font-semibold">Card</th><th className="w-24 py-2 text-center font-semibold">Virtual</th><th className="w-24 py-2 text-center font-semibold">Physical</th></tr></thead>
                <tbody className="divide-y">
                  {d.cards.map((c) => {
                    const t = types.data?.find((x) => x.key === c.key);
                    return (
                      <tr key={c.key}>
                        <td className="py-2"><span className="font-medium">{c.name}</span>{t && !t.enabled && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">not on sale</span>}</td>
                        {(['virtual', 'physical'] as const).map((k) => (
                          <td key={k} className="py-1 text-center">
                            <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                              <input type="checkbox" checked={c[k]} className="h-5 w-5 accent-[#111]" aria-label={`Tier ${d.tier} may buy the ${c.name} ${k} card`} data-testid={`check-tier${d.tier}-${c.key}-${k}`}
                                onChange={(e) => set(d.tier, (x) => ({ cards: x.cards.map((y) => (y.key === c.key ? { ...y, [k]: e.target.checked } : y)) }))} />
                            </label>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </fieldset>
          {d.tier === 1 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600" data-testid="text-tier1-form">Everyone starts on Tier 1, so it has no upgrade form. Set up the Tier 2 form to let users move up.</p>
          ) : (
            <fieldset className="min-w-0 rounded-xl border border-slate-200 p-4" data-testid={`section-tier${d.tier}-form`}>
              <legend className="px-1 text-sm font-semibold">Upgrade form for Tier {d.tier}</legend>
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={d.formOn} onChange={(e) => set(d.tier, { formOn: e.target.checked })} className="h-5 w-5 accent-[#111]" data-testid={`switch-tier${d.tier}-form`} />
                <span className="text-sm"><b>Tier {d.tier - 1} users can ask for Tier {d.tier}</b><span className="block text-xs text-slate-500">Off: nobody can ask to move up to Tier {d.tier}, and no upgrade is offered when they reach a limit.</span></span>
              </label>
              {d.formOn && (
                <div className="mt-3 space-y-4">
                  <Field label="Introduction (shown above the form)">
                    <textarea value={d.intro} onChange={(e) => set(d.tier, { intro: e.target.value })} rows={3} maxLength={2000} className={cx(ainput, 'resize-y')}
                      placeholder="e.g. To raise your limits, send a recent bank statement and a selfie holding your ID." data-testid={`input-tier${d.tier}-intro`} />
                  </Field>
                  <FieldBuilder fields={d.fields} onChange={(update) => set(d.tier, (x) => ({ fields: update(x.fields) }))} types={PLAN_FIELD_TYPES} max={30}
                    legend="Fields" hint="What the user fills in. File uploads take images, PDFs and Word documents, up to 10 per form." />
                </div>
              )}
            </fieldset>
          )}
          <TierSummary d={d} />
        </div>
      )}
      {err && <p role="alert" className="text-sm text-red-700" data-testid="error-tier-settings">{err}</p>}
      <button data-testid="button-save-tiers" disabled={m.isPending} className={cx(lime, 'inline-flex min-h-11 items-center gap-2')}>
        {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{m.isPending ? 'Saving…' : 'Save tier settings'}
      </button>
    </form>
  );
}

/** One line of what this tier allows, as the user will read it. */
function TierSummary({ d }: { d: Draft }) {
  const lim = (l: Limit, unit: string) => `${l.max.trim() ? `${money(Number(l.max))} per ${unit}` : `no limit per ${unit}`}, ${l.daily.trim() ? `${money(Number(l.daily))} per 24 hours` : 'no daily limit'}`;
  const cards = d.cards.flatMap((c) => [c.virtual && `${c.name} virtual`, c.physical && `${c.name} physical`].filter(Boolean));
  return (
    <p className="rounded-xl bg-[var(--brand-soft)] p-3 text-xs text-slate-700" data-testid={`text-tier${d.tier}-summary`}>
      <b>Tier {d.tier}:</b> withdrawals {lim(d.withdrawal, 'request')} · top-ups {lim(d.topUp, 'top-up')} · cards: {cards.length ? cards.join(', ') : 'none'}
    </p>
  );
}
