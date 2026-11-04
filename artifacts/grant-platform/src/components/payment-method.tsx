import { useEffect, useState } from 'react';
import type { PaymentField, PaymentMethod } from '@workspace/api-client-react';
import { Copy, Landmark, Paperclip } from 'lucide-react';
import { cx, money } from '@/components/bits';

/**
 * A payment method as applicants see it (Phase 10). The same pieces draw the admin's live preview in Payment Gateway,
 * so what the admin builds is exactly what the applicant fills in. `inputClass` lets each workspace keep its own look.
 */

/** The method's logo, or a neutral bank icon while there is none (or it fails to load). */
export function MethodLogo({ url, name, className = 'h-10 w-10' }: { url?: string; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <span className={cx('grid shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white', className)}>
      {url && !failed ? <img src={url} alt={`${name} logo`} className="h-full w-full object-contain p-1" onError={() => setFailed(true)} /> : <Landmark className="h-1/2 w-1/2 text-slate-400" aria-hidden />}
    </span>
  );
}

export type FieldValues = Record<string, string>;

const inputType: Record<PaymentField['type'], string> = { text: 'text', textarea: 'text', number: 'text', email: 'email', phone: 'tel', date: 'date', select: 'text' };
const inputMode: Partial<Record<PaymentField['type'], 'decimal' | 'email' | 'tel'>> = { number: 'decimal', email: 'email', phone: 'tel' };

/** The administrator's extra fields, keyed by field id (preview fields without an id yet use their position). */
export function MethodFieldInputs({ fields, values, onChange, errors, inputClass, idPrefix, disabled }: {
  fields: PaymentField[]; values: FieldValues; onChange: (next: FieldValues) => void; errors?: Record<string, string>;
  inputClass: string; idPrefix: string; disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {fields.map((f, i) => {
        const key = f.id ?? `new-${i}`;
        const id = `${idPrefix}-${key}`;
        const set = (v: string) => onChange({ ...values, [key]: v });
        const common = { id, disabled, value: values[key] ?? '', 'data-testid': `input-method-field-${i}`, 'aria-invalid': errors?.[key] ? true : undefined };
        return (
          <div key={key}>
            <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              {f.label || `Field ${i + 1}`}{f.required ? <span className="text-red-700"> *</span> : <span className="font-normal normal-case tracking-normal"> (optional)</span>}
            </label>
            {f.type === 'textarea' ? (
              <textarea {...common} rows={3} maxLength={500} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} className={cx(inputClass, 'min-h-[5.5rem]')} />
            ) : f.type === 'select' ? (
              <select {...common} onChange={(e) => set(e.target.value)} className={cx(inputClass, 'min-h-11')}>
                <option value="">Choose…</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input {...common} type={inputType[f.type]} inputMode={inputMode[f.type]} maxLength={500} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} className={cx(inputClass, 'min-h-11')} />
            )}
            {f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}
            {errors?.[key] && <p role="alert" className="mt-1 text-xs text-red-700">{errors[key]}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Same checks the server makes, so mistakes show next to the field before sending. */
export function checkFieldValues(fields: PaymentField[], values: FieldValues) {
  const errors: Record<string, string> = {};
  for (const [i, f] of fields.entries()) {
    const key = f.id ?? `new-${i}`;
    const v = (values[key] ?? '').trim();
    if (!v) { if (f.required) errors[key] = `Fill in ${f.label}.`; continue; }
    if (f.type === 'number' && !/^-?\d+(\.\d+)?$/.test(v)) errors[key] = 'Enter a number.';
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[key] = 'Enter an email address.';
    if (f.type === 'phone' && !/^\+?[0-9 ()./-]{5,30}$/.test(v)) errors[key] = 'Enter a phone number.';
    if (f.type === 'select' && !f.options?.includes(v)) errors[key] = 'Choose one of the options.';
  }
  return errors;
}

/** The method's instructions (e.g. where to send the money), line breaks kept, with a copy button. */
export function MethodInstructions({ text, testid = 'text-method-instructions' }: { text: string; testid?: string }) {
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="whitespace-pre-line break-words text-sm text-slate-700" data-testid={testid}>{text}</p>
        <button type="button" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
          className="press inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-white" aria-label="Copy instructions">
          <Copy className="h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/** Fixed-amount choices as buttons. */
export function FixedAmountChoices({ amounts, value, onChange, disabled, activeClass }: { amounts: number[]; value: string; onChange: (v: string) => void; disabled?: boolean; activeClass: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Amount">
      {amounts.map((a) => {
        const on = value !== '' && Number(value) === a;
        return (
          <button key={a} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(a.toFixed(2))} data-testid={`button-fixed-amount-${a}`}
            className={cx('press font-num min-h-11 rounded-xl border px-4 text-sm font-semibold', on ? activeClass : 'border-slate-300 bg-white text-slate-800 hover:border-slate-500')}>
            {money(a)}
          </button>
        );
      })}
    </div>
  );
}

/** Proof upload control (deposits). */
export function ProofInput({ mode, file, onChange, error, disabled }: { mode: PaymentMethod['proofMode']; file: File | null; onChange: (f: File | null) => void; error?: string; disabled?: boolean }) {
  if (mode === 'off') return null;
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Payment proof{mode === 'required' ? <span className="text-red-700"> *</span> : <span className="font-normal normal-case tracking-normal"> (optional)</span>}
      </span>
      <label className={cx('press flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-500', disabled && 'pointer-events-none opacity-60')}>
        <Paperclip className="h-4 w-4 shrink-0 text-slate-500" />
        <span className="min-w-0 flex-1 truncate" data-testid="text-proof-name">{file ? file.name : 'Attach a screenshot, photo or PDF of your payment'}</span>
        <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" data-testid="input-proof" disabled={disabled}
          onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      </label>
      {file && <button type="button" onClick={() => onChange(null)} className="mt-1 text-xs font-semibold text-slate-600 underline" data-testid="button-proof-remove">Remove file</button>}
      <p className="mt-1 text-xs text-slate-500">JPG, PNG, WebP or PDF, up to 10 MB.</p>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** A request's method, answers and proof link, as shown on both sides. */
export function RequestDetails({ method, details, proofUrl, source, testid }: {
  method?: { name: string; logoUrl?: string }; details?: { label: string; value: string }[]; proofUrl?: string; source?: 'grant' | 'deposit'; testid: string;
}) {
  if (!method && !details?.length && !proofUrl) return null;
  return (
    <div className="mt-2 space-y-2" data-testid={testid}>
      {method && (
        <p className="flex items-center gap-2 text-xs text-slate-600">
          <MethodLogo url={method.logoUrl} name={method.name} className="h-6 w-6 !rounded-md" />
          <span><span className="font-semibold text-slate-800">{method.name}</span>{source ? ` · from the ${source} balance` : ''}</span>
        </p>
      )}
      {!!details?.length && (
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
          {details.map((d) => (
            <div key={d.label} className="contents">
              <dt className="text-slate-500">{d.label}</dt>
              <dd className="break-all font-medium text-slate-800">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {proofUrl && <a href={proofUrl} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold underline" data-testid={`${testid}-proof`}><Paperclip className="h-3.5 w-3.5" />Payment proof</a>}
    </div>
  );
}
