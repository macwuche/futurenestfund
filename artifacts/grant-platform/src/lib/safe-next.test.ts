import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext (where sign-in may send you afterwards)", () => {
  it.each(["/", "/admin/kyc", "/applications?x=1", "/settings#verification"])("allows the in-app path %s", (p) => {
    expect(safeNext(p)).toBe(p);
  });
  it.each([
    "//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "evil.example", "/\t/evil.example",
    "/\n/evil.example", "/x\\..\\evil", "", null, undefined, `/${"a".repeat(2001)}`,
  ])("refuses %j", (p) => {
    expect(safeNext(p as string | null | undefined)).toBeNull();
  });
});
