import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Inbox, RefreshCw, X } from 'lucide-react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
export const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
export const dateFmt = (s: string) => {
  // Date-only strings ("2026-10-08") are parsed as UTC by Date; build them in local time so US users don't see the previous day.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const animated = new Set<string>();
/** Charts play their entry animation once per browser session, not on every visit (finding G5). Respects reduced motion. */
export function useAnimateOnce(id: string) {
  const [first] = useState(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const fresh = !animated.has(id) && !reduce;
    animated.add(id);
    return fresh;
  });
  return first;
}
export const initials = (n: string) =>
  n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

const tone: Record<string, string> = {
  green: 'bg-[#DCFCE7] text-[#166534]',
  amber: 'bg-[#FEF3C7] text-[#92400E]',
  red: 'bg-[#FEE2E2] text-[#991B1B]',
  blue: 'bg-[#DBEAFE] text-[#1E3A8A]',
  gray: 'bg-slate-100 text-slate-600',
};
const map: Record<string, string> = {
  Verified: 'green', Operational: 'green', Completed: 'green', Approved: 'green', Active: 'green', Intact: 'green', Recommended: 'green',
  Pending: 'amber', Review: 'amber', Degraded: 'amber', 'Changes requested': 'amber', 'Review required': 'amber',
  Rejected: 'red', Declined: 'red', Frozen: 'red', Offline: 'red',
  Submitted: 'green', Unsubmitted: 'gray', Withdrawn: 'gray', Cancelled: 'gray',
};
/** Display wording for API statuses. */
export const statusLabel = (s: string) => (s === 'Review' ? 'Under Review' : s);
export function StatusBadge({ status, testid, dot = true, label }: { status: string; testid?: string; dot?: boolean; label?: string }) {
  return (
    <span data-testid={testid ?? `badge-status-${status}`} className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', tone[map[status] ?? 'gray'])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {label ?? statusLabel(status)}
    </span>
  );
}

export function Skel({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-slate-200/80', className)} />;
}
export function PageSkeleton() {
  return (
    <div className="space-y-4" data-testid="state-loading">
      <Skel className="h-8 w-56" />
      <div className="grid gap-4 md:grid-cols-3"><Skel className="h-28" /><Skel className="h-28" /><Skel className="h-28" /></div>
      <Skel className="h-72" />
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div role="alert" data-testid="state-error" className="rounded-2xl border border-red-200 bg-[#FEF2F2] p-6 text-center">
      <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-red-700" />
      <p className="font-display text-lg font-semibold text-red-900">Could not load this data</p>
      <p className="mt-1 text-sm text-red-800">{message ?? 'The preview API did not respond. Nothing has been substituted.'}</p>
      <button data-testid="button-retry" onClick={onRetry} className="press mt-4 inline-flex items-center gap-2 rounded-full bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900">
        <RefreshCw className="h-4 w-4" /> Retry
      </button>
    </div>
  );
}
export function Empty({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  // Compact on purpose: an empty queue is normal, so it shouldn't take half the screen (finding A7).
  return (
    <div data-testid="state-empty" className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-5 py-6 text-center">
      <span className="mb-2 grid h-9 w-9 place-items-center rounded-full bg-white shadow-sm"><Inbox className="h-4 w-4 text-slate-500" /></span>
      <p className="font-display text-sm font-semibold">{title}</p>
      {hint && <p className="mt-0.5 max-w-sm text-sm text-slate-500">{hint}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** Close a popover on outside pointer-down or Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [ref, open, close]);
}

const focusable = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function Modal({ open, onClose, title, children, testid }: { open: boolean; onClose: () => void; title: string; children: ReactNode; testid: string }) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = box.current?.querySelector<HTMLElement>('input,select,textarea') ?? box.current?.querySelector<HTMLElement>(focusable);
    first?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeRef.current();
      if (e.key !== 'Tab' || !box.current) return;
      const els = Array.from(box.current.querySelectorAll<HTMLElement>(focusable));
      if (!els.length) return;
      const [a, z] = [els[0], els[els.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open]);
  if (!open) return null;
  // Portalled to <body> so no ancestor's stacking context (animations, transforms) can put the bottom nav above it.
  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} data-testid={`overlay-${testid}`} />
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} data-testid={testid} className="pop relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button aria-label="Close dialog" data-testid={`button-close-${testid}`} onClick={onClose} className="press -mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export const inputCls = 'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-[#1E3A8A] focus:ring-2 focus:ring-[#1E3A8A]/20 disabled:bg-slate-100 disabled:text-slate-500';
export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {error && <span role="alert" className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  );
}

/** Round profile photo with an initial fallback (also used while the image fails to load). */
export function Avatar({ name, url, className, testid }: { name: string; url?: string; className: string; testid?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <span data-testid={testid} className={cx('grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#1E3A8A] font-semibold leading-none text-white', className)}>
      {url && !failed ? <img src={url} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} /> : name.charAt(0)}
    </span>
  );
}

export const fileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Upload kinds mirror the server's rules; the server re-checks the real file contents. */
export const FILE_RULES = {
  image: { accept: 'image/jpeg,image/png,image/webp', types: ['image/jpeg', 'image/png', 'image/webp'], label: 'a JPG, PNG or WebP image' },
  identity: { accept: 'image/jpeg,image/png,image/webp,application/pdf', types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], label: 'a JPG, PNG or WebP image, or a PDF' },
  proposal: {
    accept: '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    types: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], label: 'a PDF or Word (.docx) document',
  },
} as const;
const MAX_UPLOAD = 10 * 1024 * 1024;
/** Quick client-side check so obvious mistakes fail before uploading. Returns an error message or ''. */
export function checkFile(file: File, rule: keyof typeof FILE_RULES) {
  const r = FILE_RULES[rule];
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const typeOk = (r.types as readonly string[]).includes(file.type) || (rule === 'proposal' && ['pdf', 'docx'].includes(ext));
  if (!typeOk) return `Choose ${r.label}.`;
  if (file.size > MAX_UPLOAD) return 'Files must be 10 MB or smaller.';
  if (file.size === 0) return 'This file is empty.';
  return '';
}
