import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAdminMailSetup, useConnectAdminMailDomain, useForgetAdminMailDomain, useVerifyAdminMailDomain, useGetAdminMailDns, useSetupAdminMailWebhook,
  useRemoveAdminMailWebhook, useCreateAdminMailbox, useUpdateAdminMailbox, useDeleteAdminMailbox, useUploadAdminMailSignatureLogo, useStartAdminMailRoundTrip,
  getAdminMailRoundTrip, getGetAdminMailSetupQueryKey, getGetAdminMailDnsQueryKey, getListAdminMailboxesQueryKey,
  type MailSetup, type Mailbox, type MailSignature, type MailDnsHealth, type MailDomainInputRegion,
} from '@workspace/api-client-react';
import { Check, CheckCircle2, CircleAlert, CircleDashed, Copy, Globe, ImageUp, Inbox, Loader2, Mail, Pencil, Plus, RefreshCw, Send, Trash2, Webhook, XCircle } from 'lucide-react';
import { ErrorState, Field, Modal, Skel, cx } from '@/components/bits';
import { ainput, card, dark, ghost, lime, SectionTitle } from '@/components/admin-bits';
import { brandPalette, normalizeHex } from '@/lib/brand-colors';
import { useBranding } from '@/lib/branding';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/**
 * Settings → Email, the Mail box part (Phase 14, email.md §4): a setup checklist, the domain and its DNS records with
 * live checks, receiving (the Resend webhook), mailboxes with their signatures, and a round-trip test. The Resend key
 * itself is saved in the "Sending and sender" card below (EmailSettingsCard), shared with system emails.
 */

type Tone = 'ok' | 'warn' | 'fail' | 'off';
const TONE: Record<Tone, { icon: typeof Check; cls: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-green-700' }, warn: { icon: CircleAlert, cls: 'text-amber-600' }, fail: { icon: XCircle, cls: 'text-red-700' }, off: { icon: CircleDashed, cls: 'text-slate-400' },
};
const ToneIcon = ({ tone, className }: { tone: Tone; className?: string }) => { const T = TONE[tone]; return <T.icon className={cx('h-5 w-5 shrink-0', T.cls, className)} aria-label={tone} />; };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');

function useSetupRefresh() {
  const qc = useQueryClient();
  return (data?: MailSetup) => {
    if (data) qc.setQueryData(getGetAdminMailSetupQueryKey(), data);
    void qc.invalidateQueries({ queryKey: getGetAdminMailSetupQueryKey() });
    void qc.invalidateQueries({ queryKey: getListAdminMailboxesQueryKey() });
  };
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={`Copy ${label}`} title="Copy" onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }); }}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100">{done ? <Check className="h-4 w-4 text-green-700" /> : <Copy className="h-4 w-4" />}</button>
  );
}

export function MailSetupCard() {
  const q = useGetAdminMailSetup({ query: { queryKey: getGetAdminMailSetupQueryKey(), refetchInterval: 30_000 } });
  if (q.isLoading) return <section className={cx(card, 'p-5')}><Skel className="h-6 w-48" /><Skel className="mt-4 h-40 w-full" /></section>;
  if (q.isError || !q.data) return <ErrorState message={apiError(q.error, "The mail setup couldn't be loaded.")} onRetry={() => void q.refetch()} />;
  const s = q.data;
  return (
    <div className="space-y-5" data-testid="mail-setup">
      <Checklist s={s} />
      <DomainCard s={s} />
      <ReceivingCard s={s} />
      <MailboxesCard s={s} />
      <RoundTripCard s={s} />
    </div>
  );
}

/* ------------------------------------------------------------------ checklist */

function Checklist({ s }: { s: MailSetup }) {
  const verified = s.resend?.status === 'verified';
  const receiving = s.resend?.receiving === 'enabled';
  const steps: { tone: Tone; title: string; detail: ReactNode; anchor: string }[] = [
    {
      tone: s.keyAccess === 'full' ? 'ok' : s.keyAccess === 'sending' ? 'warn' : s.keyAccess === 'missing' ? 'off' : 'fail', title: 'Connect Resend', anchor: '#card-email-settings',
      detail: { full: 'Full-access key saved.', sending: "The key can only send: create a full-access key so the domain and webhook can be managed from here.", missing: 'Save your Resend API key in "Sending and sender" below.', invalid: 'Resend refused the key. Save a new one below.', unreachable: "Resend couldn't be reached. Try again in a minute." }[s.keyAccess],
    },
    { tone: s.domain ? (verified ? 'ok' : 'warn') : 'off', title: 'Add your domain', anchor: '#mail-domain', detail: s.domain ? `${s.domain.name}: ${verified ? 'verified' : (s.resend?.status ?? 'unknown').replace(/_/g, ' ')}` : 'Enter the domain mail is sent from and received at.' },
    { tone: !s.domain ? 'off' : verified ? 'ok' : 'warn', title: 'Add the DNS records', anchor: '#mail-domain', detail: !s.domain ? 'After the domain is added.' : verified ? 'All records verified by Resend.' : 'Copy each record to your DNS provider, then press Verify.' },
    { tone: s.webhook && s.webhookSecret.set && receiving ? 'ok' : s.webhook ? 'warn' : 'off', title: 'Turn on receiving', anchor: '#mail-receiving', detail: s.webhook ? `Webhook to ${s.webhook.endpoint}${receiving ? '' : '; receiving is off on the domain'}` : 'Create the webhook that brings received mail in.' },
    { tone: s.mailboxes.length ? 'ok' : 'off', title: 'Create addresses', anchor: '#mail-mailboxes', detail: s.mailboxes.length ? s.mailboxes.map((m) => m.address).join(', ') : 'For example support@.' },
    { tone: s.inbound.receivedLast24h > 0 || s.inbound.lastStatus === 'done' ? 'ok' : 'off', title: 'Test it', anchor: '#mail-test', detail: s.inbound.lastCallAt ? `Last webhook call ${when(s.inbound.lastCallAt)} (${s.inbound.lastStatus ?? 'unknown'})` : 'Send a round-trip test once the steps above are green.' },
  ];
  const used = s.inbound.sentLast24h + s.inbound.systemSentLast24h + s.inbound.receivedLast24h;
  return (
    <section className={cx(card, 'p-5')} data-testid="card-mail-checklist">
      <SectionTitle action={<Link href="/admin/mail" className={cx(ghost, 'inline-flex min-h-10 items-center gap-2')} data-testid="link-open-mail"><Inbox className="h-4 w-4" />Open Mail</Link>}>Mail box setup</SectionTitle>
      <ol className="grid gap-2 sm:grid-cols-2">
        {steps.map((st, i) => (
          <li key={st.title}>
            <a href={st.anchor} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 hover:border-slate-400" data-testid={`step-${i + 1}`} data-status={st.tone}>
              <ToneIcon tone={st.tone} />
              <span className="min-w-0"><span className="block text-sm font-semibold text-slate-900">{i + 1}. {st.title}</span><span className="block text-xs text-slate-600">{st.detail}</span></span>
            </a>
          </li>
        ))}
      </ol>
      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600" data-testid="text-mail-usage">
        <div className="flex flex-wrap justify-between gap-2">
          <span>Last 24 hours: <b>{s.inbound.sentLast24h}</b> sent from Mail · <b>{s.inbound.systemSentLast24h}</b> notification emails · <b>{s.inbound.receivedLast24h}</b> received</span>
          <span className={cx('font-semibold', used >= s.dailyLimit * 0.8 ? 'text-red-700' : 'text-slate-700')}>{used} of {s.dailyLimit} a day on your Resend plan</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className={cx('h-full rounded-full', used >= s.dailyLimit * 0.8 ? 'bg-red-600' : 'bg-[var(--brand)]')} style={{ width: `${Math.min(100, (used / Math.max(1, s.dailyLimit)) * 100)}%` }} /></div>
        <p className="mt-2">Resend's Free plan allows 100 emails a day and 3,000 a month, received mail included. Sign-in emails sent by Supabase through the hook count too.</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ domain and DNS */

function DomainCard({ s }: { s: MailSetup }) {
  const { toast } = useToast();
  const refresh = useSetupRefresh();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [region, setRegion] = useState<MailDomainInputRegion>('eu-west-1');
  const [err, setErr] = useState('');
  const connect = useConnectAdminMailDomain();
  const verify = useVerifyAdminMailDomain();
  const forget = useForgetAdminMailDomain();
  const [checking, setChecking] = useState(false);
  const dns = useGetAdminMailDns({ query: { queryKey: getGetAdminMailDnsQueryKey(), enabled: Boolean(s.domain) && checking, retry: false } });
  const canManage = s.keyAccess === 'full';
  const fail = (e: unknown) => setErr(apiError(e, 'That didn\'t work.'));
  return (
    <section id="mail-domain" className={cx(card, 'scroll-mt-20 p-5')} data-testid="card-mail-domain">
      <SectionTitle action={s.domain && (
        <span className="flex flex-wrap gap-2">
          <button type="button" className={cx(ghost, 'inline-flex min-h-10 items-center gap-2')} disabled={!canManage || dns.isFetching} onClick={() => { setChecking(true); void qc.invalidateQueries({ queryKey: getGetAdminMailDnsQueryKey() }); }} data-testid="button-check-dns">
            {dns.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}Check DNS
          </button>
          <button type="button" className={cx(lime, 'inline-flex min-h-10 items-center gap-2')} disabled={!canManage || verify.isPending} onClick={() => { setErr(''); verify.mutate(undefined, { onSuccess: (d) => { refresh(d); toast({ title: 'Resend is checking the records', description: 'This can take a few minutes; the status updates here.' }); }, onError: fail }); }} data-testid="button-verify-domain">
            {verify.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Verify
          </button>
        </span>
      )}>Domain and DNS</SectionTitle>
      {!s.domain ? (
        <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); setErr(''); connect.mutate({ data: { name, region } }, { onSuccess: (d) => { refresh(d); toast({ title: 'Domain added', description: 'Now add its DNS records.' }); }, onError: fail }); }}>
          <p className="text-sm text-slate-600">The domain your addresses use, e.g. <b>futurenestfund.org</b> for support@futurenestfund.org. It's added to Resend with sending and receiving on; Resend then lists the DNS records to add.</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
            <Field label="Domain"><input className={ainput} value={name} onChange={(e) => setName(e.target.value)} placeholder="futurenestfund.org" autoComplete="off" data-testid="input-mail-domain" /></Field>
            <Field label="Resend region">
              <select className={ainput} value={region} onChange={(e) => setRegion(e.target.value as MailDomainInputRegion)} data-testid="select-mail-region">
                <option value="eu-west-1">Europe (Ireland)</option><option value="us-east-1">US East</option><option value="sa-east-1">South America</option><option value="ap-northeast-1">Asia (Tokyo)</option>
              </select>
            </Field>
            <button type="submit" className={cx(dark, 'min-h-11')} disabled={!canManage || connect.isPending || !name.trim()} data-testid="button-connect-domain">{connect.isPending ? 'Adding…' : 'Add domain'}</button>
          </div>
          {!canManage && <p className="text-xs text-amber-700">Save a full-access Resend key first (step 1).</p>}
        </form>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <b className="text-base">{s.domain.name}</b>
            <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', s.resend?.status === 'verified' ? 'bg-green-100 text-green-800' : s.resend?.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800')} data-testid="badge-domain-status">{(s.resend?.status ?? 'unknown').replace(/_/g, ' ')}</span>
            <span className="text-xs text-slate-500">Sending {s.resend?.sending ?? '?'} · Receiving {s.resend?.receiving ?? '?'} · {s.domain.region}</span>
            <button type="button" className="ml-auto text-xs text-slate-500 underline hover:text-red-700" onClick={() => { if (window.confirm(`Remove ${s.domain!.name} from Settings? It stays on your Resend account; Mail stops sending until a domain is added again.`)) forget.mutate(undefined, { onSuccess: refresh, onError: fail }); }} data-testid="button-forget-domain">Remove</button>
          </div>
          {s.domainError && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{s.domainError}</p>}
          <p className="mb-2 text-xs text-slate-600">Add these at your DNS provider (Cloudflare: <b>DNS only</b>, grey cloud). Names are relative to {s.domain.name}. The MX record without a name (or <code>@</code>) is what brings mail in.</p>
          <RecordsTable s={s} dns={checking ? dns.data : undefined} />
          {checking && dns.isError && <p className="mt-2 text-sm text-red-700">{apiError(dns.error, "DNS couldn't be checked.")}</p>}
          {checking && dns.data && <DnsChecks dns={dns.data} />}
        </>
      )}
      {err && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="text-domain-error">{err}</p>}
    </section>
  );
}

function RecordsTable({ s, dns }: { s: MailSetup; dns?: MailDnsHealth }) {
  const records = s.resend?.records ?? [];
  if (!records.length) return <p className="text-sm text-slate-500">Resend hasn't listed records yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[40rem] text-left text-sm" data-testid="table-dns-records">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">For</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Value</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Status</th></tr></thead>
        <tbody>
          {records.map((r, i) => {
            const check = dns?.records[i];
            const tone: Tone = check ? check.status : r.status === 'verified' ? 'ok' : r.status === 'failed' ? 'fail' : 'warn';
            return (
              <tr key={`${r.type}-${r.name}-${i}`} className="border-t border-slate-100 align-top" data-testid="row-dns-record">
                <td className="px-3 py-2 font-medium">{r.record}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.type}</td>
                <td className="px-3 py-2"><span className="flex items-center gap-1 font-mono text-xs">{r.name || '@'}<CopyButton value={r.name || '@'} label="name" /></span></td>
                <td className="max-w-[18rem] px-3 py-2"><span className="flex items-start gap-1"><span className="break-all font-mono text-xs">{r.value}</span><CopyButton value={r.value} label="value" /></span></td>
                <td className="px-3 py-2 font-mono text-xs">{r.priority ?? ''}</td>
                <td className="px-3 py-2">
                  <span className="flex items-start gap-1.5"><ToneIcon tone={tone} className="h-4 w-4" /><span className="text-xs text-slate-700">{check ? check.detail : r.status.replace(/_/g, ' ')}</span></span>
                  {check && check.status === 'fail' && check.found.length > 0 && <span className="mt-1 block break-all font-mono text-[11px] text-red-700">Found: {check.found.join(' | ')}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DnsChecks({ dns }: { dns: MailDnsHealth }) {
  return (
    <ul className="mt-3 space-y-2" data-testid="list-dns-checks">
      {dns.checks.map((c) => (
        <li key={c.id} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3" data-testid={`dns-check-${c.id}`} data-status={c.status}>
          <ToneIcon tone={c.status} />
          <span className="min-w-0 text-sm"><b>{c.label}</b><span className="block text-slate-600">{c.detail}</span>
            {c.id === 'dmarc' && c.status !== 'ok' && <span className="mt-1 flex items-center gap-1 font-mono text-xs">{dns.dmarcSuggestion}<CopyButton value={dns.dmarcSuggestion} label="DMARC value" /></span>}
          </span>
        </li>
      ))}
      <li className="text-xs text-slate-500">Checked {when(dns.checkedAt)} through public DNS (1.1.1.1 and 8.8.8.8).</li>
    </ul>
  );
}

/* ------------------------------------------------------------------ receiving */

function ReceivingCard({ s }: { s: MailSetup }) {
  const { toast } = useToast();
  const refresh = useSetupRefresh();
  const setup = useSetupAdminMailWebhook();
  const remove = useRemoveAdminMailWebhook();
  const [err, setErr] = useState('');
  const ok = Boolean(s.webhook && s.webhookSecret.set);
  return (
    <section id="mail-receiving" className={cx(card, 'scroll-mt-20 p-5')} data-testid="card-mail-receiving">
      <SectionTitle action={<span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', ok ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-700')} data-testid="badge-receiving">{ok ? <Check className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}{ok ? 'Receiving on' : 'Receiving off'}</span>}>Receiving (webhook)</SectionTitle>
      <p className="text-sm text-slate-600">Resend calls this address when mail arrives (and when sent mail bounces). The app checks every call's signature with the secret Resend gives when the webhook is made.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs" data-testid="text-inbound-url">
        {s.inboundUrl ?? 'APP_URL isn\'t set on the server'}{s.inboundUrl && <CopyButton value={s.inboundUrl} label="webhook address" />}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-2"><dt className="text-slate-500">Webhook</dt><dd>{s.webhook ? `made ${when(s.webhook.createdAt)} by ${s.webhook.createdBy}` : 'not made'}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-slate-500">Signing secret</dt><dd className="font-mono text-xs">{s.webhookSecret.set ? s.webhookSecret.hint : s.webhookSecret.unreadable ? 'can\'t be read: make the webhook again' : 'none'}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-slate-500">Last call</dt><dd>{when(s.inbound.lastCallAt)}{s.inbound.lastStatus ? ` (${s.inbound.lastStatus})` : ''}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-slate-500">Waiting / failed</dt><dd>{s.inbound.waiting} / {s.inbound.failed}</dd></div>
      </dl>
      {s.inbound.lastError && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Last error: {s.inbound.lastError}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={cx(lime, 'inline-flex min-h-11 items-center gap-2')} disabled={s.keyAccess !== 'full' || !s.domain || setup.isPending} data-testid="button-setup-webhook"
          onClick={() => { setErr(''); if (s.webhook && !window.confirm('Make the webhook again? The old one is deleted and a new secret is stored.')) return; setup.mutate(undefined, { onSuccess: (d) => { refresh(d); toast({ title: 'Receiving is on', description: 'Mail sent to your mailboxes now arrives in Mail.' }); }, onError: (e) => setErr(apiError(e, "The webhook couldn't be made.")) }); }}>
          {setup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Webhook className="h-4 w-4" />}{s.webhook ? 'Make it again' : 'Turn on receiving'}
        </button>
        {s.webhook && <button type="button" className={cx(ghost, 'min-h-11')} disabled={remove.isPending} onClick={() => { if (window.confirm('Turn off receiving? Mail sent to your mailboxes stops arriving here.')) remove.mutate(undefined, { onSuccess: refresh }); }} data-testid="button-remove-webhook">Turn off</button>}
      </div>
      {!s.domain && <p className="mt-2 text-xs text-slate-500">Add the domain first.</p>}
      {err && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="text-webhook-error">{err}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ mailboxes */

function MailboxesCard({ s }: { s: MailSetup }) {
  const { toast } = useToast();
  const refresh = useSetupRefresh();
  const create = useCreateAdminMailbox();
  const update = useUpdateAdminMailbox();
  const remove = useDeleteAdminMailbox();
  const [local, setLocal] = useState('support');
  const [display, setDisplay] = useState('');
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<Mailbox | null>(null);
  const domain = s.domain?.name;
  const after = (title: string) => () => { refresh(); toast({ title }); };
  const fail = (e: unknown) => setErr(apiError(e, "That didn't work."));
  return (
    <section id="mail-mailboxes" className={cx(card, 'scroll-mt-20 p-5')} data-testid="card-mail-mailboxes">
      <SectionTitle>Mailboxes and signatures</SectionTitle>
      {s.mailboxes.length > 0 && (
        <ul className="mb-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {s.mailboxes.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 p-3" data-testid={`row-mailbox-${m.address}`}>
              <Mail className={cx('h-5 w-5', m.enabled ? 'text-[var(--brand-ink)]' : 'text-slate-400')} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{m.displayName} <span className="font-normal text-slate-600">&lt;{m.address}&gt;</span></p>
                <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs">
                  {m.catchAll && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">Catch-all</span>}
                  {m.systemSender && <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-slate-800">Sends system emails</span>}
                  {!m.enabled && <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">Off</span>}
                  <span className="text-slate-500">{m.threads} conversation{m.threads === 1 ? '' : 's'} · {m.unread} unread</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={cx(ghost, 'inline-flex min-h-10 items-center gap-1.5 px-3')} onClick={() => setEditing(m)} data-testid="button-edit-signature"><Pencil className="h-4 w-4" />Edit</button>
                {!m.catchAll && <button type="button" className={cx(ghost, 'min-h-10 px-3 text-xs')} onClick={() => update.mutate({ id: m.id, data: { catchAll: true } }, { onSuccess: after(`${m.address} is the catch-all`), onError: fail })}>Make catch-all</button>}
                {!m.systemSender && <button type="button" className={cx(ghost, 'min-h-10 px-3 text-xs')} onClick={() => update.mutate({ id: m.id, data: { systemSender: true } }, { onSuccess: after(`System emails now come from ${m.address}`), onError: fail })} data-testid="button-make-system">Send system emails</button>}
                <button type="button" className={cx(ghost, 'min-h-10 px-3 text-xs')} onClick={() => update.mutate({ id: m.id, data: { enabled: !m.enabled } }, { onSuccess: after(m.enabled ? `${m.address} switched off` : `${m.address} switched on`), onError: fail })}>{m.enabled ? 'Switch off' : 'Switch on'}</button>
                {m.threads === 0 && !m.catchAll && !m.systemSender && <button type="button" aria-label={`Delete ${m.address}`} className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700" onClick={() => { if (window.confirm(`Delete ${m.address}?`)) remove.mutate({ id: m.id }, { onSuccess: after('Mailbox deleted'), onError: fail }); }}><Trash2 className="h-4 w-4" /></button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {domain ? (
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" noValidate onSubmit={(e) => { e.preventDefault(); setErr(''); create.mutate({ data: { address: local.trim(), displayName: display.trim() || undefined } }, { onSuccess: () => { refresh(); setLocal(''); setDisplay(''); toast({ title: 'Mailbox created' }); }, onError: fail }); }}>
          <Field label="New address">
            <span className="flex items-center rounded-lg border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-[var(--brand)]">
              <input className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm outline-none" value={local} onChange={(e) => setLocal(e.target.value.replace(/@.*/, ''))} placeholder="support" data-testid="input-mailbox-address" />
              <span className="pr-3 text-sm text-slate-500">@{domain}</span>
            </span>
          </Field>
          <Field label="Name people see"><input className={ainput} value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="Future Nest Fund Support" maxLength={60} data-testid="input-mailbox-name" /></Field>
          <button type="submit" className={cx(dark, 'inline-flex min-h-11 items-center gap-2')} disabled={create.isPending || !local.trim()} data-testid="button-create-mailbox"><Plus className="h-4 w-4" />Create</button>
        </form>
      ) : <p className="text-sm text-slate-500">Add the domain first.</p>}
      <p className="mt-3 text-xs text-slate-500">The first mailbox gets mail sent to addresses nobody created (catch-all) and sends the system emails (notifications, deposits and withdrawals, tiers), so applicants' replies land in Mail. Every administrator sees every mailbox.</p>
      {err && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="text-mailbox-error">{err}</p>}
      {editing && <MailboxEditor key={editing.id} m={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

/* ------------------------------------------------------------------ signature editor */

const SWATCHES = ['#1E3A8A', '#2563EB', '#0891B2', '#0D9488', '#16A34A', '#65A30D', '#CA8A04', '#EA580C', '#DC2626', '#DB2777', '#7C3AED', '#111827'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shortUrl = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** The same layout as the server's renderSignature (lib/mailSignature.ts), for the live preview. */
function previewHtml(sig: MailSignature, logoUrl: string | null, brand: string) {
  if (!sig.enabled) return '';
  const p = brandPalette(sig.color ?? brand);
  const line2 = [sig.title, sig.organisation].filter(Boolean).map(esc).join(' · ');
  const contact = [sig.phone && esc(sig.phone), sig.email && esc(sig.email), sig.website && `<span style="color:${p.ink}">${esc(shortUrl(sig.website))}</span>`].filter(Boolean).join(' <span style="color:#c4c7c5">·</span> ');
  const links = sig.links.map((l) => `<span style="color:${p.ink};font-weight:600">${esc(l.label)}</span>`).join(' <span style="color:#c4c7c5">·</span> ');
  const details = `${sig.name ? `<div style="font-size:15px;font-weight:700;color:${p.ink}">${esc(sig.name)}</div>` : ''}${line2 ? `<div style="font-size:13px;color:#3c4043">${line2}</div>` : ''}${contact ? `<div style="font-size:13px;color:#5f6368;margin-top:2px">${contact}</div>` : ''}${links ? `<div style="font-size:13px;margin-top:2px">${links}</div>` : ''}`;
  if (!details && !logoUrl && !sig.footer) return '';
  const logo = logoUrl ? `<img src="${esc(logoUrl)}" alt="" style="display:block;height:48px;width:auto;max-width:160px">` : '';
  const body = logo && sig.layout === 'side'
    ? `<tr><td valign="top" style="padding:0 14px 0 0">${logo}</td><td valign="top" style="border-left:2px solid ${p.brand};padding:0 0 0 14px">${details}</td></tr>`
    : `${logo ? `<tr><td style="padding:0 0 10px">${logo}</td></tr>` : ''}<tr><td style="border-left:2px solid ${p.brand};padding:0 0 0 12px">${details}</td></tr>`;
  const footer = sig.footer ? `<tr><td colspan="2" style="padding:12px 0 0"><div style="border-top:1px solid #e8eaed;padding-top:8px;font-size:11px;color:#80868b">${esc(sig.footer)}</div></td></tr>` : '';
  return `<table cellspacing="0" cellpadding="0" style="font-family:Arial,Helvetica,sans-serif;border-collapse:collapse">${body}${footer}</table>`;
}

function MailboxEditor({ m, onClose }: { m: Mailbox; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useSetupRefresh();
  const { color: brand } = useBranding();
  const update = useUpdateAdminMailbox();
  const upload = useUploadAdminMailSignatureLogo();
  const [name, setName] = useState(m.displayName);
  const [sig, setSig] = useState<MailSignature>(m.signature);
  const [logoUrl, setLogoUrl] = useState<string | null>(m.signatureLogoUrl);
  const [hex, setHex] = useState(m.signature.color ?? '');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof MailSignature>(k: K) => (v: MailSignature[K]) => setSig((s) => ({ ...s, [k]: v }));
  const text = (k: 'name' | 'title' | 'organisation' | 'phone' | 'website' | 'email' | 'footer', label: string, placeholder: string, max: number) => (
    <Field label={label}><input className={ainput} value={sig[k]} maxLength={max} placeholder={placeholder} onChange={(e) => set(k)(e.target.value)} data-testid={`input-sig-${k}`} /></Field>
  );
  useEffect(() => { const c = normalizeHex(hex); if (c) set('color')(c); }, [hex]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = previewHtml(sig, logoUrl, brand);
  const save = () => {
    setErr('');
    update.mutate({ id: m.id, data: { displayName: name.trim(), signature: sig } }, {
      onSuccess: () => { refresh(); toast({ title: 'Saved', description: `${m.address}'s name and signature are updated.` }); onClose(); },
      onError: (e) => setErr(apiError(e, "The signature couldn't be saved.")),
    });
  };
  return (
    <Modal open onClose={onClose} title={`${m.address}`} testid="modal-mailbox-editor" wide>
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          <Field label="Name people see (From)"><input className={ainput} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-testid="input-mailbox-display" /></Field>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={sig.enabled} onChange={(e) => set('enabled')(e.target.checked)} data-testid="checkbox-sig-enabled" />Add a signature to emails from this mailbox</label>
          <div className="grid gap-3 sm:grid-cols-2">
            {text('name', 'Name', 'Ada Lovelace', 80)}{text('title', 'Job title', 'Grants Manager', 80)}
            {text('organisation', 'Organisation', 'Future Nest Fund', 80)}{text('phone', 'Phone', '+44 20 0000 0000', 40)}
            {text('website', 'Website', 'futurenestfund.org', 120)}{text('email', 'Email', m.address, 254)}
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-slate-800">Links (up to 3)</legend>
            {sig.links.map((l, i) => (
              <div key={i} className="flex gap-2">
                <input className={ainput} value={l.label} placeholder="LinkedIn" maxLength={40} aria-label={`Link ${i + 1} label`} onChange={(e) => set('links')(sig.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input className={ainput} value={l.url} placeholder="https://…" maxLength={300} aria-label={`Link ${i + 1} address`} onChange={(e) => set('links')(sig.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <button type="button" aria-label={`Remove link ${i + 1}`} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg hover:bg-slate-100" onClick={() => set('links')(sig.links.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {sig.links.length < 3 && <button type="button" className="text-sm font-medium text-[var(--brand-ink)] hover:underline" onClick={() => set('links')([...sig.links, { label: '', url: '' }])} data-testid="button-add-link">+ Add a link</button>}
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-800">Signature colour</legend>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => { set('color')(null); setHex(''); }} className={cx('h-8 rounded-full border px-3 text-xs', sig.color === null ? 'border-[#111] font-semibold' : 'border-slate-300')} data-testid="button-sig-brand-colour">App colour</button>
              {SWATCHES.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => { set('color')(c); setHex(c); }} className={cx('h-8 w-8 rounded-full border-2', sig.color === c ? 'border-[#111] ring-2 ring-offset-1 ring-slate-400' : 'border-white shadow')} style={{ background: c }} />)}
              <input type="color" aria-label="Pick any colour" value={sig.color ?? brand} onChange={(e) => { set('color')(e.target.value.toUpperCase()); setHex(e.target.value.toUpperCase()); }} className="h-8 w-10 cursor-pointer rounded border border-slate-300" />
              <input className={cx(ainput, 'w-28 font-mono')} value={hex} placeholder="#RRGGBB" maxLength={7} onChange={(e) => setHex(e.target.value)} aria-label="Colour code" data-testid="input-sig-colour" />
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-800">Logo</legend>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (f) upload.mutate({ data: { file: f } }, { onSuccess: (r) => { set('logoFileId')(r.id); setLogoUrl(r.url); }, onError: (er) => setErr(apiError(er, "The logo couldn't be uploaded.")) });
              }} data-testid="input-sig-logo" />
              <button type="button" className={cx(ghost, 'inline-flex min-h-10 items-center gap-2')} onClick={() => fileRef.current?.click()} disabled={upload.isPending} data-testid="button-sig-logo">{upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}{sig.logoFileId ? 'Replace logo' : 'Upload logo'}</button>
              {sig.logoFileId && <button type="button" className="text-sm text-slate-600 underline" onClick={() => { set('logoFileId')(null); setLogoUrl(null); }}>Remove</button>}
              <label className="ml-auto flex items-center gap-2 text-sm">Layout
                <select className={cx(ainput, 'w-auto')} value={sig.layout} onChange={(e) => set('layout')(e.target.value as MailSignature['layout'])} data-testid="select-sig-layout"><option value="side">Logo beside</option><option value="stacked">Logo above</option></select>
              </label>
            </div>
            <p className="mt-1 text-xs text-slate-500">PNG, JPG, WebP or GIF, shown 48 px high. Recipients load it from this site.</p>
          </fieldset>
          {text('footer', 'Footer (small grey line under the signature)', 'futurenestfund.org', 200)}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-slate-800">Preview</p>
          <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="signature-preview">
            <p className="mb-3 text-sm text-slate-700">Hi Jane,<br />Thanks for your application. We'll be in touch soon.</p>
            {preview ? <div dangerouslySetInnerHTML={{ __html: preview }} /> : <p className="text-sm italic text-slate-400">No signature.</p>}
          </div>
          <p className="mt-2 text-xs text-slate-500">This is how it looks in Gmail, Outlook and Apple Mail (email-safe layout, no web fonts). {m.systemSender ? 'System emails from this mailbox use it too.' : ''}</p>
        </div>
      </div>
      {err && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="text-sig-error">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={ghost} onClick={onClose}>Cancel</button>
        <button type="button" className={cx(lime, 'min-h-11')} onClick={save} disabled={update.isPending} data-testid="button-save-signature">{update.isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ round trip */

function RoundTripCard({ s }: { s: MailSetup }) {
  const start = useStartAdminMailRoundTrip();
  const [box, setBox] = useState(s.mailboxes[0]?.id ?? '');
  const [state, setState] = useState<{ phase: 'idle' | 'waiting' | 'arrived' | 'late' | 'error'; text: string; threadId?: string | null }>({ phase: 'idle', text: '' });
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);
  useEffect(() => { if (!box && s.mailboxes[0]) setBox(s.mailboxes[0].id); }, [s.mailboxes, box]);
  const ready = s.keyAccess === 'full' && s.domain && s.webhook && s.mailboxes.length > 0;
  const run = () => {
    setState({ phase: 'waiting', text: 'Sending…' });
    start.mutate({ data: { mailboxId: box } }, {
      onSuccess: (r) => {
        const t0 = Date.now();
        setState({ phase: 'waiting', text: 'Sent. Waiting for it to arrive…' });
        timer.current = window.setInterval(async () => {
          const secs = Math.round((Date.now() - t0) / 1000);
          try {
            const st = await getAdminMailRoundTrip({ token: r.token, mailboxId: r.mailboxId });
            if (st.arrived) { window.clearInterval(timer.current!); setState({ phase: 'arrived', text: `Arrived in ${secs} seconds: sending and receiving both work.`, threadId: st.threadId }); return; }
          } catch { /* keep waiting */ }
          if (secs > 120) { window.clearInterval(timer.current!); setState({ phase: 'late', text: "Not arrived after 2 minutes. Check the MX record (Domain and DNS) and the webhook's last call above." }); }
          else setState({ phase: 'waiting', text: `Sent. Waiting for it to arrive… ${secs} s` });
        }, 3000);
      },
      onError: (e) => setState({ phase: 'error', text: apiError(e, "The test email couldn't be sent.") }),
    });
  };
  return (
    <section id="mail-test" className={cx(card, 'scroll-mt-20 p-5')} data-testid="card-mail-test">
      <SectionTitle>Round-trip test</SectionTitle>
      <p className="text-sm text-slate-600">Sends an email from a mailbox to itself through Resend and waits for it to come back through the webhook: proof that sending and receiving work end to end.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label="Mailbox">
          <select className={cx(ainput, 'w-auto')} value={box} onChange={(e) => setBox(e.target.value)} disabled={!s.mailboxes.length} data-testid="select-roundtrip-mailbox">
            {s.mailboxes.map((m) => <option key={m.id} value={m.id}>{m.address}</option>)}
          </select>
        </Field>
        <button type="button" className={cx(dark, 'inline-flex min-h-11 items-center gap-2')} disabled={!ready || state.phase === 'waiting'} onClick={run} data-testid="button-roundtrip">
          {state.phase === 'waiting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Run test
        </button>
      </div>
      {!ready && <p className="mt-2 text-xs text-slate-500">Finish steps 1–5 first.</p>}
      {state.phase !== 'idle' && (
        <p className={cx('mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm', state.phase === 'arrived' ? 'bg-green-50 text-green-900' : state.phase === 'waiting' ? 'bg-slate-50 text-slate-700' : 'bg-red-50 text-red-900')} role="status" data-testid="text-roundtrip">
          <ToneIcon tone={state.phase === 'arrived' ? 'ok' : state.phase === 'waiting' ? 'off' : 'fail'} className="h-4 w-4" />{state.text}
          {state.threadId && <Link href={`/admin/mail?t=${state.threadId}`} className="ml-auto font-semibold underline">Open it</Link>}
        </p>
      )}
    </section>
  );
}
