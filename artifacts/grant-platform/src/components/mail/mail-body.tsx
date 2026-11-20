import { useEffect, useRef, useState } from 'react';

/**
 * Shows an email's HTML (already sanitised by the server, email.md §7) inside a shadow root, so its styles can't touch
 * the app and the app's styles can't break it. The page's Content-Security-Policy still applies (no scripts, images
 * only from our own address), which is the second layer.
 *
 * - Images from the internet stay hidden until "Show images": then they load through /api/admin/mail/image, so the
 *   sender never sees the administrator's address.
 * - Quoted history (our `.gp-quote`, Gmail's `.gmail_quote`, Outlook's reply header, blockquotes at the end) folds
 *   behind a "•••" button, like Gmail.
 */
export function MailBody({ html, showImages, testid }: { html: string; showImages: boolean; testid?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [quoted, setQuoted] = useState(false);
  const [hasQuote, setHasQuote] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    const doc = new DOMParser().parseFromString(`<div class="gp-root">${html}</div>`, 'text/html');
    const body = doc.body.firstElementChild as HTMLElement;
    body.querySelectorAll<HTMLImageElement>('img[data-remote-src]').forEach((img) => {
      if (showImages) img.src = `/api/admin/mail/image?url=${encodeURIComponent(img.dataset['remoteSrc'] ?? '')}`;
      else { img.removeAttribute('src'); img.style.display = 'none'; }
    });
    body.querySelectorAll('a[href]').forEach((a) => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); });
    // Fold the quoted history.
    const quote = body.querySelector('.gp-quote, .gp-forward + .gp-quote, .gmail_quote, #appendonsend, div[id^="divRplyFwdMsg"]')
      ?? (body.lastElementChild?.tagName === 'BLOCKQUOTE' ? body.lastElementChild : null);
    setHasQuote(Boolean(quote));
    if (quote && !quoted) {
      // Outlook puts its "From: … Sent: …" header in a separate block before the quote; hide everything from it on.
      let n: Element | null = quote;
      while (n) { (n as HTMLElement).style.display = 'none'; n = n.nextElementSibling; }
    }
    root.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = `
      :host { display:block; }
      .gp-root { font: 14px/1.55 Arial, Helvetica, sans-serif; color:#202124; overflow-wrap:anywhere; word-break:break-word; }
      .gp-root img { max-width:100%; height:auto; }
      .gp-root table { max-width:100%; }
      .gp-root a { color:#0b57d0; }
      .gp-root blockquote { margin:0 0 0 .8ex; border-left:1px solid #ccc; padding-left:1ex; }
      .gp-root p { margin:0 0 1em; }
      .gp-root pre { white-space:pre-wrap; }
    `;
    root.append(style, document.adoptNode(body));
  }, [html, showImages, quoted]);

  return (
    <div>
      <div ref={host} data-testid={testid} className="min-w-0 overflow-x-auto" />
      {hasQuote && (
        <button type="button" onClick={() => setQuoted((q) => !q)} aria-label={quoted ? 'Hide quoted text' : 'Show quoted text'} title={quoted ? 'Hide quoted text' : 'Show trimmed content'}
          className="mt-2 inline-grid h-5 w-8 place-items-center rounded-md border border-slate-300 bg-slate-100 text-xs leading-none text-slate-600 hover:bg-slate-200" data-testid="button-toggle-quote">
          •••
        </button>
      )}
    </div>
  );
}
