import { describe, expect, it } from "vitest";
import { brandPalette, contrast, normalizeHex } from "./brandColors";

describe("brand colours", () => {
  it("reads #RGB and #RRGGBB, with or without #; refuses anything else", () => {
    expect(normalizeHex("#0a0")).toBe("#00AA00");
    expect(normalizeHex("1e3a8a")).toBe("#1E3A8A");
    expect(normalizeHex("green")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("url(x)")).toBeNull();
  });
  it("navy (today's colour): white text; it already reads as text on white", () => {
    const p = brandPalette("#1E3A8A");
    expect(p.fg).toBe("#FFFFFF");
    expect(p.ink).toBe("#1E3A8A");
    expect(contrast(p.glow, "#111111")).toBeGreaterThanOrEqual(4.5);
  });
  it("lime (the admin's old accent): dark text on it, darkened for text on white", () => {
    const p = brandPalette("#C6F432");
    expect(p.fg).toBe("#111111");
    expect(p.glow).toBe("#C6F432");
    expect(contrast(p.ink, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });
  it("any colour stays readable everywhere it's used", () => {
    for (const c of ["#00FF00", "#16A34A", "#FFFF00", "#000000", "#FFFFFF", "#7C3AED", "#E11D48", "#0EA5E9"]) {
      const p = brandPalette(c);
      expect(contrast(p.fg, p.brand)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.ink, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.glow, "#111111")).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("an unreadable value falls back to the default colour", () => {
    expect(brandPalette("nonsense").brand).toBe("#1E3A8A");
  });
});
