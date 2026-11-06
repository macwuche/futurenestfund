import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useGetBranding, getGetBrandingQueryKey, type Branding, type BrandPalette } from '@workspace/api-client-react';
import { brandPalette, DEFAULT_BRAND_COLOR } from '@/lib/brand-colors';

/*
 * Branding (Admin Settings → Branding): the application's name, brand colour and logo, on both sides and on the sign-in
 * pages. The colour is applied as CSS variables (index.css): --brand, --brand-fg, --brand-ink, --brand-glow, --brand-dark,
 * --brand-light, --brand-soft, --brand-soft2. Every open screen re-reads it every 15 seconds and when the tab comes back.
 * The last branding seen is kept in localStorage, so a reload paints in the right colour and name straight away.
 */

export const DEFAULT_APP_NAME = 'GrantApp';
const STORE_KEY = 'gp-branding';
type Brand = { appName: string; color: string; palette: BrandPalette; logoUrl: string | null };

const fallback: Brand = { appName: DEFAULT_APP_NAME, color: DEFAULT_BRAND_COLOR, palette: brandPalette(DEFAULT_BRAND_COLOR), logoUrl: null };
function remembered(): Brand {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Brand | null; return v?.palette ? v : fallback; } catch { return fallback; }
}

const VARS: [keyof BrandPalette, string][] = [
  ['brand', '--brand'], ['fg', '--brand-fg'], ['ink', '--brand-ink'], ['glow', '--brand-glow'],
  ['dark', '--brand-dark'], ['light', '--brand-light'], ['soft', '--brand-soft'], ['soft2', '--brand-soft2'],
];
export function applyPalette(p: BrandPalette) {
  const root = document.documentElement.style;
  for (const [k, v] of VARS) root.setProperty(v, p[k]);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.brand);
}

function applyIcon(b: Brand) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  if (b.logoUrl) { link.type = 'image/webp'; link.href = b.logoUrl; return; }
  // No logo: the name's first letter on the brand colour.
  const letter = (b.appName.trim()[0] ?? 'G').toUpperCase().replace(/[<&>"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${b.palette.brand}"/><text x="32" y="43" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="${b.palette.fg}">${letter}</text></svg>`;
  link.type = 'image/svg+xml';
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

type Ctx = Brand & {
  /** Admin Settings → Branding: show a colour / name on this screen before saving it (null = back to the saved one). */
  preview: (p: { color?: string; appName?: string } | null) => void;
};
const BrandingContext = createContext<Ctx>({ ...fallback, preview: () => {} });

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(remembered);
  const q = useGetBranding({ query: { queryKey: getGetBrandingQueryKey(), refetchInterval: 15_000, refetchOnWindowFocus: true, staleTime: 5_000, retry: 1 } });
  const saved: Brand = (q.data as Branding | undefined) ?? initial;
  const [draft, setDraft] = useState<{ color?: string; appName?: string } | null>(null);
  const brand = useMemo<Brand>(() => {
    if (!draft) return saved;
    const color = draft.color ?? saved.color;
    return { ...saved, color, palette: draft.color ? brandPalette(color) : saved.palette, appName: draft.appName?.trim() || saved.appName };
  }, [saved, draft]);

  useEffect(() => { applyPalette(brand.palette); applyIcon(brand); }, [brand]);
  useEffect(() => {
    // Pages set their own titles ("Dashboard | <name>"); before one does, the tab shows the name.
    if (!document.title || document.title === DEFAULT_APP_NAME || document.title === initial.appName) document.title = brand.appName;
    if (q.data) try { localStorage.setItem(STORE_KEY, JSON.stringify(q.data)); } catch { /* private mode */ }
  }, [brand.appName, q.data]);

  const value = useMemo<Ctx>(() => ({ ...brand, preview: setDraft }), [brand]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => useContext(BrandingContext);

/** The logo, or the name's first letter on the brand colour. */
export function BrandMark({ className = 'h-9 w-9', rounded = 'rounded-xl' }: { className?: string; rounded?: string }) {
  const b = useBranding();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [b.logoUrl]);
  if (b.logoUrl && !failed) {
    return <img src={b.logoUrl} alt="" className={`${className} ${rounded} shrink-0 object-contain`} onError={() => setFailed(true)} data-testid="img-brand-logo" />;
  }
  return (
    <span aria-hidden className={`${className} ${rounded} grid shrink-0 place-items-center bg-[var(--brand)] font-bold text-[var(--brand-fg)]`} data-testid="brand-letter">
      {(b.appName.trim()[0] ?? 'G').toUpperCase()}
    </span>
  );
}
