import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateUserBalanceAdjustment, useReviewAdminKycDocument, type KycDocument } from '@workspace/api-client-react';
import { Check, FileText, X } from 'lucide-react';
import { Field, Modal, balanceName, cx, dateFmt, money } from '@/components/bits';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/* Admin command-center styles (black / lime, per the admin spec). */
export const card = 'rounded-2xl border border-[#E2E8F0] bg-white shadow-sm';
export const ainput = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#111] focus:ring-2 focus:ring-[#C6F432] disabled:bg-slate-100 disabled:text-slate-500';
export const lime = 'press rounded-lg bg-[#C6F432] px-4 py-2 text-sm font-semibold text-[#111] hover:brightness-95 disabled:opacity-60';
export const dark = 'press rounded-lg bg-[#111] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60';
export const ghost = 'press rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:border-[#111] disabled:opacity-60';
export const danger = 'press rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60';

/** KPI tile. Background and border are chosen once so the accent never fights the default classes. */
export function Stat({ label, value, id, accent, href, hint }: { label: string; value: string | number; id: string; accent?: boolean; href?: string; hint?: string }) {
  const body = (
    <>
      {/* On phones the label keeps room for two lines, so values in a row line up even when one label wraps (finding AM5). */}
      <p className={cx('min-h-[2.75em] text-[13px] font-semibold leading-snug sm:min-h-0', accent ? 'text-[#C6F432]' : 'text-slate-500')}>{label}</p>
      <p className="font-num mt-1 text-2xl font-semibold tracking-tight sm:mt-2" data-testid={`stat-${id}`}>{value}</p>
      {hint && <p className={cx('mt-0.5 text-xs', accent ? 'text-slate-300' : 'text-slate-500')}>{hint}</p>}
    </>
  );
  const cls = cx('lift flex h-full flex-col rounded-2xl border p-4 shadow-sm', accent ? 'border-[#111] bg-[#111] text-white' : 'border-[#E2E8F0] bg-white', href && 'transition hover:border-[#111]');
  if (!href) return <div className={cls}>{body}</div>;
  // In-page anchors scroll natively; routes go through the router.
  return href.startsWith('#')
    ? <a href={href} className={cls} data-testid={`link-stat-${id}`}>{body}</a>
    : <Link href={href} className={cls} data-testid={`link-stat-${id}`}>{body}</Link>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-display font-bold">{children}</h2>{action}</div>;
}

/** Refetch every admin view after an action (queues, counters, ledger, inspector). */
export function useAdminRefresh() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/api/admin') }), [qc]);
}

/** Ask for a written reason before a decline or rejection. */
export function ReasonModal({ open, title, intro, label = 'Reason (shared with the applicant)', confirmLabel, pending, error, onClose, onSubmit, testid, optional = false, maxLength = 240 }: {
  open: boolean; title: string; intro?: ReactNode; label?: string; confirmLabel: string; pending: boolean; error?: string;
  onClose: () => void; onSubmit: (reason: string) => void; testid: string; optional?: boolean; maxLength?: number;
}) {
  const [reason, setReason] = useState('');
  const [local, setLocal] = useState('');
  useEffect(() => { if (open) { setReason(''); setLocal(''); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title} testid={testid}>
      <form className="space-y-3" noValidate onSubmit={(e) => {
        e.preventDefault();
        const r = reason.trim();
        if (!optional && r.length < 5) return setLocal('Write at least 5 characters.');
        setLocal(''); onSubmit(r);
      }}>
        {intro && <div className="text-sm text-slate-600">{intro}</div>}
        <Field label={optional ? `${label} (optional)` : label} error={local || error}>
          <textarea data-testid={`input-${testid}-reason`} maxLength={maxLength} value={reason} onChange={(e) => setReason(e.target.value)} className={cx(ainput, 'h-24')} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" data-testid={`button-${testid}-cancel`} onClick={onClose} className="press rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-100">Cancel</button>
          <button data-testid={`button-${testid}-confirm`} disabled={pending} className={dark}>{pending ? 'Saving…' : confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Document viewer body: sample placeholder with its demo OCR score, an image preview, or a PDF download. */
export function KycPreview({ doc, userName }: { doc: KycDocument; userName: string }) {
  if (doc.sample) {
    return (
      <div>
        <div className="relative grid aspect-[1.5/1] place-items-center overflow-hidden rounded-xl bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_10px,#e2e8f0_10px,#e2e8f0_20px)]">
          <span className="rotate-[-12deg] rounded border-2 border-slate-400 px-4 py-2 font-display text-2xl font-extrabold uppercase tracking-widest text-slate-400">Sample document</span>
        </div>
        <p className="mt-3 text-sm font-semibold" data-testid="text-doc-label">Sample document: {doc.kind}</p>
        <div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#111]" style={{ width: `${doc.confidence ?? 0}%` }} /></div>
        <p className="mt-1 text-xs text-slate-500" data-testid="text-doc-confidence">OCR confidence {doc.confidence ?? 0}% is demonstration data, not a real scan.</p>
      </div>
    );
  }
  return (
    <div>
      {doc.mimeType?.startsWith('image/') ? (
        <a href={doc.url} target="_blank" rel="noopener" className="block overflow-hidden rounded-xl border bg-slate-50">
          <img src={doc.url} alt={`${doc.kind} uploaded by ${userName}`} data-testid="img-doc-preview" className="max-h-[50dvh] w-full object-contain" />
        </a>
      ) : (
        <div className="grid aspect-[1.5/1] place-items-center rounded-xl border bg-slate-50 text-center">
          <div><FileText className="mx-auto h-10 w-10 text-slate-400" /><p className="mt-2 text-sm text-slate-600">PDF document</p></div>
        </div>
      )}
      <p className="mt-3 text-sm font-semibold" data-testid="text-doc-label">{doc.kind}: {doc.name}</p>
      <p className="mt-1 text-xs text-slate-500">Uploaded {dateFmt(doc.submittedAt)}. No OCR has been run on this file; check it by eye.</p>
      <a href={doc.url} target="_blank" rel="noopener" data-testid="link-doc-open" className={cx(lime, 'mt-3 inline-flex text-xs')}>{doc.mimeType === 'application/pdf' ? 'Download PDF' : 'Open full size'}</a>
    </div>
  );
}

/** Approve / reject controls for a pending identity document (used in the KYC queue and the inspector). */
export function KycDecision({ doc, onDone }: { doc: KycDocument; onDone?: () => void }) {
  const review = useReviewAdminKycDocument();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState('');
  if (doc.status !== 'Pending') {
    return doc.reviewNote ? <p className="text-xs text-slate-500" data-testid={`text-kyc-note-${doc.id}`}>Reviewer note: {doc.reviewNote}</p> : null;
  }
  const decide = (decision: 'Verified' | 'Rejected', note?: string) => review.mutate({ documentId: doc.id, data: { decision, note } }, {
    onSuccess: (d) => {
      refresh(); setRejecting(false); onDone?.();
      toast({ title: decision === 'Verified' ? `${doc.kind} approved` : `${doc.kind} rejected`, description: `Verification level: ${d.verificationLevel}` });
    },
    onError: (e) => { const m = apiError(e, 'The review could not be saved.'); if (rejecting) setError(m); else toast({ title: 'Review refused', description: m, variant: 'destructive' }); },
  });
  return (
    <div className="flex flex-wrap gap-2">
      <button data-testid={`button-kyc-approve-${doc.id}`} disabled={review.isPending} onClick={() => decide('Verified')} className={cx(lime, 'inline-flex items-center gap-1.5 !py-1.5 text-xs')}><Check className="h-3.5 w-3.5" />Approve</button>
      <button data-testid={`button-kyc-reject-${doc.id}`} disabled={review.isPending} onClick={() => { setError(''); setRejecting(true); }} className={cx(ghost, 'inline-flex items-center gap-1.5 !py-1.5 text-xs')}><X className="h-3.5 w-3.5" />Reject</button>
      <ReasonModal open={rejecting} onClose={() => setRejecting(false)} testid="dialog-kyc-reject" title={`Reject ${doc.kind}?`} confirmLabel="Reject document"
        intro={<p>The applicant is notified with your reason and asked to upload a new copy. Their verification level becomes Rejected until a replacement is approved.</p>}
        pending={review.isPending} error={error} onSubmit={(r) => decide('Rejected', r)} />
    </div>
  );
}

const adjSchema = z.object({
  userId: z.string().min(1, 'Choose a user'),
  account: z.enum(['grant', 'deposit', 'card']),
  amount: z.coerce.number().min(0.01, 'Minimum $0.01').max(1_000_000, 'Maximum $1,000,000'),
  reason: z.string().trim().min(5, 'At least 5 characters').max(240),
});
type Account = 'grant' | 'deposit' | 'card';

type Balances = Record<Account, number>;

/**
 * Credit or debit a sample balance. With `user` it is fixed to that person; otherwise a picker is shown (credits only).
 * A debit shows the balance before and after, and asks for confirmation before anything is recorded.
 */
export function CreditModal({ open, onClose, user, account = 'deposit', users, direction = 'credit', balances }: {
  open: boolean; onClose: () => void; user?: { id: string; name: string }; account?: Account; users?: { id: string; name: string; status: string }[];
  direction?: 'credit' | 'debit'; balances?: Balances;
}) {
  const m = useCreateUserBalanceAdjustment();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<z.output<typeof adjSchema> | null>(null);
  const debit = direction === 'debit';
  const f = useForm<z.input<typeof adjSchema>, unknown, z.output<typeof adjSchema>>({ resolver: zodResolver(adjSchema), defaultValues: { userId: user?.id ?? '', account, amount: debit ? undefined : 100, reason: '' } });
  useEffect(() => { if (open) { f.reset({ userId: user?.id ?? '', account, amount: debit ? undefined : 100, reason: '' }); setError(''); setConfirming(null); } }, [open, user?.id, account, debit, f]);
  const chosen = f.watch('account') as Account;
  const typed = Number(f.watch('amount'));
  const before = balances?.[chosen];
  const after = before === undefined || !(typed > 0) ? undefined : Math.round((debit ? before - typed : before + typed) * 100) / 100;
  const record = ({ userId, ...v }: z.output<typeof adjSchema>) => m.mutate({ userId, data: { ...v, direction } }, {
    onSuccess: () => { refresh(); toast({ title: debit ? `Removed ${money(v.amount)} from the ${balanceName(v.account)} balance` : `Credited ${money(v.amount)} to the ${balanceName(v.account)} balance` }); onClose(); },
    onError: (e) => { setConfirming(null); setError(apiError(e, debit ? 'The debit was refused.' : 'The credit was refused.')); },
  });
  return (
    <Modal open={open} onClose={onClose} title={debit ? 'Remove funds' : 'Credit a balance'} testid="dialog-adjustment">
      {confirming ? (
        <div className="space-y-4" data-testid="confirm-debit">
          <p className="text-sm">Remove <b>{money(confirming.amount)}</b> from {user?.name ?? 'this user'}’s <b>{confirming.account}</b> balance?</p>
          {before !== undefined && <p className="font-num text-sm" data-testid="text-debit-change">{money(before)} → {money(Math.round((before - confirming.amount) * 100) / 100)}</p>}
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Reason, shown to the user: “{confirming.reason}”. A ledger entry and an audit record are written, and the user is notified. This can’t be undone, though a later credit can restore the amount.</p>
          <div className="flex justify-end gap-2">
            <button type="button" data-testid="button-debit-back" onClick={() => setConfirming(null)} className={ghost}>Back</button>
            <button type="button" data-testid="button-debit-confirm" disabled={m.isPending} onClick={() => record(confirming)} className={danger}>{m.isPending ? 'Removing…' : `Remove ${money(confirming.amount)}`}</button>
          </div>
        </div>
      ) : (
        <form className="space-y-3" noValidate onSubmit={f.handleSubmit((v) => {
          setError('');
          if (debit && before !== undefined && v.amount > before) return setError(`The ${balanceName(v.account)} balance is only ${money(before)}.`);
          if (debit) setConfirming(v); else record(v);
        })}>
          <p className={cx('rounded-lg p-3 text-xs text-slate-700', debit ? 'bg-[#FEF2F2]' : 'bg-[#F7FADC]')}>
            {debit ? 'Takes money off a sample balance (never below $0, and never below what pending withdrawals hold), with a ledger entry and an audit record. The user is notified with your reason.'
              : 'Adds to a sample balance and writes a ledger entry and an audit record.'} Refused while the platform or the account is frozen. No real transfer occurs.
          </p>
          {user ? <p className="text-sm">User: <b>{user.name}</b></p> : (
            <Field label="User" error={f.formState.errors.userId?.message}>
              <select data-testid="select-adjust-user" className={ainput} {...f.register('userId')}>
                <option value="">Choose a user…</option>
                {users?.map((u) => <option key={u.id} value={u.id}>{u.name}{u.status === 'Frozen' ? ' (frozen)' : ''}</option>)}
              </select>
            </Field>
          )}
          <Field label="Account"><select data-testid="select-adjust-account" className={ainput} {...f.register('account')}><option value="grant">Grant</option><option value="deposit">Account balance</option><option value="card">Card</option></select></Field>
          <Field label="Amount (USD)" error={f.formState.errors.amount?.message}><input data-testid="input-adjust-amount" type="number" inputMode="decimal" step="0.01" className={ainput} {...f.register('amount')} /></Field>
          {before !== undefined && (
            <p className="font-num text-xs text-slate-600" data-testid="text-adjust-preview">
              {balanceName(chosen)} balance {money(before)}{after !== undefined && <> → <span className={cx('font-semibold', after < 0 ? 'text-[#991B1B]' : 'text-slate-900')}>{money(after)}</span></>}
            </p>
          )}
          <Field label={debit ? 'Reason (shown to the user and recorded in the ledger)' : 'Reason (recorded in the ledger)'} error={f.formState.errors.reason?.message}><textarea data-testid="input-adjust-reason" maxLength={240} className={cx(ainput, 'h-20')} {...f.register('reason')} /></Field>
          {error && <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-adjust-error">{error}</p>}
          <button data-testid="button-submit-adjustment" disabled={m.isPending} className={cx(debit ? danger : lime, 'w-full')}>{m.isPending ? 'Recording…' : debit ? 'Review debit' : 'Record credit'}</button>
        </form>
      )}
    </Modal>
  );
}
