import { useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import {
  useListAdminCardRequests, useChangeUserCard, useDeclineAdminCardRequest,
  type AdminCardRequest, type ListAdminCardRequestsStatus,
} from '@workspace/api-client-react';
import { Check, CreditCard, X } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Empty, ErrorState, Modal, Skel, StatusBadge, cx, dateFmt } from '@/components/bits';
import { card, dark, ghost, lime, Stat, SectionTitle, ReasonModal, useAdminRefresh } from '@/components/admin-bits';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

const cardLabel = (r: AdminCardRequest) => `Physical ${r.card.typeName} •• ${r.card.lastFour}`;

/** "3 days", "5 hours", "a few minutes": how long a request has been waiting. */
export function waited(iso: string, now = Date.now()) {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (mins < 60) return mins < 5 ? 'a few minutes' : `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

/** The oldest activation requests, for the dashboard (up to 5, with a link to the full queue). */
export function CardActivationQueue() {
  const q = useListAdminCardRequests({ status: 'requested' });
  return (
    <section className={cx(card, 'min-w-0 p-5')} data-testid="card-card-activations">
      <SectionTitle action={<Link href="/admin/cards" data-testid="link-card-activations-all" className="text-xs font-semibold hover:underline">Open Card Requests</Link>}>Cards waiting to be activated</SectionTitle>
      {q.isLoading ? <Skel className="h-14" />
        : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
        : q.data.items.length === 0 ? <Empty title="No activation requests" hint="When a user says their physical card arrived, it appears here." />
        : (
          <ul className="divide-y" data-testid="list-dashboard-card-requests">{q.data.items.slice(0, 5).map((r) => (
            <li key={r.card.id}>
              <Link href="/admin/cards" data-testid={`link-dashboard-card-${r.card.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:bg-[#F7FADC] sm:flex-nowrap sm:px-2">
                <CreditCard className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" />
                <span className="min-w-0 basis-full sm:flex-1 sm:basis-0"><span className="block truncate font-semibold">{r.userName}</span><span className="block text-xs text-slate-500 sm:truncate">{cardLabel(r)} · {r.organization}</span></span>
                {r.card.activationRequestedAt && <span className="text-xs text-slate-500">waiting {waited(r.card.activationRequestedAt)}</span>}
              </Link>
            </li>
          ))}</ul>
        )}
    </section>
  );
}

/** Card Requests: physical cards still being issued. Activate (the existing "mark as issued") or decline with a reason. */
export function AdminCardRequestsPage() {
  const [, navigate] = useLocation();
  const tab: ListAdminCardRequestsStatus = new URLSearchParams(useSearch()).get('tab') === 'awaiting' ? 'awaiting' : 'requested';
  const q = useListAdminCardRequests({ status: tab });
  const counts = q.data ? { requested: q.data.requested, awaiting: q.data.awaiting } : undefined;
  const tabs: { key: ListAdminCardRequestsStatus; label: string }[] = [
    { key: 'requested', label: 'Activation requested' },
    { key: 'awaiting', label: 'Awaiting delivery' },
  ];
  return (
    <Shell admin title="Card Requests">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat id="cards-requested" accent label="Activation requested" value={counts?.requested ?? '–'} hint="The user says it arrived" />
          <Stat id="cards-awaiting" label="Awaiting delivery" value={counts?.awaiting ?? '–'} hint="Issued, no request yet" />
        </div>
        <section className={cx(card, 'p-5')} data-testid="section-card-requests">
          <div role="tablist" aria-label="Card requests" className="mb-4 flex flex-wrap gap-2">
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} data-testid={`tab-cards-${t.key}`}
                onClick={() => navigate(t.key === 'requested' ? '/admin/cards' : '/admin/cards?tab=awaiting', { replace: true })}
                className={cx('press inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold', tab === t.key ? 'bg-[#111] text-white' : 'border border-[#E2E8F0] bg-white text-slate-700 hover:bg-slate-50')}>
                {t.label}
                {counts && <span className={cx('font-num grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px]', tab === t.key ? 'bg-[#C6F432] text-[#111]' : 'bg-slate-100 text-slate-700')}>{counts[t.key]}</span>}
              </button>
            ))}
          </div>
          <p className="mb-4 text-xs text-slate-500">
            {tab === 'requested'
              ? 'The user says their physical card arrived. Activating makes it usable; declining keeps it pending and tells them why. Oldest request first.'
              : 'Physical cards sent out that nobody has asked to activate yet. You can still mark one as issued. Oldest first.'} Cards are samples; no card network is connected.
          </p>
          {q.isLoading ? <div className="space-y-2">{[1, 2].map((i) => <Skel key={i} className="h-16" />)}</div>
            : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
            : q.data.items.length === 0 ? <Empty title={tab === 'requested' ? 'No activation requests' : 'Nothing awaiting delivery'} hint={tab === 'requested' ? 'When a user says their physical card arrived, it appears here.' : 'Physical cards you issue from a user’s profile appear here until they’re activated.'} />
            : <ul className="space-y-3" data-testid="list-card-requests">{q.data.items.map((r) => <CardRequestRow key={r.card.id} r={r} />)}</ul>}
        </section>
      </div>
    </Shell>
  );
}

function CardRequestRow({ r }: { r: AdminCardRequest }) {
  const activate = useChangeUserCard();
  const decline = useDeclineAdminCardRequest();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState('');
  const requestedAt = r.card.activationRequestedAt;
  const frozen = r.userStatus === 'Frozen';
  const id = r.card.id;
  return (
    <li className="rounded-xl border border-[#E2E8F0] p-4" data-testid={`row-cardreq-${id}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
          <Link href={`/admin/users/${r.userId}`} className="font-semibold hover:underline" data-testid={`link-cardreq-user-${id}`}>{r.userName}</Link>
          <p className="text-xs text-slate-500">{r.organization}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium"><CreditCard className="h-4 w-4 text-slate-400" />{cardLabel(r)}</p>
          <p className="mt-1 text-xs text-slate-500" data-testid={`text-cardreq-dates-${id}`}>
            {r.card.issuedAt ? `Issued ${dateFmt(r.card.issuedAt)}` : 'Issue date not recorded'}
            {requestedAt && <> · activation requested {dateFmt(requestedAt)} · <span className="font-semibold text-slate-700">waiting {waited(requestedAt)}</span></>}
          </p>
          {!requestedAt && r.card.activationDeclinedReason && (
            <p className="mt-1 text-xs text-slate-500" data-testid={`text-cardreq-last-decline-${id}`}>Last request declined{r.card.activationDeclinedAt ? ` ${dateFmt(r.card.activationDeclinedAt)}` : ''}: {r.card.activationDeclinedReason}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="text-slate-500">Account</span><StatusBadge status={r.userStatus} /></div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
          <div className="flex gap-2">
            {requestedAt && <button data-testid={`button-cardreq-decline-${id}`} onClick={() => { setError(''); setDeclining(true); }} className={cx(ghost, 'inline-flex min-h-11 items-center gap-1 text-xs md:min-h-0 md:!py-1.5')}><X className="h-3.5 w-3.5" />Decline</button>}
            <button data-testid={`button-cardreq-activate-${id}`} disabled={frozen} title={frozen ? 'Unfreeze the account first' : undefined} onClick={() => { setError(''); setConfirm(true); }} className={cx(lime, 'inline-flex min-h-11 items-center gap-1 text-xs disabled:cursor-not-allowed md:min-h-0 md:!py-1.5')}><Check className="h-3.5 w-3.5" />{requestedAt ? 'Activate' : 'Mark as issued'}</button>
          </div>
          {frozen && <p className="text-xs text-red-700" data-testid={`text-cardreq-blocker-${id}`}>Account is frozen</p>}
        </div>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Activate card •• ${r.card.lastFour}?`} testid="dialog-activate-card">
        <p className="text-sm text-slate-600">{r.userName}’s physical {r.card.typeName} card •• {r.card.lastFour} becomes active and usable. They’re notified in the app (and by email, if their email notifications are on), and an audit record is written.</p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="text-activate-error">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button data-testid="button-activate-cancel" onClick={() => setConfirm(false)} className="press rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-100">Cancel</button>
          <button data-testid="button-activate-confirm" disabled={activate.isPending} className={dark} onClick={() => activate.mutate({ userId: r.userId, cardId: id, data: { action: 'activate' } }, {
            onSuccess: () => { refresh(); setConfirm(false); toast({ title: `Card •• ${r.card.lastFour} is now active`, description: `${r.userName} has been notified.` }); },
            onError: (e) => { refresh(); setError(apiError(e, 'The card could not be activated.')); },
          })}>{activate.isPending ? 'Activating…' : 'Activate card'}</button>
        </div>
      </Modal>
      <ReasonModal open={declining} onClose={() => setDeclining(false)} testid="dialog-decline-card" title={`Decline activation of •• ${r.card.lastFour}?`} confirmLabel="Decline request"
        intro={<p>The card stays pending and {r.userName} can ask again. They’re notified with your reason, e.g. “The card you have isn’t the one we sent.”</p>}
        pending={decline.isPending} error={error}
        onSubmit={(reason) => decline.mutate({ userId: r.userId, cardId: id, data: { reason } }, {
          onSuccess: () => { refresh(); setDeclining(false); toast({ title: 'Activation request declined', description: `${r.userName} has been notified.` }); },
          onError: (e) => { refresh(); setError(apiError(e, 'The request could not be declined.')); },
        })} />
    </li>
  );
}
