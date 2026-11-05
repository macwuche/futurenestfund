import { useEffect, useState } from 'react';
import { useUpdateUserWithdrawalSources, type AdminUserProfile, type WithdrawalSources } from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';
import { cx, money } from '@/components/bits';
import { card, lime, useAdminRefresh } from '@/components/admin-bits';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

const OPTIONS: { value: WithdrawalSources; title: string; text: (u: AdminUserProfile) => string }[] = [
  { value: 'grant', title: 'Grant balance', text: (u) => `${money(u.balances.grant)} now` },
  { value: 'deposit', title: 'Account balance', text: (u) => `${money(u.balances.deposit)} now` },
  { value: 'both', title: 'Both', text: () => 'The applicant chooses for each withdrawal' },
];

/** User inspector → Limits: which balances this user can withdraw from (Phase 10). */
export function UserWithdrawalSources({ u }: { u: AdminUserProfile }) {
  const m = useUpdateUserWithdrawalSources();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const [value, setValue] = useState<WithdrawalSources>(u.withdrawalSources);
  const [err, setErr] = useState('');
  useEffect(() => setValue(u.withdrawalSources), [u.withdrawalSources]);
  return (
    <form noValidate className={cx(card, 'space-y-3 p-5')} data-testid="form-user-sources" onSubmit={(e) => {
      e.preventDefault(); setErr('');
      m.mutate({ userId: u.id, data: { sources: value } }, {
        onSuccess: () => { refresh(); toast({ title: 'Withdrawal balances saved', description: `${u.name} has been notified.` }); },
        onError: (e2) => setErr(apiError(e2, 'This could not be saved. Please try again.')),
      });
    }}>
      <h3 className="font-display font-bold">Withdraw from</h3>
      <p className="text-sm text-slate-600">Which balances {u.name} can withdraw from. Pending withdrawals from a balance you close here can't be approved; decline them instead.</p>
      <div role="radiogroup" aria-label="Withdraw from" className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} data-testid={`button-sources-${o.value}`} onClick={() => { setValue(o.value); setErr(''); }}
            className={cx('press min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition', value === o.value ? 'border-[#111] bg-[#111] text-[#C6F432]' : 'border-slate-300 hover:border-[#111]')}>
            <span className="block font-semibold">{o.title}</span><span className={cx('block text-xs', value === o.value ? 'text-white/80' : 'text-slate-500')}>{o.text(u)}</span>
          </button>
        ))}
      </div>
      {err && <p role="alert" className="text-sm text-red-700" data-testid="error-user-sources">{err}</p>}
      <button data-testid="button-save-user-sources" disabled={m.isPending || value === u.withdrawalSources} className={cx(lime, 'inline-flex min-h-11 items-center gap-2')}>
        {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{m.isPending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
