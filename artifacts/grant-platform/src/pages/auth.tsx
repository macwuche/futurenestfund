import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2, MailCheck } from 'lucide-react';
import { cx, Field, inputCls } from '@/components/bits';
import { appUrl, useAuth } from '@/lib/auth';
import { authErrorMessage } from '@/lib/auth-errors';
import { safeNext } from '@/lib/safe-next';
import { useToast } from '@/hooks/use-toast';

const primaryBtn = 'press inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#1E3A8A] px-5 py-3 text-[15px] font-semibold text-white hover:bg-[#0F172A] disabled:opacity-60';
const linkCls = 'font-semibold text-[#1E3A8A] hover:underline';

const email = z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.').max(254);
// Supabase hashes passwords with bcrypt, which only reads the first 72 bytes.
const newPassword = z.string().min(8, 'Use at least 8 characters.').max(72, 'Use at most 72 characters.');


function Mark() {
  return (
    <div className="mb-8 flex items-center justify-center gap-1" aria-label="GrantApp">
      <svg viewBox="0 0 28 24" className="h-7 w-8" aria-hidden="true">
        <path d="M1 3h6l6 13L22.5 1H27L14.5 23h-3z" fill="#1E3A8A" />
        <path d="M7 3h3.5l5 10.5-2 3.5z" fill="#3B82F6" />
      </svg>
      <span className="text-2xl font-bold tracking-tight text-slate-900">GrantApp</span>
    </div>
  );
}

export function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => { document.title = `${title} · GrantApp`; }, [title]);
  return (
    <div className="theme-user flex min-h-[100dvh] flex-col items-center justify-center bg-[#F3F4F6] px-4 py-10">
      <main id="main" className="w-full max-w-[420px]">
        <Mark />
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold text-slate-900" data-testid="text-auth-title">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>}
      </main>
    </div>
  );
}

function FormError({ message, testid = 'text-auth-error' }: { message: string | null; testid?: string }) {
  if (!message) return null;
  return <p role="alert" data-testid={testid} className="rounded-xl border border-red-200 bg-[#FEF2F2] px-3.5 py-2.5 text-sm text-red-800">{message}</p>;
}

function PasswordInput({ testid, autoComplete, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { testid: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...rest} type={shown ? 'text' : 'password'} autoComplete={autoComplete} data-testid={testid} className={cx(inputCls, 'pr-11')} />
      <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide password' : 'Show password'} data-testid={`${testid}-toggle`}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-500 hover:text-slate-800">
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Submit({ busy, children, testid }: { busy: boolean; children: ReactNode; testid: string }) {
  return (
    <button type="submit" disabled={busy} data-testid={testid} className={primaryBtn}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}{children}
    </button>
  );
}

/* ---------- sign in ---------- */
const signInSchema = z.object({ email, password: z.string().min(1, 'Enter your password.') });

export function SignInPage() {
  const { client } = useAuth();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const next = safeNext(params.get('next'));
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [entering, setEntering] = useState(false);
  const f = useForm<z.infer<typeof signInSchema>>({ resolver: zodResolver(signInSchema), defaultValues: { email: '', password: '' } });
  const submit = f.handleSubmit(async (v) => {
    setError(null); setUnconfirmed(null); setResent(false);
    const { error: e } = await client!.auth.signInWithPassword({ email: v.email, password: v.password });
    if (e) {
      setError(authErrorMessage(e));
      if (e.code === 'email_not_confirmed') setUnconfirmed(v.email);
      return;
    }
    setEntering(true); // the auth provider picks up the session, then the router leaves this page
  });
  const resend = async () => {
    if (!unconfirmed) return;
    const { error: e } = await client!.auth.resend({ type: 'signup', email: unconfirmed, options: { emailRedirectTo: appUrl() } });
    if (e) setError(authErrorMessage(e)); else setResent(true);
  };
  const add = (href: string) => (next ? `${href}?next=${encodeURIComponent(next)}` : href);
  return (
    <AuthFrame title="Sign in" subtitle={next?.startsWith('/admin') ? 'Sign in with your administrator account.' : 'Welcome back. Sign in to your grant workspace.'}
      footer={<>New to GrantApp? <Link href={add('/sign-up')} className={linkCls} data-testid="link-sign-up">Create an account</Link></>}>
      <form onSubmit={submit} noValidate className="space-y-4" data-testid="form-sign-in">
        <FormError message={error} />
        {unconfirmed && (resent
          ? <p className="text-sm text-[#166534]" data-testid="text-confirmation-resent">We've sent a new confirmation link to {unconfirmed}.</p>
          : <button type="button" onClick={resend} className={cx(linkCls, 'text-sm')} data-testid="button-resend-confirmation">Resend the confirmation email</button>)}
        <Field label="Email" error={f.formState.errors.email?.message}>
          <input {...f.register('email')} type="email" autoComplete="email" inputMode="email" autoFocus data-testid="input-email" className={inputCls} />
        </Field>
        <Field label="Password" error={f.formState.errors.password?.message}>
          <PasswordInput {...f.register('password')} autoComplete="current-password" testid="input-password" />
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className={cx(linkCls, 'text-sm')} data-testid="link-forgot-password">Forgot password?</Link>
        </div>
        <Submit busy={f.formState.isSubmitting || entering} testid="button-sign-in">Sign in</Submit>
      </form>
    </AuthFrame>
  );
}

/* ---------- sign up ---------- */
const signUpSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(100),
  organization: z.string().trim().max(160, 'Use at most 160 characters.'),
  email,
  password: newPassword,
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { path: ['confirm'], message: "The passwords don't match." });

export function SignUpPage() {
  const { client } = useAuth();
  const next = safeNext(new URLSearchParams(useSearch()).get('next'));
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const f = useForm<z.infer<typeof signUpSchema>>({ resolver: zodResolver(signUpSchema), defaultValues: { name: '', organization: '', email: '', password: '', confirm: '' } });
  const submit = f.handleSubmit(async (v) => {
    setError(null);
    const { data, error: e } = await client!.auth.signUp({
      email: v.email, password: v.password,
      options: { data: { name: v.name, organization: v.organization }, emailRedirectTo: appUrl() },
    });
    if (e) { setError(authErrorMessage(e)); return; }
    // With email confirmation on there is no session yet. (An address that's already registered gets the same
    // answer from Supabase, so this screen never reveals whether an account exists.)
    if (!data.session) setSentTo(v.email);
  });
  if (sentTo) {
    return (
      <AuthFrame title="Check your email" footer={<Link href="/sign-in" className={linkCls} data-testid="link-sign-in">Back to sign in</Link>}>
        <div className="text-center" data-testid="panel-check-email">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[#EEF4FB] text-[#1E3A8A]"><MailCheck className="h-7 w-7" /></span>
          <p className="text-sm text-slate-600">We've sent a confirmation link to <strong className="text-slate-900" data-testid="text-sent-to">{sentTo}</strong>. Open it to activate your account, then sign in.</p>
          <p className="mt-3 text-xs text-slate-500">Nothing there? Check your spam folder, or try signing in to get a new link.</p>
        </div>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Create your account" subtitle="Apply for grants and track your funding in one place."
      footer={<>Already have an account? <Link href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'} className={linkCls} data-testid="link-sign-in">Sign in</Link></>}>
      <form onSubmit={submit} noValidate className="space-y-4" data-testid="form-sign-up">
        <FormError message={error} />
        <Field label="Full name" error={f.formState.errors.name?.message}>
          <input {...f.register('name')} autoComplete="name" autoFocus data-testid="input-name" className={inputCls} />
        </Field>
        <Field label="Organization (optional)" error={f.formState.errors.organization?.message}>
          <input {...f.register('organization')} autoComplete="organization" data-testid="input-organization" className={inputCls} />
        </Field>
        <Field label="Email" error={f.formState.errors.email?.message}>
          <input {...f.register('email')} type="email" autoComplete="email" inputMode="email" data-testid="input-email" className={inputCls} />
        </Field>
        <Field label="Password" error={f.formState.errors.password?.message}>
          <PasswordInput {...f.register('password')} autoComplete="new-password" testid="input-password" />
        </Field>
        <Field label="Confirm password" error={f.formState.errors.confirm?.message}>
          <PasswordInput {...f.register('confirm')} autoComplete="new-password" testid="input-confirm" />
        </Field>
        <p className="text-xs text-slate-500">At least 8 characters. This is a preview with sample grants: don't upload real identity documents yet.</p>
        <Submit busy={f.formState.isSubmitting} testid="button-sign-up">Create account</Submit>
      </form>
    </AuthFrame>
  );
}

/* ---------- forgot password ---------- */
export function ForgotPasswordPage() {
  const { client } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const f = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email })), defaultValues: { email: '' } });
  const submit = f.handleSubmit(async (v) => {
    setError(null);
    const { error: e } = await client!.auth.resetPasswordForEmail(v.email, { redirectTo: appUrl('reset-password') });
    if (e) setError(authErrorMessage(e)); else setSentTo(v.email);
  });
  return (
    <AuthFrame title="Reset your password" subtitle={sentTo ? undefined : "Enter your email and we'll send you a link to choose a new password."}
      footer={<Link href="/sign-in" className={linkCls} data-testid="link-sign-in">Back to sign in</Link>}>
      {sentTo ? (
        <p className="text-sm text-slate-600" data-testid="text-reset-sent">If an account exists for <strong className="text-slate-900">{sentTo}</strong>, you'll get an email with a reset link shortly. The link works once and expires after an hour.</p>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4" data-testid="form-forgot">
          <FormError message={error} />
          <Field label="Email" error={f.formState.errors.email?.message}>
            <input {...f.register('email')} type="email" autoComplete="email" inputMode="email" autoFocus data-testid="input-email" className={inputCls} />
          </Field>
          <Submit busy={f.formState.isSubmitting} testid="button-send-reset">Send reset link</Submit>
        </form>
      )}
    </AuthFrame>
  );
}

/* ---------- choose a new password (after the reset link) ---------- */
const resetSchema = z.object({ password: newPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: "The passwords don't match." });

export function ResetPasswordPage() {
  const { client, status, recovering, finishRecovery } = useAuth();
  const [, nav] = useLocation();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const f = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirm: '' } });
  if (status !== 'signed-in' || !recovering) {
    return (
      <AuthFrame title="Link expired" footer={<Link href="/sign-in" className={linkCls} data-testid="link-sign-in">Back to sign in</Link>}>
        <p className="text-sm text-slate-600" data-testid="text-reset-invalid">This password reset link is invalid or has expired. Links work once and only for an hour.</p>
        <Link href="/forgot-password" className={cx(primaryBtn, 'mt-5')} data-testid="link-forgot-password">Request a new link</Link>
      </AuthFrame>
    );
  }
  const submit = f.handleSubmit(async (v) => {
    setError(null);
    const { error: e } = await client!.auth.updateUser({ password: v.password });
    if (e) { setError(authErrorMessage(e)); return; }
    // A reset usually means the old password can't be trusted: end every other session.
    await client!.auth.signOut({ scope: 'others' }).catch(() => {});
    finishRecovery();
    toast({ title: 'Password updated', description: "You're signed in with your new password and signed out everywhere else." });
    nav('/');
  });
  return (
    <AuthFrame title="Choose a new password">
      <form onSubmit={submit} noValidate className="space-y-4" data-testid="form-reset">
        <FormError message={error} />
        <Field label="New password" error={f.formState.errors.password?.message}>
          <PasswordInput {...f.register('password')} autoComplete="new-password" autoFocus testid="input-password" />
        </Field>
        <Field label="Confirm new password" error={f.formState.errors.confirm?.message}>
          <PasswordInput {...f.register('confirm')} autoComplete="new-password" testid="input-confirm" />
        </Field>
        <Submit busy={f.formState.isSubmitting} testid="button-save-password">Save new password</Submit>
      </form>
    </AuthFrame>
  );
}

/* ---------- email link landing page ---------- */
const OTP_TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const;
type OtpType = (typeof OTP_TYPES)[number];

/**
 * Where every email link lands: /auth/confirm?token_hash=…&type=…&next=…. The one-time hash is exchanged here with
 * verifyOtp (only on a real page load with JavaScript, so mail scanners that pre-fetch links don't use it up), then the
 * address bar is cleaned and the user moves on: a reset link to "choose a new password", everything else to `next`.
 */
export function ConfirmPage() {
  const { client, status, recovering } = useAuth();
  const [, nav] = useLocation();
  const params = new URLSearchParams(useSearch());
  const tokenHash = params.get('token_hash');
  const type = params.get('type') as OtpType | null;
  const next = safeNext(params.get('next'));
  const [state, setState] = useState<'working' | 'verified' | 'failed'>('working');
  const started = useRef(false);
  const target = useRef<string>('/');
  useEffect(() => {
    if (started.current) return; // the hash works once, so never send it twice (React dev mode runs effects twice)
    started.current = true;
    if (!tokenHash || !type || !OTP_TYPES.includes(type)) { setState('failed'); return; }
    window.history.replaceState(null, '', `${import.meta.env.BASE_URL}auth/confirm`); // keep the hash out of history
    target.current = type === 'recovery' ? '/reset-password' : next ?? '/';
    void client!.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => setState(error ? 'failed' : 'verified'));
  }, [client, tokenHash, type, next]);
  // Move on only once the new session is fully loaded, so the next page doesn't flash a signed-out state.
  useEffect(() => {
    if (state === 'verified' && status === 'signed-in' && (target.current !== '/reset-password' || recovering)) nav(target.current, { replace: true });
  }, [state, status, recovering, nav]);
  if (state !== 'failed') return <AuthLoading />;
  return (
    <AuthFrame title="This link has expired" footer={<Link href="/sign-in" className={linkCls} data-testid="link-sign-in">Back to sign in</Link>}>
      <p className="text-sm text-slate-600" data-testid="text-confirm-failed">Email links work once and only for a limited time. If you've already used it, just sign in. Otherwise, request a new one.</p>
      <div className="mt-5 grid gap-3">
        <Link href="/sign-in" className={primaryBtn} data-testid="link-confirm-sign-in">Sign in</Link>
        <Link href="/forgot-password" className={cx(linkCls, 'text-center text-sm')} data-testid="link-confirm-forgot">Reset your password instead</Link>
      </div>
    </AuthFrame>
  );
}

/* ---------- full-page states ---------- */
export function AuthLoading() {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-[#F3F4F6]" data-testid="state-auth-loading" aria-busy="true">
      <Loader2 className="h-7 w-7 animate-spin text-[#1E3A8A]" aria-label="Loading" />
    </div>
  );
}

export function AuthUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <AuthFrame title="Can't reach GrantApp">
      <p className="text-sm text-slate-600" data-testid="text-auth-unavailable">We couldn't check your sign-in. Check your connection and try again.</p>
      <button onClick={onRetry} className={cx(primaryBtn, 'mt-5')} data-testid="button-auth-retry">Try again</button>
    </AuthFrame>
  );
}
