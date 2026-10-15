import { Link, useLocation } from 'wouter';
import { Shell } from '@/components/shell';
import { Empty } from '@/components/bits';

export default function NotFound() {
  const [loc] = useLocation();
  const admin = loc.startsWith('/admin');
  return (
    <Shell title="Page not found">
      <Empty title="We couldn't find that page" hint="The link may be outdated, or the page may have moved.">
        <Link href={admin ? '/admin' : '/dashboard'} data-testid="link-home" className="inline-flex rounded-full bg-[#1E3A8A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F172A]">Back to dashboard</Link>
      </Empty>
    </Shell>
  );
}
