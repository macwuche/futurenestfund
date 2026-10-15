import { useEffect, type ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw, X } from 'lucide-react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
export const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
export const dateFmt = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
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
  Submitted: 'blue', Unsubmitted: 'gray',
};
export function StatusBadge({ status, testid }: { status: string; testid?: string }) {
  return (
    <span data-testid={testid ?? `badge-status-${status}`} className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', tone[map[status] ?? 'gray'])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status}
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
  return (
    <div data-testid="state-empty" className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-slate-100"><Inbox className="h-5 w-5 text-slate-500" /></span>
      <p className="font-display font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-slate-500">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, testid }: { open: boolean; onClose: () => void; title: string; children: ReactNode; testid: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} data-testid={`overlay-${testid}`} />
      <div role="dialog" aria-modal="true" aria-label={title} data-testid={testid} className="pop relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button aria-label="Close dialog" data-testid={`button-close-${testid}`} onClick={onClose} className="press grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
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
