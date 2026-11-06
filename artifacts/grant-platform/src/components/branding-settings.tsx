import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAdminBranding, useUpdateAdminBranding, useUploadAdminBrandingLogo, useSetAdminBrandingLogoUrl, useDeleteAdminBrandingLogo,
  getGetAdminBrandingQueryKey, getGetBrandingQueryKey, type AdminBranding,
} from '@workspace/api-client-react';
import { ImageUp, Link2, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { ErrorState, Field, Skel, cx } from '@/components/bits';
import { ainput, card, ghost, lime, SectionTitle } from '@/components/admin-bits';
import { BrandMark, useBranding } from '@/lib/branding';
import { normalizeHex } from '@/lib/brand-colors';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/*
 * Admin Settings → Branding: the application's name, its brand colour and logo, for both sides, the sign-in pages and
 * every email. While picking, this screen previews the colour live; saving applies it everywhere (other open screens
 * follow within 15 seconds).
 */

const SWATCHES = ['#1E3A8A', '#2563EB', '#0891B2', '#0D9488', '#16A34A', '#65A30D', '#C6F432', '#CA8A04', '#EA580C', '#DC2626', '#DB2777', '#7C3AED', '#111827'];

export function BrandingSettings() {
  const q = useGetAdminBranding();
  const save = useUpdateAdminBranding();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { preview } = useBranding();
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [hex, setHex] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (q.data) { setName(q.data.appName); setColor(q.data.color); setHex(q.data.color); } }, [q.data]);
  // Live preview on this screen while editing; leaving the page puts the saved branding back.
  useEffect(() => { if (q.data) preview({ color, appName: name }); }, [color, name, q.data, preview]);
  useEffect(() => () => preview(null), [preview]);

  const refreshAll = (data: AdminBranding) => {
    qc.setQueryData(getGetAdminBrandingQueryKey(), data);
    qc.invalidateQueries({ queryKey: getGetBrandingQueryKey() });
  };
  const pick = (c: string) => { setColor(c); setHex(c); setErr(''); };
  const dirty = !!q.data && (name.trim() !== q.data.appName || color !== q.data.color);

  if (q.isLoading) return <div className={cx(card, 'space-y-3 p-5')}><Skel className="h-6 w-40" /><Skel className="h-28" /></div>;
  if (q.isError || !q.data) return <div className={cx(card, 'p-5')}><ErrorState onRetry={() => q.refetch()} /></div>;
  const d = q.data;

  return (
    <>
      <form noValidate className={cx(card, 'space-y-5 p-5')} data-testid="form-branding" onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (n.length < 2 || n.length > 40) return setErr('Give the application a name of 2–40 characters.');
        if (!normalizeHex(color)) return setErr('Choose a colour, or enter it as a hex code like #16A34A.');
        setErr('');
        save.mutate({ data: { appName: n, color } }, {
          onSuccess: (data) => { refreshAll(data); toast({ title: 'Branding saved', description: 'It applies everywhere now; other open screens follow within 15 seconds.' }); },
          onError: (e2) => setErr(apiError(e2, 'The branding could not be saved. Please try again.')),
        });
      }}>
        <div>
          <SectionTitle>Name and colour</SectionTitle>
          <p className="text-sm text-slate-600">Shown on the user and admin sides, the sign-in pages, the browser tab and every email. This screen previews your changes as you make them; they apply for everyone when you save.</p>
        </div>
        <Field label="Application name">
          <input value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setErr(''); }} className={cx(ainput, 'min-h-11')} data-testid="input-app-name" placeholder={d.defaults.appName} />
        </Field>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Brand colour</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Brand colour">
            {SWATCHES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => pick(c)} data-testid={`swatch-${c.slice(1)}`}
                className={cx('press h-11 w-11 rounded-full ring-offset-2 transition', color === c ? 'ring-2 ring-[#111]' : 'ring-1 ring-black/10 hover:ring-2 hover:ring-slate-400')}
                style={{ background: c }} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-2 text-sm font-semibold">
              <input type="color" value={normalizeHex(color)?.toLowerCase() ?? '#1e3a8a'} onChange={(e) => pick(e.target.value.toUpperCase())} className="h-8 w-10 cursor-pointer border-0 bg-transparent p-0" aria-label="Pick any colour" data-testid="input-color-picker" />
              Any colour
            </label>
            <input value={hex} onChange={(e) => { setHex(e.target.value); const n = normalizeHex(e.target.value); if (n) { setColor(n); setErr(''); } }} maxLength={7} aria-label="Hex code"
              className={cx(ainput, 'font-num min-h-11 !w-32 uppercase')} data-testid="input-color-hex" placeholder="#16A34A" />
            <button type="button" className={cx(ghost, 'inline-flex min-h-11 items-center gap-1.5')} onClick={() => { pick(d.defaults.color); setName(d.defaults.appName); }} data-testid="button-branding-defaults">
              <RotateCcw className="h-4 w-4" />Defaults
            </button>
          </div>
        </fieldset>

        <Preview name={name.trim() || d.appName} />

        {err && <p role="alert" className="text-sm text-red-700" data-testid="error-branding">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <button data-testid="button-save-branding" disabled={save.isPending || !dirty} className={cx(lime, 'inline-flex min-h-11 items-center gap-2')}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{save.isPending ? 'Saving…' : 'Save branding'}
          </button>
          {dirty && <button type="button" className={cx(ghost, 'min-h-11')} onClick={() => { setName(d.appName); pick(d.color); }} data-testid="button-branding-undo">Undo changes</button>}
        </div>
      </form>
      <LogoCard d={d} onSaved={refreshAll} />
    </>
  );
}

/** What the brand looks like on each side, with the readable text colours worked out for it. */
function Preview({ name }: { name: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="branding-preview">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">User side</p>
        <div className="flex items-center gap-2"><BrandMark className="h-8 w-8 text-base" rounded="rounded-lg" /><span className="truncate text-lg font-bold">{name}</span></div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-[var(--brand-fg)]">Apply for this grant</span>
          <span className="text-sm font-semibold text-[var(--brand-ink)] underline">A link</span>
        </div>
        <div className="mt-3 rounded-lg bg-[var(--brand-soft)] p-3 text-xs text-slate-700">A highlighted panel</div>
      </div>
      <div className="rounded-xl bg-[#111] p-4 text-white">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Admin side</p>
        <div className="flex items-center gap-2"><BrandMark className="h-8 w-8 text-base" rounded="rounded-lg" /><span className="truncate text-lg font-bold">{name}</span></div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-[var(--brand-fg)]">Active menu item</span>
          <span className="text-xs font-semibold uppercase tracking-widest text-[var(--brand-glow)]">Command center</span>
        </div>
      </div>
    </div>
  );
}

function LogoCard({ d, onSaved }: { d: AdminBranding; onSaved: (d: AdminBranding) => void }) {
  const upload = useUploadAdminBrandingLogo();
  const fromUrl = useSetAdminBrandingLogoUrl();
  const remove = useDeleteAdminBrandingLogo();
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = upload.isPending || fromUrl.isPending || remove.isPending;
  const done = (title: string) => (data: AdminBranding) => { onSaved(data); setErr(''); toast({ title }); };
  const fail = (e: unknown) => setErr(apiError(e, 'The logo could not be saved. Please try again.'));
  return (
    <section className={cx(card, 'space-y-4 p-5')} data-testid="card-brand-logo">
      <div>
        <SectionTitle>Logo</SectionTitle>
        <p className="text-sm text-slate-600">Shown next to the name in both menus, on the sign-in pages and as the browser tab icon. A square PNG, JPEG or WebP up to 2 MB works best. Without a logo, the name's first letter on the brand colour is used.</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <BrandMark className="h-16 w-16 text-2xl" rounded="rounded-2xl" />
        <p className="text-sm text-slate-600" data-testid="text-logo-source">
          {d.logoUrl ? (d.logoSource === 'upload' ? 'Uploaded logo' : `Logo taken from ${d.logoSource}`) : 'No logo: the first letter is used'}
        </p>
        {d.logoUrl && (
          <button type="button" disabled={busy} className={cx(ghost, 'inline-flex min-h-11 items-center gap-1.5 text-red-700')} data-testid="button-remove-logo"
            onClick={() => remove.mutate(undefined, { onSuccess: done('Logo removed'), onError: fail })}><Trash2 className="h-4 w-4" />Remove</button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" data-testid="input-logo-file"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate({ data: { file: f } }, { onSuccess: done('Logo uploaded'), onError: fail }); }} />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={cx(lime, 'inline-flex min-h-11 items-center gap-2')} data-testid="button-upload-logo">
          {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}Upload logo
        </button>
      </div>
      <form noValidate className="flex flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (!/^https:\/\//i.test(url.trim())) return setErr('Enter an image link starting with https://');
        fromUrl.mutate({ data: { url: url.trim() } }, { onSuccess: (x) => { setUrl(''); done('Logo saved from the link')(x); }, onError: fail });
      }}>
        <input value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} placeholder="https://example.org/logo.png" aria-label="Logo image link"
          className={cx(ainput, 'min-h-11 min-w-0 flex-1 basis-56')} data-testid="input-logo-url" />
        <button disabled={busy || !url.trim()} className={cx(ghost, 'inline-flex min-h-11 items-center gap-1.5')} data-testid="button-logo-url">
          {fromUrl.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Use this link
        </button>
      </form>
      <p className="text-xs text-slate-500">A link is downloaded once and stored here (re-encoded, like an upload), so the logo keeps working if the other site changes.</p>
      {err && <p role="alert" className="text-sm text-red-700" data-testid="error-brand-logo">{err}</p>}
    </section>
  );
}
