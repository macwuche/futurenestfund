import { useState } from 'react';
import { useGetApplicantTier, useCreateApplicantTierRequest, type ApplicantTier, type TierLimits, type TierRule } from '@workspace/api-client-react';
import { CheckCircle2, Clock, CreditCard, Gauge, Lock, XCircle } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ErrorState, PageSkeleton, cx, inputCls, money, dateFmt } from '@/components/bits';
import { PlanFieldInputs, checkPlanValues, type PlanFiles, type PlanValues } from '@/components/grant-plan';
import { PlanAnswers } from '@/components/plan-application';
import { apiError, useRefreshApplicant } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/*
 * "Your tier" (Step 9.4): what the user's tier allows, what the next one unlocks, and the upgrade form to ask for it.
 * Upgrades go one tier at a time; an administrator reviews each request.
 */

const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm';
const primary = 'press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--brand-fg)] hover:bg-[var(--brand-dark)] disabled:opacity-60';
const outline = 'press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60';

const limitText = (l: TierLimits, unit: string) => [
  l.maxPerRequest === null ? `No limit per ${unit}` : `${money(l.maxPerRequest)} per ${unit}`,
  l.dailyTotal === null ? 'no daily limit' : `${money(l.dailyTotal)} per 24 hours`,
].join(' · ');
const cardList = (r: TierRule) => r.cards.flatMap((c) => (c.virtual && c.physical ? [`${c.name} (virtual and physical)`] : c.virtual ? [`${c.name} (virtual)`] : c.physical ? [`${c.name} (physical)`] : []));

export function TierPage() {
  const q = useGetApplicantTier();
  return (
    <Shell title="Your tier">
      {q.isLoading ? <PageSkeleton /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : <TierView t={q.data} />}
    </Shell>
  );
}

function TierView({ t }: { t: ApplicantTier }) {
  const current = t.tiers.find((x) => x.tier === t.tier)!;
  const next = t.next ? t.tiers.find((x) => x.tier === t.next!.tier) : undefined;
  const pending = t.request?.status === 'Pending';
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className={cx(card, 'p-5')} data-testid="section-current-tier">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--brand)] text-[var(--brand-fg)]"><Gauge className="h-6 w-6" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-500">Your account is on</p>
            <h2 className="text-2xl font-bold text-slate-900" data-testid="text-current-tier">Tier {t.tier}</h2>
          </div>
        </div>
        <TierFacts r={current} custom={t.customWithdrawalLimits} testid="list-current-tier" />
      </section>

      <RequestStatus t={t} />

      {t.next && next && !pending && <UpgradeFlow t={t} next={next} />}
      {!t.next && t.tier < 3 && !pending && (
        <p className={cx(card, 'p-5 text-sm text-slate-600')} data-testid="text-no-upgrade">Upgrades to Tier {t.tier + 1} aren't open yet. If you need higher limits, contact support.</p>
      )}
      {t.tier >= 3 && <p className={cx(card, 'p-5 text-sm text-slate-600')} data-testid="text-top-tier">You're on the highest tier.</p>}

      <section className={cx(card, 'p-5')} data-testid="section-all-tiers">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">What each tier includes</h2>
        <ol className="grid gap-3 md:grid-cols-3">
          {t.tiers.map((r) => (
            <li key={r.tier} className={cx('rounded-xl border p-4', r.tier === t.tier ? 'border-[var(--brand-ink)] bg-[var(--brand-soft)]' : 'border-slate-200')} data-testid={`card-tier-${r.tier}`}>
              <p className="flex items-center justify-between font-semibold text-slate-900">Tier {r.tier}{r.tier === t.tier && <span className="rounded-full bg-[var(--brand)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-fg)]">You</span>}</p>
              <TierFacts r={r} compact />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function TierFacts({ r, custom, compact, testid }: { r: TierRule; custom?: boolean; compact?: boolean; testid?: string }) {
  const cards = cardList(r);
  const rows: [string, string][] = [
    ['Withdrawals', custom ? 'Set for your account by our team (see Withdrawals)' : limitText(r.withdrawal, 'request')],
    ['Card top-ups', limitText(r.topUp, 'top-up')],
    ['Cards you can buy', cards.length ? cards.join(', ') : 'None'],
  ];
  return (
    <dl className={cx(compact ? 'mt-2 space-y-2' : 'mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200')} data-testid={testid}>
      {rows.map(([k, v]) => (
        <div key={k} className={compact ? '' : 'grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]'}>
          <dt className={compact ? 'text-xs text-slate-500' : 'text-sm text-slate-500'}>{k}</dt>
          <dd className={cx('text-sm text-slate-900', !compact && 'font-medium')}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function RequestStatus({ t }: { t: ApplicantTier }) {
  const r = t.request;
  if (!r) return null;
  const tone = r.status === 'Pending' ? { icon: Clock, cls: 'border-amber-200 bg-amber-50 text-amber-900', title: `Your Tier ${r.toTier} upgrade is being reviewed` }
    : r.status === 'Approved' ? { icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', title: `Tier ${r.toTier} approved` }
    : { icon: XCircle, cls: 'border-red-200 bg-red-50 text-red-900', title: `Your Tier ${r.toTier} upgrade wasn't approved` };
  return (
    <section className={cx('rounded-2xl border p-5', tone.cls)} data-testid="section-tier-request" data-status={r.status}>
      <p className="flex items-center gap-2 font-semibold"><tone.icon className="h-5 w-5 shrink-0" aria-hidden />{tone.title}</p>
      <p className="mt-1 text-sm">
        Sent {dateFmt(r.submittedAt)}{r.decidedAt ? ` · decided ${dateFmt(r.decidedAt)}` : ''}.
        {r.status === 'Pending' && " We'll let you know in the app and by email as soon as it's decided."}
        {r.status === 'Declined' && t.next && ' You can fix what’s mentioned and send the form again below.'}
      </p>
      {r.decisionNote && <p className="mt-2 text-sm" data-testid="text-tier-decision-note"><b>{r.status === 'Declined' ? 'Reason' : 'Note'}:</b> {r.decisionNote}</p>}
      {r.status === 'Pending' && <div className="mt-3"><PlanAnswers a={{ answers: r.answers }} testid="section-tier-request-answers" /></div>}
    </section>
  );
}

type Step = 'intro' | 'form' | 'summary';

function UpgradeFlow({ t, next }: { t: ApplicantTier; next: TierRule }) {
  const form = t.next!;
  const [step, setStep] = useState<Step>('intro');
  const [values, setValues] = useState<PlanValues>({});
  const [files, setFiles] = useState<PlanFiles>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const m = useCreateApplicantTierRequest();
  const refresh = useRefreshApplicant();
  const { toast } = useToast();
  const current = t.tiers.find((x) => x.tier === t.tier)!;
  const newCards = next.cards.filter((c) => (c.virtual && !current.cards.find((x) => x.key === c.key)?.virtual) || (c.physical && !current.cards.find((x) => x.key === c.key)?.physical));
  const toSummary = () => {
    const e = checkPlanValues(form.fields, values, files);
    setErrors(e);
    if (Object.keys(e).length) return setError('Check the highlighted fields.');
    setError(''); setStep('summary'); window.scrollTo({ top: 0 });
  };
  const submit = () => {
    setError('');
    const fileFields = form.fields.filter((f) => f.type === 'file' && f.id && files[f.id]).map((f) => f.id!);
    const answers = Object.fromEntries(form.fields.filter((f) => f.type !== 'file' && f.id && values[f.id]?.trim()).map((f) => [f.id!, values[f.id!]!.trim()]));
    m.mutate({ data: { answers: JSON.stringify(answers), fileFields: JSON.stringify(fileFields), files: fileFields.map((id) => files[id]!) } }, {
      onSuccess: () => { refresh(); window.scrollTo({ top: 0 }); toast({ title: `Tier ${form.tier} upgrade sent`, description: "We'll let you know as soon as it's reviewed." }); },
      onError: (e) => setError(apiError(e, "Your upgrade request couldn't be sent. Try again.")),
    });
  };
  return (
    <section className={cx(card, 'p-5')} data-testid="section-upgrade">
      <h2 className="text-lg font-semibold text-slate-900">Upgrade to Tier {form.tier}</h2>
      {step === 'intro' && (
        <>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="list-upgrade-unlocks">
            <div className="rounded-xl bg-[var(--brand-soft)] p-4"><dt className="text-xs text-slate-600">Withdrawals</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{limitText(next.withdrawal, 'request')}</dd>
              {t.customWithdrawalLimits && <dd className="mt-1 text-xs text-slate-500">Your account has its own limits, set by our team; they stay in place.</dd>}</div>
            <div className="rounded-xl bg-[var(--brand-soft)] p-4"><dt className="text-xs text-slate-600">Card top-ups</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{limitText(next.topUp, 'top-up')}</dd></div>
            {newCards.length > 0 && (
              <div className="rounded-xl bg-[var(--brand-soft)] p-4 sm:col-span-2"><dt className="flex items-center gap-1.5 text-xs text-slate-600"><CreditCard className="h-3.5 w-3.5" aria-hidden />New cards you can buy</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900">{newCards.map((c) => c.name).join(', ')}</dd></div>
            )}
          </dl>
          {form.intro && <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-slate-700" data-testid="text-upgrade-intro">{form.intro}</p>}
          <button type="button" className={cx(primary, 'mt-5 w-full sm:w-auto')} onClick={() => setStep('form')} data-testid="button-start-upgrade">Start the upgrade form</button>
        </>
      )}
      {step === 'form' && (
        <form className="mt-4" noValidate onSubmit={(e) => { e.preventDefault(); toSummary(); }} data-testid="form-tier-upgrade">
          <PlanFieldInputs fields={form.fields} values={values} files={files} errors={errors} inputClass={inputCls} idPrefix="tier"
            onChange={setValues} onFile={(k, f) => { setFiles((x) => ({ ...x, [k]: f })); setErrors((x) => { const { [k]: _gone, ...rest } = x; return rest; }); }} />
          {error && <p role="alert" className="mt-4 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-upgrade-error">{error}</p>}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={outline} onClick={() => setStep('intro')}>Back</button>
            <button type="submit" className={primary} data-testid="button-review-upgrade">Review and send</button>
          </div>
        </form>
      )}
      {step === 'summary' && (
        <div className="mt-4" data-testid="section-upgrade-summary">
          <p className="text-sm text-slate-600">Check your answers. Our team reviews them and you'll hear back in the app and by email. Your current limits stay in place until then.</p>
          <dl className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200" data-testid="list-upgrade-summary">
            {form.fields.map((f, i) => {
              const v = f.type === 'file' ? files[f.id!]?.name : values[f.id!]?.trim();
              return (
                <div key={f.id ?? i} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                  <dt className="text-sm text-slate-500">{f.label}</dt>
                  <dd className={cx('break-words text-sm', v ? 'font-medium text-slate-900' : 'text-slate-400')} data-testid={`text-upgrade-answer-${i}`}>{v || 'Not given'}</dd>
                </div>
              );
            })}
          </dl>
          {error && <p role="alert" className="mt-4 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-upgrade-error">{error}</p>}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={outline} onClick={() => setStep('form')} disabled={m.isPending} data-testid="button-edit-upgrade">Edit answers</button>
            <button type="button" className={primary} onClick={submit} disabled={m.isPending} data-testid="button-send-upgrade">{m.isPending ? 'Sending…' : `Send Tier ${form.tier} upgrade`}</button>
          </div>
        </div>
      )}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500"><Lock className="h-3.5 w-3.5" aria-hidden />Upload sample documents only: this is a demo.</p>
    </section>
  );
}
