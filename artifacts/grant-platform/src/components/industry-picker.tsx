import { useEffect, useState } from 'react';
import { useListIndustries, useSetApplicantIndustry } from '@workspace/api-client-react';
import { Field, Modal, cx, inputCls } from '@/components/bits';
import { apiError, useRefreshApplicant } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/*
 * Phase 11: the applicant's industry decides which grant plans are recommended. Chosen at sign-up; users who signed up
 * earlier are asked by a setup card on the dashboard, and anyone can change it in Settings.
 */

const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm';
const primary = 'press inline-flex min-h-11 items-center justify-center rounded-full bg-[#1E3A8A] px-5 text-sm font-semibold text-white hover:bg-[#0F172A] disabled:opacity-50';

function useIndustryForm(current: string | null, onSaved?: () => void) {
  const list = useListIndustries();
  const m = useSetApplicantIndustry();
  const refresh = useRefreshApplicant();
  const { toast } = useToast();
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setValue(current ?? ''); }, [current]);
  const save = () => {
    setError(null);
    if (!value) return setError('Choose your industry.');
    m.mutate({ data: { industryId: value } }, {
      onSuccess: () => {
        refresh();
        toast({ title: 'Industry saved', description: `${list.data?.find((i) => i.id === value)?.name ?? 'Your industry'}: we'll recommend grants for it.` });
        onSaved?.();
      },
      onError: (e) => setError(apiError(e, "Couldn't save your industry. Try again.")),
    });
  };
  return { list, m, value, setValue, error, save, dirty: value !== (current ?? '') };
}

function Select({ form, testid }: { form: ReturnType<typeof useIndustryForm>; testid: string }) {
  return (
    <select value={form.value} onChange={(e) => form.setValue(e.target.value)} className={inputCls} data-testid={testid} disabled={form.list.isLoading}>
      <option value="">{form.list.isLoading ? 'Loading…' : 'Choose your industry'}</option>
      {form.list.data?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
    </select>
  );
}

/** Dashboard: the "Choose your industry" setup card opens this. */
export function IndustryDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: string | null }) {
  const form = useIndustryForm(current, onClose);
  return (
    <Modal open={open} onClose={onClose} title="Choose your industry" testid="dialog-industry">
      <p className="mb-3 text-sm text-slate-600">We use it to recommend the grants that fit you. You can change it later in Settings, and you can still apply to any grant.</p>
      <Field label="Industry" error={form.error ?? undefined}><Select form={form} testid="select-industry-dialog" /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="press min-h-11 rounded-full px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100">Cancel</button>
        <button type="button" className={primary} disabled={form.m.isPending} onClick={form.save} data-testid="button-save-industry-dialog">{form.m.isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

/** Settings: change the industry at any time. */
export function IndustrySettings({ current }: { current: string | null }) {
  const form = useIndustryForm(current);
  return (
    <section className={cx(card, 'p-5')} aria-labelledby="industry-heading" data-testid="section-industry">
      <h2 id="industry-heading" className="text-lg font-semibold text-slate-900">Your industry</h2>
      <p className="mb-3 text-sm text-slate-500">Grant plans for your industry are recommended to you. You can still apply to any plan.</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1"><Field label="Industry" error={form.error ?? undefined}><Select form={form} testid="select-industry" /></Field></div>
        <button type="button" className={primary} disabled={form.m.isPending || !form.dirty} onClick={form.save} data-testid="button-save-industry">{form.m.isPending ? 'Saving…' : 'Save industry'}</button>
      </div>
    </section>
  );
}
