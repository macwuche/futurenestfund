import { useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useListAdminTierRequests, useDecideAdminTierRequest, type AdminTierRequest } from '@workspace/api-client-react';
import { usePendingTierRequests } from '@/lib/tier-requests';
import { ArrowRight, Check, Download, Gauge, Paperclip, X } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Empty, ErrorState, Skel, StatusBadge, cx, dateFmt } from '@/components/bits';
import { card, ghost, lime, SectionTitle, ReasonModal, useAdminRefresh } from '@/components/admin-bits';
import { waited } from '@/pages/admin-cards';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/*
 * Tier Upgrades (Step 9.4): users ask to move up one tier by sending the upgrade form set in Settings → Tiers. Approve
 * (their tier goes up straight away) or decline with a reason they see (they can send the form again).
 */

type Tab = 'pending' | 'decided';


/** The oldest upgrade requests, for the dashboard. */
export function TierRequestQueue() {
  const q = usePendingTierRequests();
  return (
    <section className={cx(card, 'min-w-0 p-5')} data-testid="card-tier-requests">
      <SectionTitle action={<Link href="/admin/tiers" data-testid="link-tier-requests-all" className="text-xs font-semibold hover:underline">Open Tier Upgrades</Link>}>Tier upgrades waiting</SectionTitle>
      {q.isLoading ? <Skel className="h-14" />
        : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
        : q.data.length === 0 ? <Empty title="No upgrade requests" hint="When a user sends a tier upgrade form, it appears here." />
        : (
          <ul className="divide-y" data-testid="list-dashboard-tier-requests">{q.data.slice(0, 5).map((r) => (
            <li key={r.id}>
              <Link href="/admin/tiers" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:bg-[#F7FADC] sm:flex-nowrap sm:px-2" data-testid={`link-dashboard-tier-${r.id}`}>
                <Gauge className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" />
                <span className="min-w-0 basis-full sm:flex-1 sm:basis-0"><span className="block truncate font-semibold">{r.user.name}</span><span className="block text-xs text-slate-500">Tier {r.fromTier} → Tier {r.toTier}</span></span>
                <span className="text-xs text-slate-500">waiting {waited(r.submittedAt)}</span>
              </Link>
            </li>
          ))}</ul>
        )}
    </section>
  );
}

export function AdminTierRequestsPage() {
  const [, navigate] = useLocation();
  const tab: Tab = new URLSearchParams(useSearch()).get('tab') === 'decided' ? 'decided' : 'pending';
  const q = useListAdminTierRequests({ status: tab });
  const pending = usePendingTierRequests();
  return (
    <Shell admin title="Tier Upgrades">
      <section className={cx(card, 'p-5')} data-testid="section-tier-requests">
        <div role="tablist" aria-label="Tier upgrade requests" className="mb-4 flex flex-wrap gap-2">
          {(['pending', 'decided'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} data-testid={`tab-tiers-${t}`} onClick={() => navigate(t === 'pending' ? '/admin/tiers' : '/admin/tiers?tab=decided', { replace: true })}
              className={cx('press inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold', tab === t ? 'bg-[#111] text-white' : 'border border-[#E2E8F0] bg-white text-slate-700 hover:bg-slate-50')}>
              {t === 'pending' ? 'Waiting' : 'Decided'}
              {t === 'pending' && pending.data && <span className={cx('font-num grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px]', tab === t ? 'bg-[#C6F432] text-[#111]' : 'bg-slate-100 text-slate-700')}>{pending.data.length}</span>}
            </button>
          ))}
        </div>
        <p className="mb-4 text-xs text-slate-500">
          {tab === 'pending'
            ? 'Users who sent the upgrade form for the next tier, oldest first. Approving moves them up straight away; declining tells them why and they can send it again. The forms and what each tier allows are set in '
            : 'The latest 50 decisions. Forms and limits are set in '}
          <Link href="/admin/settings/tiers" className="font-semibold underline">Settings → Tiers</Link>.
        </p>
        {q.isLoading ? <div className="space-y-2">{[1, 2].map((i) => <Skel key={i} className="h-24" />)}</div>
          : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
          : q.data.length === 0 ? <Empty title={tab === 'pending' ? 'No upgrade requests waiting' : 'No decisions yet'} hint={tab === 'pending' ? 'When a user sends a tier upgrade form, it appears here.' : undefined} />
          : <ul className="space-y-3" data-testid="list-tier-requests">{q.data.map((r) => <TierRequestRow key={r.id} r={r} />)}</ul>}
      </section>
    </Shell>
  );
}

function TierRequestRow({ r }: { r: AdminTierRequest }) {
  const decide = useDecideAdminTierRequest();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [mode, setMode] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState('');
  const send = (decision: 'approve' | 'decline', note: string) => decide.mutate({ requestId: r.id, data: { decision, ...(note ? { note } : {}) } }, {
    onSuccess: () => { refresh(); setMode(null); toast({ title: decision === 'approve' ? `${r.user.name} is now Tier ${r.toTier}` : 'Upgrade declined', description: `${r.user.name} has been notified.` }); },
    onError: (e) => { refresh(); setError(apiError(e, 'The request could not be decided. Please try again.')); },
  });
  const open = (m: 'approve' | 'decline') => { setError(''); setMode(m); };
  return (
    <li className="rounded-xl border border-[#E2E8F0] p-4" data-testid={`row-tierreq-${r.id}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
          <Link href={`/admin/users/${r.user.id}`} className="font-semibold hover:underline" data-testid={`link-tierreq-user-${r.id}`}>{r.user.name}</Link>
          <p className="truncate text-xs text-slate-500">{r.user.email}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold" data-testid={`text-tierreq-tiers-${r.id}`}>Tier {r.fromTier}<ArrowRight className="h-4 w-4 text-slate-400" aria-label="to" />Tier {r.toTier}</p>
          <p className="mt-1 text-xs text-slate-500">
            Sent {dateFmt(r.submittedAt)}{r.status === 'Pending' && <> · <span className="font-semibold text-slate-700">waiting {waited(r.submittedAt)}</span></>}
            {r.decidedAt && <> · {r.status.toLowerCase()} {dateFmt(r.decidedAt)}{r.decidedBy ? ` by ${r.decidedBy}` : ''}</>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge status={r.status === 'Pending' ? 'Under Review' : r.status} label={r.status === 'Pending' ? 'Waiting' : undefined} />
            <span className="text-slate-500">Identity</span><StatusBadge status={r.user.verificationLevel} testid={`badge-tierreq-kyc-${r.id}`} />
            {r.status === 'Pending' && r.user.tier !== r.fromTier && <span className="text-red-700" data-testid={`text-tierreq-moved-${r.id}`}>Now on Tier {r.user.tier}</span>}
          </div>
          {r.decisionNote && <p className="mt-2 text-sm text-slate-700" data-testid={`text-tierreq-note-${r.id}`}>{r.status === 'Declined' ? 'Reason' : 'Note'}: {r.decisionNote}</p>}
        </div>
        {r.status === 'Pending' && (
          <div className="flex w-full gap-2 sm:w-auto">
            <button data-testid={`button-tierreq-decline-${r.id}`} onClick={() => open('decline')} className={cx(ghost, 'inline-flex min-h-11 items-center gap-1 text-xs md:min-h-0 md:!py-1.5')}><X className="h-3.5 w-3.5" />Decline</button>
            <button data-testid={`button-tierreq-approve-${r.id}`} onClick={() => open('approve')} className={cx(lime, 'inline-flex min-h-11 items-center gap-1 text-xs md:min-h-0 md:!py-1.5')}><Check className="h-3.5 w-3.5" />Approve</button>
          </div>
        )}
      </div>
      <details className="mt-3 rounded-lg bg-slate-50 p-3" open={r.status === 'Pending'}>
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold sm:min-h-0 sm:py-0">Their answers ({r.answers.length})</summary>
        <dl className="mt-2 divide-y divide-slate-200" data-testid={`list-tierreq-answers-${r.id}`}>
          {r.answers.map((a) => (
            <div key={a.fieldId} className="grid gap-1 py-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <dt className="text-xs text-slate-500">{a.label}</dt>
              <dd className="min-w-0 break-words text-sm">
                {a.file ? (
                  <a href={a.file.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 font-semibold underline sm:min-h-0" data-testid={`link-tierreq-file-${a.fieldId}`}>
                    <Paperclip className="h-4 w-4 shrink-0" aria-hidden />{a.file.name}<Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  </a>
                ) : a.value ? a.value : <span className="text-slate-400">Not given</span>}
              </dd>
            </div>
          ))}
        </dl>
      </details>
      <ReasonModal open={mode === 'approve'} onClose={() => setMode(null)} testid="dialog-approve-tier" title={`Move ${r.user.name} to Tier ${r.toTier}?`} confirmLabel={`Approve Tier ${r.toTier}`} optional label="Note to the user"
        intro={<p>Their Tier {r.toTier} limits and cards apply straight away (custom limits in their profile still win). They're notified in the app and by email.</p>}
        pending={decide.isPending} error={error} onSubmit={(note) => send('approve', note)} maxLength={500} />
      <ReasonModal open={mode === 'decline'} onClose={() => setMode(null)} testid="dialog-decline-tier" title={`Decline ${r.user.name}'s Tier ${r.toTier} upgrade?`} confirmLabel="Decline upgrade"
        intro={<p>They stay on Tier {r.fromTier} and see your reason, e.g. “The bank statement is older than three months.” They can send the form again.</p>}
        pending={decide.isPending} error={error} onSubmit={(note) => send('decline', note)} maxLength={500} />
    </li>
  );
}
