import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import {
  useListApplicantGrantPlans, useGetApplicantGrantPlan, useCreateApplicantApplication, useListIndustries,
  type GrantPlan,
} from '@workspace/api-client-react';
import { ArrowLeft, ChevronRight, Search, Sparkles } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Empty, ErrorState, PageSkeleton, StatusBadge, cx, inputCls, money } from '@/components/bits';
import { PlanFieldInputs, PlanLogo, checkPlanValues, feeLine, type PlanFiles, type PlanValues } from '@/components/grant-plan';
import { apiError, useApplicantDashboard, useRefreshApplicant } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/*
 * Grants (Phase 11): the grant plans administrators create. The ones for the applicant's industry (and plans for all
 * industries) are recommended first. Applying: the plan's own form → a summary with the award and the application
 * fee → submit. Nothing is charged until an administrator approves.
 */

const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm';
const primary = 'press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--brand-fg)] hover:bg-[var(--brand-dark)] disabled:opacity-60';
const outline = 'press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60';

export function GrantPlansPage() {
  return <Shell title="Grants"><GrantPlansBody /></Shell>;
}

function GrantPlansBody() {
  const q = useListApplicantGrantPlans();
  const industries = useListIndustries();
  const dash = useApplicantDashboard();
  const [find, setFind] = useState('');
  const [industry, setIndustry] = useState('');
  const mine = dash.data?.profile.industryId ?? null;
  const myIndustry = mine ? industries.data?.find((i) => i.id === mine)?.name : undefined;
  const shown = useMemo(() => {
    const term = find.trim().toLowerCase();
    return (q.data ?? []).filter((p) => (!industry || (industry === 'all' ? p.industryId === null : p.industryId === industry))
      && (!term || `${p.name} ${p.industry} ${p.description}`.toLowerCase().includes(term)));
  }, [q.data, find, industry]);
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const filtering = !!find.trim() || !!industry;
  const recommended = shown.filter((p) => p.recommended);
  const others = shown.filter((p) => !p.recommended);
  const usedIndustries = (industries.data ?? []).filter((i) => q.data!.some((p) => p.industryId === i.id));
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1"><span className="sr-only">Search grants</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search grants" className={cx(inputCls, 'pl-9')} data-testid="input-search-plans" />
        </label>
        <label className="sm:w-64"><span className="sr-only">Industry</span>
          <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={inputCls} data-testid="select-plan-industry-filter">
            <option value="">All grants</option>
            <option value="all">Open to all industries</option>
            {usedIndustries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
      </div>
      {q.data.length === 0 ? <Empty title="No grants are open right now" hint="New grants appear here as soon as they open. Check back soon." />
        : !shown.length ? <Empty title="No grants match" hint="Try another word or industry." />
        : (
          <>
            {!filtering && !mine && (
              <p className="rounded-xl border border-[var(--brand-ink)]/15 bg-[#F5F8FD] px-4 py-3 text-sm text-slate-700" data-testid="text-choose-industry-hint">
                <Link href="/settings" className="font-semibold text-[var(--brand-ink)] underline">Choose your industry</Link> to see the grants recommended for you.
              </p>
            )}
            {recommended.length > 0 && (
              <section aria-labelledby="recommended-heading" data-testid="section-recommended-plans">
                <h2 id="recommended-heading" className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900"><Sparkles className="h-5 w-5 text-[var(--brand-ink)]" aria-hidden />Recommended for you</h2>
                {myIndustry && !filtering && <p className="-mt-2 mb-3 text-sm text-slate-500">For {myIndustry}, and grants open to every industry.</p>}
                <PlanGrid plans={recommended} />
              </section>
            )}
            {others.length > 0 && (
              <section aria-labelledby="other-heading" data-testid="section-other-plans">
                <h2 id="other-heading" className="mb-3 text-lg font-semibold text-slate-900">{recommended.length ? 'Other grants' : 'All grants'}</h2>
                <PlanGrid plans={others} />
              </section>
            )}
          </>
        )}
    </div>
  );
}

function PlanGrid({ plans }: { plans: GrantPlan[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="list-plans">
      {plans.map((p) => (
        <li key={p.id}>
          <Link href={`/grants/${p.id}`} data-testid={`card-plan-${p.id}`} className={cx(card, 'lift group flex h-full flex-col p-4 transition hover:border-[var(--brand-ink)] sm:p-5')}>
            <div className="flex items-start gap-3">
              <PlanLogo url={p.logoUrl} name={p.name} initials={p.initials} className="h-12 w-12" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">{p.name}</p>
                <p className="text-xs text-slate-500">{p.industry}</p>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5" aria-hidden />
            </div>
            {p.description && <p className="mt-3 line-clamp-2 text-sm text-slate-600">{p.description}</p>}
            <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-4">
              <span><span className="block text-xs text-slate-500">You receive</span><span className="text-xl font-bold tabular-nums text-[var(--brand-ink)]" data-testid={`text-plan-amount-${p.id}`}>{money(p.amount)}</span></span>
              <span className="text-xs text-slate-500" data-testid={`text-plan-fee-${p.id}`}>{feeLine(p.feeAmount)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ---------- one plan: details → form → summary → submit ---------- */

export function GrantPlanPage() {
  const { planId } = useParams<{ planId: string }>();
  const q = useGetApplicantGrantPlan(planId ?? '');
  return (
    <Shell title={q.data?.name ?? 'Grant'}>
      <Link href="/grants" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--brand-ink)] hover:underline" data-testid="link-back-grants"><ArrowLeft className="h-4 w-4" />All grants</Link>
      {q.isLoading ? <PageSkeleton />
        : q.isError || !q.data ? <Empty title="This grant isn't open" hint="It may have closed. Browse the grants that are open now." />
        : <ApplyFlow p={q.data} />}
    </Shell>
  );
}

type Step = 'details' | 'form' | 'summary';

function ApplyFlow({ p }: { p: GrantPlan }) {
  const [step, setStep] = useState<Step>('details');
  const [values, setValues] = useState<PlanValues>({});
  const [files, setFiles] = useState<PlanFiles>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const m = useCreateApplicantApplication();
  const refresh = useRefreshApplicant();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const toSummary = () => {
    const e = checkPlanValues(p.fields, values, files);
    setErrors(e);
    if (Object.keys(e).length) { setError('Check the highlighted fields.'); return; }
    setError(''); setStep('summary'); window.scrollTo({ top: 0 });
  };
  const submit = () => {
    setError('');
    const fileFields = p.fields.filter((f) => f.type === 'file' && f.id && files[f.id]).map((f) => f.id!);
    const answers = Object.fromEntries(p.fields.filter((f) => f.type !== 'file' && f.id && values[f.id]?.trim()).map((f) => [f.id!, values[f.id!]!.trim()]));
    m.mutate({ data: { planId: p.id, answers: JSON.stringify(answers), fileFields: JSON.stringify(fileFields), files: fileFields.map((id) => files[id]!) } }, {
      onSuccess: (a) => {
        refresh();
        toast({ title: 'Application submitted', description: p.feeAmount > 0 ? `Nothing is charged now. The ${money(p.feeAmount)} fee is charged only if it's approved.` : "We'll let you know when it's reviewed." });
        navigate(`/applications/${a.id}`);
      },
      onError: (e) => setError(apiError(e, "Your application couldn't be submitted. Try again.")),
    });
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PlanHeader p={p} />
      {step === 'details' && (
        <section className={cx(card, 'p-5')} data-testid="section-plan-details">
          {p.description ? <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-700" data-testid="text-plan-description">{p.description}</p>
            : <p className="text-sm text-slate-500">No description.</p>}
          <FeeNote fee={p.feeAmount} />
          <button type="button" className={cx(primary, 'mt-5 w-full sm:w-auto')} onClick={() => setStep('form')} data-testid="button-start-application">Apply for this grant</button>
        </section>
      )}
      {step === 'form' && (
        <form className={cx(card, 'p-5')} noValidate onSubmit={(e) => { e.preventDefault(); toSummary(); }} data-testid="form-plan-application">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Your application</h2>
          {p.fields.length === 0 ? <p className="text-sm text-slate-600">This grant has no questions. Continue to review and submit.</p>
            : <PlanFieldInputs fields={p.fields} values={values} files={files} errors={errors} inputClass={inputCls} idPrefix="apply"
                onChange={setValues} onFile={(k, f) => { setFiles((x) => ({ ...x, [k]: f })); setErrors((x) => { const { [k]: _gone, ...rest } = x; return rest; }); }} />}
          {error && <p role="alert" className="mt-4 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-apply-error">{error}</p>}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={outline} onClick={() => setStep('details')}>Back</button>
            <button type="submit" className={primary} data-testid="button-review-application">Review application</button>
          </div>
        </form>
      )}
      {step === 'summary' && (
        <section className={cx(card, 'p-5')} data-testid="section-application-summary">
          <h2 className="text-lg font-semibold text-slate-900">Check and submit</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-[var(--brand-soft)] p-4"><dt className="text-sm text-slate-600">You'll receive if approved</dt><dd className="mt-1 text-2xl font-bold tabular-nums text-[var(--brand-ink)]" data-testid="text-summary-amount">{money(p.amount)}</dd><dd className="text-xs text-slate-500">Added to your grant balance</dd></div>
            <div className="rounded-xl bg-slate-50 p-4"><dt className="text-sm text-slate-600">Application fee</dt><dd className="mt-1 text-2xl font-bold tabular-nums text-slate-900" data-testid="text-summary-fee">{money(p.feeAmount)}</dd><dd className="text-xs text-slate-500">{p.feeAmount > 0 ? 'Charged from your account balance only if approved' : 'No fee for this grant'}</dd></div>
          </dl>
          <FeeNote fee={p.feeAmount} />
          {p.fields.length > 0 && (
            <dl className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200" data-testid="list-summary-answers">
              {p.fields.map((f, i) => {
                const v = f.type === 'file' ? files[f.id!]?.name : values[f.id!]?.trim();
                return (
                  <div key={f.id ?? i} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                    <dt className="text-sm text-slate-500">{f.label}</dt>
                    <dd className={cx('break-words text-sm', v ? 'font-medium text-slate-900' : 'text-slate-400')} data-testid={`text-summary-answer-${i}`}>{v || 'Not given'}</dd>
                  </div>
                );
              })}
            </dl>
          )}
          {error && <p role="alert" className="mt-4 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-apply-error">{error}</p>}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={outline} onClick={() => setStep('form')} disabled={m.isPending} data-testid="button-edit-application">Edit answers</button>
            <button type="button" className={primary} onClick={submit} disabled={m.isPending} data-testid="button-submit-application">{m.isPending ? 'Submitting…' : 'Submit application'}</button>
          </div>
        </section>
      )}
    </div>
  );
}

function PlanHeader({ p }: { p: GrantPlan }) {
  return (
    <section className={cx(card, 'flex flex-wrap items-center gap-4 p-5')} data-testid="section-plan-header">
      <PlanLogo url={p.logoUrl} name={p.name} initials={p.initials} className="h-16 w-16" />
      <div className="min-w-0 flex-1 basis-40">
        <h2 className="text-xl font-bold text-slate-900" data-testid="text-plan-name">{p.name}</h2>
        <p className="text-sm text-slate-500">{p.industry}{p.recommended && <span className="ml-2 align-middle"><StatusBadge status="Recommended" dot={false} /></span>}</p>
      </div>
      {/* Phones: the amount goes under the name, so the name keeps the width. */}
      <div className="w-full border-t border-slate-100 pt-3 sm:w-auto sm:border-0 sm:pt-0 sm:text-right">
        <p className="text-2xl font-bold tabular-nums text-[var(--brand-ink)]" data-testid="text-plan-amount">{money(p.amount)}</p>
        <p className="text-xs text-slate-500" data-testid="text-plan-fee">{feeLine(p.feeAmount)}</p>
      </div>
    </section>
  );
}

function FeeNote({ fee }: { fee: number }) {
  if (!(fee > 0)) return null;
  return (
    <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="text-fee-note">
      Nothing is charged when you apply. If your application is approved, the {money(fee)} application fee is charged from your account balance,
      even if that takes it below $0. Your next deposit then covers it first.
    </p>
  );
}
