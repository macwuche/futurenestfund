import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAuthConfigQueryKey, getGetEmailSettingsQueryKey, useCheckEmailHealth, useGetEmailSettings, useRemoveEmailSecret, useSendTestEmail, useUpdateEmailSettings,
  type EmailHealth, type EmailHealthCheck, type EmailSecretStatus, type EmailSettings, type EmailSettingsUpdate, type EmailSettingValue, type EmailTestResult,
} from '@workspace/api-client-react';
import { AlertTriangle, Check, CheckCircle2, Circle, Copy, KeyRound, Loader2, Mail, RefreshCw, Send, XCircle } from 'lucide-react';
import { Field, cx } from '@/components/bits';
import { ainput, card, dark, ghost, lime, SectionTitle } from '@/components/admin-bits';
import { apiError } from '@/lib/demo-state';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';

/**
 * Admin Settings → Email: Resend API key, sender, reply-to, support address, signature and the Supabase Send Email Hook,
 * with health checks and a test email. Secrets are write-only: the API only ever returns a hint like `re_••••abcd`.
 * A value saved here wins over the server environment; the source of each value is shown next to it.
 */

const SIGNATURE_MAX = 600;
type Text = 'fromName' | 'fromAddress' | 'replyTo' | 'supportEmail' | 'signature';
const TEXT_FIELDS: Text[] = ['fromName', 'fromAddress', 'replyTo', 'supportEmail', 'signature'];
const settingsOnly = (v: EmailSettingValue) => (v.source === 'settings' ? v.value ?? '' : '');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '');

function SourceNote({ v, envLabel = 'server environment' }: { v: EmailSettingValue; envLabel?: string }) {
  if (v.source !== 'environment') return null;
  return <span className="mt-1 block text-xs text-slate-500">In use from the {envLabel}: <b className="font-medium text-slate-700">{v.value}</b>. Enter a value to replace it.</span>;
}

export function EmailSettingsCard() {
  const q = useGetEmailSettings();
  const s = q.data;
  return (
    <section className={cx(card, 'p-5 lg:col-span-2')} data-testid="card-email-settings">
      <SectionTitle action={s && <SendingBadge s={s} />}>Email</SectionTitle>
      {!s ? (
        q.isError ? <p className="text-sm text-red-700">The email settings couldn't be loaded. <button className="underline" onClick={() => void q.refetch()}>Try again</button></p>
          : <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            Every email GrantApp sends goes through <b>Resend</b>: sign-up and password emails from Supabase, and notifications about applications and money requests.
            {s.from ? <> Emails are sent from <b className="break-all" data-testid="text-email-from">{s.from}</b>.</> : ' Add an API key and a sender address to start sending.'}
          </p>
          {!s.canStoreSecrets && (
            <p role="note" data-testid="text-email-no-encryption" className="mb-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Keys can't be saved here yet: {s.encryptionProblem} Add it to the server's <code className="rounded bg-white/70 px-1">api.env</code> and restart the API. The other settings can be saved now.</span>
            </p>
          )}
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              <SecretField name="resendApiKey" label="Resend API key" status={s.apiKey} canStore={s.canStoreSecrets}
                placeholder="re_…" help="Resend → API Keys → Create API key. A key with “Sending access” is enough." />
              <SenderForm s={s} />
            </div>
            <div className="space-y-6">
              <HealthPanel />
              <HookPanel s={s} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function SendingBadge({ s }: { s: EmailSettings }) {
  return (
    <span data-testid="status-email-sending" className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
      s.sending ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600')}>
      <span className={cx('h-1.5 w-1.5 rounded-full', s.sending ? 'bg-emerald-500' : 'bg-slate-400')} />{s.sending ? 'Email on' : 'Email off'}
    </span>
  );
}

function useSettingsUpdated() {
  const qc = useQueryClient();
  return (data: EmailSettings) => {
    qc.setQueryData(getGetEmailSettingsQueryKey(), data);
    void qc.invalidateQueries({ queryKey: getGetAuthConfigQueryKey() });
  };
}

/** A write-only secret: shows a hint and where it comes from; Replace opens a password field. */
function SecretField({ name, label, status, canStore, placeholder, help }: {
  name: 'resendApiKey' | 'hookSecret'; label: string; status: EmailSecretStatus; canStore: boolean; placeholder: string; help: ReactNode;
}) {
  const update = useUpdateEmailSettings();
  const remove = useRemoveEmailSecret();
  const updated = useSettingsUpdated();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const id = name === 'resendApiKey' ? 'api-key' : 'hook-secret';
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return setErr(`Paste the ${label.toLowerCase()}.`);
    const body: EmailSettingsUpdate = name === 'resendApiKey' ? { apiKey: value.trim() } : { hookSecret: value.trim() };
    update.mutate({ data: body }, {
      onSuccess: (d) => { updated(d); setEditing(false); setValue(''); setErr(''); toast({ title: `${label} saved`, description: 'It is encrypted on the server and in use now.' }); },
      onError: (e2) => setErr(apiError(e2, `The ${label.toLowerCase()} couldn't be saved.`)),
    });
  };
  const doRemove = () => remove.mutate({ name }, {
    onSuccess: (d) => { updated(d); setConfirmRemove(false); toast({ title: `${label} removed` }); },
    onError: () => toast({ title: `The ${label.toLowerCase()} couldn't be removed`, variant: 'destructive' }),
  });
  const sourceText = status.unreadable ? "Saved, but can't be decrypted: enter it again"
    : status.source === 'settings' ? `Saved in Settings${status.updatedBy ? ` by ${status.updatedBy}` : ''}${status.updatedAt ? `, ${when(status.updatedAt)}` : ''}`
      : status.source === 'environment' ? 'From the server environment (api.env)' : 'Not set';
  return (
    <div data-testid={`secret-${id}`}>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <KeyRound className="h-4 w-4 shrink-0 text-slate-500" />
        <div className="min-w-[10rem] flex-1">
          <p className="font-mono text-sm text-slate-900" data-testid={`text-${id}-hint`}>{status.hint ?? '—'}</p>
          <p className={cx('text-xs', status.unreadable ? 'text-red-700' : 'text-slate-500')} data-testid={`text-${id}-source`}>{sourceText}</p>
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={ghost} disabled={!canStore} data-testid={`button-${id}-edit`} onClick={() => { setEditing(true); setConfirmRemove(false); }}>
              {status.set || status.unreadable ? 'Replace' : 'Add'}
            </button>
            {(status.source === 'settings' || status.unreadable) && (
              <button type="button" className="press rounded-lg px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" data-testid={`button-${id}-remove`} onClick={() => setConfirmRemove(true)}>Remove</button>
            )}
          </div>
        )}
      </div>
      {confirmRemove && (
        <div role="alertdialog" aria-label={`Remove the ${label.toLowerCase()}?`} className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-testid={`confirm-${id}-remove`}>
          <p>Remove the saved {label.toLowerCase()}? {name === 'resendApiKey' ? 'Email stops unless the server environment has a key.' : 'Supabase hook calls are refused unless the server environment has a secret.'}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="press rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60" disabled={remove.isPending} onClick={doRemove} data-testid={`button-${id}-remove-confirm`}>
              {remove.isPending ? 'Removing…' : 'Remove'}
            </button>
            <button type="button" className={ghost} onClick={() => setConfirmRemove(false)}>Keep it</button>
          </div>
        </div>
      )}
      {editing && (
        <form onSubmit={save} className="mt-2 space-y-2" data-testid={`form-${id}`}>
          <input type="password" autoComplete="off" spellCheck={false} autoFocus aria-label={`New ${label.toLowerCase()}`} placeholder={placeholder}
            value={value} onChange={(e) => { setValue(e.target.value); setErr(''); }} className={cx(ainput, 'font-mono')} data-testid={`input-${id}`} />
          {err && <p role="alert" className="text-xs text-red-700" data-testid={`error-${id}`}>{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button className={dark} disabled={update.isPending} data-testid={`button-${id}-save`}>{update.isPending ? 'Saving…' : `Save ${label.toLowerCase()}`}</button>
            <button type="button" className={ghost} onClick={() => { setEditing(false); setValue(''); setErr(''); }}>Cancel</button>
          </div>
        </form>
      )}
      <p className="mt-1.5 text-xs text-slate-500">{help} Once saved it can't be shown again, only replaced.</p>
    </div>
  );
}

function SenderForm({ s }: { s: EmailSettings }) {
  const update = useUpdateEmailSettings();
  const updated = useSettingsUpdated();
  const { toast } = useToast();
  const initial = () => Object.fromEntries(TEXT_FIELDS.map((f) => [f, settingsOnly(s[f])])) as Record<Text, string>;
  const [form, setForm] = useState<Record<Text, string>>(initial);
  const [err, setErr] = useState('');
  useEffect(() => { setForm(initial()); }, [s.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (f: Text) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setForm((v) => ({ ...v, [f]: e.target.value })); setErr(''); };
  const dirty = TEXT_FIELDS.some((f) => form[f] !== settingsOnly(s[f]));
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.signature.length > SIGNATURE_MAX) return setErr(`The signature can be up to ${SIGNATURE_MAX} characters.`);
    const data = Object.fromEntries(TEXT_FIELDS.map((f) => [f, form[f].trim() ? form[f] : null])) as EmailSettingsUpdate;
    update.mutate({ data }, {
      onSuccess: (d) => { updated(d); toast({ title: 'Email settings saved', description: 'They apply to every email from now on.' }); },
      onError: (e2) => setErr(apiError(e2, "The email settings couldn't be saved.")),
    });
  };
  const previewName = form.fromName.trim() || s.fromName.value || 'GrantApp';
  const previewAddress = form.fromAddress.trim() || s.fromAddress.value || 'no-reply@your-domain.org';
  const previewSupport = form.supportEmail.trim() || s.supportEmail.value;
  const signature = form.signature.trim();
  const sigLines = signature.split('\n').length;
  return (
    <form onSubmit={save} noValidate className="space-y-4" data-testid="form-email-sender">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sender name">
          <input className={ainput} maxLength={80} placeholder={s.fromName.value ?? 'Future Nest Fund'} value={form.fromName} onChange={set('fromName')} data-testid="input-email-from-name" />
          <SourceNote v={s.fromName} />
        </Field>
        <Field label="Sender address">
          <input className={ainput} type="email" autoComplete="off" placeholder={s.fromAddress.value ?? 'no-reply@mail.futurenestfund.org'} value={form.fromAddress} onChange={set('fromAddress')} data-testid="input-email-from-address" />
          <SourceNote v={s.fromAddress} />
        </Field>
        <Field label="Reply-to (optional)">
          <input className={ainput} type="email" autoComplete="off" placeholder={s.replyTo.value ?? 'Replies go to the sender address'} value={form.replyTo} onChange={set('replyTo')} data-testid="input-email-reply-to" />
          <SourceNote v={s.replyTo} />
        </Field>
        <Field label="Support address">
          <input className={ainput} type="email" autoComplete="off" placeholder={s.supportEmail.value ?? 'help@futurenestfund.org'} value={form.supportEmail} onChange={set('supportEmail')} data-testid="input-email-support" />
          <SourceNote v={s.supportEmail} />
        </Field>
      </div>
      <p className="-mt-1 text-xs text-slate-500">The sender address must be on a domain verified in Resend. The support address appears in every email's footer and in the applicants' Help Centre.</p>
      <Field label="Signature">
        <textarea className={cx(ainput, 'min-h-[7rem] resize-y')} rows={4} maxLength={SIGNATURE_MAX + 50} value={form.signature} onChange={set('signature')}
          placeholder={'Future Nest Fund\nGrants team\nfuturenestfund.org'} data-testid="input-email-signature" />
      </Field>
      <p className={cx('-mt-2 text-xs', form.signature.length > SIGNATURE_MAX || sigLines > 10 ? 'text-red-700' : 'text-slate-500')} data-testid="text-signature-count">
        {form.signature.length}/{SIGNATURE_MAX} characters · {signature ? sigLines : 0}/10 lines. Plain text: added under every email.
      </p>

      <div aria-label="Email preview" className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100" data-testid="email-preview">
        <p className="border-b border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">Preview</span> · From: <span className="break-all">{previewName} &lt;{previewAddress}&gt;</span>
        </p>
        <div className="p-3 sm:p-4">
          <p className="mb-2 text-sm font-bold text-slate-900">GrantApp</p>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <p className="mb-2 text-base font-bold text-slate-900">Withdrawal approved</p>
            <p>Hi Jane, your withdrawal of $1,250.00 (ref ABC12345) was approved. Your funds are on their way.</p>
            {signature && <p className="mt-4 whitespace-pre-line border-t border-slate-200 pt-3 text-slate-700" data-testid="preview-signature">{signature}</p>}
          </div>
          <p className="mt-2 text-xs text-slate-500">Sent by GrantApp to jane@example.org. If you didn't expect this email, you can ignore it.{previewSupport && <> Questions? Write to <span className="text-[#1E3A8A]">{previewSupport}</span>.</>}</p>
        </div>
      </div>

      {err && <p role="alert" className="text-sm text-red-700" data-testid="error-email-settings">{err}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button className={lime} disabled={!dirty || update.isPending} data-testid="button-email-settings-save">
          {update.isPending ? 'Saving…' : 'Save email settings'}
        </button>
        {s.updatedAt && <span className="text-xs text-slate-500" data-testid="text-email-updated">Last saved {when(s.updatedAt)}{s.updatedBy ? ` by ${s.updatedBy}` : ''}</span>}
      </div>
    </form>
  );
}

const STATUS_ICON: Record<EmailHealthCheck['status'], ReactNode> = {
  ok: <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label="OK" />,
  warn: <AlertTriangle className="h-5 w-5 text-amber-600" aria-label="Needs attention" />,
  fail: <XCircle className="h-5 w-5 text-red-600" aria-label="Problem" />,
  off: <Circle className="h-5 w-5 text-slate-400" aria-label="Not set up" />,
};

function HealthPanel() {
  const check = useCheckEmailHealth();
  const test = useSendTestEmail();
  const { me } = useAuth();
  const [health, setHealth] = useState<EmailHealth | null>(null);
  const [to, setTo] = useState(me?.email ?? '');
  const [result, setResult] = useState<EmailTestResult | null>(null);
  const [testErr, setTestErr] = useState('');
  const run = () => check.mutate(undefined, { onSuccess: setHealth });
  useEffect(run, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sendTest = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null); setTestErr('');
    if (!to.trim()) return setTestErr('Enter the address to send the test email to.');
    test.mutate({ data: { to: to.trim() } }, {
      onSuccess: (r) => { setResult(r); run(); },
      onError: (e2) => setTestErr(apiError(e2, "The test email couldn't be sent.")),
    });
  };
  return (
    <div className="rounded-xl border border-slate-200 p-4" data-testid="panel-email-health">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">Health checks</h3>
        <button type="button" className={cx(ghost, 'inline-flex items-center gap-1.5 px-3')} onClick={run} disabled={check.isPending} data-testid="button-email-check">
          {check.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Run checks
        </button>
      </div>
      {!health ? (
        check.isError ? <p className="text-sm text-red-700">The checks couldn't run. Try again.</p>
          : <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Checking…</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100" data-testid="list-email-checks">
            {health.checks.map((c) => (
              <li key={c.id} className="flex gap-3 py-2.5" data-testid={`check-${c.id}`} data-status={c.status}>
                <span className="mt-0.5 shrink-0">{STATUS_ICON[c.status]}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{c.label}</p>
                  <p className="break-words text-xs leading-relaxed text-slate-600">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          {health.domain && health.domain.records.length > 0 && (
            <div className="mt-2 overflow-x-auto" data-testid="table-email-dns">
              <table className="w-full min-w-[22rem] text-left text-xs">
                <caption className="mb-1 text-left text-xs font-semibold text-slate-700">DNS records for {health.domain.name}</caption>
                <thead className="text-slate-500"><tr><th className="py-1 pr-2 font-semibold">Record</th><th className="py-1 pr-2 font-semibold">Type</th><th className="py-1 pr-2 font-semibold">Name</th><th className="py-1 font-semibold">Status</th></tr></thead>
                <tbody>
                  {health.domain.records.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2">{r.record}</td><td className="py-1.5 pr-2">{r.type}</td><td className="break-all py-1.5 pr-2 font-mono">{r.name}</td>
                      <td className={cx('py-1.5 font-semibold', r.status === 'verified' ? 'text-emerald-700' : 'text-amber-700')}>{r.status.replace(/_/g, ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500" data-testid="text-email-outbox">
            Outbox: {health.outbox.waiting} waiting · {health.outbox.sentLast24h} sent in 24 h · {health.outbox.failed} gave up in 7 days. Checked {when(health.checkedAt)}.
          </p>
        </>
      )}
      <form onSubmit={sendTest} noValidate className="mt-4 border-t border-slate-100 pt-4" data-testid="form-email-test">
        <label htmlFor="email-test-to" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Send a test email</label>
        <div className="flex flex-wrap gap-2">
          <input id="email-test-to" type="email" className={cx(ainput, 'min-w-0 flex-1 basis-48')} placeholder="you@example.org" value={to}
            onChange={(e) => { setTo(e.target.value); setTestErr(''); }} data-testid="input-email-test-to" />
          <button className={cx(dark, 'inline-flex items-center gap-1.5')} disabled={test.isPending} data-testid="button-email-test">
            {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send test
          </button>
        </div>
        {testErr && <p role="alert" className="mt-2 text-xs text-red-700" data-testid="error-email-test">{testErr}</p>}
        {result && (
          <p role="status" data-testid="text-email-test-result" data-ok={result.ok}
            className={cx('mt-2 flex gap-2 rounded-lg p-2.5 text-xs', result.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900')}>
            {result.ok ? <Check className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}<span className="break-words">{result.message}</span>
          </p>
        )}
      </form>
    </div>
  );
}

function HookPanel({ s }: { s: EmailSettings }) {
  const { toast } = useToast();
  const copy = async () => {
    if (!s.hookUrl) return;
    try { await navigator.clipboard.writeText(s.hookUrl); toast({ title: 'Hook URL copied' }); }
    catch { toast({ title: 'Copy failed: select the address and copy it', variant: 'destructive' }); }
  };
  return (
    <div className="rounded-xl border border-slate-200 p-4" data-testid="panel-email-hook">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-900"><Mail className="h-4 w-4" />Supabase sign-in emails</h3>
      <p className="mb-3 text-xs leading-relaxed text-slate-600">
        Without this, Supabase sends sign-up and password-reset emails itself, a few per hour at most and without your sender or signature.
        In Supabase → Authentication → Hooks → <b>Send Email</b>, choose HTTPS, paste this URL, generate a secret and save it below.
      </p>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Hook URL</p>
      {s.hookUrl ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <code className="min-w-0 flex-1 break-all text-xs" data-testid="text-email-hook-url">{s.hookUrl}</code>
          <button type="button" onClick={() => void copy()} className={cx(ghost, 'inline-flex shrink-0 items-center gap-1 px-2.5 py-1.5 text-xs')} data-testid="button-email-hook-copy">
            <Copy className="h-3.5 w-3.5" />Copy
          </button>
        </div>
      ) : <p className="mb-4 text-xs text-red-700">APP_URL isn't set on the server, so there's no public hook URL yet.</p>}
      <SecretField name="hookSecret" label="Hook secret" status={s.hookSecret} canStore={s.canStoreSecrets} placeholder="v1,whsec_…"
        help="Shown by Supabase when you create the hook, starting with v1,whsec_." />
    </div>
  );
}
