import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetApplicantDashboard, useGetAdminDashboard, useUpdateGlobalFreeze, getGetAdminDashboardQueryKey,
} from '@workspace/api-client-react';
import {
  LayoutDashboard, Layers, FileText, CreditCard, ArrowLeftRight, ArrowUpFromLine, PlusCircle, Settings, Bell, Search, Plus, Menu, X,
  ChevronDown, Users, ArrowDownToLine, ShieldCheck, Snowflake, Building2, ScanLine,
} from 'lucide-react';
import { cx, initials, Modal } from '@/components/bits';
import { useDemo } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

const userNav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/grants', label: 'Grant categories', icon: Layers },
  { href: '/applications', label: 'Applications', icon: FileText },
  { href: '/cards', label: 'Cards', icon: CreditCard },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/withdrawals', label: 'Withdrawals', icon: ArrowUpFromLine },
  { href: '/deposits', label: 'Add funds', icon: PlusCircle },
  { href: '/settings', label: 'Settings', icon: Settings },
];
const adminNav = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/admin/deposits', label: 'Deposit Page', icon: ArrowDownToLine },
  { href: '/admin/withdrawals', label: 'Withdrawal Page', icon: ArrowUpFromLine },
  { href: '/admin/kyc', label: 'KYC Page', icon: ScanLine },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];
const bottomNav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/grants', label: 'Categories', icon: Layers },
  { href: '/applications', label: 'Apps', icon: FileText },
  { href: '/cards', label: 'Cards', icon: CreditCard },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function WorkspaceSwitch({ admin }: { admin: boolean }) {
  const [, nav] = useLocation();
  return (
    <div role="group" aria-label="Demo workspace switch" data-testid="switch-workspace" className={cx('flex rounded-full p-0.5 text-xs font-semibold', admin ? 'bg-white/10' : 'bg-slate-100')}>
      {[{ k: false, l: 'User workspace', to: '/dashboard' }, { k: true, l: 'Admin workspace', to: '/admin' }].map((o) => (
        <button key={o.l} aria-pressed={admin === o.k} data-testid={o.k ? 'button-admin-workspace' : 'button-user-workspace'} onClick={() => nav(o.to)}
          className={cx('press rounded-full px-3 py-1.5 transition-all duration-200 whitespace-nowrap',
            admin === o.k ? (admin ? 'bg-[#C6F432] text-[#111]' : 'bg-[#1E3A8A] text-white') : admin ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900')}>
          <span className="hidden sm:inline">{o.l}</span><span className="sm:hidden">{o.k ? 'Admin' : 'User'}</span>
        </button>
      ))}
    </div>
  );
}

function NavList({ items, admin, onNav, count }: { items: typeof userNav; admin: boolean; onNav?: () => void; count?: number }) {
  const [loc] = useLocation();
  return (
    <nav aria-label={admin ? 'Admin navigation' : 'User navigation'} className="flex flex-col gap-1">
      {items.map((i) => {
        const active = loc === i.href || (i.href === '/dashboard' && loc === '/') || (i.href === '/admin/users' && loc.startsWith('/admin/users'));
        return (
          <Link key={i.href} href={i.href} onClick={onNav} aria-current={active ? 'page' : undefined} data-testid={`link-nav-${i.href.replace(/\//g, '-').slice(1)}`}
            className={cx('group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
              admin ? (active ? 'bg-[#C6F432] text-[#111] font-semibold' : 'text-slate-300 hover:bg-white/10 hover:text-white hover:translate-x-0.5')
                : active ? 'bg-[#1E3A8A] text-white' : 'text-slate-600 hover:bg-[#EEF4FB] hover:text-[#1E3A8A] hover:translate-x-0.5')}>
            <i.icon className="h-[18px] w-[18px]" />
            <span className="flex-1">{i.label}</span>
            {i.label === 'Applications' && count !== undefined && (
              <span data-testid="badge-applications-count" className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', active ? 'bg-white text-[#1E3A8A]' : 'bg-[#DBEAFE] text-[#1E3A8A]')}>{count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ admin }: { admin: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <span className={cx('grid h-9 w-9 place-items-center rounded-xl font-display text-lg font-extrabold', admin ? 'bg-[#C6F432] text-[#111]' : 'bg-[#1E3A8A] text-white')}>G</span>
      <div className="leading-tight">
        <div className={cx('font-display text-base font-bold', admin && 'text-white')}>Grant Platform</div>
        <div className={cx('text-[10px] font-semibold uppercase tracking-widest', admin ? 'text-[#C6F432]' : 'text-slate-400')}>{admin ? 'Command center' : 'Funding workspace'}</div>
      </div>
    </div>
  );
}

export function Shell({ admin, title, children }: { admin: boolean; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [loc, nav] = useLocation();
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
    document.title = `${title} | Grant Platform`;
    const description = admin
      ? `${title} — sample grant administration, profile controls and operations. Interactive demo.`
      : `${title} — discover funding, follow grant applications and manage your sample workspace. Interactive demo.`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
  }, [loc, title, admin]);
  return (
    <div className={cx('min-h-[100dvh] lg:flex', admin ? 'bg-[#F4F5F8]' : 'mobile-preview-frame bg-[#E9EDF3]')}>
      {!admin && <div data-testid="mobile-browser-bar" className="flex items-center justify-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2 text-[11px] text-slate-600 lg:hidden">
        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
        <span>grantapp.mx{loc === '/' ? '/dashboard' : loc}</span>
        <span className="rounded bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500">Demo</span>
      </div>}
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:bg-white focus:p-2">Skip to content</a>
      <aside className={cx('hidden lg:flex lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:gap-6 lg:overflow-y-auto border-r p-4',
        admin ? 'bg-[#111111] border-slate-800' : 'bg-white border-slate-200')} data-testid="sidebar-desktop">
        <Brand admin={admin} />
        <SidebarBody admin={admin} />
      </aside>
      {open && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} data-testid="overlay-drawer" />}
      <aside aria-hidden={!open} inert={!open} data-testid="drawer-mobile" className={cx('fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-6 overflow-y-auto p-4 transition-transform duration-300 lg:hidden',
        admin ? 'bg-[#111111]' : 'bg-white', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center justify-between">
          <Brand admin={admin} />
          <button aria-label="Close menu" data-testid="button-close-drawer" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} className={cx('grid h-9 w-9 place-items-center rounded-full', admin ? 'text-white hover:bg-white/10' : 'hover:bg-slate-100')}><X className="h-5 w-5" /></button>
        </div>
        <SidebarBody admin={admin} onNav={() => setOpen(false)} focusable={open} />
      </aside>
      <div className="min-w-0 flex-1">
        {admin ? <AdminTop title={title} onMenu={() => setOpen(true)} /> : <UserTop title={title} onMenu={() => setOpen(true)} />}
        <main id="main" className={cx('mx-auto w-full max-w-[1280px] p-4 sm:p-6', !admin && 'pb-24 lg:pb-8')}>
          <div key={loc} className="rise">{children}</div>
          <p className="mt-8 text-center text-xs text-slate-500" data-testid="text-demo-note">Demo preview. No real authentication, transfers, card networks or OCR are connected.</p>
        </main>
        {!admin && (
          <nav aria-label="Bottom navigation" data-testid="nav-bottom" className="fixed inset-x-1 bottom-1 z-30 flex rounded-b-[24px] border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
            {bottomNav.map((b) => {
              const a = loc === b.href || (b.href === '/dashboard' && loc === '/');
              return (
                <button key={b.href} data-testid={`button-bottom-${b.label.toLowerCase()}`} onClick={() => nav(b.href)} aria-current={a ? 'page' : undefined}
                  className={cx('press flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', a ? 'text-[#1E3A8A]' : 'text-slate-500')}>
                  <span className={cx('grid h-7 w-12 place-items-center rounded-full transition-colors', a && 'bg-[#DBEAFE]')}><b.icon className="h-5 w-5" /></span>{b.label}
                </button>
              );
            })}
          </nav>
        )}
      </div>
      {!admin && <NewApplicationModal />}
    </div>
  );
}

function SidebarBody({ admin, onNav, focusable = true }: { admin: boolean; onNav?: () => void; focusable?: boolean }) {
  const { apps } = useDemo();
  const { data } = useGetApplicantDashboard(undefined, { query: { enabled: !admin, queryKey: ['/api/applicant/dashboard'] } });
  const count = data ? data.applicationCount + apps.length : undefined;
  return (
    <div className={cx('flex flex-1 flex-col gap-6', !focusable && 'pointer-events-none')}>
      <NavList items={admin ? adminNav : userNav} admin={admin} onNav={onNav} count={admin ? undefined : count} />
      <div className="mt-auto space-y-3">
        <div className={cx('rounded-xl p-3 text-xs leading-relaxed', admin ? 'bg-white/5 text-slate-400' : 'bg-[#EEF4FB] text-slate-600')}>
          <strong className={admin ? 'text-[#C6F432]' : 'text-[#1E3A8A]'}>DEMO preview.</strong> Switch workspaces to see both sides of the sample data.
        </div>
        <WorkspaceSwitch admin={admin} />
      </div>
    </div>
  );
}

function UserTop({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { data } = useGetApplicantDashboard();
  const { setNewAppOpen, notes, setSearch, search } = useDemo();
  const [, nav] = useLocation();
  const [bell, setBell] = useState(false);
  const [org, setOrg] = useState(false);
  const [srch, setSrch] = useState(false);
  const orgName = data?.profile.organization ?? 'Organization';
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="flex items-center gap-2 px-4 py-3 sm:px-6">
        <button aria-label="Open menu" data-testid="button-open-drawer" onClick={onMenu} className="press grid h-10 w-10 place-items-center rounded-full hover:bg-slate-100 lg:hidden"><Menu className="h-5 w-5" /></button>
        <h1 className="font-display text-lg font-bold sm:text-xl" data-testid="text-page-title">{title}</h1>
        <div className="relative ml-2 hidden md:block">
          <button data-testid="button-org-switcher" aria-haspopup="menu" aria-expanded={org} onClick={() => setOrg(!org)} className="press flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:border-[#1E3A8A]">
            <Building2 className="h-4 w-4 text-[#1E3A8A]" /><span data-testid="text-org-name">{orgName}</span><ChevronDown className={cx('h-4 w-4 transition-transform', org && 'rotate-180')} />
          </button>
          {org && (
            <div role="menu" className="pop absolute left-0 top-full mt-2 w-64 rounded-xl border bg-white p-1.5 shadow-xl">
              <button role="menuitem" data-testid="menu-org-current" onClick={() => setOrg(false)} className="flex w-full items-center justify-between rounded-lg bg-[#EEF4FB] px-3 py-2 text-sm font-medium text-[#1E3A8A]">{orgName}<span className="text-xs">Current</span></button>
              <p className="px-3 py-2 text-xs text-slate-500">Single organization in this demo.</p>
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {srch && (
            <form onSubmit={(e) => { e.preventDefault(); nav('/applications'); }} className="pop">
              <input autoFocus data-testid="input-global-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search applications" className="w-36 rounded-full border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#1E3A8A] sm:w-56" />
            </form>
          )}
          <button aria-label="Search" data-testid="button-search" onClick={() => setSrch(!srch)} className="press grid h-10 w-10 place-items-center rounded-full hover:bg-slate-100"><Search className="h-5 w-5" /></button>
          <div className="relative">
            <button aria-label="Notifications" data-testid="button-notifications" onClick={() => setBell(!bell)} className="press relative grid h-10 w-10 place-items-center rounded-full hover:bg-slate-100">
              <Bell className="h-5 w-5" />{notes.length > 0 && <span data-testid="badge-notification-count" className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#1E3A8A] px-1 text-[10px] font-bold text-white">{notes.length}</span>}
            </button>
            {bell && (
              <div className="pop absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border bg-white p-3 shadow-xl" data-testid="panel-notifications">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Preview activity</p>
                {notes.length === 0 ? <p className="text-sm text-slate-500">Nothing yet. Actions you take appear here.</p> : notes.map((n, i) => <p key={i} className="border-t py-2 text-sm first:border-0">{n}</p>)}
              </div>
            )}
          </div>
          <button data-testid="button-new-application" onClick={() => setNewAppOpen(true)} className="press flex items-center gap-1.5 rounded-full bg-[#1E3A8A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0F172A]">
            <Plus className="h-4 w-4" /><span className="hidden sm:inline">New Application</span><span className="sm:hidden">New</span>
          </button>
          <div className="hidden sm:block"><WorkspaceSwitch admin={false} /></div>
          {data && <span aria-hidden className="hidden h-9 w-9 place-items-center rounded-full bg-[#DBEAFE] text-xs font-bold text-[#1E3A8A] xl:grid">{initials(data.profile.name)}</span>}
        </div>
      </div>
    </header>
  );
}

function AdminTop({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { data } = useGetAdminDashboard();
  const { adminSearch, setAdminSearch } = useDemo();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const freeze = useUpdateGlobalFreeze();
  const frozen = data?.globalFrozen ?? false;
  const go = () =>
    freeze.mutate({ data: { frozen: !frozen, reason: reason || undefined } }, {
      onSuccess: (r) => {
        qc.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
        toast({ title: r.frozen ? 'Global freeze enabled (demo)' : 'Global freeze lifted (demo)' });
        setConfirm(false); setReason('');
      },
      onError: () => toast({ title: 'Freeze update failed', variant: 'destructive' }),
    });
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        <button aria-label="Open menu" data-testid="button-open-drawer" onClick={onMenu} className="press grid h-10 w-10 place-items-center rounded-lg bg-[#111] text-[#C6F432] lg:hidden"><Menu className="h-5 w-5" /></button>
        <h1 className="font-display text-lg font-bold sm:text-xl" data-testid="text-page-title">{title}</h1>
        {data && (
          <span data-testid="badge-four-eyes" title="Two-person authorization is not enabled. Demo configuration only." className={cx('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-flex', data.systemHealth.fourEyes ? 'bg-[#111] text-[#C6F432]' : 'bg-[#FEF3C7] text-[#92400E]')}><ShieldCheck className="h-3.5 w-3.5" />{data.systemHealth.fourEyes ? '4-Eyes Active' : '4-Eyes: not enabled (demo config)'}</span>
        )}
        <form onSubmit={(e) => { e.preventDefault(); nav('/admin/users'); }} className="relative order-last w-full md:order-none md:ml-4 md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input data-testid="input-admin-search" aria-label="Search users, logs and IDs" value={adminSearch} onChange={(e) => setAdminSearch(e.target.value)} placeholder="Search logs, users, IDs" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#111] focus:ring-2 focus:ring-[#C6F432]" />
        </form>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden rounded-full bg-[#111] sm:block"><WorkspaceSwitch admin={true} /></div>
          <button data-testid="button-global-freeze" onClick={() => setConfirm(true)} disabled={!data} className={cx('press flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-50', frozen ? 'bg-[#C6F432] text-[#111]' : 'bg-red-700 text-white hover:bg-red-800')}>
            <Snowflake className="h-4 w-4" />{frozen ? 'Lift Freeze' : 'Global Freeze'}
          </button>
        </div>
      </div>
      <div className="px-4 pb-2 sm:hidden"><div className="inline-block rounded-full bg-[#111]"><WorkspaceSwitch admin={true} /></div></div>
      {frozen && <div data-testid="banner-frozen" className="bg-red-700 px-6 py-1.5 text-center text-xs font-semibold text-white">Platform is globally frozen (demo state). Ledger adjustments are paused conceptually.</div>}
      <Modal open={confirm} onClose={() => setConfirm(false)} title={frozen ? 'Lift global freeze?' : 'Enable global freeze?'} testid="dialog-global-freeze">
        <p className="mb-3 text-sm text-slate-600">This flips a demo flag only. No real funds are moved or locked.</p>
        <textarea data-testid="input-freeze-reason" maxLength={240} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="mb-4 h-24 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-[#111] focus:ring-2 focus:ring-[#C6F432]" />
        <div className="flex justify-end gap-2">
          <button data-testid="button-freeze-cancel" onClick={() => setConfirm(false)} className="press rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-100">Cancel</button>
          <button data-testid="button-freeze-confirm" disabled={freeze.isPending} onClick={go} className="press rounded-lg bg-[#111] px-4 py-2 text-sm font-semibold text-[#C6F432] disabled:opacity-60">{freeze.isPending ? 'Applying...' : 'Confirm'}</button>
        </div>
      </Modal>
    </header>
  );
}

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Field, inputCls } from '@/components/bits';

const appSchema = z.object({
  title: z.string().min(3, 'Enter at least 3 characters'),
  category: z.string().min(1, 'Choose a category'),
  amount: z.coerce.number().min(100, 'Minimum is $100'),
});
export function NewApplicationModal() {
  const { newAppOpen, setNewAppOpen, addApp } = useDemo();
  const [, nav] = useLocation();
  const { toast } = useToast();
  const f = useForm<z.input<typeof appSchema>, unknown, z.output<typeof appSchema>>({ resolver: zodResolver(appSchema), defaultValues: { title: '', category: 'Innovation', amount: 5000 } });
  return (
    <Modal open={newAppOpen} onClose={() => setNewAppOpen(false)} title="New application" testid="dialog-new-application">
      <form className="space-y-4" onSubmit={f.handleSubmit((v) => {
        addApp(v); toast({ title: 'Application added to preview', description: v.title }); setNewAppOpen(false); f.reset(); nav('/applications');
      })}>
        <Field label="Project title" error={f.formState.errors.title?.message}><input data-testid="input-app-title" className={inputCls} {...f.register('title')} /></Field>
        <Field label="Category" error={f.formState.errors.category?.message}>
          <select data-testid="select-app-category" className={inputCls} {...f.register('category')}>
            {['Innovation', 'Community Arts', 'Education', 'Health', 'Climate'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Requested amount (USD)" error={f.formState.errors.amount?.message}><input data-testid="input-app-amount" type="number" step="any" className={inputCls} {...f.register('amount')} /></Field>
        <p className="text-xs text-slate-500">DEMO: saved in this browser (localStorage) only. Not submitted to a funder.</p>
        <button data-testid="button-submit-application" type="submit" className="press w-full rounded-full bg-[#1E3A8A] py-2.5 text-sm font-semibold text-white hover:bg-[#0F172A]">Add application</button>
      </form>
    </Modal>
  );
}
