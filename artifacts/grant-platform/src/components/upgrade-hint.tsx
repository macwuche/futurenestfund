import { Link } from 'wouter';
import { ArrowUpRight } from 'lucide-react';

/**
 * Step 9.4: shown under a refusal caused by a tier limit — what went wrong is the message above it; this says how to fix
 * it. `tier` is the tier that would raise the limit (from the API's `upgradeTier`).
 */
export function UpgradeHint({ tier, testid = 'hint-upgrade' }: { tier: number | null; testid?: string }) {
  if (!tier) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--brand-ink)]/20 bg-[var(--brand-soft)] px-4 py-3" data-testid={testid}>
      <p className="min-w-0 flex-1 basis-48 text-sm text-slate-700">Higher limits come with <b>Tier {tier}</b>. Send a short verification form and we'll review it.</p>
      <Link href="/tier" className="press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--brand-fg)] hover:bg-[var(--brand-dark)]" data-testid={`${testid}-link`}>
        Upgrade your account<ArrowUpRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}
