import { useEffect, useState } from 'react';
import {
  useListAdminPaymentMethods, useCreateAdminPaymentMethod, useUpdateAdminPaymentMethod, useDeleteAdminPaymentMethod, useMoveAdminPaymentMethod,
  useUploadAdminPaymentMethodLogo, useSetAdminPaymentMethodLogoUrl, useDeleteAdminPaymentMethodLogo,
  type PaymentMethod, type PaymentField, type PaymentFieldType, type PaymentMethodUpdate,
} from '@workspace/api-client-react';
import { ArrowDown, ArrowUp, ImageUp, Link2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Empty, ErrorState, Field, Modal, Skel, checkFile, cx, money } from '@/components/bits';
import { card, ainput, lime, dark, ghost, danger, SectionTitle, useAdminRefresh } from '@/components/admin-bits';
import { FixedAmountChoices, MethodFieldInputs, MethodInstructions, MethodLogo, ProofInput, type FieldValues } from '@/components/payment-method';
import { FeeInput, feeDraft, feeFromDraft, type FeeDraft } from '@/components/fee-input';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/*
 * Payment Gateway (Phase 10): the deposit and withdrawal methods applicants choose from.
 * Admin menu: Payment Gateway → Deposit / Withdrawal. The request queues stay on Deposit Page / Withdrawal Page.
 */

type Kind = 'Deposit' | 'Withdrawal';
const FIELD_TYPES: { value: PaymentFieldType; label: string }[] = [
  { value: 'text', label: 'Short text' }, { value: 'textarea', label: 'Long text' }, { value: 'number', label: 'Number' },
  { value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' }, { value: 'date', label: 'Date' }, { value: 'select', label: 'Dropdown' },
];
const PROOF: { value: PaymentMethod['proofMode']; label: string; hint: string }[] = [
  { value: 'required', label: 'Required', hint: 'Applicants must attach a proof to place the request.' },
  { value: 'optional', label: 'Optional', hint: 'Applicants may attach one.' },
  { value: 'off', label: 'Off', hint: 'No upload field is shown.' },
];
const MAX_FIELDS = 20, MAX_FIXED = 10;

function proofText(m: PaymentMethod) {
  return m.kind === 'Withdrawal' ? '' : m.proofMode === 'required' ? 'proof required' : m.proofMode === 'optional' ? 'proof optional' : 'no proof';
}

function GatewayPage({ kind }: { kind: Kind }) {
  const list = useListAdminPaymentMethods({ kind });
  const [editing, setEditing] = useState<PaymentMethod | 'new' | null>(null);
  const [removing, setRemoving] = useState<PaymentMethod | null>(null);
  const word = kind.toLowerCase();
  return (
    <Shell admin title={`Payment Gateway · ${kind}`}>
      <div className="space-y-5">
        <section className={cx(card, 'p-5')} data-testid={`section-methods-${word}`}>
          <SectionTitle action={
            <button data-testid={`button-create-${word}-method`} onClick={() => setEditing('new')} className={cx(lime, 'inline-flex min-h-11 items-center gap-1.5')}>
              <Plus className="h-4 w-4" />Create {word} method
            </button>}>
            {kind} methods
          </SectionTitle>
          <p className="-mt-2 mb-4 text-sm text-slate-500">
            {kind === 'Deposit'
              ? 'Applicants choose one of these on Add funds. Each method sets its amounts, the details applicants fill in and whether they attach a payment proof.'
              : 'Applicants choose one of these on Withdrawals. Each method sets its amounts and the details applicants give to be paid.'}
            {' '}Requests appear on the {kind} Page queue. The first method in the list shows first.
          </p>
          {list.isLoading ? <div className="space-y-2">{[1, 2].map((i) => <Skel key={i} className="h-20" />)}</div>
            : list.isError || !list.data ? <ErrorState onRetry={() => list.refetch()} />
            : list.data.length === 0 ? <Empty title={`No ${word} methods yet`} hint={`Applicants can't place ${word} requests until you create and enable one.`} />
            : <ul className="space-y-3" data-testid="list-methods">{list.data.map((m, i) => (
                <MethodRow key={m.id} m={m} first={i === 0} last={i === list.data!.length - 1} onEdit={() => setEditing(m)} onDelete={() => setRemoving(m)} />
              ))}</ul>}
        </section>
      </div>
      {editing && <MethodEditor kind={kind} method={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <DeleteMethod method={removing} onClose={() => setRemoving(null)} />
    </Shell>
  );
}

function MethodRow({ m, first, last, onEdit, onDelete }: { m: PaymentMethod; first: boolean; last: boolean; onEdit: () => void; onDelete: () => void }) {
  const update = useUpdateAdminPaymentMethod();
  const move = useMoveAdminPaymentMethod();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const fail = (e: unknown) => toast({ title: 'Not saved', description: apiError(e, 'Try again.'), variant: 'destructive' });
  const meta = [m.amountRule, m.feeText !== 'No fee' ? m.feeText : '', `${m.fields.length} field${m.fields.length === 1 ? '' : 's'}`, proofText(m)].filter(Boolean).join(' · ');
  return (
    <li className={cx('rounded-xl border p-4', m.enabled ? 'border-[#E2E8F0]' : 'border-dashed border-slate-300 bg-slate-50')} data-testid={`row-method-${m.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <MethodLogo url={m.logoUrl} name={m.name} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold" data-testid={`text-method-name-${m.id}`}>{m.name}{!m.enabled && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">Disabled</span>}</p>
          <p className="text-xs text-slate-500" data-testid={`text-method-meta-${m.id}`}>{meta}</p>
          <p className="text-xs text-slate-500">{m.requestCount ?? 0} request{m.requestCount === 1 ? '' : 's'}</p>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" role="switch" className="h-5 w-5 accent-[#111]" checked={!!m.enabled} disabled={update.isPending} data-testid={`switch-method-enabled-${m.id}`}
            onChange={(e) => update.mutate({ methodId: m.id, data: { enabled: e.target.checked } }, {
              onSuccess: () => { refresh(); toast({ title: e.target.checked ? `${m.name} enabled` : `${m.name} disabled`, description: e.target.checked ? 'Applicants can choose it.' : "Applicants won't see it." }); },
              onError: fail,
            })} />
          {m.enabled ? 'Enabled' : 'Enable'}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onEdit} data-testid={`button-edit-method-${m.id}`} className={cx(ghost, 'inline-flex min-h-11 items-center gap-1.5')}><Pencil className="h-4 w-4" />Edit</button>
        <button aria-label={`Move ${m.name} up`} disabled={first || move.isPending} data-testid={`button-method-up-${m.id}`} onClick={() => move.mutate({ methodId: m.id, data: { direction: 'up' } }, { onSuccess: refresh, onError: fail })}
          className={cx(ghost, 'grid min-h-11 min-w-11 place-items-center !px-0')}><ArrowUp className="h-4 w-4" /></button>
        <button aria-label={`Move ${m.name} down`} disabled={last || move.isPending} data-testid={`button-method-down-${m.id}`} onClick={() => move.mutate({ methodId: m.id, data: { direction: 'down' } }, { onSuccess: refresh, onError: fail })}
          className={cx(ghost, 'grid min-h-11 min-w-11 place-items-center !px-0')}><ArrowDown className="h-4 w-4" /></button>
        <button onClick={onDelete} data-testid={`button-delete-method-${m.id}`} className="press ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" />Delete</button>
      </div>
    </li>
  );
}

function DeleteMethod({ method, onClose }: { method: PaymentMethod | null; onClose: () => void }) {
  const del = useDeleteAdminPaymentMethod();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [error, setError] = useState('');
  useEffect(() => setError(''), [method]);
  if (!method) return null;
  const used = (method.requestCount ?? 0) > 0;
  return (
    <Modal open onClose={onClose} title={`Delete ${method.name}?`} testid="dialog-delete-method">
      <p className="text-sm text-slate-600">
        {used ? `${method.name} has ${method.requestCount} request${method.requestCount === 1 ? '' : 's'}, so it can't be deleted: those requests keep pointing to it. Disable it instead, and applicants won't see it any more.`
          : `${method.name} has never been used. Deleting it removes it and its logo for good.`}
      </p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="press min-h-11 rounded-lg px-4 text-sm font-semibold hover:bg-slate-100" data-testid="button-delete-method-cancel">Cancel</button>
        {!used && <button disabled={del.isPending} className={cx(danger, 'min-h-11')} data-testid="button-delete-method-confirm"
          onClick={() => del.mutate({ methodId: method.id }, { onSuccess: () => { refresh(); onClose(); toast({ title: `${method.name} deleted` }); }, onError: (e) => setError(apiError(e, 'It could not be deleted.')) })}>
          {del.isPending ? 'Deleting…' : 'Delete method'}</button>}
      </div>
    </Modal>
  );
}

/* ---------- the create / edit form ---------- */

type DraftField = PaymentField & { key: string; optionsText: string };
type Draft = {
  name: string; amountMode: 'range' | 'fixed'; min: string; max: string; fixed: string[]; fixedInput: string;
  fields: DraftField[]; proofMode: PaymentMethod['proofMode']; instructions: string; enabled: boolean; fee: FeeDraft;
  logoTab: 'upload' | 'url'; logoFile: File | null; logoUrlInput: string; removeLogo: boolean;
};
let keySeq = 0;
const newKey = () => `f${++keySeq}`;
const amountText = (n: number | null | undefined) => (n == null ? '' : String(n));
const toDraft = (m: PaymentMethod | undefined, kind: Kind): Draft => ({
  name: m?.name ?? '', amountMode: m?.amountMode ?? 'range', min: amountText(m?.minAmount), max: amountText(m?.maxAmount),
  fixed: (m?.fixedAmounts ?? []).map((a) => a.toFixed(2)), fixedInput: '',
  fields: (m?.fields ?? []).map((f) => ({ ...f, key: newKey(), optionsText: (f.options ?? []).join('\n') })),
  proofMode: m?.proofMode ?? (kind === 'Deposit' ? 'required' : 'off'), instructions: m?.instructions ?? '', enabled: m?.enabled ?? true,
  fee: feeDraft(m?.fee),
  logoTab: 'upload', logoFile: null, logoUrlInput: '', removeLogo: false,
});
const parseAmount = (s: string) => { const t = s.trim().replace(/[$,\s]/g, ''); return t === '' ? null : Number(t); };
const validAmount = (n: number | null) => n !== null && Number.isFinite(n) && n >= 0.01 && n <= 1_000_000 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const fieldsOut = (fields: DraftField[]): PaymentField[] => fields.map(({ key: _k, optionsText, ...f }) => ({
  ...(f.id ? { id: f.id } : {}), label: f.label.trim(), type: f.type, required: f.required,
  ...(f.placeholder?.trim() ? { placeholder: f.placeholder.trim() } : {}), ...(f.help?.trim() ? { help: f.help.trim() } : {}),
  ...(f.type === 'select' ? { options: optionsText.split('\n').map((o) => o.trim()).filter(Boolean) } : {}),
}));

function checkDraft(d: Draft, kind: Kind): string {
  if (d.name.trim().length < 2) return 'Give the method a name (at least 2 characters).';
  if (d.amountMode === 'range') {
    const min = parseAmount(d.min), max = parseAmount(d.max);
    if (d.min.trim() && !validAmount(min)) return 'The minimum must be between $0.01 and $1,000,000.';
    if (d.max.trim() && !validAmount(max)) return 'The maximum must be between $0.01 and $1,000,000.';
    if (min !== null && max !== null && min > max) return "The minimum can't be higher than the maximum.";
  } else if (!d.fixed.length) return 'Add at least one fixed amount.';
  const fee = feeFromDraft(d.fee);
  if (typeof fee === 'string') return fee;
  for (const [i, f] of d.fields.entries()) {
    if (!f.label.trim()) return `Field ${i + 1} needs a label.`;
    if (f.type === 'select' && !f.optionsText.split('\n').some((o) => o.trim())) return `"${f.label}" needs at least one option.`;
  }
  if (d.logoTab === 'url' && d.logoUrlInput.trim() && !/^https:\/\//i.test(d.logoUrlInput.trim())) return 'The logo link must start with https://';
  void kind;
  return '';
}

function MethodEditor({ kind, method, onClose }: { kind: Kind; method?: PaymentMethod; onClose: () => void }) {
  const [current, setCurrent] = useState<PaymentMethod | undefined>(method);
  const [d, setD] = useState<Draft>(() => toDraft(method, kind));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<FieldValues>({});
  const create = useCreateAdminPaymentMethod();
  const update = useUpdateAdminPaymentMethod();
  const uploadLogo = useUploadAdminPaymentMethodLogo();
  const linkLogo = useSetAdminPaymentMethodLogoUrl();
  const dropLogo = useDeleteAdminPaymentMethodLogo();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setField = (key: string, patch: Partial<DraftField>) => setD((x) => ({ ...x, fields: x.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) }));
  const moveField = (i: number, by: -1 | 1) => setD((x) => { const fs = [...x.fields]; [fs[i], fs[i + by]] = [fs[i + by]!, fs[i]!]; return { ...x, fields: fs }; });
  const word = kind.toLowerCase();

  const [localLogo, setLocalLogo] = useState<string | undefined>();
  useEffect(() => {
    if (!d.logoFile) { setLocalLogo(undefined); return; }
    const u = URL.createObjectURL(d.logoFile); setLocalLogo(u);
    return () => URL.revokeObjectURL(u);
  }, [d.logoFile]);
  const shownLogo = d.removeLogo ? undefined : localLogo ?? current?.logoUrl;

  const addFixed = () => {
    const n = parseAmount(d.fixedInput);
    if (!validAmount(n)) return setError('Enter a fixed amount between $0.01 and $1,000,000 with at most two decimals.');
    const v = n!.toFixed(2);
    if (d.fixed.includes(v)) return setError(`${money(n!)} is already in the list.`);
    if (d.fixed.length >= MAX_FIXED) return setError(`At most ${MAX_FIXED} fixed amounts.`);
    setError(''); set({ fixed: [...d.fixed, v].sort((a, b) => Number(a) - Number(b)), fixedInput: '' });
  };

  const save = async () => {
    const problem = checkDraft(d, kind);
    if (problem) return setError(problem);
    setError(''); setBusy(true);
    const data: PaymentMethodUpdate = {
      name: d.name.trim(), amountMode: d.amountMode,
      ...(d.amountMode === 'range' ? { minAmount: parseAmount(d.min), maxAmount: parseAmount(d.max) } : { fixedAmounts: d.fixed.map(Number) }),
      fields: fieldsOut(d.fields), instructions: d.instructions, enabled: d.enabled, ...(kind === 'Deposit' ? { proofMode: d.proofMode } : {}),
      fee: feeFromDraft(d.fee) as { mode: 'fixed' | 'percent'; amount: number },
    };
    let saved = current;
    try {
      saved = current ? await update.mutateAsync({ methodId: current.id, data }) : await create.mutateAsync({ data: { ...data, kind, name: data.name! } });
      setCurrent(saved);
    } catch (e) { setBusy(false); return setError(apiError(e, 'The method could not be saved.')); }
    // The logo is a second step: a method saved without one still exists, so a logo problem keeps the form open on that method.
    try {
      if (d.logoTab === 'upload' && d.logoFile) saved = await uploadLogo.mutateAsync({ methodId: saved!.id, data: { file: d.logoFile } });
      else if (d.logoTab === 'url' && d.logoUrlInput.trim()) saved = await linkLogo.mutateAsync({ methodId: saved!.id, data: { url: d.logoUrlInput.trim() } });
      else if (d.removeLogo && saved!.logoUrl) saved = await dropLogo.mutateAsync({ methodId: saved!.id });
    } catch (e) {
      setBusy(false); setCurrent(saved); refresh();
      return setError(`The method was saved, but the logo wasn't: ${apiError(e, 'try another image.')}`);
    }
    setBusy(false); refresh(); onClose();
    toast({ title: current ? `${saved!.name} saved` : `${saved!.name} created`, description: saved!.enabled ? 'Applicants can choose it now.' : "It's disabled, so applicants don't see it yet." });
  };

  return (
    <Modal open wide onClose={onClose} title={current ? `Edit ${current.name}` : `Create ${word} method`} testid="dialog-method">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form className="min-w-0 space-y-5" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {/* Logo */}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Logo</legend>
            <div className="flex items-center gap-3">
              <MethodLogo url={shownLogo} name={d.name || 'Method'} className="h-16 w-16" />
              <div className="flex rounded-lg border border-slate-300 p-0.5" role="tablist" aria-label="Logo source">
                {(['upload', 'url'] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={d.logoTab === t} data-testid={`tab-logo-${t}`} onClick={() => set({ logoTab: t })}
                    className={cx('press inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold', d.logoTab === t ? 'bg-[#111] text-white' : 'text-slate-700 hover:bg-slate-100')}>
                    {t === 'upload' ? <><ImageUp className="h-4 w-4" />Upload</> : <><Link2 className="h-4 w-4" />Link</>}
                  </button>
                ))}
              </div>
            </div>
            {d.logoTab === 'upload' ? (
              <label className="press flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm hover:border-slate-500">
                <ImageUp className="h-4 w-4 text-slate-500" /><span className="truncate">{d.logoFile ? d.logoFile.name : 'Choose a PNG, JPG or WebP image (up to 2 MB)'}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" data-testid="input-logo-file" onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f) { const bad = checkFile(f, 'image') || (f.size > 2 * 1024 * 1024 ? 'Logos must be 2 MB or smaller.' : ''); if (bad) { setError(bad); return; } }
                  setError(''); set({ logoFile: f, removeLogo: false });
                }} />
              </label>
            ) : (
              <div>
                <input value={d.logoUrlInput} onChange={(e) => set({ logoUrlInput: e.target.value, removeLogo: false })} placeholder="https://example.com/logo.png" maxLength={2000}
                  className={cx(ainput, 'min-h-11')} data-testid="input-logo-url" inputMode="url" aria-label="Logo image link" />
                <p className="mt-1 text-xs text-slate-500">We download the image once when you save and keep our own copy, so the logo keeps working even if the link changes.</p>
              </div>
            )}
            {(current?.logoUrl || d.logoFile) && !d.removeLogo && (
              <button type="button" className="text-xs font-semibold text-red-700 underline" data-testid="button-logo-remove" onClick={() => set({ removeLogo: true, logoFile: null, logoUrlInput: '' })}>Remove logo</button>
            )}
          </fieldset>

          <Field label="Method name">
            <input value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} placeholder={kind === 'Deposit' ? 'e.g. Bank transfer, USDT (TRC20)' : 'e.g. Bank payout, PayPal'}
              className={cx(ainput, 'min-h-11')} data-testid="input-method-name" />
          </Field>

          {/* Amount rule */}
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {([['range', 'Minimum and maximum'], ['fixed', 'Fixed amounts']] as const).map(([v, label]) => (
                <label key={v} className={cx('press flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold', d.amountMode === v ? 'border-[#111] bg-[#C6F432]/30' : 'border-slate-300')}>
                  <input type="radio" name="amount-mode" checked={d.amountMode === v} onChange={() => set({ amountMode: v })} className="accent-[#111]" data-testid={`radio-amount-${v}`} />{label}
                </label>
              ))}
            </div>
            {d.amountMode === 'range' ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Minimum ($)"><input value={d.min} onChange={(e) => set({ min: e.target.value })} inputMode="decimal" placeholder="No minimum" className={cx(ainput, 'font-num min-h-11')} data-testid="input-method-min" /></Field>
                <Field label="Maximum ($)"><input value={d.max} onChange={(e) => set({ max: e.target.value })} inputMode="decimal" placeholder="No maximum" className={cx(ainput, 'font-num min-h-11')} data-testid="input-method-max" /></Field>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-slate-500">Applicants pick one of these amounts.</p>
                <div className="flex flex-wrap gap-2" data-testid="list-fixed-amounts">
                  {d.fixed.map((a) => (
                    <span key={a} className="font-num inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 pl-3 text-sm font-semibold">
                      {money(Number(a))}
                      <button type="button" aria-label={`Remove ${money(Number(a))}`} className="press grid h-11 w-11 place-items-center rounded-lg hover:bg-slate-200" onClick={() => set({ fixed: d.fixed.filter((x) => x !== a) })}><X className="h-4 w-4" /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={d.fixedInput} onChange={(e) => set({ fixedInput: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFixed(); } }}
                    inputMode="decimal" placeholder="e.g. 250" className={cx(ainput, 'font-num min-h-11 max-w-[12rem]')} data-testid="input-fixed-amount" aria-label="Fixed amount to add" />
                  <button type="button" onClick={addFixed} className={cx(ghost, 'min-h-11')} data-testid="button-add-fixed" disabled={d.fixed.length >= MAX_FIXED}>Add amount</button>
                </div>
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Fee</legend>
            <p className="mb-2 text-xs text-slate-500" data-testid="text-fee-help">
              {kind === 'Deposit'
                ? 'Taken out of the amount deposited: a $100 deposit with a $3 fee adds $97 to the deposit balance. A fixed amount or a percentage of the deposit; empty = no fee.'
                : 'Paid from the applicant\'s deposit balance, on top of the amount withdrawn. A fixed amount or a percentage of the withdrawal; empty = no fee.'}
            </p>
            <div className="max-w-xs"><FeeInput value={d.fee} onChange={(fee) => set({ fee })} label={`${kind} fee`} testid="input-method-fee" /></div>
          </fieldset>

          <Field label={kind === 'Deposit' ? 'Instructions for applicants (e.g. where to send the money)' : 'Instructions for applicants (optional)'}>
            <textarea value={d.instructions} onChange={(e) => set({ instructions: e.target.value })} maxLength={1000} rows={4} className={cx(ainput, 'min-h-[6rem]')} data-testid="input-method-instructions"
              placeholder={kind === 'Deposit' ? 'e.g. Send to IBAN DE89 3704 0044 0532 0130 00 (Future Nest Fund). Use your email as the reference.' : 'e.g. Payouts reach your account in 1–3 business days.'} />
          </Field>

          {/* Field builder */}
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Details applicants fill in</legend>
            <p className="mb-3 text-xs text-slate-500">{kind === 'Deposit' ? 'e.g. sender name, transaction ID, network.' : 'e.g. wallet address, network name, account number.'} Up to {MAX_FIELDS}.</p>
            <ol className="space-y-3" data-testid="list-builder-fields">
              {d.fields.map((f, i) => (
                <li key={f.key} className="rounded-xl border border-slate-200 p-3" data-testid={`builder-field-${i}`}>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <input value={f.label} onChange={(e) => setField(f.key, { label: e.target.value })} maxLength={60} placeholder={`Field ${i + 1} label, e.g. Wallet address`}
                      aria-label={`Field ${i + 1} label`} className={cx(ainput, 'min-h-11')} data-testid={`input-field-label-${i}`} />
                    <select value={f.type} onChange={(e) => setField(f.key, { type: e.target.value as PaymentFieldType })} aria-label={`Field ${i + 1} type`} className={cx(ainput, 'min-h-11')} data-testid={`select-field-type-${i}`}>
                      {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  {f.type === 'select' && (
                    <textarea value={f.optionsText} onChange={(e) => setField(f.key, { optionsText: e.target.value })} rows={3} placeholder={'One option per line, e.g.\nTRC20\nERC20'}
                      aria-label={`Field ${i + 1} options`} className={cx(ainput, 'mt-2')} data-testid={`input-field-options-${i}`} />
                  )}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-600">Placeholder and help text</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input value={f.placeholder ?? ''} onChange={(e) => setField(f.key, { placeholder: e.target.value })} maxLength={80} placeholder="Placeholder" aria-label={`Field ${i + 1} placeholder`} className={cx(ainput, 'min-h-11')} />
                      <input value={f.help ?? ''} onChange={(e) => setField(f.key, { help: e.target.value })} maxLength={200} placeholder="Help text under the field" aria-label={`Field ${i + 1} help`} className={cx(ainput, 'min-h-11')} />
                    </div>
                  </details>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
                      <input type="checkbox" checked={f.required} onChange={(e) => setField(f.key, { required: e.target.checked })} className="h-5 w-5 accent-[#111]" data-testid={`check-field-required-${i}`} />Required
                    </label>
                    <span className="ml-auto flex gap-1">
                      <button type="button" aria-label={`Move field ${i + 1} up`} disabled={i === 0} onClick={() => moveField(i, -1)} className={cx(ghost, 'grid min-h-11 min-w-11 place-items-center !px-0')}><ArrowUp className="h-4 w-4" /></button>
                      <button type="button" aria-label={`Move field ${i + 1} down`} disabled={i === d.fields.length - 1} onClick={() => moveField(i, 1)} className={cx(ghost, 'grid min-h-11 min-w-11 place-items-center !px-0')}><ArrowDown className="h-4 w-4" /></button>
                      <button type="button" aria-label={`Remove field ${i + 1}`} data-testid={`button-field-remove-${i}`} onClick={() => setD((x) => ({ ...x, fields: x.fields.filter((y) => y.key !== f.key) }))}
                        className="press grid min-h-11 min-w-11 place-items-center rounded-lg text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            <button type="button" disabled={d.fields.length >= MAX_FIELDS} data-testid="button-add-field"
              onClick={() => setD((x) => ({ ...x, fields: [...x.fields, { key: newKey(), label: '', type: 'text', required: true, optionsText: '' }] }))}
              className={cx(ghost, 'mt-3 inline-flex min-h-11 items-center gap-1.5')}><Plus className="h-4 w-4" />Add field</button>
          </fieldset>

          {kind === 'Deposit' && (
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment proof upload</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {PROOF.map((p) => (
                  <label key={p.value} className={cx('press flex cursor-pointer flex-col rounded-lg border p-3 text-sm', d.proofMode === p.value ? 'border-[#111] bg-[#C6F432]/30' : 'border-slate-300')}>
                    <span className="flex items-center gap-2 font-semibold"><input type="radio" name="proof" checked={d.proofMode === p.value} onChange={() => set({ proofMode: p.value })} className="accent-[#111]" data-testid={`radio-proof-${p.value}`} />{p.label}</span>
                    <span className="mt-1 text-xs text-slate-500">{p.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-5 w-5 accent-[#111]" data-testid="check-method-enabled" />
            Enabled: applicants can choose this method
          </label>

          {error && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-method-error">{error}</p>}
          <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-white px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:p-0">
            <button type="button" onClick={onClose} className="press min-h-11 rounded-lg px-4 text-sm font-semibold hover:bg-slate-100" data-testid="button-method-cancel">Cancel</button>
            <button disabled={busy} className={cx(dark, 'min-h-11')} data-testid="button-method-save">{busy ? 'Saving…' : current ? 'Save changes' : `Create ${word} method`}</button>
          </div>
        </form>

        {/* Live preview of what the applicant sees */}
        <aside className="hidden lg:block" aria-label="Preview">
          <div className="sticky top-0 rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="panel-method-preview">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">What applicants see</p>
            <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <MethodLogo url={shownLogo} name={d.name || 'Method'} />
                <div className="min-w-0"><p className="truncate font-semibold">{d.name.trim() || 'Method name'}</p><p className="font-num text-xs text-slate-500">{previewRule(d)}{previewFee(d) ? ` · ${previewFee(d)}` : ''}</p></div>
              </div>
              <MethodInstructions text={d.instructions} testid="text-preview-instructions" />
              {d.amountMode === 'fixed'
                ? d.fixed.length ? <FixedAmountChoices amounts={d.fixed.map(Number)} value="" onChange={() => {}} activeClass="border-[#1E3A8A] bg-[#1E3A8A] text-white" /> : null
                : <input disabled placeholder="Amount" className={cx(ainput, 'min-h-11')} aria-label="Amount (preview)" />}
              <MethodFieldInputs fields={fieldsOut(d.fields).map((f, i) => ({ ...f, id: d.fields[i]!.key }))} values={preview} onChange={setPreview} inputClass={ainput} idPrefix="preview" />
              {kind === 'Deposit' && <ProofInput mode={d.proofMode} file={null} onChange={() => {}} disabled />}
            </div>
          </div>
        </aside>
      </div>
    </Modal>
  );
}

function previewFee(d: Draft) {
  const f = feeFromDraft(d.fee);
  if (typeof f === 'string' || !(f.amount > 0)) return '';
  return f.mode === 'fixed' ? `Fee ${money(f.amount)}` : `Fee ${f.amount}%`;
}

function previewRule(d: Draft) {
  if (d.amountMode === 'fixed') return d.fixed.length ? `Fixed: ${d.fixed.map((a) => money(Number(a))).join(' / ')}` : 'Add fixed amounts';
  const min = parseAmount(d.min), max = parseAmount(d.max);
  if (validAmount(min) && validAmount(max)) return `${money(min!)} – ${money(max!)}`;
  if (validAmount(min)) return `From ${money(min!)}`;
  if (validAmount(max)) return `Up to ${money(max!)}`;
  return 'Any amount';
}

export const AdminDepositMethodsPage = () => <GatewayPage kind="Deposit" />;
export const AdminWithdrawalMethodsPage = () => <GatewayPage kind="Withdrawal" />;
