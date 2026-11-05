import { useEffect, useState } from 'react';
import {
  useListAdminGrantPlans, useCreateAdminGrantPlan, useUpdateAdminGrantPlan, useDeleteAdminGrantPlan, useUploadAdminGrantPlanLogo,
  useSetAdminGrantPlanLogoUrl, useDeleteAdminGrantPlanLogo, useListIndustries, getListAdminGrantPlansQueryKey, getListAdminIndustriesQueryKey,
  type GrantPlan, type GrantPlanUpdate, type PlanField,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ImageUp, Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Empty, ErrorState, Field, Modal, Skel, checkFile, cx, money } from '@/components/bits';
import { card, ainput, lime, dark, danger, ghost, SectionTitle } from '@/components/admin-bits';
import { FieldBuilder, PLAN_FIELD_TYPES, checkDraftFields, fieldsOut, toDraftFields, type DraftField } from '@/components/field-builder';
import { PlanFieldInputs, PlanLogo, feeLine, initialsOf, type PlanFiles, type PlanValues } from '@/components/grant-plan';
import { FeeInput, feeDraft, feeFromDraft, type FeeDraft } from '@/components/fee-input';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/*
 * Grant Plans (Phase 11): the grants applicants apply to. Each plan has its industry, award, application fee (charged
 * from the applicant's account balance only when the application is approved) and its own application form.
 */

const MAX_FIELDS = 30;

function useRefreshPlans() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getListAdminGrantPlansQueryKey() });
    qc.invalidateQueries({ queryKey: getListAdminIndustriesQueryKey() });
  };
}

export function AdminGrantPlansPage() {
  const list = useListAdminGrantPlans();
  const [editing, setEditing] = useState<GrantPlan | 'new' | null>(null);
  const [removing, setRemoving] = useState<GrantPlan | null>(null);
  return (
    <Shell admin title="Grant Plans">
      <section className={cx(card, 'p-5')} data-testid="section-grant-plans">
        <SectionTitle action={
          <button data-testid="button-create-plan" onClick={() => setEditing('new')} className={cx(lime, 'inline-flex min-h-11 items-center gap-1.5')}>
            <Plus className="h-4 w-4" />Create grant plan
          </button>}>
          Grant plans
        </SectionTitle>
        <p className="-mt-2 mb-4 text-sm text-slate-500">
          Applicants see the plans that are on, with the ones for their industry recommended first. Each plan has its own application form.
          The application fee is charged from the applicant's account balance only when you approve, and it is the one charge that can take that balance below $0.
        </p>
        {list.isLoading ? <div className="space-y-2">{[1, 2].map((i) => <Skel key={i} className="h-20" />)}</div>
          : list.isError || !list.data ? <ErrorState onRetry={() => list.refetch()} />
          : list.data.length === 0 ? <Empty title="No grant plans yet" hint="Applicants can't apply for a grant until you create a plan and switch it on." />
          : <ul className="space-y-3" data-testid="list-plans">{list.data.map((p) => (
              <PlanRow key={p.id} p={p} onEdit={() => setEditing(p)} onDelete={() => setRemoving(p)} />
            ))}</ul>}
      </section>
      {editing && <PlanEditor plan={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <DeletePlan plan={removing} onClose={() => setRemoving(null)} />
    </Shell>
  );
}

function PlanRow({ p, onEdit, onDelete }: { p: GrantPlan; onEdit: () => void; onDelete: () => void }) {
  const update = useUpdateAdminGrantPlan();
  const refresh = useRefreshPlans();
  const { toast } = useToast();
  const meta = [p.industry, `${money(p.amount)} award`, feeLine(p.feeAmount), `${p.fields.length} field${p.fields.length === 1 ? '' : 's'}`].join(' · ');
  return (
    <li className={cx('rounded-xl border p-4', p.enabled ? 'border-[#E2E8F0]' : 'border-dashed border-slate-300 bg-slate-50')} data-testid={`row-plan-${p.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <PlanLogo url={p.logoUrl} name={p.name} initials={p.initials} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold" data-testid={`text-plan-name-${p.id}`}>{p.name}{!p.enabled && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">Off</span>}</p>
          <p className="text-xs text-slate-500" data-testid={`text-plan-meta-${p.id}`}>{meta}</p>
          <p className="text-xs text-slate-500">{p.applicationCount ?? 0} application{p.applicationCount === 1 ? '' : 's'}</p>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" role="switch" className="h-5 w-5 accent-[#111]" checked={!!p.enabled} disabled={update.isPending} data-testid={`switch-plan-enabled-${p.id}`}
            onChange={(e) => update.mutate({ planId: p.id, data: { enabled: e.target.checked } }, {
              onSuccess: () => { refresh(); toast({ title: e.target.checked ? `${p.name} is on` : `${p.name} is off`, description: e.target.checked ? 'Applicants can apply to it.' : "Applicants won't see it. Applications already made carry on." }); },
              onError: (err) => toast({ title: 'Not saved', description: apiError(err, 'Try again.'), variant: 'destructive' }),
            })} />
          {p.enabled ? 'On' : 'Off'}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onEdit} data-testid={`button-edit-plan-${p.id}`} className={cx(ghost, 'inline-flex min-h-11 items-center gap-1.5')}><Pencil className="h-4 w-4" />Edit</button>
        <button onClick={onDelete} data-testid={`button-delete-plan-${p.id}`} className="press ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" />Delete</button>
      </div>
    </li>
  );
}

function DeletePlan({ plan, onClose }: { plan: GrantPlan | null; onClose: () => void }) {
  const del = useDeleteAdminGrantPlan();
  const refresh = useRefreshPlans();
  const { toast } = useToast();
  const [error, setError] = useState('');
  useEffect(() => setError(''), [plan]);
  if (!plan) return null;
  const used = (plan.applicationCount ?? 0) > 0;
  return (
    <Modal open onClose={onClose} title={`Delete ${plan.name}?`} testid="dialog-delete-plan">
      <p className="text-sm text-slate-600">
        {used ? `${plan.name} has ${plan.applicationCount} application${plan.applicationCount === 1 ? '' : 's'}, so it can't be deleted. Switch it off instead: applicants won't see it, and the applications carry on.`
          : `Nobody has applied to ${plan.name}. Deleting it removes it and its logo for good.`}
      </p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="press min-h-11 rounded-lg px-4 text-sm font-semibold hover:bg-slate-100" data-testid="button-delete-plan-cancel">Cancel</button>
        {!used && <button disabled={del.isPending} className={cx(danger, 'min-h-11')} data-testid="button-delete-plan-confirm"
          onClick={() => del.mutate({ planId: plan.id }, { onSuccess: () => { refresh(); onClose(); toast({ title: `${plan.name} deleted` }); }, onError: (e) => setError(apiError(e, 'It could not be deleted.')) })}>
          {del.isPending ? 'Deleting…' : 'Delete plan'}</button>}
      </div>
    </Modal>
  );
}

/* ---------- the create / edit form ---------- */

type Draft = {
  name: string; description: string; industryId: string; amount: string; fee: FeeDraft; fields: DraftField[]; enabled: boolean;
  logoTab: 'upload' | 'url'; logoFile: File | null; logoUrlInput: string; removeLogo: boolean;
};
const toDraft = (p: GrantPlan | undefined): Draft => ({
  name: p?.name ?? '', description: p?.description ?? '', industryId: p?.industryId ?? '', amount: p ? String(p.amount) : '',
  fee: feeDraft(p?.fee), fields: toDraftFields(p?.fields), enabled: p?.enabled ?? true,
  logoTab: 'upload', logoFile: null, logoUrlInput: '', removeLogo: false,
});
const parseAmount = (s: string) => { const t = s.trim().replace(/[$,\s]/g, ''); return t === '' ? null : Number(t); };
const validAward = (n: number | null) => n !== null && Number.isFinite(n) && n >= 1 && n <= 10_000_000 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const planFields = (fields: DraftField[]) => fieldsOut(fields) as PlanField[];

function previewFee(d: Draft) {
  const f = feeFromDraft(d.fee, 'The application fee');
  const award = parseAmount(d.amount);
  if (typeof f === 'string' || !(f.amount > 0)) return 0;
  if (f.mode === 'fixed') return f.amount;
  return validAward(award) ? Math.round(award! * f.amount) / 100 : 0;
}

function checkDraft(d: Draft): string {
  if (d.name.trim().length < 2) return 'Give the plan a name (at least 2 characters).';
  if (!validAward(parseAmount(d.amount))) return 'The award amount must be between $1 and $10,000,000, with at most two decimals.';
  const fee = feeFromDraft(d.fee, 'The application fee');
  if (typeof fee === 'string') return fee;
  if (previewFee(d) > parseAmount(d.amount)!) return "The application fee can't be more than the award.";
  const fieldProblem = checkDraftFields(d.fields);
  if (fieldProblem) return fieldProblem;
  if (d.fields.filter((f) => f.type === 'file').length > 10) return "A plan's form can ask for at most 10 files.";
  if (d.logoTab === 'url' && d.logoUrlInput.trim() && !/^https:\/\//i.test(d.logoUrlInput.trim())) return 'The logo link must start with https://';
  return '';
}

function PlanEditor({ plan, onClose }: { plan?: GrantPlan; onClose: () => void }) {
  const [current, setCurrent] = useState<GrantPlan | undefined>(plan);
  const [d, setD] = useState<Draft>(() => toDraft(plan));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewValues, setPreviewValues] = useState<PlanValues>({});
  const [previewFiles, setPreviewFiles] = useState<PlanFiles>({});
  const industries = useListIndustries();
  const create = useCreateAdminGrantPlan();
  const update = useUpdateAdminGrantPlan();
  const uploadLogo = useUploadAdminGrantPlanLogo();
  const linkLogo = useSetAdminGrantPlanLogoUrl();
  const dropLogo = useDeleteAdminGrantPlanLogo();
  const refresh = useRefreshPlans();
  const { toast } = useToast();
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const [localLogo, setLocalLogo] = useState<string | undefined>();
  useEffect(() => {
    if (!d.logoFile) { setLocalLogo(undefined); return; }
    const u = URL.createObjectURL(d.logoFile); setLocalLogo(u);
    return () => URL.revokeObjectURL(u);
  }, [d.logoFile]);
  const shownLogo = d.removeLogo ? undefined : localLogo ?? current?.logoUrl;
  const industryName = d.industryId ? industries.data?.find((i) => i.id === d.industryId)?.name ?? current?.industry ?? '' : 'All industries';
  const award = parseAmount(d.amount);

  const save = async () => {
    const problem = checkDraft(d);
    if (problem) return setError(problem);
    setError(''); setBusy(true);
    const data: GrantPlanUpdate = {
      name: d.name.trim(), description: d.description, industryId: d.industryId || null, amount: award!,
      fee: feeFromDraft(d.fee, 'The application fee') as { mode: 'fixed' | 'percent'; amount: number },
      fields: planFields(d.fields), enabled: d.enabled,
    };
    let saved = current;
    try {
      saved = current ? await update.mutateAsync({ planId: current.id, data }) : await create.mutateAsync({ data: { ...data, name: data.name!, amount: data.amount! } });
      setCurrent(saved);
    } catch (e) { setBusy(false); return setError(apiError(e, 'The plan could not be saved.')); }
    // The logo is a second step: a plan saved without one still exists, so a logo problem keeps the form open on that plan.
    try {
      if (d.logoTab === 'upload' && d.logoFile) saved = await uploadLogo.mutateAsync({ planId: saved!.id, data: { file: d.logoFile } });
      else if (d.logoTab === 'url' && d.logoUrlInput.trim()) saved = await linkLogo.mutateAsync({ planId: saved!.id, data: { url: d.logoUrlInput.trim() } });
      else if (d.removeLogo && saved!.logoUrl) saved = await dropLogo.mutateAsync({ planId: saved!.id });
    } catch (e) {
      setBusy(false); setCurrent(saved); refresh();
      return setError(`The plan was saved, but the logo wasn't: ${apiError(e, 'try another image.')}`);
    }
    setBusy(false); refresh(); onClose();
    toast({ title: current ? `${saved!.name} saved` : `${saved!.name} created`, description: saved!.enabled ? 'Applicants can apply to it now.' : "It's off, so applicants don't see it yet." });
  };

  return (
    <Modal open wide onClose={onClose} title={current ? `Edit ${current.name}` : 'Create grant plan'} testid="dialog-plan">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form className="min-w-0 space-y-5" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Logo or image (optional)</legend>
            <div className="flex flex-wrap items-center gap-3">
              <PlanLogo url={shownLogo} name={d.name || 'Grant plan'} initials={initialsOf(d.name || 'Grant plan')} className="h-16 w-16" />
              <div className="flex rounded-lg border border-slate-300 p-0.5" role="tablist" aria-label="Logo source">
                {(['upload', 'url'] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={d.logoTab === t} data-testid={`tab-plan-logo-${t}`} onClick={() => set({ logoTab: t })}
                    className={cx('press inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold', d.logoTab === t ? 'bg-[#111] text-white' : 'text-slate-700 hover:bg-slate-100')}>
                    {t === 'upload' ? <><ImageUp className="h-4 w-4" />Upload</> : <><Link2 className="h-4 w-4" />Link</>}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-500">Without one, applicants see the plan's initials ({initialsOf(d.name || 'Grant plan')}).</p>
            {d.logoTab === 'upload' ? (
              <label className="press flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm hover:border-slate-500">
                <ImageUp className="h-4 w-4 text-slate-500" /><span className="truncate">{d.logoFile ? d.logoFile.name : 'Choose a PNG, JPG or WebP image (up to 2 MB)'}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" data-testid="input-plan-logo-file" onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f) { const bad = checkFile(f, 'image') || (f.size > 2 * 1024 * 1024 ? 'Logos must be 2 MB or smaller.' : ''); if (bad) { setError(bad); return; } }
                  setError(''); set({ logoFile: f, removeLogo: false });
                }} />
              </label>
            ) : (
              <input value={d.logoUrlInput} onChange={(e) => set({ logoUrlInput: e.target.value, removeLogo: false })} placeholder="https://example.com/logo.png" maxLength={2000}
                className={cx(ainput, 'min-h-11')} data-testid="input-plan-logo-url" inputMode="url" aria-label="Logo image link" />
            )}
            {(current?.logoUrl || d.logoFile) && !d.removeLogo && (
              <button type="button" className="text-xs font-semibold text-red-700 underline" data-testid="button-plan-logo-remove" onClick={() => set({ removeLogo: true, logoFile: null, logoUrlInput: '' })}>Remove logo</button>
            )}
          </fieldset>

          <Field label="Plan name">
            <input value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} placeholder="e.g. School Grant" className={cx(ainput, 'min-h-11')} data-testid="input-plan-name" />
          </Field>
          <Field label="Description">
            <textarea value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} rows={4} className={cx(ainput, 'min-h-[6rem]')} data-testid="input-plan-description"
              placeholder="Who it's for, what it pays for, how decisions are made." />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Industry">
              <select value={d.industryId} onChange={(e) => set({ industryId: e.target.value })} className={cx(ainput, 'min-h-11')} data-testid="select-plan-industry">
                <option value="">All industries</option>
                {industries.data?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Field>
            <Field label="Award amount ($)">
              <input value={d.amount} onChange={(e) => set({ amount: e.target.value })} inputMode="decimal" placeholder="e.g. 5000" className={cx(ainput, 'font-num min-h-11')} data-testid="input-plan-amount" />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Application fee</legend>
            <p className="mb-2 text-xs text-slate-500" data-testid="text-plan-fee-help">
              Charged from the applicant's account balance only when you approve, even if that takes it below $0. Nothing is charged on submit, decline or withdrawal.
              A fixed amount or a percentage of the award; empty = no fee.
            </p>
            <div className="max-w-xs"><FeeInput value={d.fee} onChange={(fee) => set({ fee })} label="Application fee" testid="input-plan-fee" /></div>
          </fieldset>

          <FieldBuilder fields={d.fields} onChange={(update) => setD((x) => ({ ...x, fields: update(x.fields) }))} types={PLAN_FIELD_TYPES} max={MAX_FIELDS}
            legend="Application form" hint="What applicants fill in, e.g. full name, date of birth, address, ID document (a File upload field)." />

          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-5 w-5 accent-[#111]" data-testid="check-plan-enabled" />
            On: applicants can see and apply to this plan
          </label>

          {error && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-plan-error">{error}</p>}
          <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-white px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:p-0">
            <button type="button" onClick={onClose} className="press min-h-11 rounded-lg px-4 text-sm font-semibold hover:bg-slate-100" data-testid="button-plan-cancel">Cancel</button>
            <button disabled={busy} className={cx(dark, 'min-h-11')} data-testid="button-plan-save">{busy ? 'Saving…' : current ? 'Save changes' : 'Create grant plan'}</button>
          </div>
        </form>

        {/* Live preview of what the applicant sees */}
        <aside className="hidden lg:block" aria-label="Preview">
          <div className="sticky top-0 rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="panel-plan-preview">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">What applicants see</p>
            <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <PlanLogo url={shownLogo} name={d.name || 'Grant plan'} initials={initialsOf(d.name || 'Grant plan')} />
                <div className="min-w-0"><p className="truncate font-semibold">{d.name.trim() || 'Plan name'}</p><p className="text-xs text-slate-500">{industryName}</p></div>
              </div>
              <p className="font-num text-lg font-bold">{validAward(award) ? money(award!) : '$0.00'}</p>
              <p className="text-xs text-slate-500">{feeLine(previewFee(d))}{previewFee(d) > 0 ? ', charged on approval' : ''}</p>
              {d.description.trim() && <p className="line-clamp-4 whitespace-pre-line text-sm text-slate-600">{d.description}</p>}
              <PlanFieldInputs fields={planFields(d.fields).map((f, i) => ({ ...f, id: d.fields[i]!.key }))} values={previewValues} files={previewFiles}
                onChange={setPreviewValues} onFile={(k, f) => setPreviewFiles((x) => ({ ...x, [k]: f }))} inputClass={ainput} idPrefix="preview" />
            </div>
          </div>
        </aside>
      </div>
    </Modal>
  );
}
