import { useEffect, useState } from 'react';
import type { PlanField } from '@workspace/api-client-react';
import { Paperclip } from 'lucide-react';
import { FILE_RULES, checkFile, cx, money } from '@/components/bits';

/**
 * Grant plans as applicants see them (Phase 11). The same pieces draw the admin's live preview in Grant Plans,
 * so what the admin builds is exactly what the applicant fills in.
 */

/** "School Grant" → "SG": the placeholder when a plan has no logo (same rule as the server). */
export function initialsOf(name: string) {
  const words = name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return 'GP';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** The plan's logo, or its initials on the brand navy while there is none (or it fails to load). */
export function PlanLogo({ url, name, initials, className = 'h-12 w-12' }: { url?: string; name: string; initials?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) {
    return (
      <span className={cx('grid shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white', className)}>
        <img src={url} alt={`${name} logo`} className="h-full w-full object-contain p-1" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span aria-hidden className={cx('grid shrink-0 select-none place-items-center rounded-xl bg-[linear-gradient(135deg,var(--brand)_0%,var(--brand-light)_100%)] font-bold tracking-wide text-[var(--brand-fg)]', className)} data-testid="plan-initials">
      <span className="text-[clamp(0.75rem,40%,1.25rem)]">{initials ?? initialsOf(name)}</span>
    </span>
  );
}

export type PlanValues = Record<string, string>;
export type PlanFiles = Record<string, File | null>;

const inputType: Record<string, string> = { text: 'text', textarea: 'text', number: 'text', email: 'email', phone: 'tel', date: 'date', select: 'text' };
const inputMode: Record<string, 'decimal' | 'email' | 'tel' | undefined> = { number: 'decimal', email: 'email', phone: 'tel' };
export const PLAN_FILE_ACCEPT = FILE_RULES.application.accept;

/** The plan's application form, keyed by field id (preview fields without an id yet use their position). */
export function PlanFieldInputs({ fields, values, files, onChange, onFile, errors, inputClass, idPrefix, disabled, existingFiles }: {
  fields: PlanField[]; values: PlanValues; files: PlanFiles; onChange: (next: PlanValues) => void; onFile: (key: string, f: File | null) => void;
  errors?: Record<string, string>; inputClass: string; idPrefix: string; disabled?: boolean;
  /** When editing after "Changes requested": the file already on the application, kept unless replaced. */
  existingFiles?: Record<string, string>;
}) {
  return (
    <div className="space-y-4">
      {fields.map((f, i) => {
        const key = f.id ?? `new-${i}`;
        const id = `${idPrefix}-${key}`;
        const set = (v: string) => onChange({ ...values, [key]: v });
        const common = { id, disabled, value: values[key] ?? '', 'data-testid': `input-plan-field-${i}`, 'aria-invalid': errors?.[key] ? true : undefined };
        const label = (
          <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            {f.label || `Field ${i + 1}`}{f.required ? <span className="text-red-700"> *</span> : <span className="font-normal normal-case tracking-normal"> (optional)</span>}
          </label>
        );
        return (
          <div key={key}>
            {label}
            {f.type === 'file' ? (
              <>
                <span className={cx('press flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-500', disabled && 'pointer-events-none opacity-60')}>
                  <Paperclip className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" data-testid={`text-plan-file-${i}`}>
                    {files[key]?.name ?? (existingFiles?.[key] ? `${existingFiles[key]} (attached)` : 'Choose a file: JPG, PNG, WebP, PDF or Word, up to 10 MB')}
                  </span>
                  <input id={id} type="file" className="sr-only" accept={PLAN_FILE_ACCEPT} disabled={disabled} data-testid={`input-plan-field-${i}`}
                    onChange={(e) => { onFile(key, e.target.files?.[0] ?? null); e.target.value = ''; }} />
                </span>
                {files[key] && <button type="button" onClick={() => onFile(key, null)} className="mt-1 text-xs font-semibold text-slate-600 underline">Remove file</button>}
              </>
            ) : f.type === 'textarea' ? (
              <textarea {...common} rows={3} maxLength={500} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} className={cx(inputClass, 'min-h-[5.5rem]')} />
            ) : f.type === 'select' ? (
              <select {...common} onChange={(e) => set(e.target.value)} className={cx(inputClass, 'min-h-11')}>
                <option value="">Choose…</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input {...common} type={inputType[f.type] ?? 'text'} inputMode={inputMode[f.type]} maxLength={500} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} className={cx(inputClass, 'min-h-11')} />
            )}
            {f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}
            {errors?.[key] && <p role="alert" className="mt-1 text-xs text-red-700" data-testid={`error-plan-field-${i}`}>{errors[key]}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Same checks the server makes, so mistakes show next to the field before sending. */
export function checkPlanValues(fields: PlanField[], values: PlanValues, files: PlanFiles, existingFiles: Record<string, string> = {}) {
  const errors: Record<string, string> = {};
  for (const [i, f] of fields.entries()) {
    const key = f.id ?? `new-${i}`;
    if (f.type === 'file') {
      const file = files[key];
      if (!file) { if (f.required && !existingFiles[key]) errors[key] = `Attach ${f.label}.`; continue; }
      const bad = checkFile(file, 'application');
      if (bad) errors[key] = bad;
      continue;
    }
    const v = (values[key] ?? '').trim();
    if (!v) { if (f.required) errors[key] = `Fill in ${f.label}.`; continue; }
    if (f.type === 'number' && !/^-?\d+(\.\d+)?$/.test(v)) errors[key] = 'Enter a number.';
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[key] = 'Enter an email address.';
    if (f.type === 'phone' && !/^\+?[0-9 ()./-]{5,30}$/.test(v)) errors[key] = 'Enter a phone number.';
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[key] = 'Enter a date.';
    if (f.type === 'select' && !f.options?.includes(v)) errors[key] = 'Choose one of the options.';
  }
  return errors;
}

/** "Fee $2.00" → the fee line shown on plan cards and the summary. */
export const feeLine = (feeAmount: number) => (feeAmount > 0 ? `${money(feeAmount)} application fee` : 'No application fee');
