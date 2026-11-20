import type { MailFile } from '@workspace/api-client-react';
import { Download, FileImage, FileSpreadsheet, FileText, FileWarning, Presentation, X } from 'lucide-react';
import { cx, fileSize } from '@/components/bits';

/** Icon and colour by kind, like Gmail's attachment chips. */
function kind(f: MailFile) {
  const t = f.mimeType;
  if (t.startsWith('image/')) return { Icon: FileImage, color: 'text-red-600' };
  if (t === 'application/pdf') return { Icon: FileText, color: 'text-red-700' };
  if (/sheet|excel|csv/.test(t)) return { Icon: FileSpreadsheet, color: 'text-green-700' };
  if (/presentation|powerpoint/.test(t)) return { Icon: Presentation, color: 'text-orange-600' };
  return { Icon: FileText, color: 'text-blue-700' };
}

/** A small chip (Compose). */
export function FileChip({ file, onRemove }: { file: MailFile; onRemove?: () => void }) {
  const { Icon, color } = kind(file);
  return (
    <span className="inline-flex max-w-[16rem] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-2 pr-1 text-[13px]" data-testid="chip-attachment">
      <Icon className={cx('h-4 w-4 shrink-0', color)} />
      <a href={file.url ?? undefined} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-slate-800 hover:underline">{file.name}</a>
      <span className="shrink-0 text-xs text-slate-500">{fileSize(file.size)}</span>
      {onRemove && <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove} className="grid h-6 w-6 place-items-center rounded hover:bg-slate-200"><X className="h-3.5 w-3.5" /></button>}
    </span>
  );
}

/** Attachment cards under a message (reader): image previews, a download button, and files that weren't kept. */
export function AttachmentCards({ files }: { files: MailFile[] }) {
  if (!files.length) return null;
  const kept = files.filter((f) => f.available);
  const held = files.filter((f) => !f.available);
  return (
    <div className="mt-4 border-t border-slate-100 pt-3" data-testid="attachments">
      <p className="mb-2 text-sm font-medium text-slate-700">{files.length} attachment{files.length > 1 ? 's' : ''}</p>
      <div className="flex flex-wrap gap-3">
        {kept.map((f) => {
          const { Icon, color } = kind(f);
          const image = /^image\/(jpeg|png|gif|webp)$/.test(f.mimeType);
          return (
            <div key={f.id} className="group relative w-44 overflow-hidden rounded-lg border border-slate-200 bg-white" data-testid="card-attachment">
              <a href={f.url!} target="_blank" rel="noreferrer" className="block h-24 bg-slate-50" aria-label={`Open ${f.name}`}>
                {image ? <img src={f.url!} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className="grid h-full place-items-center"><Icon className={cx('h-10 w-10', color)} /></div>}
              </a>
              <div className="flex items-center gap-2 border-t border-slate-100 px-2 py-1.5">
                <Icon className={cx('h-4 w-4 shrink-0', color)} />
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-800" title={f.name}>{f.name}</p><p className="text-[11px] text-slate-500">{fileSize(f.size)}</p></div>
                <a href={`${f.url}?download`} aria-label={`Download ${f.name}`} className="grid h-8 w-8 place-items-center rounded hover:bg-slate-100"><Download className="h-4 w-4 text-slate-600" /></a>
              </div>
            </div>
          );
        })}
      </div>
      {held.map((f) => (
        <p key={f.id} className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="text-attachment-held">
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0" /><span><b>{f.name}</b> wasn't kept: {f.blockedReason}</span>
        </p>
      ))}
    </div>
  );
}
