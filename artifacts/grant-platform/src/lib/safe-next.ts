/**
 * Only paths inside this app are allowed as a ?next= target after sign-in. Anything that a browser would treat as another
 * site ("//evil.com", "/\\evil.com", "https://…", "javascript:…") or that contains control characters is refused.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2000) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null; // browsers turn "\\" into "/" and strip tabs/newlines
  return raw;
}
