/**
 * Branding: everything the app needs from the one brand colour the administrator picks. Pure, unit-tested; the web app
 * has the same maths in `grant-platform/src/lib/brand-colors.ts` (keep them in step).
 *
 * The colour itself fills buttons and highlights; text on it is white or near-black, whichever reads better. Where the
 * brand colour is used as text (links on white, accents on the admin's black menu) it's darkened or lightened just enough
 * to reach a 4.5:1 contrast, so any colour the admin picks stays readable.
 */

export const DEFAULT_BRAND_COLOR = "#1E3A8A";
const INK = "#111111";

export function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(s);
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.split("").map(c => c + c).join("") : m[1]!;
  return `#${h.toUpperCase()}`;
}

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
/** Mix `a` toward `b`: t = 0 is `a`, t = 1 is `b`. */
export const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i]! - v) * t)); };

export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** Move `hex` toward `toward` in small steps until it reaches `ratio` against `bg` (or gets there). */
function reach(hex: string, bg: string, toward: string, ratio = 4.5) {
  for (let t = 0; t <= 1.0001; t += 0.05) { const c = mix(hex, toward, t); if (contrast(c, bg) >= ratio) return c; }
  return toward;
}

export type BrandPalette = {
  /** The colour as picked: fills buttons, active items, badges. */
  brand: string;
  /** Text and icons on the brand colour. */
  fg: string;
  /** The brand as text on white (links, headings, borders that must show). */
  ink: string;
  /** The brand as text on the admin's black menu and header. */
  glow: string;
  /** Hover / pressed fill. */
  dark: string;
  /** A lighter end for gradients. */
  light: string;
  /** Tinted backgrounds and their borders. */
  soft: string; soft2: string;
};

export function brandPalette(color: string): BrandPalette {
  const brand = normalizeHex(color) ?? DEFAULT_BRAND_COLOR;
  const fg = contrast(brand, "#FFFFFF") >= contrast(brand, INK) ? "#FFFFFF" : INK;
  return {
    brand, fg,
    ink: reach(brand, "#FFFFFF", "#000000"),
    glow: reach(brand, INK, "#FFFFFF"),
    // A darker fill for hover: for a light colour with dark text, stay light enough for that text.
    dark: fg === "#FFFFFF" ? mix(brand, "#000000", 0.3) : mix(brand, "#000000", 0.12),
    light: mix(brand, "#FFFFFF", 0.25),
    soft: mix(brand, "#FFFFFF", 0.92),
    soft2: mix(brand, "#FFFFFF", 0.8),
  };
}
