import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import {
  useListAdminMailboxes, useListAdminMailThreads, useGetAdminMailThread, useUpdateAdminMailThreads, useDeleteAdminMailThreads, useRetryAdminMailSend, useDeleteAdminMailDraft,
  getListAdminMailboxesQueryKey, getListAdminMailThreadsQueryKey, getGetAdminMailThreadQueryKey, getAdminMailDraft,
  type Mailbox, type MailMessage, type MailThread, type MailView, type MailThreadDetail,
} from '@workspace/api-client-react';
import {
  AlertTriangle, Archive, ArrowLeft, ChevronLeft, ChevronRight, Clock, File as FileIcon, Forward, Inbox, Keyboard, Loader2, Mail as MailIcon, MailOpen, Menu, Paperclip,
  Pencil, RefreshCw, Reply, ReplyAll, Search, Send, ShieldAlert, Star, Trash2, Undo2, UserRound, X,
} from 'lucide-react';
import { Shell } from '@/components/shell';
import { ToastAction } from '@/components/ui/toast';
import { Avatar, Modal, Skel, cx } from '@/components/bits';
import { ComposeWindow, type ComposeRequest } from '@/components/mail/compose';
import { MailBody } from '@/components/mail/mail-body';
import { AttachmentCards } from '@/components/mail/mail-files';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/**
 * Mail (Phase 14, email.md §5): the admin mail box, laid out like Gmail in the app's own brand. Every administrator
 * sees every mailbox. The view, mailbox, search, page and open conversation live in the address bar.
 */

const VIEWS: { key: MailView; label: string; icon: typeof Inbox }[] = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'starred', label: 'Starred', icon: Star },
  { key: 'sent', label: 'Sent', icon: Send },
  { key: 'drafts', label: 'Drafts', icon: FileIcon },
  { key: 'archive', label: 'Archive', icon: Archive },
  { key: 'spam', label: 'Spam', icon: ShieldAlert },
  { key: 'trash', label: 'Trash', icon: Trash2 },
  { key: 'all', label: 'All mail', icon: MailIcon },
];

const pad = (n: number) => String(n).padStart(2, '0');
/** Gmail's list dates: time today, "18 Nov" this year, else 18/11/2025. */
export function listDate(iso: string) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-GB');
}
const fullDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const who = (a: { name?: string | null; address: string }) => a.name || a.address.split('@')[0]!;

function useMailParams() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const p = new URLSearchParams(search);
  const params = {
    view: ((VIEWS.some((v) => v.key === p.get('view')) ? p.get('view') : 'inbox') as MailView),
    box: p.get('box') ?? 'all',
    q: p.get('q') ?? '',
    page: Math.max(1, Number(p.get('page') ?? 1) || 1),
    thread: p.get('t'),
    unread: p.get('unread') === '1',
    attachments: p.get('att') === '1',
  };
  const go = useCallback((next: Partial<typeof params>) => {
    const merged = { ...params, ...next };
    const s = new URLSearchParams();
    if (merged.view !== 'inbox') s.set('view', merged.view);
    if (merged.box !== 'all') s.set('box', merged.box);
    if (merged.q) s.set('q', merged.q);
    if (merged.page > 1) s.set('page', String(merged.page));
    if (merged.thread) s.set('t', merged.thread);
    if (merged.unread) s.set('unread', '1');
    if (merged.attachments) s.set('att', '1');
    const qs = s.toString();
    navigate(`/admin/mail${qs ? `?${qs}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, navigate]);
  return { ...params, go };
}

export function AdminMailPage() {
  const p = useMailParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const boxesQ = useListAdminMailboxes({ query: { queryKey: getListAdminMailboxesQueryKey(), refetchInterval: 15_000 } });
  const boxes = boxesQ.data ?? [];
  const [compose, setCompose] = useState<ComposeRequest | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const [searchText, setSearchText] = useState(p.q);
  useEffect(() => setSearchText(p.q), [p.q]);
  const defaultBox = (p.box !== 'all' ? p.box : boxes.find((b) => b.systemSender)?.id) ?? boxes.find((b) => b.enabled)?.id ?? '';
  const refresh = useCallback(() => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/api/admin/mail') }), [qc]);

  const openCompose = useCallback((r: Omit<ComposeRequest, 'key'>) => setCompose({ ...r, key: Date.now() }), []);
  const openDraft = useCallback(async (id: string) => {
    try { const d = await getAdminMailDraft(id); openCompose({ mode: 'draft', mailboxId: d.mailboxId, draft: d }); }
    catch (e) { toast({ title: "The draft couldn't be opened", description: apiError(e, 'It may have been sent or deleted.'), variant: 'destructive' }); refresh(); }
  }, [openCompose, toast, refresh]);

  // Shortcuts that work everywhere on the page (list and conversation ones live in their components).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if ((t instanceof Element && t.closest('input,textarea,select,[contenteditable="true"]')) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'c' && boxes.some((b) => b.enabled)) { e.preventDefault(); openCompose({ mode: 'new', mailboxId: defaultBox }); }
      else if (e.key === '/') { e.preventDefault(); document.getElementById('mail-search')?.focus(); }
      else if (e.key === '?') setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boxes, defaultBox, openCompose]);

  const unreadTotal = boxes.reduce((s, b) => s + b.unread, 0);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = unreadTotal ? `(${unreadTotal}) ${base}` : base;
  }, [unreadTotal, p.view, p.thread]);

  if (boxesQ.isLoading) return <Shell admin title="Mail"><div className="space-y-3"><Skel className="h-12 w-full" /><Skel className="h-96 w-full" /></div></Shell>;
  if (!boxes.length) {
    return (
      <Shell admin title="Mail">
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center" data-testid="mail-not-set-up">
          <MailIcon className="mx-auto h-10 w-10 text-slate-400" />
          <h2 className="mt-3 text-lg font-bold text-slate-900">Mail isn't set up yet</h2>
          <p className="mt-2 text-sm text-slate-600">Connect your domain, turn on receiving and create a mailbox (for example support@) in Settings → Email. Then mail sent to it arrives here.</p>
          <Link href="/admin/settings/email" className="press mt-5 inline-flex min-h-11 items-center rounded-lg bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--brand-fg)]" data-testid="link-mail-setup">Set up email</Link>
        </div>
      </Shell>
    );
  }

  const rail = (
    <MailRail boxes={boxes} p={p} onCompose={() => openCompose({ mode: 'new', mailboxId: defaultBox })} onNav={() => setDrawer(false)} />
  );
  return (
    <Shell admin title="Mail">
      <div className="-m-4 flex h-[calc(100dvh-4rem)] min-h-[32rem] bg-[#F6F8FC] sm:-m-6" data-testid="mail-page">
        <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto px-2 py-3 lg:flex">{rail}</aside>
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="Folders">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-[#F6F8FC] px-2 py-3 shadow-xl">{rail}</aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col pb-2 pr-0 sm:pr-3">
          {/* Search bar */}
          <form className="flex items-center gap-2 px-2 py-2 sm:px-0" role="search" onSubmit={(e) => { e.preventDefault(); p.go({ q: searchText.trim(), page: 1, thread: null }); }}>
            <button type="button" aria-label="Folders" onClick={() => setDrawer(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-slate-200 lg:hidden" data-testid="button-mail-folders"><Menu className="h-5 w-5" /></button>
            <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#E9EEF6] px-4 focus-within:bg-white focus-within:shadow-md">
              <Search className="h-5 w-5 shrink-0 text-slate-600" />
              <input id="mail-search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search mail" aria-label="Search mail" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" data-testid="input-mail-search" />
              {(searchText || p.q) && <button type="button" aria-label="Clear search" onClick={() => { setSearchText(''); p.go({ q: '', page: 1 }); }} className="grid h-8 w-8 place-items-center rounded-full hover:bg-slate-200"><X className="h-4 w-4" /></button>}
            </div>
            <button type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelp(true)} className="hidden h-11 w-11 place-items-center rounded-full hover:bg-slate-200 sm:grid"><Keyboard className="h-5 w-5 text-slate-600" /></button>
            <MailboxSwitcher boxes={boxes} value={p.box} onChange={(box) => p.go({ box, page: 1, thread: null })} />
          </form>
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-white">
            {p.thread
              ? <ThreadView id={p.thread} boxes={boxes} onBack={() => p.go({ thread: null })} onCompose={openCompose} onOpenDraft={openDraft} />
              : <ThreadList p={p} boxes={boxes} onOpenDraft={openDraft} />}
          </div>
        </div>
        <button type="button" onClick={() => openCompose({ mode: 'new', mailboxId: defaultBox })} aria-label="Compose"
          className="press fixed bottom-24 right-4 z-30 inline-flex h-14 items-center gap-2 rounded-2xl bg-[var(--brand-soft2)] px-5 text-sm font-semibold text-slate-900 shadow-lg lg:hidden" data-testid="button-compose-fab">
          <Pencil className="h-5 w-5" />Compose
        </button>
      </div>
      {compose && (
        <ComposeWindow key={compose.key} request={compose} mailboxes={boxes} onClose={() => { setCompose(null); refresh(); }}
          onSent={() => refresh()} onReopen={(r) => { setCompose(r); refresh(); }} />
      )}
      <ShortcutsHelp open={help} onClose={() => setHelp(false)} />
    </Shell>
  );
}

/* ------------------------------------------------------------------ left rail */

function MailRail({ boxes, p, onCompose, onNav }: { boxes: Mailbox[]; p: ReturnType<typeof useMailParams>; onCompose: () => void; onNav: () => void }) {
  const box = boxes.find((b) => b.id === p.box);
  const unread = box ? box.unread : boxes.reduce((s, b) => s + b.unread, 0);
  const drafts = box ? box.drafts : boxes.reduce((s, b) => s + b.drafts, 0);
  const enabled = boxes.some((b) => b.enabled);
  return (
    <>
      <button type="button" onClick={() => { onNav(); onCompose(); }} disabled={!enabled}
        className="press mb-4 ml-1 inline-flex h-14 w-fit items-center gap-3 rounded-2xl bg-[var(--brand-soft2)] px-5 text-sm font-semibold text-slate-900 shadow-sm transition hover:shadow-md disabled:opacity-60" data-testid="button-compose">
        <Pencil className="h-5 w-5" />Compose
      </button>
      <nav aria-label="Mail folders" className="flex flex-col">
        {VIEWS.map((v) => {
          const active = p.view === v.key && !p.q;
          const count = v.key === 'inbox' ? unread : v.key === 'drafts' ? drafts : 0;
          return (
            <button key={v.key} type="button" onClick={() => { onNav(); p.go({ view: v.key, page: 1, thread: null, q: '' }); }} aria-current={active ? 'page' : undefined}
              className={cx('flex h-9 items-center gap-4 rounded-r-full pl-5 pr-4 text-left text-sm', active ? 'bg-[var(--brand-soft2)] font-bold text-slate-900' : 'text-slate-700 hover:bg-slate-200/70')} data-testid={`folder-${v.key}`}>
              <v.icon className="h-[18px] w-[18px]" />
              <span className="flex-1">{v.label}</span>
              {count > 0 && <span className={cx('font-num text-xs', v.key === 'inbox' && 'font-bold')} data-testid={`count-${v.key}`}>{count}</span>}
            </button>
          );
        })}
      </nav>
      <p className="mb-1 ml-5 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Mailboxes</p>
      <nav aria-label="Mailboxes" className="flex flex-col">
        {[{ id: 'all', address: 'All mailboxes', unread: boxes.reduce((s, b) => s + b.unread, 0), enabled: true }, ...boxes].map((b) => {
          const active = p.box === b.id;
          return (
            <button key={b.id} type="button" onClick={() => { onNav(); p.go({ box: b.id, page: 1, thread: null }); }} aria-current={active ? 'true' : undefined}
              className={cx('flex h-9 items-center gap-3 rounded-r-full pl-5 pr-4 text-left text-sm', active ? 'bg-slate-200 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-200/70', !b.enabled && 'opacity-60')} data-testid={`mailbox-${b.address}`}>
              <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', b.id === 'all' ? 'bg-slate-400' : 'bg-[var(--brand)]')} />
              <span className="min-w-0 flex-1 truncate">{b.address}</span>
              {b.unread > 0 && <span className="font-num text-xs font-bold">{b.unread}</span>}
            </button>
          );
        })}
      </nav>
      <Link href="/admin/settings/email" className="ml-5 mt-4 text-xs font-medium text-slate-600 hover:underline" data-testid="link-mail-settings">Mailboxes and signatures</Link>
    </>
  );
}

function MailboxSwitcher({ boxes, value, onChange }: { boxes: Mailbox[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="relative hidden sm:block">
      <span className="sr-only">Mailbox</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-11 max-w-[15rem] truncate rounded-full border border-slate-300 bg-white pl-4 pr-8 text-sm font-medium outline-none hover:border-slate-400" data-testid="select-mailbox">
        <option value="all">All mailboxes</option>
        {boxes.map((b) => <option key={b.id} value={b.id}>{b.address}{b.unread ? ` (${b.unread})` : ''}</option>)}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------ list */

function IconButton({ label, onClick, children, testid, disabled }: { label: string; onClick: () => void; children: ReactNode; testid?: string; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="grid h-10 w-10 place-items-center rounded-full text-slate-700 hover:bg-slate-100 disabled:opacity-40" data-testid={testid}>
      {children}
    </button>
  );
}

function ThreadList({ p, boxes, onOpenDraft }: { p: ReturnType<typeof useMailParams>; boxes: Mailbox[]; onOpenDraft: (id: string) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const params = { mailboxId: p.box !== 'all' ? p.box : undefined, view: p.view, q: p.q || undefined, page: p.page, unread: p.unread || undefined, attachments: p.attachments || undefined };
  const list = useListAdminMailThreads(params, { query: { queryKey: getListAdminMailThreadsQueryKey(params), refetchInterval: 15_000, placeholderData: keepPreviousData } });
  const update = useUpdateAdminMailThreads();
  const purge = useDeleteAdminMailThreads();
  const discard = useDeleteAdminMailDraft();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState(0);
  useEffect(() => { setSel(new Set()); setFocus(0); }, [p.view, p.box, p.q, p.page]);
  const threads = list.data?.threads ?? [];
  const drafts = list.data?.drafts ?? [];
  const total = list.data?.total ?? 0;
  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/api/admin/mail') });
  const act = (ids: string[], data: { unread?: boolean; starred?: boolean; folder?: 'inbox' | 'archive' | 'spam' | 'trash' }, done?: string, undoData?: typeof data) => {
    if (!ids.length) return;
    update.mutate({ data: { ids, ...data } }, {
      onSuccess: () => {
        setSel(new Set()); refresh();
        if (done) toast({ title: done, ...(undoData ? { action: <ToastAction altText="Undo" onClick={() => update.mutate({ data: { ids, ...undoData } }, { onSuccess: refresh })}>Undo</ToastAction> } : {}) });
      },
      onError: (e) => toast({ title: "That didn't work", description: apiError(e, 'Try again.'), variant: 'destructive' }),
    });
  };
  const ids = [...sel];
  const inBin = p.view === 'trash' || p.view === 'spam';
  const n = (k: number) => `${k} conversation${k === 1 ? '' : 's'}`;

  // j / k / x / e / # / s / Enter, like Gmail.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if ((t instanceof Element && t.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) || e.ctrlKey || e.metaKey || e.altKey || !threads.length) return;
      const cur = threads[Math.min(focus, threads.length - 1)];
      if (e.key === 'j') setFocus((f) => Math.min(threads.length - 1, f + 1));
      else if (e.key === 'k') setFocus((f) => Math.max(0, f - 1));
      else if ((e.key === 'Enter' || e.key === 'o') && cur) p.go({ thread: cur.id });
      else if (e.key === 'x' && cur) setSel((s) => { const n2 = new Set(s); n2.has(cur.id) ? n2.delete(cur.id) : n2.add(cur.id); return n2; });
      const target = ids.length ? ids : cur ? [cur.id] : [];
      if (e.key === 'e' && !inBin) act(target, { folder: 'archive' }, `${n(target.length)} archived`, { folder: 'inbox' });
      else if (e.key === '#') act(target, { folder: 'trash' }, `${n(target.length)} moved to Trash`, { folder: 'inbox' });
      else if (e.key === 's' && cur) act([cur.id], { starred: !cur.starred });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const from = total ? (p.page - 1) * 50 + 1 : 0;
  const to = Math.min(total, p.page * 50);
  const viewLabel = VIEWS.find((v) => v.key === p.view)?.label ?? 'Inbox';
  const allChecked = threads.length > 0 && threads.every((t) => sel.has(t.id));
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-slate-100 px-2" data-testid="mail-toolbar">
        {p.view !== 'drafts' && (
          <label className="grid h-10 w-10 place-items-center rounded-full hover:bg-slate-100" title="Select all">
            <input type="checkbox" checked={allChecked} onChange={() => setSel(allChecked ? new Set() : new Set(threads.map((t) => t.id)))} aria-label="Select all" className="h-4 w-4" data-testid="checkbox-select-all" />
          </label>
        )}
        {ids.length === 0 ? (
          <>
            <IconButton label="Refresh" onClick={() => { void list.refetch(); }} testid="button-mail-refresh">{list.isFetching ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <RefreshCw className="h-[18px] w-[18px]" />}</IconButton>
            <button type="button" onClick={() => p.go({ unread: !p.unread, page: 1 })} className={cx('ml-1 h-8 rounded-full border px-3 text-xs font-medium', p.unread ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-50')} data-testid="filter-unread">Unread</button>
            <button type="button" onClick={() => p.go({ attachments: !p.attachments, page: 1 })} className={cx('ml-1 inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium', p.attachments ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-50')} data-testid="filter-attachments"><Paperclip className="h-3 w-3" /><span className="whitespace-nowrap"><span className="sm:hidden">Files</span><span className="hidden sm:inline">Has attachment</span></span></button>
          </>
        ) : (
          <div className="flex items-center gap-0.5" data-testid="bulk-actions">
            {p.view !== 'archive' && !inBin && <IconButton label="Archive" onClick={() => act(ids, { folder: 'archive' }, `${n(ids.length)} archived`, { folder: 'inbox' })} testid="bulk-archive"><Archive className="h-[18px] w-[18px]" /></IconButton>}
            {p.view !== 'spam' ? <IconButton label="Report spam" onClick={() => act(ids, { folder: 'spam' }, `${n(ids.length)} marked as spam`, { folder: 'inbox' })} testid="bulk-spam"><ShieldAlert className="h-[18px] w-[18px]" /></IconButton>
              : <IconButton label="Not spam" onClick={() => act(ids, { folder: 'inbox' }, `${n(ids.length)} moved to Inbox`)} testid="bulk-not-spam"><Inbox className="h-[18px] w-[18px]" /></IconButton>}
            {inBin ? (
              <button type="button" onClick={() => { if (window.confirm(`Delete ${n(ids.length)} for good? This can't be undone.`)) purge.mutate({ data: { ids } }, { onSuccess: () => { setSel(new Set()); refresh(); toast({ title: `${n(ids.length)} deleted for good` }); } }); }}
                className="mx-1 h-8 rounded-full px-3 text-xs font-semibold text-red-700 hover:bg-red-50" data-testid="bulk-delete-forever">Delete forever</button>
            ) : <IconButton label="Delete" onClick={() => act(ids, { folder: 'trash' }, `${n(ids.length)} moved to Trash`, { folder: 'inbox' })} testid="bulk-trash"><Trash2 className="h-[18px] w-[18px]" /></IconButton>}
            {p.view === 'trash' && <IconButton label="Move to Inbox" onClick={() => act(ids, { folder: 'inbox' }, `${n(ids.length)} moved to Inbox`)} testid="bulk-restore"><Undo2 className="h-[18px] w-[18px]" /></IconButton>}
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <IconButton label="Mark as read" onClick={() => act(ids, { unread: false })} testid="bulk-read"><MailOpen className="h-[18px] w-[18px]" /></IconButton>
            <IconButton label="Mark as unread" onClick={() => act(ids, { unread: true })} testid="bulk-unread"><MailIcon className="h-[18px] w-[18px]" /></IconButton>
            <span className="ml-2 text-xs text-slate-600">{ids.length} selected</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1 text-xs text-slate-600">
          <span className="font-num hidden whitespace-nowrap sm:inline" data-testid="text-mail-range">{total ? `${from}–${to} of ${total}` : ''}</span>
          <IconButton label="Newer" disabled={p.page <= 1} onClick={() => p.go({ page: p.page - 1 })}><ChevronLeft className="h-[18px] w-[18px]" /></IconButton>
          <IconButton label="Older" disabled={to >= total} onClick={() => p.go({ page: p.page + 1 })}><ChevronRight className="h-[18px] w-[18px]" /></IconButton>
        </div>
      </div>
      {p.q && <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-600">Results for <b>“{p.q}”</b> in {viewLabel}{p.box !== 'all' ? ` · ${boxes.find((b) => b.id === p.box)?.address}` : ''}</p>}
      {p.view === 'trash' && <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">Conversations in Trash are deleted for good after 30 days.</p>}
      {p.view === 'spam' && <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">Spam is emptied after 30 days.</p>}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="mail-list">
        {list.isLoading ? <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skel key={i} className="h-10 w-full" />)}</div>
          : list.isError ? <p className="p-6 text-sm text-red-700">The mail couldn't be loaded. <button type="button" className="underline" onClick={() => void list.refetch()}>Try again</button></p>
          : p.view === 'drafts' ? (
            drafts.length ? drafts.map((d) => (
              <div key={d.id} className="group flex min-h-12 items-center gap-3 border-b border-slate-100 px-4 hover:shadow-[inset_1px_0_0_#dadce0,inset_-1px_0_0_#dadce0,0_1px_2px_0_rgba(60,64,67,.3)]" data-testid="row-draft">
                <button type="button" onClick={() => onOpenDraft(d.id)} className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left text-sm">
                  <span className="w-44 shrink-0 truncate font-medium text-red-700">Draft{d.to.length ? <span className="text-slate-700"> · {d.to.map(who).join(', ')}</span> : ''}</span>
                  <span className="min-w-0 flex-1 truncate"><span className="text-slate-900">{d.subject}</span><span className="text-slate-500"> – {d.snippet}</span></span>
                  <span className="shrink-0 text-xs text-slate-500">{listDate(d.updatedAt)}</span>
                </button>
                <IconButton label="Discard draft" onClick={() => discard.mutate({ id: d.id }, { onSuccess: () => { refresh(); toast({ title: 'Draft discarded' }); } })}><Trash2 className="h-4 w-4" /></IconButton>
              </div>
            )) : <EmptyList view="drafts" q={p.q} />
          ) : threads.length ? threads.map((t, i) => (
            <ThreadRow key={t.id} t={t} focused={i === focus} checked={sel.has(t.id)} showBox={p.box === 'all' && boxes.length > 1}
              onCheck={() => setSel((s) => { const n2 = new Set(s); n2.has(t.id) ? n2.delete(t.id) : n2.add(t.id); return n2; })}
              onOpen={() => p.go({ thread: t.id })} onStar={() => act([t.id], { starred: !t.starred })}
              onArchive={inBin ? undefined : () => act([t.id], { folder: 'archive' }, 'Conversation archived', { folder: t.folder })}
              onTrash={() => act([t.id], { folder: 'trash' }, 'Conversation moved to Trash', { folder: t.folder })}
              onToggleRead={() => act([t.id], { unread: !t.unread })} />
          )) : <EmptyList view={p.view} q={p.q} />}
      </div>
    </div>
  );
}

function EmptyList({ view, q }: { view: MailView; q: string }) {
  const text = q ? 'No conversations match your search.' : {
    inbox: 'Your inbox is empty. Mail sent to your mailboxes shows up here.', starred: 'No starred conversations. Stars let you give conversations a special status to make them easier to find.',
    sent: 'Nothing sent yet.', drafts: 'You don\'t have any saved drafts.', archive: 'Nothing archived.', spam: 'Hooray, no spam here!', trash: 'Nothing in Trash.', all: 'No mail yet.',
  }[view];
  return <p className="px-6 py-16 text-center text-sm text-slate-500" data-testid="mail-empty">{text}</p>;
}

function ThreadRow({ t, focused, checked, showBox, onCheck, onOpen, onStar, onArchive, onTrash, onToggleRead }: {
  t: MailThread; focused: boolean; checked: boolean; showBox: boolean; onCheck: () => void; onOpen: () => void; onStar: () => void;
  onArchive?: () => void; onTrash: () => void; onToggleRead: () => void;
}) {
  const names = t.participants.length ? t.participants.slice(0, 3).map(who).join(', ') : t.mailboxAddress;
  return (
    <div role="row" aria-selected={checked} data-testid="row-thread" data-unread={t.unread || undefined}
      className={cx('group relative flex min-h-12 cursor-pointer items-center gap-1 border-b border-slate-100 pl-1 pr-3 text-sm transition-shadow sm:pl-2',
        t.unread ? 'bg-white' : 'bg-[#F2F6FC]', checked && '!bg-[#C2DBFF]', focused && 'shadow-[inset_3px_0_0_var(--brand)]',
        'hover:z-10 hover:shadow-[inset_1px_0_0_#dadce0,inset_-1px_0_0_#dadce0,0_1px_2px_0_rgba(60,64,67,.3),0_1px_3px_1px_rgba(60,64,67,.15)]')}
      onClick={onOpen}>
      <label className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-slate-200/60" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${t.subject}`} className="h-4 w-4" />
      </label>
      <button type="button" aria-label={t.starred ? 'Unstar' : 'Star'} aria-pressed={t.starred} onClick={(e) => { e.stopPropagation(); onStar(); }}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-slate-200/60" data-testid="button-star">
        <Star className={cx('h-[18px] w-[18px]', t.starred ? 'fill-amber-400 text-amber-500' : 'text-slate-400')} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col py-2 sm:flex-row sm:items-center sm:gap-3">
        <span className={cx('w-full shrink-0 truncate sm:w-48', t.unread ? 'font-bold text-slate-900' : 'text-slate-800')}>
          {names}{t.messageCount > 1 && <span className="ml-1 text-xs font-normal text-slate-500">{t.messageCount}</span>}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {showBox && <span className="mr-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-700">{t.mailboxAddress.split('@')[0]}</span>}
          <span className={t.unread ? 'font-bold text-slate-900' : 'text-slate-900'}>{t.subject}</span>
          <span className="text-slate-500"> – {t.snippet}</span>
        </span>
      </div>
      {t.hasAttachments && <Paperclip className="mx-1 h-4 w-4 shrink-0 text-slate-500" aria-label="Has attachments" />}
      <span className={cx('w-14 shrink-0 text-right text-xs group-hover:invisible', t.unread ? 'font-bold text-slate-900' : 'text-slate-600')}>{listDate(t.lastMessageAt)}</span>
      <div className="invisible absolute right-2 flex items-center bg-inherit group-hover:visible" onClick={(e) => e.stopPropagation()}>
        {onArchive && <IconButton label="Archive" onClick={onArchive}><Archive className="h-4 w-4" /></IconButton>}
        <IconButton label="Delete" onClick={onTrash}><Trash2 className="h-4 w-4" /></IconButton>
        <IconButton label={t.unread ? 'Mark as read' : 'Mark as unread'} onClick={onToggleRead}>{t.unread ? <MailOpen className="h-4 w-4" /> : <MailIcon className="h-4 w-4" />}</IconButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ conversation */

function ThreadView({ id, boxes, onBack, onCompose, onOpenDraft }: {
  id: string; boxes: Mailbox[]; onBack: () => void; onCompose: (r: Omit<ComposeRequest, 'key'>) => void; onOpenDraft: (id: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useGetAdminMailThread(id, { query: { queryKey: getGetAdminMailThreadQueryKey(id), refetchInterval: 15_000 } });
  const update = useUpdateAdminMailThreads();
  const retry = useRetryAdminMailSend();
  const data: MailThreadDetail | undefined = q.data;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [images, setImages] = useState<Set<string>>(new Set());
  const box = boxes.find((b) => b.id === data?.thread.mailboxId);
  // The newest message and unread ones start open; the others fold to one line (Gmail).
  useEffect(() => {
    if (!data) return;
    const last = data.messages[data.messages.length - 1];
    setOpen((prev) => new Set([...prev, ...data.messages.filter((m) => m.unread).map((m) => m.id), ...(last ? [last.id] : [])]));
  }, [data?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (q.isSuccess) void qc.invalidateQueries({ queryKey: getListAdminMailboxesQueryKey() }); }, [q.isSuccess, qc]);
  const refresh = () => qc.invalidateQueries({ predicate: (k) => String(k.queryKey[0]).startsWith('/api/admin/mail') });
  const move = (folder: 'inbox' | 'archive' | 'spam' | 'trash', label: string) => update.mutate({ data: { ids: [id], folder } }, {
    onSuccess: () => { refresh(); onBack(); toast({ title: label }); },
    onError: (e) => toast({ title: "That didn't work", description: apiError(e, 'Try again.'), variant: 'destructive' }),
  });
  const last = data?.messages[data.messages.length - 1];
  const lastIn = data ? [...data.messages].reverse().find((m) => m.direction === 'in') ?? last : undefined;
  const reply = (m: MailMessage | undefined, mode: 'reply' | 'replyAll' | 'forward') => m && box && onCompose({ mode, mailboxId: box.id, original: m });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if ((t instanceof Element && t.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) || e.ctrlKey || e.metaKey || e.altKey || !data) return;
      if (e.key === 'r') { e.preventDefault(); reply(lastIn, 'reply'); }
      else if (e.key === 'a') { e.preventDefault(); reply(lastIn, 'replyAll'); }
      else if (e.key === 'f') { e.preventDefault(); reply(last, 'forward'); }
      else if (e.key === 'e' && data.thread.folder !== 'archive') move('archive', 'Conversation archived');
      else if (e.key === '#') move('trash', 'Conversation moved to Trash');
      else if (e.key === 'u' || e.key === 'Escape') onBack();
      else if (e.key === 's') update.mutate({ data: { ids: [id], starred: !data.thread.starred } }, { onSuccess: refresh });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (q.isLoading) return <div className="space-y-3 p-6"><Skel className="h-8 w-2/3" /><Skel className="h-40 w-full" /></div>;
  if (q.isError || !data) return <div className="p-6 text-sm text-slate-600"><button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-slate-700 hover:underline"><ArrowLeft className="h-4 w-4" />Back</button><p>{apiError(q.error, "This conversation couldn't be opened.")}</p></div>;
  const t = data.thread;
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-slate-100 px-2" data-testid="thread-toolbar">
          <IconButton label="Back to list" onClick={onBack} testid="button-thread-back"><ArrowLeft className="h-[18px] w-[18px]" /></IconButton>
          {t.folder !== 'archive' && t.folder !== 'trash' && <IconButton label="Archive" onClick={() => move('archive', 'Conversation archived')} testid="button-thread-archive"><Archive className="h-[18px] w-[18px]" /></IconButton>}
          {t.folder === 'spam' ? <IconButton label="Not spam" onClick={() => move('inbox', 'Moved to Inbox')}><Inbox className="h-[18px] w-[18px]" /></IconButton>
            : <IconButton label="Report spam" onClick={() => move('spam', 'Marked as spam')} testid="button-thread-spam"><ShieldAlert className="h-[18px] w-[18px]" /></IconButton>}
          {t.folder === 'trash' ? <IconButton label="Move to Inbox" onClick={() => move('inbox', 'Moved to Inbox')} testid="button-thread-restore"><Undo2 className="h-[18px] w-[18px]" /></IconButton>
            : <IconButton label="Delete" onClick={() => move('trash', 'Conversation moved to Trash')} testid="button-thread-trash"><Trash2 className="h-[18px] w-[18px]" /></IconButton>}
          {t.folder === 'archive' && <IconButton label="Move to Inbox" onClick={() => move('inbox', 'Moved to Inbox')}><Inbox className="h-[18px] w-[18px]" /></IconButton>}
          <IconButton label="Mark as unread" onClick={() => update.mutate({ data: { ids: [id], unread: true } }, { onSuccess: () => { refresh(); onBack(); } })} testid="button-thread-unread"><MailIcon className="h-[18px] w-[18px]" /></IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 sm:px-6">
          <div className="flex items-start gap-3 py-4">
            <h2 className="min-w-0 flex-1 text-[22px] leading-snug text-slate-900" data-testid="text-thread-subject">
              {t.subject}
              <span className="ml-2 inline-block rounded bg-slate-200 px-1.5 py-0.5 align-middle text-xs text-slate-700">{t.folder === 'inbox' ? 'Inbox' : t.folder[0]!.toUpperCase() + t.folder.slice(1)}</span>
              <span className="ml-1 inline-block rounded bg-[var(--brand-soft)] px-1.5 py-0.5 align-middle text-xs text-slate-800">{t.mailboxAddress}</span>
            </h2>
            <button type="button" aria-label={t.starred ? 'Unstar' : 'Star'} onClick={() => update.mutate({ data: { ids: [id], starred: !t.starred } }, { onSuccess: refresh })} className="grid h-10 w-10 place-items-center rounded-full hover:bg-slate-100">
              <Star className={cx('h-5 w-5', t.starred ? 'fill-amber-400 text-amber-500' : 'text-slate-400')} />
            </button>
          </div>
          <div className="divide-y divide-slate-100" data-testid="thread-messages">
            {data.messages.map((m) => (
              <MessageItem key={m.id} m={m} open={open.has(m.id)} onToggle={() => setOpen((s) => { const n = new Set(s); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })}
                images={images.has(m.id)} onImages={() => setImages((s) => new Set(s).add(m.id))}
                onReply={() => reply(m, 'reply')} onReplyAll={() => reply(m, 'replyAll')} onForward={() => reply(m, 'forward')}
                onRetry={() => retry.mutate({ id: m.id }, { onSuccess: () => { toast({ title: 'Sending again…' }); refresh(); }, onError: (e) => toast({ title: "Couldn't retry", description: apiError(e, 'Try again.'), variant: 'destructive' }) })} />
            ))}
          </div>
          {data.drafts.map((d) => (
            <button key={d.id} type="button" onClick={() => onOpenDraft(d.id)} className="mt-3 flex w-full items-center gap-2 rounded-xl border border-dashed border-red-300 px-4 py-3 text-left text-sm text-red-700 hover:bg-red-50" data-testid="button-open-thread-draft">
              <Pencil className="h-4 w-4" />Draft: {d.snippet || 'continue writing'}
            </button>
          ))}
          {last && (
            <div className="mt-6 flex flex-wrap gap-2 pl-0 sm:pl-14">
              <button type="button" onClick={() => reply(lastIn, 'reply')} className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-400 px-5 text-sm font-medium text-slate-800 hover:bg-slate-100" data-testid="button-reply"><Reply className="h-4 w-4" />Reply</button>
              {(lastIn && lastIn.to.length + lastIn.cc.length > 1) && <button type="button" onClick={() => reply(lastIn, 'replyAll')} className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-400 px-5 text-sm font-medium text-slate-800 hover:bg-slate-100" data-testid="button-reply-all"><ReplyAll className="h-4 w-4" />Reply all</button>}
              <button type="button" onClick={() => reply(last, 'forward')} className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-400 px-5 text-sm font-medium text-slate-800 hover:bg-slate-100" data-testid="button-forward"><Forward className="h-4 w-4" />Forward</button>
            </div>
          )}
        </div>
      </div>
      {data.profile && <ProfileCard profile={data.profile} />}
    </div>
  );
}

function MessageItem({ m, open, onToggle, images, onImages, onReply, onReplyAll, onForward, onRetry }: {
  m: MailMessage; open: boolean; onToggle: () => void; images: boolean; onImages: () => void; onReply: () => void; onReplyAll: () => void; onForward: () => void; onRetry: () => void;
}) {
  const recipients = [...m.to, ...m.cc];
  const status = m.status === 'queued' || m.status === 'sending' ? <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Clock className="h-3 w-3" />Sending…</span>
    : m.status === 'failed' ? <span className="text-xs font-medium text-red-700">Not sent</span> : null;
  if (!open) {
    return (
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 py-3 text-left text-sm hover:bg-slate-50" data-testid="message-collapsed">
        <Avatar name={who(m.from)} className="h-10 w-10 shrink-0 text-sm" />
        <span className={cx('w-40 shrink-0 truncate', m.unread ? 'font-bold' : 'font-medium', 'text-slate-900')}>{m.direction === 'out' ? 'me' : who(m.from)}</span>
        <span className="min-w-0 flex-1 truncate text-slate-500">{m.snippet}</span>
        {m.attachments.length > 0 && <Paperclip className="h-4 w-4 shrink-0 text-slate-500" />}
        <span className="shrink-0 text-xs text-slate-500">{listDate(m.date)}</span>
      </button>
    );
  }
  return (
    <article className="py-4" data-testid="message-open">
      <div className="flex items-start gap-3">
        <Avatar name={who(m.from)} className="h-10 w-10 shrink-0 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2" onClick={onToggle} role="button" tabIndex={-1}>
            <span className="font-bold text-slate-900">{m.from.name ?? m.from.address}</span>
            <span className="text-xs text-slate-500">&lt;{m.from.address}&gt;</span>
            {status}
          </div>
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer list-none truncate hover:underline">to {recipients.length ? recipients.map((a) => (a.name ?? a.address)).join(', ') : 'undisclosed recipients'}{m.bcc.length ? `, bcc: ${m.bcc.map((a) => a.address).join(', ')}` : ''} ▾</summary>
            <dl className="mt-2 grid grid-cols-[4rem_1fr] gap-x-2 gap-y-0.5 rounded-lg border border-slate-200 p-3">
              <dt className="text-slate-500">from:</dt><dd>{m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address}</dd>
              {m.replyTo.length > 0 && <><dt className="text-slate-500">reply-to:</dt><dd>{m.replyTo.map((a) => a.address).join(', ')}</dd></>}
              <dt className="text-slate-500">to:</dt><dd>{m.to.map((a) => a.address).join(', ') || '-'}</dd>
              {m.cc.length > 0 && <><dt className="text-slate-500">cc:</dt><dd>{m.cc.map((a) => a.address).join(', ')}</dd></>}
              <dt className="text-slate-500">date:</dt><dd>{fullDate(m.date)}</dd>
              <dt className="text-slate-500">subject:</dt><dd>{m.subject || '(no subject)'}</dd>
              {m.sentBy && m.direction === 'out' && <><dt className="text-slate-500">sent by:</dt><dd>{m.sentBy}</dd></>}
            </dl>
          </details>
        </div>
        <span className="shrink-0 text-xs text-slate-500" title={fullDate(m.date)}>{fullDate(m.date)} ({ago(m.date)})</span>
        <div className="flex shrink-0">
          <button type="button" aria-label="Reply" title="Reply" onClick={onReply} className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100" data-testid="button-message-reply"><Reply className="h-4 w-4" /></button>
          <button type="button" aria-label="Forward" title="Forward" onClick={onForward} className="hidden h-9 w-9 place-items-center rounded-full hover:bg-slate-100 sm:grid" data-testid="button-message-forward"><Forward className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="mt-3 sm:pl-[3.25rem]">
        {m.authFailed && (
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert" data-testid="banner-auth-failed">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span><b>Be careful with this message.</b> It failed the checks that prove who sent it (SPF, DKIM or DMARC), so it may not be from {m.from.address}. Don't open attachments or follow links you didn't expect.</span>
          </p>
        )}
        {m.status === 'failed' && (
          <p className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" data-testid="banner-send-failed">
            <AlertTriangle className="h-4 w-4" />This email wasn't sent: {m.error}
            <button type="button" onClick={onRetry} className="ml-auto rounded-full border border-red-300 px-3 py-1 text-xs font-semibold hover:bg-red-100" data-testid="button-retry-send">Try again</button>
          </p>
        )}
        {m.status === 'sent' && m.error && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="banner-delivery">{m.error}</p>}
        {m.remoteImages && !images && (
          <p className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700" data-testid="banner-images">
            Images in this email are hidden, so the sender can't see when you open it.
            <button type="button" onClick={onImages} className="font-semibold text-[var(--brand-ink)] underline" data-testid="button-show-images">Show images</button>
          </p>
        )}
        <MailBody html={m.html} showImages={images} testid="message-body" />
        <AttachmentCards files={m.attachments} />
        <div className="mt-4 flex gap-2 sm:hidden">
          <button type="button" onClick={onReply} className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-400 px-4 text-sm"><Reply className="h-4 w-4" />Reply</button>
          <button type="button" onClick={onReplyAll} className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-400 px-4 text-sm"><ReplyAll className="h-4 w-4" />All</button>
          <button type="button" onClick={onForward} className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-400 px-4 text-sm"><Forward className="h-4 w-4" />Forward</button>
        </div>
      </div>
    </article>
  );
}

function ProfileCard({ profile }: { profile: NonNullable<MailThreadDetail['profile']> }) {
  return (
    <aside className="hidden w-64 shrink-0 border-l border-slate-100 p-4 xl:block" data-testid="mail-profile-card">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><UserRound className="h-3.5 w-3.5" />Applicant</p>
      <Avatar name={profile.name} className="h-14 w-14 text-lg" />
      <p className="mt-2 font-semibold text-slate-900">{profile.name}</p>
      <p className="break-all text-xs text-slate-600">{profile.email}</p>
      {profile.organization && <p className="mt-1 text-xs text-slate-600">{profile.organization}</p>}
      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between"><dt className="text-slate-500">Tier</dt><dd className="font-medium">Tier {profile.tier}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-500">Account</dt><dd className="font-medium">{profile.status}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-500">Identity</dt><dd className="font-medium">{profile.verificationLevel}</dd></div>
      </dl>
      <Link href={`/admin/users/${profile.id}`} className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-800 hover:border-[#111]" data-testid="link-mail-profile">Open in Users</Link>
    </aside>
  );
}

function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows = useMemo(() => [
    ['c', 'Compose'], ['/', 'Search'], ['j / k', 'Next / previous conversation'], ['Enter or o', 'Open conversation'], ['x', 'Select conversation'],
    ['e', 'Archive'], ['#', 'Delete'], ['s', 'Star'], ['r', 'Reply'], ['a', 'Reply all'], ['f', 'Forward'], ['u or Esc', 'Back to the list'], ['Ctrl + Enter', 'Send (in Compose)'], ['?', 'This list'],
  ], []);
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" testid="modal-mail-shortcuts">
      <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt><kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt><dd className="text-slate-700">{v}</dd></div>)}
      </dl>
    </Modal>
  );
}
