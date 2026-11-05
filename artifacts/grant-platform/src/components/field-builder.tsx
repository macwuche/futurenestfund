import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { cx } from '@/components/bits';
import { ainput, ghost } from '@/components/admin-bits';

/**
 * The administrator's form builder: Payment Gateway methods (Phase 10) and grant plan application forms (Phase 11).
 * Plans also offer a file upload field.
 */

export type BuilderField = { id?: string; label: string; type: string; required: boolean; placeholder?: string; help?: string; options?: string[] };
export type DraftField = BuilderField & { key: string; optionsText: string };
export type FieldTypeChoice = { value: string; label: string };

export const BASE_FIELD_TYPES: FieldTypeChoice[] = [
  { value: 'text', label: 'Short text' }, { value: 'textarea', label: 'Long text' }, { value: 'number', label: 'Number' },
  { value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' }, { value: 'date', label: 'Date' }, { value: 'select', label: 'Dropdown' },
];
export const PLAN_FIELD_TYPES: FieldTypeChoice[] = [...BASE_FIELD_TYPES, { value: 'file', label: 'File upload' }];

let keySeq = 0;
export const newFieldKey = () => `f${++keySeq}`;
export const toDraftFields = (fields: BuilderField[] | undefined): DraftField[] =>
  (fields ?? []).map((f) => ({ ...f, key: newFieldKey(), optionsText: (f.options ?? []).join('\n') }));

/** The draft back to what the API takes (the server gives new fields their ids). */
export const fieldsOut = (fields: DraftField[]): BuilderField[] => fields.map(({ key: _k, optionsText, ...f }) => ({
  ...(f.id ? { id: f.id } : {}), label: f.label.trim(), type: f.type, required: f.required,
  ...(f.placeholder?.trim() ? { placeholder: f.placeholder.trim() } : {}), ...(f.help?.trim() ? { help: f.help.trim() } : {}),
  ...(f.type === 'select' ? { options: optionsText.split('\n').map((o) => o.trim()).filter(Boolean) } : {}),
}));

/** The same checks the server makes on the fields themselves; '' when they're fine. */
export function checkDraftFields(fields: DraftField[]): string {
  const seen = new Set<string>();
  for (const [i, f] of fields.entries()) {
    const label = f.label.trim();
    if (!label) return `Field ${i + 1} needs a label.`;
    if (seen.has(label.toLowerCase())) return `Two fields are called "${label}". Give each field its own label.`;
    seen.add(label.toLowerCase());
    if (f.type === 'select' && !f.optionsText.split('\n').some((o) => o.trim())) return `"${label}" needs at least one option.`;
  }
  return '';
}

export function FieldBuilder({ fields, onChange, types, max, legend, hint }: {
  fields: DraftField[]; onChange: (update: (fields: DraftField[]) => DraftField[]) => void;
  types: FieldTypeChoice[]; max: number; legend: string; hint: string;
}) {
  const setField = (key: string, patch: Partial<DraftField>) => onChange((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const moveField = (i: number, by: -1 | 1) => onChange((fs) => { const next = [...fs]; [next[i], next[i + by]] = [next[i + by]!, next[i]!]; return next; });
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{legend}</legend>
      <p className="mb-3 text-xs text-slate-500">{hint} Up to {max}.</p>
      <ol className="space-y-3" data-testid="list-builder-fields">
        {fields.map((f, i) => (
          <li key={f.key} className="rounded-xl border border-slate-200 p-3" data-testid={`builder-field-${i}`}>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <input value={f.label} onChange={(e) => setField(f.key, { label: e.target.value })} maxLength={60} placeholder={`Field ${i + 1} label`}
                aria-label={`Field ${i + 1} label`} className={cx(ainput, 'min-h-11')} data-testid={`input-field-label-${i}`} />
              <select value={f.type} onChange={(e) => setField(f.key, { type: e.target.value })} aria-label={`Field ${i + 1} type`} className={cx(ainput, 'min-h-11')} data-testid={`select-field-type-${i}`}>
                {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {f.type === 'select' && (
              <textarea value={f.optionsText} onChange={(e) => setField(f.key, { optionsText: e.target.value })} rows={3} placeholder={'One option per line, e.g.\nOption A\nOption B'}
                aria-label={`Field ${i + 1} options`} className={cx(ainput, 'mt-2')} data-testid={`input-field-options-${i}`} />
            )}
            {f.type === 'file' && <p className="mt-2 text-xs text-slate-500">Applicants attach one file here: a JPG, PNG, WebP or PDF, or a Word (.docx) document, up to 10 MB.</p>}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">{f.type === 'file' ? 'Help text' : 'Placeholder and help text'}</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {f.type !== 'file' && <input value={f.placeholder ?? ''} onChange={(e) => setField(f.key, { placeholder: e.target.value })} maxLength={80} placeholder="Placeholder" aria-label={`Field ${i + 1} placeholder`} className={cx(ainput, 'min-h-11')} />}
                <input value={f.help ?? ''} onChange={(e) => setField(f.key, { help: e.target.value })} maxLength={200} placeholder="Help text under the field" aria-label={`Field ${i + 1} help`} className={cx(ainput, 'min-h-11')} />
              </div>
            </details>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={f.required} onChange={(e) => setField(f.key, { required: e.target.checked })} className="h-5 w-5 accent-[#111]" data-testid={`check-field-required-${i}`} />Required
              </label>
              <span className="ml-auto flex gap-1">
                <button type="button" aria-label={`Move field ${i + 1} up`} disabled={i === 0} onClick={() => moveField(i, -1)} className={cx(ghost, 'grid min-h-11 min-w-11 place-items-center !px-0')}><ArrowUp className="h-4 w-4" /></button>
                <button type="button" aria-label={`Move field ${i + 1} down`} disabled={i === fields.length - 1} onClick={() => moveField(i, 1)} className={cx(ghost, 'grid min-h-11 min-w-11 place-items-center !px-0')}><ArrowDown className="h-4 w-4" /></button>
                <button type="button" aria-label={`Remove field ${i + 1}`} data-testid={`button-field-remove-${i}`} onClick={() => onChange((fs) => fs.filter((y) => y.key !== f.key))}
                  className="press grid min-h-11 min-w-11 place-items-center rounded-lg text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
              </span>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" disabled={fields.length >= max} data-testid="button-add-field"
        onClick={() => onChange((fs) => [...fs, { key: newFieldKey(), label: '', type: 'text', required: true, optionsText: '' }])}
        className={cx(ghost, 'mt-3 inline-flex min-h-11 items-center gap-1.5')}><Plus className="h-4 w-4" />Add field</button>
    </fieldset>
  );
}
