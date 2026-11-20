import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  useSaveAdminMailDraft, useSendAdminMail, useDeleteAdminMailDraft, useUndoAdminMailSend, useUploadAdminMailAttachment, useListAdminMailContacts,
  getListAdminMailContactsQueryKey, type Mailbox, type MailAddress, type MailFile, type MailMessage,
} from '@workspace/api-client-react';
import {
  Bold, Italic, Link2, List, ListOrdered, Loader2, Maximize2, Minimize2, Minus, Paperclip, Quote, RemoveFormatting, Send, Strikethrough, Trash2, Underline, X,
} from 'lucide-react';
import { ToastAction } from '@/components/ui/toast';
import { cx, fileSize } from '@/components/bits';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';
import { MailBody } from './mail-body';
import { FileChip } from './mail-files';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward' | 'draft';
export type ComposeRequest = {
  key: number;
  mode: ComposeMode;
  mailboxId: string;
  /** The message replied to / forwarded. */
  original?: MailMessage;
  /** An existing draft to continue. */
  draft?: MailMessage;
  to?: MailAddress[];
};

export const ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.pps,.ppsx,.odt,.ods,.odp,.txt,.csv,.rtf';

const fmt = (a: MailAddress) => (a.name ? `${a.name} <${a.address}>` : a.address);
const reSubject = (s: string, f: boolean) => {
  const base = s.replace(/^\s*((re|fw|fwd|aw|sv)(\[\d+\])?\s*:\s*)+/i, '').trim() || '(no subject)';
  return `${f ? 'Fwd' : 'Re'}: ${base}`;
};

/** Who a reply goes to (same rules as the server's replyRecipients). */
function replyTargets(m: MailMessage, self: string, all: boolean) {
  const sender = m.replyTo.length ? m.replyTo : [m.from];
  const to = m.direction === 'out' ? m.to : sender;
  const cc = all ? [...(m.direction === 'out' ? [] : m.to), ...m.cc] : [];
  const seen = new Set([self.toLowerCase()]);
  const keep = (l: MailAddress[]) => l.filter((a) => (seen.has(a.address) ? false : (seen.add(a.address), true)));
  return { to: keep(to), cc: keep(cc) };
}

/* ------------------------------------------------------------------ address field */

function AddressField({ label, value, onChange, autoFocus, testid }: { label: string; value: MailAddress[]; onChange: (v: MailAddress[]) => void; autoFocus?: boolean; testid: string }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = text.trim();
  const suggestions = useListAdminMailContacts({ q }, { query: { queryKey: getListAdminMailContactsQueryKey({ q }), enabled: q.length >= 2, staleTime: 30_000 } }).data ?? [];
  const list = suggestions.filter((s) => !value.some((v) => v.address === s.address));
  const add = (raw: string) => {
    const parts = raw.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
    const next = [...value];
    for (const p of parts) {
      const m = /<([^>]+)>/.exec(p);
      const address = (m ? m[1]! : p).toLowerCase();
      if (!next.some((n) => n.address === address)) next.push({ address, name: null });
    }
    onChange(next); setText(''); setOpen(false);
  };
  const pick = (a: MailAddress) => { onChange([...value, a]); setText(''); setOpen(false); };
  const valid = (a: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a);
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (open && list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length); return; }
    if ((e.key === 'Enter' || e.key === 'Tab') && open && list[active] && q) { e.preventDefault(); pick(list[active]!); return; }
    if ((e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === 'Tab' && q)) && q) { e.preventDefault(); add(q); return; }
    if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="relative flex min-h-10 flex-wrap items-center gap-1 border-b border-slate-200 px-3 py-1" data-testid={testid}>
      <span className="mr-1 text-sm text-slate-500">{label}</span>
      {value.map((a) => (
        <span key={a.address} title={a.address} className={cx('inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[13px]', valid(a.address) ? 'border-slate-300 bg-slate-50 text-slate-800' : 'border-red-300 bg-red-50 text-red-800')} data-testid="chip-recipient">
          <span className="truncate">{a.name ?? a.address}</span>
          <button type="button" aria-label={`Remove ${a.address}`} onClick={() => onChange(value.filter((v) => v.address !== a.address))} className="grid h-4 w-4 place-items-center rounded-full hover:bg-slate-200"><X className="h-3 w-3" /></button>
        </span>
      ))}
      <input value={text} autoFocus={autoFocus} aria-label={label} onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }} onKeyDown={onKey}
        onBlur={() => { window.setTimeout(() => setOpen(false), 150); if (q) add(q); }} className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm outline-none" data-testid={`${testid}-input`} />
      {open && list.length > 0 && q.length >= 2 && (
        <ul role="listbox" className="absolute left-10 top-full z-20 mt-1 w-[min(22rem,90vw)] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {list.map((s, i) => (
            <li key={s.address} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(s); }} className={cx('flex w-full flex-col px-3 py-2 text-left text-sm', i === active ? 'bg-slate-100' : 'hover:bg-slate-50')}>
                <span className="font-medium text-slate-900">{s.name ?? s.address}</span>{s.name && <span className="text-xs text-slate-500">{s.address}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ toolbar */

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  const b = (label: string, active: boolean, run: () => void, Icon: typeof Bold) => (
    <button type="button" aria-label={label} title={label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={run}
      className={cx('grid h-8 w-8 place-items-center rounded-md text-slate-700', active ? 'bg-slate-200' : 'hover:bg-slate-100')}><Icon className="h-4 w-4" /></button>
  );
  const link = () => {
    const prev = editor.getAttributes('link')['href'] as string | undefined;
    const url = window.prompt('Link address', prev ?? 'https://');
    if (url === null) return;
    if (!url.trim()) { editor.chain().focus().unsetLink().run(); return; }
    const href = /^(https?:|mailto:|tel:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };
  return (
    <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
      {b('Bold (Ctrl+B)', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), Bold)}
      {b('Italic (Ctrl+I)', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), Italic)}
      {b('Underline (Ctrl+U)', editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), Underline)}
      {b('Strikethrough', editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), Strikethrough)}
      <span className="mx-1 h-5 w-px bg-slate-200" />
      {b('Bulleted list', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), List)}
      {b('Numbered list', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), ListOrdered)}
      {b('Quote', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), Quote)}
      {b('Link', editor.isActive('link'), link, Link2)}
      {b('Remove formatting', false, () => editor.chain().focus().unsetAllMarks().clearNodes().run(), RemoveFormatting)}
    </div>
  );
}

/* ------------------------------------------------------------------ the window */

export function ComposeWindow({ request, mailboxes, onClose, onSent, onReopen }: {
  request: ComposeRequest; mailboxes: Mailbox[]; onClose: () => void; onSent: (threadId: string) => void; onReopen: (r: ComposeRequest) => void;
}) {
  const { toast } = useToast();
  const enabled = mailboxes.filter((m) => m.enabled);
  const o = request.original;
  const d = request.draft;
  const initialBox = d?.mailboxId ?? request.mailboxId ?? enabled[0]?.id ?? '';
  const [mailboxId, setMailboxId] = useState(initialBox);
  const box = mailboxes.find((m) => m.id === mailboxId);
  const initial = useMemo(() => {
    if (d) return { to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, html: d.html, files: d.attachments };
    if (o && (request.mode === 'reply' || request.mode === 'replyAll')) {
      const r = replyTargets(o, box?.address ?? '', request.mode === 'replyAll');
      return { to: r.to, cc: r.cc, bcc: [], subject: reSubject(o.subject, false), html: '', files: [] as MailFile[] };
    }
    if (o && request.mode === 'forward') return { to: [], cc: [], bcc: [], subject: reSubject(o.subject, true), html: '', files: o.attachments.filter((f) => f.available && !f.inline) };
    return { to: request.to ?? [], cc: [], bcc: [], subject: '', html: '', files: [] as MailFile[] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.key]);
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [bcc, setBcc] = useState(initial.bcc);
  const [showCc, setShowCc] = useState(initial.cc.length > 0 || initial.bcc.length > 0);
  const [subject, setSubject] = useState(initial.subject);
  const [files, setFiles] = useState<MailFile[]>(initial.files);
  const [withSignature, setWithSignature] = useState(d?.withSignature ?? true);
  const [draftId, setDraftId] = useState<string | null>(d?.id ?? null);
  const [size, setSize] = useState<'normal' | 'min' | 'max'>('normal');
  const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const isReply = request.mode === 'reply' || request.mode === 'replyAll' || Boolean(d?.threadId && !d?.forwardOf);
  const replyToId = o && (request.mode === 'reply' || request.mode === 'replyAll') ? o.id : undefined;
  const forwardId = o && request.mode === 'forward' ? o.id : d?.forwardOf ?? undefined;

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } } }), Placeholder.configure({ placeholder: 'Write your message' })],
    content: initial.html,
    editorProps: { attributes: { class: 'gp-editor min-h-[10rem] px-3 py-2 text-[14px] leading-relaxed text-slate-900 outline-none', 'aria-label': 'Message', 'data-testid': 'compose-editor' } },
    onUpdate: () => setDirty(true),
  });

  const save = useSaveAdminMailDraft();
  const send = useSendAdminMail();
  const discard = useDeleteAdminMailDraft();
  const undo = useUndoAdminMailSend();
  const upload = useUploadAdminMailAttachment();

  const payload = useCallback(() => ({
    ...(draftId ? { id: draftId } : {}), mailboxId, to: to.map(fmt), cc: cc.map(fmt), bcc: bcc.map(fmt), subject, html: editor?.getHTML() ?? '',
    ...(replyToId ? { replyToMessageId: replyToId } : {}), ...(forwardId ? { forwardOfMessageId: forwardId } : {}),
    attachmentIds: files.map((f) => f.id), withSignature,
  }), [draftId, mailboxId, to, cc, bcc, subject, editor, replyToId, forwardId, files, withSignature]);

  // Autosave a couple of seconds after the last change (Gmail-style "Draft saved").
  useEffect(() => {
    if (!dirty || send.isPending) return;
    const t = window.setTimeout(() => {
      save.mutate({ data: payload() }, {
        onSuccess: (m) => { setDraftId(m.id); setSavedAt(new Date()); setDirty(false); setFiles(m.attachments); },
        onError: () => { /* shown on send; drafts retry on the next change */ },
      });
    }, 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, to, cc, bcc, subject, files, withSignature, mailboxId]);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };

  const addFiles = (list: FileList | File[]) => {
    for (const f of Array.from(list)) {
      if (f.size > 15 * 1024 * 1024) { toast({ title: `${f.name} is too large`, description: 'Attachments can be up to 15 MB each.', variant: 'destructive' }); continue; }
      upload.mutate({ data: { file: f } }, {
        onSuccess: (r) => { setFiles((prev) => [...prev, r]); setDirty(true); },
        onError: (e) => toast({ title: `${f.name} wasn't attached`, description: apiError(e, 'The file was refused.'), variant: 'destructive' }),
      });
    }
  };

  const total = files.reduce((s, f) => s + f.size, 0);
  const doSend = () => {
    setErr('');
    if (!to.length && !cc.length && !bcc.length) { setErr('Add at least one recipient.'); return; }
    if (!subject.trim() && !window.confirm('Send this email without a subject?')) return;
    send.mutate({ data: payload() }, {
      onSuccess: (r) => {
        onSent(r.threadId);
        onClose();
        const { dismiss } = toast({
          title: 'Sending…', description: `It goes in ${r.undoSeconds} seconds.`, duration: r.undoSeconds * 1000,
          action: (
            <ToastAction altText="Undo sending" data-testid="button-undo-send" onClick={() => undo.mutate({ id: r.id }, {
              onSuccess: (m) => { dismiss(); toast({ title: 'Sending undone', description: 'The email is open again as a draft.' }); onReopen({ key: Date.now(), mode: 'draft', mailboxId: m.mailboxId, draft: m }); },
              onError: (e) => toast({ title: 'Too late', description: apiError(e, 'The email has already been sent.'), variant: 'destructive' }),
            })}>Undo</ToastAction>
          ),
        });
        window.setTimeout(() => toast({ title: 'Message sent' }), r.undoSeconds * 1000 + 800);
      },
      onError: (e) => setErr(apiError(e, "The email couldn't be sent.")),
    });
  };
  const doDiscard = () => {
    if (draftId) discard.mutate({ id: draftId }, { onSuccess: () => toast({ title: 'Draft discarded' }) });
    onClose();
  };
  const close = () => {
    // Closing keeps the draft (saved now if anything changed), like Gmail.
    if (dirty && (to.length || subject || editor?.getText().trim() || files.length)) save.mutate({ data: payload() }, { onSuccess: () => toast({ title: 'Draft saved' }) });
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doSend(); }
      if (e.key === 'Escape' && size === 'max') setSize('normal');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const title = subject.trim() || (request.mode === 'forward' ? 'Forward' : isReply ? 'Reply' : 'New message');
  return (
    <div role="dialog" aria-label={title} data-testid="compose-window"
      className={cx('fixed z-50 flex flex-col overflow-hidden bg-white shadow-[0_8px_30px_rgba(0,0,0,.25)]',
        size === 'max' ? 'inset-0 sm:inset-6 sm:rounded-2xl' : size === 'min' ? 'bottom-0 right-4 w-[min(22rem,calc(100vw-2rem))] rounded-t-xl' : 'inset-0 sm:inset-auto sm:bottom-0 sm:right-4 sm:h-[min(36rem,calc(100dvh-5rem))] sm:w-[34rem] sm:rounded-t-xl')}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
      <div className="flex h-11 shrink-0 items-center gap-2 bg-[#F2F6FC] px-3">
        <button type="button" onClick={() => setSize(size === 'min' ? 'normal' : 'min')} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-slate-800">{title}</button>
        <button type="button" aria-label={size === 'min' ? 'Open' : 'Minimise'} onClick={() => setSize(size === 'min' ? 'normal' : 'min')} className="hidden h-8 w-8 place-items-center rounded-md hover:bg-slate-200 sm:grid"><Minus className="h-4 w-4" /></button>
        <button type="button" aria-label={size === 'max' ? 'Exit full screen' : 'Full screen'} onClick={() => setSize(size === 'max' ? 'normal' : 'max')} className="hidden h-8 w-8 place-items-center rounded-md hover:bg-slate-200 sm:grid">{size === 'max' ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
        <button type="button" aria-label="Save and close" onClick={close} className="grid h-9 w-9 place-items-center rounded-md hover:bg-slate-200" data-testid="button-compose-close"><X className="h-4 w-4" /></button>
      </div>
      {size !== 'min' && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {enabled.length > 1 && (
              <label className="flex min-h-10 items-center gap-2 border-b border-slate-200 px-3 text-sm">
                <span className="text-slate-500">From</span>
                <select value={mailboxId} onChange={(e) => touch(setMailboxId)(e.target.value)} className="min-w-0 flex-1 bg-transparent py-2 outline-none" data-testid="select-compose-from">
                  {enabled.map((m) => <option key={m.id} value={m.id}>{m.displayName} &lt;{m.address}&gt;</option>)}
                </select>
              </label>
            )}
            {enabled.length === 1 && <div className="flex min-h-10 items-center gap-2 border-b border-slate-200 px-3 text-sm"><span className="text-slate-500">From</span><span className="truncate">{box?.displayName} &lt;{box?.address}&gt;</span></div>}
            <div className="relative">
              <AddressField label="To" value={to} onChange={touch(setTo)} autoFocus={!isReply} testid="field-to" />
              {!showCc && <button type="button" onClick={() => setShowCc(true)} className="absolute right-3 top-2 text-sm text-slate-600 hover:underline" data-testid="button-show-cc">Cc Bcc</button>}
            </div>
            {showCc && <><AddressField label="Cc" value={cc} onChange={touch(setCc)} testid="field-cc" /><AddressField label="Bcc" value={bcc} onChange={touch(setBcc)} testid="field-bcc" /></>}
            <input value={subject} onChange={(e) => touch(setSubject)(e.target.value)} placeholder="Subject" aria-label="Subject" maxLength={300}
              className="block min-h-10 w-full border-b border-slate-200 px-3 text-sm outline-none" data-testid="input-compose-subject" />
            <div onClick={() => editor?.commands.focus()} className="cursor-text"><EditorContent editor={editor} /></div>
            {(isReply || forwardId) && <p className="px-3 pb-2 text-xs text-slate-500" data-testid="text-quote-note">{forwardId ? 'The forwarded message and its header are added below.' : 'The earlier message is quoted below your reply.'}</p>}
            {withSignature && box?.signaturePreview && (
              <div className="px-3 pb-3 opacity-80" data-testid="compose-signature"><MailBody html={box.signaturePreview} showImages={false} /></div>
            )}
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pb-3" data-testid="compose-files">
                {files.map((f) => <FileChip key={f.id} file={f} onRemove={() => { setFiles((p) => p.filter((x) => x.id !== f.id)); setDirty(true); }} />)}
                <span className="self-center text-xs text-slate-500">{fileSize(total)} of 25 MB</span>
              </div>
            )}
            {upload.isPending && <p className="flex items-center gap-2 px-3 pb-3 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Attaching…</p>}
          </div>
          {err && <p role="alert" className="mx-3 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="text-compose-error">{err}</p>}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2">
            <button type="button" onClick={doSend} disabled={send.isPending || upload.isPending || !mailboxId}
              className="press inline-flex min-h-10 items-center gap-2 rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--brand-fg)] hover:brightness-95 disabled:opacity-60" data-testid="button-send">
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send
            </button>
            <Toolbar editor={editor} />
            <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} data-testid="input-compose-file" />
            <button type="button" aria-label="Attach files" title="Attach files (PDF, images, Word, Excel, PowerPoint…; up to 15 MB each)" onClick={() => fileInput.current?.click()} className="grid h-9 w-9 place-items-center rounded-md hover:bg-slate-100" data-testid="button-attach"><Paperclip className="h-4 w-4" /></button>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={withSignature} onChange={(e) => touch(setWithSignature)(e.target.checked)} data-testid="checkbox-signature" />Signature</label>
            <span className="ml-auto text-xs text-slate-400" aria-live="polite">{save.isPending ? 'Saving…' : savedAt ? 'Draft saved' : ''}</span>
            <button type="button" aria-label="Discard draft" title="Discard draft" onClick={doDiscard} className="grid h-9 w-9 place-items-center rounded-md text-slate-600 hover:bg-slate-100" data-testid="button-discard"><Trash2 className="h-4 w-4" /></button>
          </div>
        </>
      )}
      {dragging && <div className="pointer-events-none absolute inset-0 grid place-items-center border-2 border-dashed border-[var(--brand)] bg-white/90 text-sm font-semibold text-slate-700">Drop files to attach</div>}
    </div>
  );
}
