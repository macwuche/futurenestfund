import { describe, expect, it } from "vitest";
import { buildEnvelope, parseDsn, parseStack, scrub, shortReference } from "./monitoring";

describe("scrub", () => {
  it("removes emails, tokens, secrets and long numbers, and caps the length", () => {
    expect(scrub("No user jane.cooper@example.com found", 200)).toBe("No user [email] found");
    expect(scrub("Bearer eyJhbGciOi.eyJzdWIiOjF9.c2lnbmF0dXJl rejected", 200)).toBe("Bearer [token] rejected");
    expect(scrub("key sb_secret_FAKEexample123 leaked", 200)).toBe("key [secret] leaked");
    expect(scrub("card 4111 1111 1111 1111 or +1 (415) 555-0132", 200)).toBe("card [number] or +1 (415) [number]");
    expect(scrub("line 42:17 of 2026-10-31", 200)).toBe("line 42:17 of 2026-10-31");
    expect(scrub("x".repeat(50), 10)).toBe("x".repeat(10));
  });
});

describe("parseDsn", () => {
  it("builds the envelope URL, keeping a path prefix", () => {
    expect(parseDsn("https://abc123@o1.ingest.de.sentry.io/4507")).toEqual({ key: "abc123", host: "o1.ingest.de.sentry.io", envelopeUrl: "https://o1.ingest.de.sentry.io/api/4507/envelope/" });
    expect(parseDsn("https://k@errors.example.org/glitchtip/7").envelopeUrl).toBe("https://errors.example.org/glitchtip/api/7/envelope/");
  });
  it("rejects malformed DSNs", () => {
    for (const bad of ["not a url", "https://o1.ingest.sentry.io/1", "https://k@host/", "ftp://k@host/1", "https://k@host/abc"]) expect(() => parseDsn(bad)).toThrow();
  });
});

describe("parseStack", () => {
  it("reads V8 and Firefox/Safari frames, oldest first, without query strings", () => {
    const v8 = "TypeError: x is undefined\n    at render (https://app/assets/index-abc.js?v=1:10:5)\n    at https://app/assets/vendor.js:2:3";
    expect(parseStack(v8)).toEqual([
      { filename: "https://app/assets/vendor.js", lineno: 2, colno: 3 },
      { function: "render", filename: "https://app/assets/index-abc.js", lineno: 10, colno: 5 },
    ]);
    expect(parseStack("render@https://app/a.js:1:2\n@https://app/b.js:3:4")).toEqual([
      { filename: "https://app/b.js", lineno: 3, colno: 4 },
      { function: "render", filename: "https://app/a.js", lineno: 1, colno: 2 },
    ]);
  });
});

describe("buildEnvelope", () => {
  it("sends only the listed fields: no user, headers, cookies or IP", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    const text = buildEnvelope(
      { source: "server", type: "Error", message: "boom", stack: "Error: boom\n    at f (/app/dist/index.mjs:1:2)", requestId: "rid-1", method: "POST", path: "/api/x" },
      { dsn: "https://k@h/1", eventId: "e".repeat(32), now, environment: "production", release: "abc" },
    );
    const [header, item, event] = text.trimEnd().split("\n").map((l) => JSON.parse(l));
    expect(header).toEqual({ event_id: "e".repeat(32), sent_at: "2026-10-31T12:00:00.000Z", dsn: "https://k@h/1" });
    expect(item).toEqual({ type: "event" });
    expect(Object.keys(event).sort()).toEqual(["environment", "event_id", "exception", "level", "logger", "platform", "release", "request", "tags", "timestamp"]);
    expect(event.request).toEqual({ method: "POST", url: "/api/x" });
    expect(event.tags).toEqual({ source: "server", request_id: "rid-1" });
    expect(event.exception.values[0].stacktrace.frames).toHaveLength(1);
  });
});

describe("buildEnvelope component stack", () => {
  it("sends React's component stack under contexts.react and keeps it out of the frames", () => {
    const text = buildEnvelope(
      { source: "browser", type: "Error", message: "boom", stack: "Error: boom\n    at f (http://app/a.js:1:2)\nComponent stack:\n    at CardsBody (http://app/c.js:3:4)\n    at Shell" },
      { dsn: "https://k@h/1", eventId: "e".repeat(32), now: new Date(), environment: "test" },
    );
    const event = JSON.parse(text.trimEnd().split("\n")[2]!);
    expect(event.contexts.react.componentStack).toBe("at CardsBody (http://app/c.js:3:4)\n    at Shell");
    expect(event.exception.values[0].stacktrace.frames).toEqual([{ function: "f", filename: "http://app/a.js", lineno: 1, colno: 2 }]);
  });
});

describe("shortReference", () => {
  it("is the first 8 hex characters", () => {
    expect(shortReference("1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809")).toBe("1a2b3c4d");
  });
});
