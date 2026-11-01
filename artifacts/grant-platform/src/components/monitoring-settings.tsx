import { useState } from 'react';
import { useGetMonitoringStatus, useTriggerMonitoringTestError } from '@workspace/api-client-react';
import { Activity, Loader2, ShieldCheck } from 'lucide-react';
import { StatusBadge, cx } from '@/components/bits';
import { card, dark, SectionTitle } from '@/components/admin-bits';
import { reportClientError } from '@/lib/monitoring';

type Result = { server: string | null; browser: string | null };

/**
 * Admin settings: where errors go (the server log, plus Sentry when SENTRY_DSN is set) and a button that raises one
 * deliberate server error and one browser error, so an administrator can check both arrive.
 */
export function MonitoringSettings() {
  const status = useGetMonitoringStatus();
  const trigger = useTriggerMonitoringTestError();
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setResult(null);
    let server: string | null = null;
    try {
      await trigger.mutateAsync();
    } catch (e) {
      const id = (e as { data?: { requestId?: string } } | null)?.data?.requestId;
      server = id ? id.replaceAll('-', '').slice(0, 8) : null;
    }
    const browser = await reportClientError('test', new Error('Monitoring test: a deliberate browser error from Admin settings'));
    setResult({ server, browser });
    setBusy(false);
  };
  const s = status.data;
  return (
    <section className={cx(card, 'p-5')} data-testid="card-monitoring">
      <SectionTitle>Error monitoring</SectionTitle>
      <p className="text-sm text-slate-600" data-testid="text-monitoring-status">
        {!s ? 'Checking…' : s.sentry
          ? <>Server errors and browser crashes are written to the server log and sent to Sentry ({s.sentryHost}), environment <b>{s.environment}</b>. No user details, cookies or IP addresses are sent, and email addresses, long numbers and tokens are removed from messages first.</>
          : <>Server errors and browser crashes are written to the server log only. To also send them to Sentry, set <code className="rounded bg-slate-100 px-1">SENTRY_DSN</code> on the server.</>}
      </p>
      <p className="mt-2 text-xs text-slate-500">Each error has a reference, which users see in error messages. Search the log for it to find the error.</p>
      <button data-testid="button-monitoring-test" disabled={busy} onClick={() => void run()} className={cx(dark, 'mt-4 inline-flex items-center gap-1.5')}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}Send test errors
      </button>
      {result && (
        <div role="status" className="mt-3 rounded-lg bg-slate-50 p-3 text-sm" data-testid="text-monitoring-result">
          {result.server && result.browser
            ? <>Sent. Look for server reference <b className="font-mono" data-testid="text-monitoring-server-ref">{result.server}</b> and browser reference <b className="font-mono" data-testid="text-monitoring-browser-ref">{result.browser}</b> in the log{s?.sentry ? ' and in Sentry' : ''}.</>
            : <span className="text-[#991B1B]">The test errors could not be confirmed{result.server ? ` (server reference ${result.server})` : ''}. Check that the API is running.</span>}
        </div>
      )}
    </section>
  );
}

/** Admin settings: whether uploads are virus-scanned (ClamAV), and whether the scanner answers right now. */
export function VirusScanSettings() {
  const status = useGetMonitoringStatus();
  const v = status.data?.virusScan;
  const state = !v ? null : !v.enabled ? 'Off' : v.ok ? 'Active' : v.failOpen ? 'Degraded' : 'Offline';
  return (
    <section className={cx(card, 'p-5')} data-testid="card-virus-scan">
      <SectionTitle action={state && <StatusBadge status={state} label={!v!.enabled ? 'Off' : v!.ok ? 'Scanning' : 'Not answering'} testid="status-virus-scan" />}>
        <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Upload virus scanning</span>
      </SectionTitle>
      <p className="text-sm text-slate-600" data-testid="text-virus-scan">
        {!v ? 'Checking…'
          : !v.enabled ? <>Uploads (identity documents, proposals, photos) are checked for type and structure, but not scanned for viruses. To scan them, install ClamAV on the server and set <code className="rounded bg-slate-100 px-1">CLAMAV_SOCKET</code>.</>
          : v.ok ? <>Every upload is scanned by ClamAV before it's saved; a flagged file is refused and the attempt is logged. <span className="text-slate-500">{v.version}</span></>
          : v.failOpen ? <>The scanner isn't answering, and <code className="rounded bg-slate-100 px-1">CLAMAV_FAIL_OPEN=1</code> is set, so uploads are being accepted <b>unscanned</b>. {v.error}</>
          : <>The scanner isn't answering, so uploads are refused until it's back. {v.error}</>}
      </p>
    </section>
  );
}
