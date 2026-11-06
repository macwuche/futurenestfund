import { useMemo, useState } from 'react';
import { useResubmitApplicantApplication, type ApplicationDetail, type PlanField } from '@workspace/api-client-react';
import { Download, Paperclip } from 'lucide-react';
import { Field, cx, inputCls, money } from '@/components/bits';
import { PlanFieldInputs, checkPlanValues, type PlanFiles, type PlanValues } from '@/components/grant-plan';
import { apiError } from '@/lib/demo-state';

/*
 * A grant plan application on the applicant's side (Phase 11): the award and the application fee (charged only on
 * approval), the answers given, and — after "Changes requested" — the form to edit and resubmit.
 */

const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm';

/** What happens with the fee, in words, for the application's status. */
export function feeStatus(a: Pick<ApplicationDetail, 'status' | 'fee' | 'feeCharged'>) {
  const fee = a.fee ?? 0;
  if (!(fee > 0)) return 'No application fee';
  if (a.feeCharged) return `${money(fee)} charged from your account balance on approval`;
  if (a.status === 'Declined' || a.status === 'Withdrawn') return `${money(fee)} not charged`;
  return `${money(fee)}, charged from your account balance only if approved`;
}

export function PlanAnswers({ a, testid = 'section-plan-answers', fileLabel = 'Download' }: { a: ApplicationDetail | { answers?: ApplicationDetail['answers'] }; testid?: string; fileLabel?: string }) {
  const answers = a.answers ?? [];
  if (!answers.length) return null;
  return (
    <section className={cx(card, 'p-5')} aria-labelledby="answers-heading" data-testid={testid}>
      <h2 id="answers-heading" className="mb-3 text-lg font-semibold text-slate-900">Your answers</h2>
      <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {answers.map((x, i) => (
          <div key={x.fieldId} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <dt className="text-sm text-slate-500">{x.label}</dt>
            <dd className="min-w-0 break-words text-sm" data-testid={`text-answer-${i}`}>
              {x.file ? (
                <a href={x.file.url} download={x.file.name} data-testid={`link-answer-file-${i}`} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-[var(--brand-ink)] underline sm:min-h-0" aria-label={`${fileLabel} ${x.file.name}`}>
                  <Paperclip className="h-4 w-4 shrink-0" aria-hidden />{x.file.name}<Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </a>
              ) : x.value ? <span className="font-medium text-slate-900">{x.value}</span> : <span className="text-slate-400">Not given</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** After "Changes requested": edit the answers (a file left empty keeps the one attached) and resubmit. */
export function PlanResubmit({ a, onDone }: { a: ApplicationDetail; onDone: (d: ApplicationDetail) => void }) {
  const fields: PlanField[] = useMemo(() => (a.answers ?? []).map((x) => ({
    id: x.fieldId, label: x.label, type: x.type as PlanField['type'], required: x.required, placeholder: x.placeholder, help: x.help, options: x.options,
  })), [a.answers]);
  const [values, setValues] = useState<PlanValues>(() => Object.fromEntries((a.answers ?? []).filter((x) => x.type !== 'file').map((x) => [x.fieldId, x.value])));
  const [files, setFiles] = useState<PlanFiles>({});
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const m = useResubmitApplicantApplication();
  const existing = Object.fromEntries((a.answers ?? []).filter((x) => x.file).map((x) => [x.fieldId, x.file!.name]));
  const submit = () => {
    const e = checkPlanValues(fields, values, files, existing);
    setErrors(e);
    if (Object.keys(e).length) return setError('Check the highlighted fields.');
    setError('');
    const fileFields = fields.filter((f) => f.type === 'file' && files[f.id!]).map((f) => f.id!);
    const answers = Object.fromEntries(fields.filter((f) => f.type !== 'file' && values[f.id!]?.trim()).map((f) => [f.id!, values[f.id!]!.trim()]));
    m.mutate({ applicationId: a.id, data: { note: note.trim() || undefined, answers: JSON.stringify(answers), fileFields: JSON.stringify(fileFields), files: fileFields.map((id) => files[id]!) } }, {
      onSuccess: (d) => { setFiles({}); setNote(''); onDone(d); },
      onError: (err) => setError(apiError(err, "Your changes couldn't be sent. Try again.")),
    });
  };
  return (
    <form noValidate className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="form-plan-resubmit">
      <PlanFieldInputs fields={fields} values={values} files={files} errors={errors} inputClass={inputCls} idPrefix="edit" existingFiles={existing}
        onChange={setValues} onFile={(k, f) => setFiles((x) => ({ ...x, [k]: f }))} />
      <Field label="Note to the reviewer (optional)"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder="What you changed" className={cx(inputCls, 'resize-y')} data-testid="input-resubmit-note" /></Field>
      {error && <p role="alert" className="text-sm text-[#991B1B]" data-testid="text-resubmit-error">{error}</p>}
      <button type="submit" disabled={m.isPending} className="press rounded-full bg-[var(--brand)] px-5 py-2.5 text-[15px] font-semibold text-[var(--brand-fg)] hover:bg-[var(--brand-dark)] disabled:opacity-60" data-testid="button-resubmit-plan">
        {m.isPending ? 'Resubmitting…' : 'Resubmit application'}
      </button>
    </form>
  );
}
