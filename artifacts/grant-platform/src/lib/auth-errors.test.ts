import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-errors";

describe("authErrorMessage", () => {
  it("turns Supabase error codes into plain language", () => {
    expect(authErrorMessage({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe("Email or password is incorrect.");
    expect(authErrorMessage({ code: "over_request_rate_limit" })).toMatch(/Too many attempts/);
    expect(authErrorMessage({ code: "same_password" })).toMatch(/different/);
  });
  it("falls back to the server message, then to a generic one", () => {
    expect(authErrorMessage({ code: "something_new", message: "Specific reason" })).toBe("Specific reason");
    expect(authErrorMessage(null)).toBe("Something went wrong. Please try again.");
  });
});
