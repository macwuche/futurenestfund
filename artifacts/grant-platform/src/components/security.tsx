import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, Loader2, LogOut, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { cx, Field, inputCls, Modal } from '@/components/bits';
import { authErrorMessage, useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';

type Tone = 'user' | 'admin';
const styles = {
  user: {
    card: 'rounded-2xl border border-[#E5E7EB] bg-white shadow-sm',
    primary: 'press inline-flex items-center justify-center gap-2 rounded-full bg-[#1E3A8A] px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0F172A] disabled:opacity-50',
    secondary: 'press inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-[#1E3A8A] disabled:opacity-60',
    danger: 'press inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#991B1B] px-4 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-60',
    icon: 'bg-[#EEF4FB] text-[#1E3A8A]',
  },
  admin: {
    card: 'rounded-2xl border border-[#E2E8F0] bg-white shadow-sm',
    primary: 'press inline-flex items-center justify-center gap-2 rounded-lg bg-[#C6F432] px-4 py-2 text-sm font-semibold text-[#111] hover:brightness-95 disabled:opacity-60',
    secondary: 'press inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-[#111] disabled:opacity-60',
    danger: 'press inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60',
    icon: 'bg-[#111] text-[#C6F432]',
  },
} as const;

const newPassword = z.string().min(8, 'Use at least 8 characters.').max(72, 'Use at most 72 characters.');
const schema = z.object({ current: z.string().min(1, 'Enter your current password.'), password: newPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: "The passwords don't match." })
  .refine((v) => v.password !== v.current, { path: ['password'], message: 'Choose a password different from your current one.' });

/**
 * "Sign-in & security" for the signed-in user: change password (after re-checking the current one) and end sessions
 * on other devices or everywhere. Renders nothing in demo mode, where there is no real account.
 */
export function AccountSecurity({ tone }: { tone: Tone }) {
  const { status } = useAuth();
  if (status !== 'signed-in') return null;
  const s = styles[tone];
  return (
    <section className={cx(s.card, 'p-5')} aria-labelledby="security-heading" data-testid="section-security">
      <h2 id="security-heading" className="text-lg font-semibold text-slate-900">Sign-in &amp; security</h2>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <ChangePassword tone={tone} />
        <Sessions tone={tone} />
      </div>
    </section>
  );
}

function ChangePassword({ tone }: { tone: Tone }) {
  const { client, me } = useAuth();
  const { toast } = useToast();
  const s = styles[tone];
  const [error, setError] = useState<string | null>(null);
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { current: '', password: '', confirm: '' } });
  const submit = f.handleSubmit(async (v) => {
    setError(null);
    // Supabase doesn't ask for the current password, so prove it first by signing in again with it.
    const check = await client!.auth.signInWithPassword({ email: me!.email, password: v.current });
    if (check.error) {
      if (check.error.code === 'invalid_credentials') f.setError('current', { message: 'Your current password is incorrect.' });
      else setError(authErrorMessage(check.error));
      return;
    }
    const { error: e } = await client!.auth.updateUser({ password: v.password });
    if (e) { setError(authErrorMessage(e)); return; }
    f.reset();
    toast({ title: 'Password changed', description: 'Use your new password next time you sign in.' });
  });
  return (
    <form onSubmit={submit} noValidate className="space-y-4" data-testid="form-change-password">
      <div className="flex items-center gap-3">
        <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', s.icon)}><KeyRound className="h-5 w-5" /></span>
        <div><h3 className="font-semibold text-slate-900">Change password</h3><p className="text-sm text-slate-500">At least 8 characters.</p></div>
      </div>
      {error && <p role="alert" data-testid="text-password-error" className="rounded-xl border border-red-200 bg-[#FEF2F2] px-3.5 py-2.5 text-sm text-red-800">{error}</p>}
      <Field label="Current password" error={f.formState.errors.current?.message}>
        <input {...f.register('current')} type="password" autoComplete="current-password" data-testid="input-current-password" className={inputCls} />
      </Field>
      <Field label="New password" error={f.formState.errors.password?.message}>
        <input {...f.register('password')} type="password" autoComplete="new-password" data-testid="input-new-password" className={inputCls} />
      </Field>
      <Field label="Confirm new password" error={f.formState.errors.confirm?.message}>
        <input {...f.register('confirm')} type="password" autoComplete="new-password" data-testid="input-confirm-password" className={inputCls} />
      </Field>
      <button type="submit" disabled={f.formState.isSubmitting} data-testid="button-change-password" className={s.primary}>
        {f.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}{f.formState.isSubmitting ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}

function Sessions({ tone }: { tone: Tone }) {
  const { signOut, signOutOthers } = useAuth();
  const { toast } = useToast();
  const s = styles[tone];
  const [busy, setBusy] = useState<'others' | 'all' | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const others = async () => {
    setBusy('others');
    try {
      await signOutOthers();
      toast({ title: 'Signed out of other devices', description: 'Other devices are signed out within the hour, when their current session expires.' });
    } catch { toast({ title: "Couldn't sign out other devices", description: 'Please try again.', variant: 'destructive' }); }
    setBusy(null);
  };
  const everywhere = async () => {
    setBusy('all');
    try { await signOut('global'); } catch {
      setBusy(null); setConfirmAll(false);
      toast({ title: "Couldn't sign out everywhere", description: 'Please try again.', variant: 'destructive' });
    }
  };
  return (
    <div className="space-y-4" data-testid="panel-sessions">
      <div className="flex items-center gap-3">
        <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', s.icon)}><MonitorSmartphone className="h-5 w-5" /></span>
        <div><h3 className="font-semibold text-slate-900">Devices</h3><p className="text-sm text-slate-500">Lost a device or signed in somewhere shared?</p></div>
      </div>
      <div className="flex flex-wrap gap-3">
        <button onClick={others} disabled={busy !== null} data-testid="button-sign-out-others" className={s.secondary}>
          {busy === 'others' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}Sign out of other devices
        </button>
        <button onClick={() => setConfirmAll(true)} disabled={busy !== null} data-testid="button-sign-out-everywhere" className={s.secondary}>
          <LogOut className="h-4 w-4" />Sign out everywhere
        </button>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">Other devices can't sign back in without your password. One that's open right now is signed out within an hour. If you think someone else knows your password, change it too.</p>
      <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600" data-testid="text-2fa-soon">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />Two-factor sign-in with an authenticator app is coming soon.
      </div>
      <Modal open={confirmAll} onClose={() => busy === null && setConfirmAll(false)} title="Sign out everywhere?" testid="dialog-sign-out-everywhere">
        <p className="text-sm text-slate-600">This signs you out on every device, including this one. You'll need your password to sign back in.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button onClick={() => setConfirmAll(false)} disabled={busy !== null} data-testid="button-cancel-everywhere" className={s.secondary}>Cancel</button>
          <button onClick={everywhere} disabled={busy !== null} data-testid="button-confirm-everywhere" className={s.danger}>
            {busy === 'all' && <Loader2 className="h-4 w-4 animate-spin" />}Sign out everywhere
          </button>
        </div>
      </Modal>
    </div>
  );
}
