import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetApplicantMatchmakingQueryKey, useGetApplicantMatchmaking, useSaveApplicantMatchmaking,
  MatchmakingAnswersFocusAreasItem, MatchmakingAnswersFundingSize, MatchmakingAnswersGoalsItem, MatchmakingAnswersOrgType, MatchmakingAnswersTimeline,
  type ApplicantDashboard, type MatchmakingAnswers,
} from '@workspace/api-client-react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import { Modal, cx, dateFmt, money } from '@/components/bits';
import { apiError, useRefreshApplicant } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

const card = 'rounded-2xl border border-[#E5E7EB] bg-white shadow-sm';
const ORG_TYPES = Object.values(MatchmakingAnswersOrgType);
const FOCUS = Object.values(MatchmakingAnswersFocusAreasItem);
const GOALS = Object.values(MatchmakingAnswersGoalsItem);
const SIZES: { v: MatchmakingAnswers['fundingSize']; label: string }[] = [
  { v: MatchmakingAnswersFundingSize.under10k, label: 'Under $10,000' }, { v: MatchmakingAnswersFundingSize['10to30k'], label: '$10,000 – $30,000' },
  { v: MatchmakingAnswersFundingSize.over30k, label: 'Over $30,000' }, { v: MatchmakingAnswersFundingSize.any, label: 'Any amount' },
];
const TIMES: { v: MatchmakingAnswers['timeline']; label: string }[] = [
  { v: MatchmakingAnswersTimeline['30days'], label: 'Within 30 days' }, { v: MatchmakingAnswersTimeline['90days'], label: 'Within 90 days' },
  { v: MatchmakingAnswersTimeline.flexible, label: 'Flexible' },
];

const schema = z.object({
  orgType: z.enum(ORG_TYPES as [MatchmakingAnswers['orgType'], ...MatchmakingAnswers['orgType'][]], { message: 'Choose your organization type.' }),
  focusAreas: z.array(z.enum(FOCUS as [string, ...string[]])).min(1, 'Choose at least one focus area.'),
  goals: z.array(z.enum(GOALS as [string, ...string[]])).min(1, 'Choose at least one goal.'),
  fundingSize: z.enum(SIZES.map((s) => s.v) as [string, ...string[]], { message: 'Choose a funding size.' }),
  timeline: z.enum(TIMES.map((t) => t.v) as [string, ...string[]], { message: 'Choose when you need the money.' }),
});
type Form = z.infer<typeof schema>;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const chip = (on: boolean) => cx('press inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition md:min-h-9',
  on ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-[#1E3A8A]');

function Question({ n, title, hint, error, children }: { n: number; title: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-slate-900"><span className="mr-1.5 text-[#1E3A8A]">{n}.</span>{title}</legend>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <div className="flex flex-wrap gap-2">{children}</div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </fieldset>
  );
}

/** Single choice shown as chips (radio semantics). */
function Choice<T extends string>({ name, options, value, onChange }: { name: string; options: { v: T; label: string }[]; value?: string; onChange: (v: T) => void }) {
  return <>{options.map((o) => (
    <label key={o.v} className={chip(value === o.v)} data-testid={`option-${name}-${slug(o.v)}`}>
      <input type="radio" name={name} className="sr-only" checked={value === o.v} onChange={() => onChange(o.v)} />
      {value === o.v && <Check className="h-3.5 w-3.5" />}{o.label}
    </label>
  ))}</>;
}

/** Several choices shown as chips (checkbox semantics). */
function Multi({ name, options, value, onChange }: { name: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return <>{options.map((o) => {
    const on = value.includes(o);
    return (
      <label key={o} className={chip(on)} data-testid={`option-${name}-${slug(o)}`}>
        <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])} />
        {on && <Check className="h-3.5 w-3.5" />}{o}
      </label>
    );
  })}</>;
}

/** The five-question matchmaking questionnaire. Rule-based: answers are scored against each grant's published criteria. */
export function MatchmakingDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: MatchmakingAnswers | null }) {
  const { toast } = useToast();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const refresh = useRefreshApplicant();
  const save = useSaveApplicantMatchmaking();
  const [error, setError] = useState('');
  const f = useForm<Form>({
    resolver: zodResolver(schema),
    values: { orgType: initial?.orgType as Form['orgType'], focusAreas: initial?.focusAreas ?? [], goals: initial?.goals ?? [], fundingSize: initial?.fundingSize as Form['fundingSize'], timeline: initial?.timeline as Form['timeline'] },
  });
  const e = f.formState.errors;
  const close = () => { setError(''); onClose(); };
  return (
    <Modal open={open} onClose={close} title={initial ? 'Edit your matchmaking answers' : 'Find grants that fit you'} testid="dialog-matchmaking">
      <form noValidate className="space-y-5" onSubmit={f.handleSubmit((v) => {
        setError('');
        save.mutate({ data: v as MatchmakingAnswers }, {
          onSuccess: (res) => {
            qc.setQueryData(getGetApplicantMatchmakingQueryKey(), res);
            refresh();
            const n = res.matches.filter((m) => m.recommended).length;
            toast({ title: n ? `${n} recommended ${n === 1 ? 'grant' : 'grants'} for you` : 'Answers saved', description: n ? 'Ranked by how well each grant fits your answers.' : 'No grant scores 70% or more yet. Try more focus areas or a broader funding size.' });
            close();
            nav('/grants');
          },
          onError: (err) => setError(apiError(err, 'Your answers could not be saved. Please try again.')),
        });
      })}>
        <p className="text-sm text-slate-600">We score each sample grant against your answers using fixed rules (who can apply, focus area, goals, amount and deadline) and show why it fits. No AI is used.</p>
        <Controller control={f.control} name="orgType" render={({ field }) => (
          <Question n={1} title="What kind of organization are you?" error={e.orgType?.message}>
            <Choice name="orgType" options={ORG_TYPES.map((v) => ({ v, label: v }))} value={field.value} onChange={field.onChange} />
          </Question>
        )} />
        <Controller control={f.control} name="focusAreas" render={({ field }) => (
          <Question n={2} title="Which areas do you work in?" hint="Choose all that apply." error={e.focusAreas?.message}>
            <Multi name="focus" options={FOCUS} value={field.value} onChange={field.onChange} />
          </Question>
        )} />
        <Controller control={f.control} name="goals" render={({ field }) => (
          <Question n={3} title="What do you need the funding for?" hint="Choose all that apply." error={e.goals?.message}>
            <Multi name="goal" options={GOALS} value={field.value} onChange={field.onChange} />
          </Question>
        )} />
        <Controller control={f.control} name="fundingSize" render={({ field }) => (
          <Question n={4} title="How much funding are you looking for?" error={e.fundingSize?.message}>
            <Choice name="size" options={SIZES} value={field.value} onChange={field.onChange} />
          </Question>
        )} />
        <Controller control={f.control} name="timeline" render={({ field }) => (
          <Question n={5} title="When do you need a decision?" error={e.timeline?.message}>
            <Choice name="timeline" options={TIMES} value={field.value} onChange={field.onChange} />
          </Question>
        )} />
        {error && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-matchmaking-error">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={close} className="press min-h-11 rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700 md:min-h-10">Cancel</button>
          <button type="submit" disabled={save.isPending} data-testid="button-save-matchmaking" className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-[#1E3A8A] px-5 text-sm font-semibold text-white hover:bg-[#0F172A] disabled:opacity-60 md:min-h-10">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{initial ? 'Update my matches' : 'Show my matches'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Opens the questionnaire, pre-filled with the saved answers. */
export function useMatchmakingDialog() {
  const [open, setOpen] = useState(false);
  const q = useGetApplicantMatchmaking();
  return { open: () => setOpen(true), answered: !!q.data?.answers, dialog: <MatchmakingDialog open={open} onClose={() => setOpen(false)} initial={q.data?.answers} /> };
}

type Grant = ApplicantDashboard['recommendations'][number];

/** "92% match" pill; nothing before the questionnaire is answered. */
export function MatchPill({ g }: { g: Grant }) {
  if (g.matchScore === undefined) return null;
  return (
    <span data-testid={`text-match-${g.id}`} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums',
      g.recommended ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-slate-100 text-slate-600')}>
      {g.matchScore}% match
    </span>
  );
}

/** The reasons behind a score, collapsed by default. */
export function WhyMatch({ g }: { g: Grant }) {
  if (!g.matchReasons?.length) return null;
  return (
    <details className="group mt-3 text-sm" data-testid={`why-match-${g.id}`}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center font-semibold text-[#1E3A8A] hover:underline md:min-h-0">Why this match</summary>
      <ul className="mt-1.5 space-y-1 text-slate-600">
        {g.matchReasons.map((r) => <li key={r} className="flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#16A34A]" />{r}</li>)}
      </ul>
    </details>
  );
}

/** Top of Grant categories: the three best matches, or a prompt to answer the questionnaire. */
export function TopMatches({ d }: { d: ApplicantDashboard }) {
  const mm = useMatchmakingDialog();
  const scored = d.recommendations.filter((g) => g.matchScore !== undefined);
  if (!scored.length) {
    return (
      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#DBEAFE] bg-[#EEF4FB] p-5" data-testid="section-find-matches">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-[#1E3A8A] shadow-sm"><Sparkles className="h-5 w-5" /></span>
        <div className="min-w-[12rem] flex-1">
          <h2 className="text-lg font-semibold text-slate-900">Find grants that fit you</h2>
          <p className="text-sm text-slate-600">Answer five quick questions and we'll rank these grants by how well they fit, and show why.</p>
        </div>
        <button data-testid="button-start-matchmaking" onClick={mm.open} className="press min-h-11 rounded-full bg-[#1E3A8A] px-5 text-sm font-semibold text-white hover:bg-[#0F172A]">Find my matches</button>
        {mm.dialog}
      </section>
    );
  }
  const top = scored.filter((g) => g.recommended).slice(0, 3);
  return (
    <section className={cx(card, 'p-4 sm:p-5')} data-testid="section-top-matches" aria-labelledby="top-matches-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="top-matches-heading" className="text-lg font-semibold text-slate-900">Your top matches</h2>
        <button data-testid="button-edit-matchmaking" onClick={mm.open} className="press inline-flex min-h-11 items-center text-sm font-semibold text-[#1E3A8A] hover:underline md:min-h-0">Edit answers</button>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-slate-600" data-testid="text-no-matches">No grant fits your answers well enough to recommend (70% or more). Try more focus areas, more goals or "Any amount".</p>
      ) : (
        <ol className="grid gap-3 md:grid-cols-3">
          {top.map((g, i) => (
            <li key={g.id} className="rounded-xl border border-slate-200 p-4" data-testid={`top-match-${g.id}`}>
              <div className="flex items-start justify-between gap-2"><span className="text-xs font-semibold text-slate-500">#{i + 1} · {g.category}</span><MatchPill g={g} /></div>
              <h3 className="mt-1 font-semibold text-slate-900">{g.title}</h3>
              <p className="text-sm text-slate-600"><span className="font-semibold tabular-nums text-[#1E3A8A]">{money(g.amount)}</span> · closes {dateFmt(g.deadline)}</p>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {g.matchReasons?.map((r) => <li key={r} className="flex gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-[#16A34A]" />{r}</li>)}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {mm.dialog}
    </section>
  );
}
