import { createContext, useCallback, useContext, useDeferredValue, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useGetAdminDashboard, useListAdminCardRequests, getListAdminCardRequestsQueryKey, useUpdateGlobalFreeze, useSearchAdmin, getSearchAdminQueryKey,
  useMarkApplicantNotificationsRead, getListApplicantNotificationsQueryKey, type NotificationList,
} from '@workspace/api-client-react';
import {
  LayoutDashboard, FileText, CreditCard, ArrowLeftRight, ArrowUpFromLine, PlusCircle, Settings, Bell, Search, Plus, Menu, X,
  Users, ArrowDownToLine, Snowflake, Building2, ScanLine, House, ClipboardList, ChartPie, Milestone,
  MessageCircleQuestion, Ellipsis, BadgeCheck, Upload, ArrowLeftRight as SwitchIcon, LogOut, Wallet, ChevronDown, Award, Gauge,
} from 'lucide-react';
import { usePendingTierRequests } from '@/lib/tier-requests';
import { Avatar, checkFile, cx, Field, FILE_RULES, fileSize, inputCls, Modal, money, Skel, useDismiss } from '@/components/bits';
import { CATEGORIES, apiError, useApplicantDashboard, useDemo, useNotifications, useRefreshApplicant } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth';
import { AdminAvatar, useAdminAccount } from '@/components/admin-photo';

type NavItem = { href: string; label: string; icon: typeof House };

/** The applicant menu, in groups (finding U1). Settings and Help sit at the bottom with the account card. */
const userNavGroups: { label: string; items: NavItem[] }[] = [
  { label: 'Overview', items: [
    { href: '/dashboard', label: 'Dashboard', icon: House },
    { href: '/applications', label: 'My Applications', icon: FileText },
    { href: '/milestones', label: 'Milestones', icon: Milestone },
  ] },
  { label: 'Find funding', items: [
    { href: '/grants', label: 'Grants', icon: Award },
  ] },
  { label: 'Track', items: [
    { href: '/funding-tracker', label: 'Funding Tracker', icon: ClipboardList },
    { href: '/reports', label: 'Reports', icon: ChartPie },
  ] },
  { label: 'Money', items: [
    { href: '/cards', label: 'Cards', icon: CreditCard },
    { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
    { href: '/withdrawals', label: 'Withdrawals', icon: ArrowUpFromLine },
    { href: '/deposits', label: 'Add funds', icon: PlusCircle },
  ] },
];
const userNavFooter: NavItem[] = [
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/help', label: 'Help Centre', icon: MessageCircleQuestion },
];
const adminNav: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/grant-plans', label: 'Grant Plans', icon: Award },
  { href: '/admin/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/admin/deposits', label: 'Deposit Page', icon: ArrowDownToLine },
  { href: '/admin/withdrawals', label: 'Withdrawal Page', icon: ArrowUpFromLine },
  { href: '/admin/payment-gateway', label: 'Payment Gateway', icon: Wallet },
  { href: '/admin/kyc', label: 'KYC Page', icon: ScanLine },
  { href: '/admin/cards', label: 'Card Requests', icon: CreditCard },
  { href: '/admin/tiers', label: 'Tier Upgrades', icon: Gauge },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];
/** Payment Gateway is a group: its pages are the method settings for each kind (the request queues stay on their own pages). */
const gatewayNav: NavItem[] = [
  { href: '/admin/payment-gateway/deposit', label: 'Deposit', icon: ArrowDownToLine },
  { href: '/admin/payment-gateway/withdrawal', label: 'Withdrawal', icon: ArrowUpFromLine },
];
const bottomNav: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: House },
  { href: '/grants', label: 'Grants', icon: Award },
  { href: '/applications', label: 'Apps', icon: FileText },
  { href: '/cards', label: 'Cards', icon: CreditCard },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const isActive = (loc: string, href: string) =>
  loc === href || (href === '/dashboard' && loc === '/') || (href === '/admin/users' && loc.startsWith('/admin/users')) || (href === '/admin/settings' && loc.startsWith('/admin/settings/')) || (href === '/applications' && loc.startsWith('/applications/')) || (href === '/grants' && loc.startsWith('/grants/'));
const testId = (href: string) => `link-nav-${href.replace(/\//g, '-').slice(1)}`;

/* ---------- Page title plumbing: pages render <Shell title>, the persistent layout renders the chrome ---------- */
const TitleCtx = createContext<(t: string) => void>(() => {});

/** Registers the page title with the persistent layout. `admin` is kept for call-site compatibility. */
export function Shell({ title, children }: { admin?: boolean; title: string; children: ReactNode }) {
  const setTitle = useContext(TitleCtx);
  useLayoutEffect(() => setTitle(title), [title, setTitle]);
  return <>{children}</>;
}

export function Layout({ admin, children }: { admin: boolean; children: ReactNode }) {
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState(false);
  const [loc] = useLocation();
  // Links to a section (e.g. /settings#verification) let that page scroll itself.
  useEffect(() => { setOpen(false); if (!window.location.hash) window.scrollTo(0, 0); }, [loc]);
  useEffect(() => {
    if (!title) return;
    document.title = `${title} | GrantApp`;
    const description = admin
      ? `${title}: grant administration.`
      : `${title}: apply for grants, follow your applications and manage your funding.`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
  }, [title, admin]);
  const close = useCallback(() => setOpen(false), []);
  return (
    <TitleCtx.Provider value={setTitle}>
      {admin
        ? <AdminFrame title={title} open={open} setOpen={setOpen} loc={loc}>{children}</AdminFrame>
        : <UserFrame title={title} open={open} setOpen={setOpen} close={close} loc={loc}>{children}</UserFrame>}
    </TitleCtx.Provider>
  );
}

const SkipLink = () => <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:bg-white focus:p-2">Skip to content</a>;

/* ================================================================== */
/* User workspace                                                      */
/* ================================================================== */

function Logo() {
  return (
    <Link href="/dashboard" aria-label="GrantApp home" className="flex items-center gap-1 px-2">
      <svg viewBox="0 0 28 24" className="h-6 w-7" aria-hidden="true">
        <path d="M1 3h6l6 13L22.5 1H27L14.5 23h-3z" fill="#1E3A8A" />
        <path d="M7 3h3.5l5 10.5-2 3.5z" fill="#3B82F6" />
      </svg>
      <span className="text-[22px] font-bold tracking-tight text-slate-900">GrantApp</span>
    </Link>
  );
}

function UserFrame({ title, open, setOpen, close, loc, children }: { title: string; open: boolean; setOpen: (b: boolean) => void; close: () => void; loc: string; children: ReactNode }) {
  const isDash = loc === '/' || loc === '/dashboard';
  return (
    <div className="theme-user min-h-[100dvh] bg-white lg:flex lg:bg-[#F3F4F6]">
      <SkipLink />
      <aside data-testid="sidebar-desktop" className="hidden border-r border-slate-200 bg-white px-3 py-5 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:gap-6 lg:overflow-y-auto">
        <Logo />
        <UserSidebar />
      </aside>
      {open && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={close} data-testid="overlay-drawer" />}
      <aside aria-hidden={!open} inert={!open} data-testid="drawer-mobile" className={cx('fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto bg-white px-3 py-5 shadow-2xl transition-transform duration-300 lg:hidden', open ? 'translate-x-0' : 'translate-x-full')}>
        <div className="flex items-center justify-between">
          <Logo />
          <button aria-label="Close menu" data-testid="button-close-drawer" onClick={close} className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <DrawerSearch onDone={close} />
        <UserSidebar onNav={close} />
      </aside>
      <div className="min-w-0 flex-1">
        <UserTopDesktop />
        <UserTopMobile title={title} isDash={isDash} onMenu={() => setOpen(true)} />
        <main id="main" className="mx-auto w-full max-w-[1280px] px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-10 lg:pt-6">
          {isDash ? (
            <div className="mb-5">
              <h1 className="sr-only">Dashboard</h1>
              <NewAppButton className="hidden lg:inline-flex" />
            </div>
          ) : (
            title && <h1 className="mb-5 hidden text-2xl font-bold text-slate-900 lg:block" data-testid="text-page-title">{title}</h1>
          )}
          <div key={loc} className="rise">{children}</div>
        </main>
        <BottomNav loc={loc} />
      </div>
    </div>
  );
}

/** Phase 11: applications are made to a grant plan, so "New Application" opens the Grants page. */
function NewAppButton({ className, testid = 'button-new-application' }: { className?: string; testid?: string }) {
  return (
    <Link href="/grants" data-testid={testid} className={cx('press items-center gap-1.5 rounded-full bg-[#1E3A8A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0F172A]', className)}>
      <Plus className="h-4 w-4" />New Application
    </Link>
  );
}

function NavRow({ item, active, onNav, count }: { item: NavItem; active: boolean; onNav?: () => void; count?: number }) {
  return (
    <Link href={item.href} onClick={onNav} aria-current={active ? 'page' : undefined} data-testid={testId(item.href)}
      className={cx('flex items-center gap-3 rounded-lg px-3 py-1.5 text-[15px] transition-colors duration-150',
        active ? 'bg-[#DBEAFE] font-semibold text-slate-900' : 'font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900')}>
      <item.icon className={cx('h-[18px] w-[18px] shrink-0', active ? 'text-[#1E3A8A]' : 'text-slate-500')} />
      <span className="flex-1 truncate">{item.label}</span>
      {count !== undefined && (
        <span data-testid="badge-applications-count" className="grid h-5 min-w-5 place-items-center rounded-full bg-slate-200 px-1.5 text-[11px] font-semibold text-slate-700">{count}</span>
      )}
    </Link>
  );
}

function UserSidebar({ onNav }: { onNav?: () => void }) {
  const [loc] = useLocation();
  const { data } = useApplicantDashboard();
  const count = data?.applicationCount;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <nav aria-label="User navigation" className="flex flex-col gap-3">
        {userNavGroups.map((g) => (
          <div key={g.label} role="group" aria-labelledby={`nav-group-${g.label.replace(/\s+/g, '-').toLowerCase()}`} className="flex flex-col gap-0.5">
            <p id={`nav-group-${g.label.replace(/\s+/g, '-').toLowerCase()}`} className="px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>
            {g.items.map((i) => <NavRow key={i.href} item={i} active={isActive(loc, i.href)} onNav={onNav} count={i.href === '/applications' ? count : undefined} />)}
          </div>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5">
        {userNavFooter.map((i) => <NavRow key={i.href} item={i} active={isActive(loc, i.href)} onNav={onNav} />)}
        <hr className="my-3 border-slate-200" />
        <UserCard onNav={onNav} />
      </div>
    </div>
  );
}

/** Signs out and says so if it fails; the auth gate then shows the sign-in page. */
function useSignOut() {
  const { signOut } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return { busy, run: async () => {
    setBusy(true);
    try { await signOut(); } catch { toast({ title: "Couldn't sign out", description: 'Check your connection and try again.', variant: 'destructive' }); }
    setBusy(false);
  } };
}

function UserCard({ onNav }: { onNav?: () => void }) {
  const { data } = useApplicantDashboard();
  const { status } = useAuth();
  const out = useSignOut();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  if (!data) return <Skel className="h-12" />;
  const go = () => { close(); onNav?.(); };
  return (
    <div ref={ref} className="relative flex items-center gap-3 px-2" data-testid="card-user">
      <Avatar name={data.profile.name} url={data.profile.avatarUrl} className="h-10 w-10 text-base" testid="avatar-sidebar" />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-semibold text-slate-900" data-testid="text-sidebar-name">{data.profile.name}</p>
        <p className="truncate text-xs text-slate-500">{data.profile.organization}</p>
      </div>
      <button aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} data-testid="button-user-menu" onClick={() => setOpen(!open)} className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><Ellipsis className="h-5 w-5" /></button>
      {open && (
        <div role="menu" className="pop absolute bottom-full left-0 right-0 z-50 mb-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          <Link role="menuitem" href="/settings" onClick={go} data-testid="menu-account-settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-100"><Settings className="h-4 w-4 text-slate-500" />Account settings</Link>
          {status === 'demo' ? (
            <>
              <Link role="menuitem" href="/admin" onClick={go} data-testid="button-admin-workspace" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-100"><SwitchIcon className="h-4 w-4 text-slate-500" />Switch to admin view</Link>
              <p className="mt-1 border-t border-slate-100 px-3 pb-1 pt-2 text-[11px] leading-snug text-slate-500" data-testid="text-demo-note">Demo preview. No real sign-in, transfers, card networks or OCR are connected.</p>
            </>
          ) : (
            <>
              <button role="menuitem" onClick={out.run} disabled={out.busy} data-testid="menu-sign-out" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-60"><LogOut className="h-4 w-4 text-slate-500" />{out.busy ? 'Signing out…' : 'Sign out'}</button>
              <p className="mt-1 border-t border-slate-100 px-3 pb-1 pt-2 text-[11px] leading-snug text-slate-500" data-testid="text-demo-note">Preview with sample grants. No real transfers, card networks or OCR are connected.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The organisation name. A plain label: applicants belong to one organisation, so there is nothing to switch (finding U5). */
function OrgLabel({ name }: { name: string }) {
  return (
    <p className="flex items-center gap-2 px-2 text-[15px] font-semibold text-slate-900" data-testid="text-org-name">
      <Building2 className="h-4 w-4 text-slate-500" aria-hidden="true" />{name}
    </p>
  );
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function NotificationBell({ compact }: { compact?: boolean }) {
  const q = useNotifications();
  const qc = useQueryClient();
  const markRead = useMarkApplicantNotificationsRead();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const unread = q.data?.unread ?? 0;
  const items = q.data?.items ?? [];
  const toggle = async () => {
    setOpen(!open);
    if (open || unread === 0) return;
    // Cancel any in-flight refetch so a stale response can't bring the dot back, clear it now, then confirm with the server.
    const key = getListApplicantNotificationsQueryKey();
    await qc.cancelQueries({ queryKey: key });
    qc.setQueryData<NotificationList>(key, (d) => (d ? { unread: 0, items: d.items.map((n) => ({ ...n, read: true })) } : d));
    markRead.mutate(undefined, { onSuccess: (d) => qc.setQueryData(key, d), onError: () => qc.invalidateQueries({ queryKey: key }) });
  };
  return (
    <div ref={ref} className="relative">
      <button aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} data-testid="button-notifications" onClick={toggle}
        className={cx('relative grid place-items-center rounded-full text-slate-700', compact ? 'h-11 w-11 bg-slate-100 hover:bg-slate-200' : 'h-10 w-10 hover:bg-slate-100')}>
        <Bell className="h-5 w-5" />
        {unread > 0 && <span data-testid="badge-notification-dot" className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />}
      </button>
      {open && (
        <div className="pop absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-2 shadow-xl" data-testid="panel-notifications">
          <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Notifications</p>
          {q.isError ? <p className="px-2 py-3 text-sm text-red-700">Couldn't load notifications.</p>
            : items.length === 0 ? <p className="px-2 py-3 text-sm text-slate-500">You're all caught up.</p>
            : (
              <ul className="max-h-80 overflow-y-auto">
                {items.map((n) => {
                  const body = <><span className="block text-sm text-slate-800">{n.message}</span><span className="block text-xs text-slate-500">{ago(n.createdAt)}</span></>;
                  return (
                    <li key={n.id} className="border-t border-slate-100 first:border-0" data-testid={`notification-${n.id}`}>
                      {n.link ? <Link href={n.link} onClick={close} className="block rounded-lg px-2 py-2 hover:bg-slate-50">{body}</Link> : <div className="px-2 py-2">{body}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}

function UserTopDesktop() {
  const { data } = useApplicantDashboard();
  const { search, setSearch } = useDemo();
  const [loc, nav] = useLocation();
  return (
    <header className="sticky top-0 z-30 hidden h-16 items-center gap-3 border-b border-slate-200 bg-white px-8 lg:flex">
      {data ? <OrgLabel name={data.profile.organization} /> : <Skel className="h-7 w-40" />}
      <div className="ml-auto flex items-center gap-3">
        <NotificationBell />
        <form role="search" onSubmit={(e) => { e.preventDefault(); if (loc !== '/applications' && loc !== '/dashboard' && loc !== '/') nav('/applications'); }} className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input data-testid="input-global-search" type="search" aria-label="Search applications" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
            className="w-56 rounded-full border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-[#1E3A8A] focus:ring-2 focus:ring-[#1E3A8A]/20" />
        </form>
      </div>
    </header>
  );
}

/** The header search on phones: lives in the menu, filters applications like the desktop one, Enter opens Applications. */
function DrawerSearch({ onDone }: { onDone: () => void }) {
  const { search, setSearch } = useDemo();
  const [loc, nav] = useLocation();
  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); onDone(); if (loc !== '/applications') nav('/applications'); }} className="relative px-1">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input data-testid="input-drawer-search" type="search" enterKeyHint="search" aria-label="Search applications" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search applications"
        className="w-full rounded-full border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-[15px] outline-none transition focus:border-[#1E3A8A] focus:ring-2 focus:ring-[#1E3A8A]/20" />
    </form>
  );
}

function UserTopMobile({ title, isDash, onMenu }: { title: string; isDash: boolean; onMenu: () => void }) {
  const { data } = useApplicantDashboard();
  const menu = (
    <button aria-label="Open menu" data-testid="button-open-drawer" onClick={onMenu} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"><Menu className="h-5 w-5" /></button>
  );
  if (!isDash) {
    return (
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <h1 className="flex-1 truncate text-lg font-bold text-slate-900" data-testid="text-page-title-mobile">{title}</h1>
        <NotificationBell compact />
        {menu}
      </header>
    );
  }
  return (
    <header className="px-4 pb-2 pt-5 lg:hidden" data-testid="section-greeting">
      <div className="flex items-start gap-3">
        {data ? (
          <>
            <Avatar name={data.profile.name} url={data.profile.avatarUrl} className="h-12 w-12 text-lg" testid="avatar-mobile" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-lg font-semibold text-slate-900"><span className="truncate" data-testid="text-profile-name">{data.profile.name}</span>
                {data.profile.verified && <BadgeCheck data-testid="badge-verified" aria-label="Verified" className="h-5 w-5 shrink-0 fill-[#16A34A] text-white" />}</p>
              <p className="truncate text-sm text-slate-600" data-testid="text-profile-org">{data.profile.organization}</p>
            </div>
          </>
        ) : <Skel className="h-12 flex-1" />}
        <NotificationBell compact />
        {menu}
      </div>
      {/* Phones: start an application straight from the dashboard, like the desktop button (finding UM1). */}
      <NewAppButton className="mt-4 flex w-full justify-center py-2.5 text-[15px]" testid="button-new-application-mobile" />
    </header>
  );
}

function BottomNav({ loc }: { loc: string }) {
  return (
    <nav aria-label="Bottom navigation" data-testid="nav-bottom" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {bottomNav.map((b) => {
        const a = isActive(loc, b.href);
        return (
          <Link key={b.href} href={b.href} data-testid={`button-bottom-${b.label.toLowerCase()}`} aria-current={a ? 'page' : undefined}
            className={cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', a ? 'text-[#1E3A8A]' : 'text-slate-500')}>
            <span className={cx('grid h-7 w-12 place-items-center rounded-full transition-colors', a && 'bg-[#DBEAFE]')}><b.icon className="h-5 w-5" /></span>{b.label}
          </Link>
        );
      })}
    </nav>
  );
}

function WorkspaceSwitch() {
  const [, nav] = useLocation();
  return (
    <div role="group" aria-label="Demo workspace switch" data-testid="switch-workspace" className="grid grid-cols-2 rounded-full bg-white/10 p-0.5 text-xs font-semibold">
      {[{ admin: false, l: 'User view', to: '/dashboard' }, { admin: true, l: 'Admin view', to: '/admin' }].map((o) => (
        <button key={o.l} aria-pressed={o.admin} data-testid={o.admin ? 'button-admin-workspace' : 'button-user-workspace'} onClick={() => nav(o.to)}
          className={cx('press rounded-full px-2 py-1.5 transition-all duration-200 whitespace-nowrap', o.admin ? 'bg-[#C6F432] text-[#111]' : 'text-slate-300 hover:text-white')}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

function AdminNavList({ onNav }: { onNav?: () => void }) {
  const [loc] = useLocation();
  const inGateway = loc.startsWith('/admin/payment-gateway');
  const [open, setOpen] = useState(inGateway);
  useEffect(() => { if (inGateway) setOpen(true); }, [inGateway]);
  // Activation requests waiting (the same query the Card Requests page uses, so deciding one updates the badge).
  const cardRequests = useListAdminCardRequests({ status: 'requested' }, { query: { queryKey: getListAdminCardRequestsQueryKey({ status: 'requested' }), refetchInterval: 60_000 } }).data?.requested ?? 0;
  const tierRequests = usePendingTierRequests(60_000).data?.length ?? 0;
  const row = (active: boolean) => cx('group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
    active ? 'bg-[#C6F432] text-[#111] font-semibold' : 'text-slate-300 hover:bg-white/10 hover:text-white hover:translate-x-0.5');
  return (
    <nav aria-label="Admin navigation" className="flex flex-col gap-1">
      {adminNav.map((i) => {
        if (i.href === '/admin/payment-gateway') {
          return (
            <div key={i.href}>
              <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="nav-payment-gateway" data-testid="button-nav-payment-gateway"
                className={cx(row(false), 'w-full', inGateway && !open && 'bg-white/10 text-white')}>
                <i.icon className="h-[18px] w-[18px]" />
                <span className="flex-1 text-left">{i.label}</span>
                <ChevronDown className={cx('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
              </button>
              {open && (
                <div id="nav-payment-gateway" className="ml-5 mt-1 flex flex-col gap-1 border-l border-white/10 pl-3">
                  {gatewayNav.map((c) => {
                    const active = loc === c.href;
                    return (
                      <Link key={c.href} href={c.href} onClick={onNav} aria-current={active ? 'page' : undefined} data-testid={testId(c.href)} className={row(active)}>
                        <c.icon className="h-4 w-4" /><span className="flex-1">{c.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }
        const active = isActive(loc, i.href);
        return (
          <Link key={i.href} href={i.href} onClick={onNav} aria-current={active ? 'page' : undefined} data-testid={testId(i.href)} className={row(active)}>
            <i.icon className="h-[18px] w-[18px]" />
            <span className="flex-1">{i.label}</span>
            {i.href === '/admin/tiers' && tierRequests > 0 && (
              <span data-testid="badge-tier-requests" aria-label={`${tierRequests} waiting`} className={cx('font-num grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold', active ? 'bg-[#111] text-[#C6F432]' : 'bg-[#C6F432] text-[#111]')}>{tierRequests}</span>
            )}
            {i.href === '/admin/cards' && cardRequests > 0 && (
              <span data-testid="badge-card-requests" aria-label={`${cardRequests} waiting`} className={cx('font-num grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold', active ? 'bg-[#111] text-[#C6F432]' : 'bg-[#C6F432] text-[#111]')}>{cardRequests}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function AdminBrand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#C6F432] font-display text-lg font-extrabold text-[#111]">G</span>
      <div className="leading-tight">
        <div className="font-display text-base font-bold text-white">GrantApp</div>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-[#C6F432]">Command center</div>
      </div>
    </div>
  );
}

function AdminSidebarBody({ onNav }: { onNav?: () => void }) {
  const { status, me } = useAuth();
  const account = useAdminAccount();
  const out = useSignOut();
  return (
    <div className="flex flex-1 flex-col gap-6">
      <AdminNavList onNav={onNav} />
      {status === 'demo' ? (
        <div className="mt-auto space-y-3">
          <div className="rounded-xl bg-white/5 p-3 text-xs leading-relaxed text-slate-400">
            <strong className="text-[#C6F432]">DEMO preview.</strong> Switch workspaces to see both sides of the sample data.
          </div>
          <WorkspaceSwitch />
        </div>
      ) : (
        <div className="mt-auto rounded-xl bg-white/5 p-3" data-testid="card-admin-account">
          <div className="flex items-center gap-3">
            <AdminAvatar name={account?.name ?? me?.name ?? ''} url={account?.avatarUrl} className="h-10 w-10 text-sm" testid="avatar-admin-sidebar" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Signed in as</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-white" data-testid="text-admin-email" title={me?.email}>{me?.email}</p>
            </div>
          </div>
          <button onClick={out.run} disabled={out.busy} data-testid="button-sign-out"
            className="press mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-white/15 px-3 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60">
            <LogOut className="h-4 w-4" />{out.busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}

function AdminFrame({ title, open, setOpen, loc, children }: { title: string; open: boolean; setOpen: (b: boolean) => void; loc: string; children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#F4F5F8] lg:flex">
      <SkipLink />
      <aside className="hidden border-r border-slate-800 bg-[#111111] p-4 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:gap-6 lg:overflow-y-auto" data-testid="sidebar-desktop">
        <AdminBrand />
        <AdminSidebarBody />
      </aside>
      {open && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} data-testid="overlay-drawer" />}
      <aside aria-hidden={!open} inert={!open} data-testid="drawer-mobile" className={cx('fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-6 overflow-y-auto bg-[#111111] p-4 transition-transform duration-300 lg:hidden', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center justify-between">
          <AdminBrand />
          <button aria-label="Close menu" data-testid="button-close-drawer" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full text-white hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
        <AdminSidebarBody onNav={() => setOpen(false)} />
      </aside>
      <div className="min-w-0 flex-1">
        <AdminTop title={title} onMenu={() => setOpen(true)} />
        <main id="main" className="mx-auto w-full max-w-[1280px] p-4 sm:p-6">
          <div key={loc} className="rise">{children}</div>
          <AdminFootNote />
        </main>
      </div>
    </div>
  );
}

function AdminFootNote() {
  const { status } = useAuth();
  return (
    <p className="mt-8 text-center text-xs text-slate-500" data-testid="text-demo-note">
      {status === 'demo'
        ? 'Demo preview. No real sign-in, transfers, card networks or OCR are connected; there is one shared demo administrator.'
        : 'Sample data. No real transfers, card networks or OCR are connected.'}
    </p>
  );
}

function AdminTop({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { data } = useGetAdminDashboard();
  const account = useAdminAccount();
  const [confirm, setConfirm] = useState(false);
  const [searching, setSearching] = useState(false); // phones: the search row opens from an icon
  const [loc] = useLocation();
  useEffect(() => setSearching(false), [loc]);
  const frozen = data?.globalFrozen ?? false;
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur" data-testid="header-admin">
      {/* One 64 px row: title left, search fills the middle (md+), freeze and avatar pinned right. */}
      <div className="flex min-h-16 flex-wrap items-center gap-2 px-4 py-3 sm:px-6 md:flex-nowrap md:gap-4">
        <button aria-label="Open menu" data-testid="button-open-drawer" onClick={onMenu} className="press grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#111] text-[#C6F432] lg:hidden"><Menu className="h-5 w-5" /></button>
        <h1 className="min-w-0 flex-1 truncate font-display text-lg font-bold sm:text-xl md:max-w-[16rem] md:flex-none lg:max-w-[20rem]" data-testid="text-page-title">{title}</h1>
        <AdminSearch open={searching} onClose={() => setSearching(false)} className={cx('order-last basis-full md:order-none md:block md:max-w-xl md:flex-1 md:basis-auto', searching ? 'block' : 'hidden')} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button type="button" aria-label={searching ? 'Close search' : 'Search'} aria-expanded={searching} data-testid="button-admin-search-toggle" onClick={() => setSearching(!searching)}
            className={cx('press grid h-10 w-10 place-items-center rounded-lg border md:hidden', searching ? 'border-[#111] bg-[#111] text-[#C6F432]' : 'border-slate-300 text-slate-700')}>
            {searching ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
          <button data-testid="button-global-freeze" onClick={() => setConfirm(true)} disabled={!data} aria-label={frozen ? 'Lift global freeze' : 'Freeze the platform'} className={cx('press flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition disabled:opacity-50', frozen ? 'bg-[#C6F432] text-[#111]' : 'bg-red-700 text-white hover:bg-red-800')}>
            <Snowflake className="h-4 w-4" /><span className="sm:hidden">{frozen ? 'Lift' : 'Freeze'}</span><span className="hidden sm:inline">{frozen ? 'Lift freeze' : 'Freeze platform'}</span>
          </button>
          {account && (
            <Link href="/admin/settings/account" aria-label={`Your profile and settings (${account.email || account.name})`} title={account.email || account.name} data-testid="link-admin-avatar" className="press hidden shrink-0 rounded-full sm:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111]/40">
              <AdminAvatar name={account.name} url={account.avatarUrl} className="h-10 w-10 text-sm" testid="avatar-admin-header" />
            </Link>
          )}
        </div>
      </div>
      {frozen && <div data-testid="banner-frozen" className="bg-red-700 px-6 py-1.5 text-center text-xs font-semibold text-white">Platform is globally frozen. Balance credits, approvals and new deposit or withdrawal requests are paused.</div>}
      <GlobalFreezeDialog open={confirm} onClose={() => setConfirm(false)} frozen={frozen} />
    </header>
  );
}

/** Confirmation (with an optional reason for the audit log) before the platform-wide freeze is switched. */
export function GlobalFreezeDialog({ open, onClose, frozen }: { open: boolean; onClose: () => void; frozen: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const freeze = useUpdateGlobalFreeze();
  useEffect(() => { if (open) setReason(''); }, [open]);
  const go = () =>
    freeze.mutate({ data: { frozen: !frozen, reason: reason.trim() || undefined } }, {
      onSuccess: (r) => {
        qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/api/admin') });
        toast({ title: r.frozen ? 'Global freeze enabled' : 'Global freeze lifted' });
        onClose();
      },
      onError: () => toast({ title: 'Freeze update failed', variant: 'destructive' }),
    });
  return (
    <Modal open={open} onClose={onClose} title={frozen ? 'Lift global freeze?' : 'Enable global freeze?'} testid="dialog-global-freeze">
      <p className="mb-3 text-sm text-slate-600">
        {frozen ? 'Balance credits, approvals and applicant requests will be allowed again.' : 'Balance credits, approvals of deposits, withdrawals and grant awards, and new applicant requests are refused until the freeze is lifted.'} The change is written to the audit log. Sample data only.
      </p>
      <textarea data-testid="input-freeze-reason" aria-label="Reason (optional)" maxLength={240} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional, recorded in the audit log)" className="mb-4 h-24 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-[#111] focus:ring-2 focus:ring-[#C6F432]" />
      <div className="flex justify-end gap-2">
        <button data-testid="button-freeze-cancel" onClick={onClose} className="press rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-100">Cancel</button>
        <button data-testid="button-freeze-confirm" disabled={freeze.isPending} onClick={go} className="press rounded-lg bg-[#111] px-4 py-2 text-sm font-semibold text-[#C6F432] disabled:opacity-60">{freeze.isPending ? 'Applying…' : frozen ? 'Lift freeze' : 'Freeze platform'}</button>
      </div>
    </Modal>
  );
}

/** Header search over users, applications, ledger entries and audit logs (names, text or IDs). */
function AdminSearch({ className, open: shown, onClose }: { className?: string; open?: boolean; onClose?: () => void }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (shown) input.current?.focus(); }, [shown]);
  const [open, setOpen] = useState(false);
  const [, nav] = useLocation();
  const ref = useRef<HTMLFormElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const term = useDeferredValue(text.trim());
  const params = { q: term };
  const q = useSearchAdmin(params, { query: { enabled: term.length >= 2, queryKey: getSearchAdminQueryKey(params), placeholderData: keepPreviousData } });
  const go = (href: string) => { close(); setText(''); onClose?.(); nav(href); };
  const r = term.length >= 2 ? q.data : undefined;
  const empty = r && !r.users.length && !r.applications.length && !r.transactions.length && !r.audit.length;
  const row = 'flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-[#F7FADC]';
  const group = (label: string, items: ReactNode[]) => items.length > 0 && (
    <div className="py-1"><p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>{items}</div>
  );
  return (
    <form ref={ref} role="search" onSubmit={(e) => { e.preventDefault(); if (term) go(`/admin/users?q=${encodeURIComponent(term)}`); }} className={cx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input ref={input} data-testid="input-admin-search" type="search" enterKeyHint="search" aria-label="Search users, applications, transactions and logs" value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search users, applications, ledger, audit log"
        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#111] focus:ring-2 focus:ring-[#C6F432]" />
      {open && term.length >= 2 && (
        <div className="pop absolute left-0 right-0 top-full z-50 mt-2 max-h-[70dvh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl md:w-[26rem]" data-testid="panel-admin-search">
          {q.isError ? <p className="px-2 py-3 text-sm text-red-700">Search failed. Try again.</p>
            : !r ? <p className="px-2 py-3 text-sm text-slate-500">Searching…</p>
            : empty ? <p className="px-2 py-3 text-sm text-slate-500" data-testid="text-search-empty">No matches for “{term}”.</p>
            : <>
              {group('Users', r.users.map((u) => <button type="button" key={u.id} className={row} onClick={() => go(`/admin/users/${u.id}`)} data-testid={`search-user-${u.id}`}><span className="text-sm font-semibold">{u.name}</span><span className="text-xs text-slate-500">{u.email} · {u.organization}</span></button>))}
              {group('Applications', r.applications.map((a) => <button type="button" key={a.id} className={row} onClick={() => go(`/admin/users/${a.userId}/applications/${a.id}`)} data-testid={`search-app-${a.id}`}><span className="text-sm font-semibold">{a.title}</span><span className="text-xs text-slate-500">{a.id} · {a.userName} · {a.status === 'Review' ? 'Under review' : a.status}</span></button>))}
              {group('Ledger', r.transactions.map((t) => <button type="button" key={t.id} className={row} onClick={() => go(`/admin/transactions?q=${t.id.slice(0, 8)}`)} data-testid={`search-tx-${t.id}`}><span className="text-sm font-semibold">{t.kind} · {money(t.amount)}</span><span className="truncate text-xs text-slate-500">{t.userName} · {t.reason}</span></button>))}
              {group('Audit log', r.audit.map((a) => <button type="button" key={a.id} className={row} onClick={() => go(`/admin/audit?search=${a.id}`)} data-testid={`search-audit-${a.id}`}><span className="text-sm">{a.action}</span><span className="text-xs text-slate-500">{a.subject} · {a.actor} · {new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></button>))}
            </>}
        </div>
      )}
    </form>
  );
}
