import { describe, expect, it } from "vitest";
import { expiresSoon, formatNumber, isExpired, luhnOk, networkOf, parseCard, parseExpiry } from "./cardRules";

const NOW = new Date("2026-11-20T12:00:00Z");
const good = { holderName: "Jane  Doe", number: "4242 4242 4242 4242", expiry: "08/29", cvv: "123" };

describe("card rules", () => {
  it("checks the Luhn digit", () => {
    expect(luhnOk("4242424242424242")).toBe(true);
    expect(luhnOk("4242424242424241")).toBe(false);
    expect(luhnOk("378282246310005")).toBe(true);
  });

  it("tells the network from the number", () => {
    expect(networkOf("4242424242424242")).toBe("visa");
    expect(networkOf("5555555555554444")).toBe("mastercard");
    expect(networkOf("2223003122003222")).toBe("mastercard");
    expect(networkOf("378282246310005")).toBe("amex");
    expect(networkOf("5061000000000000000")).toBe("verve");
    expect(networkOf("6011111111111117")).toBe("discover");
    expect(networkOf("9999999999999995")).toBe("other");
  });

  it("reads MM/YY and MM/YYYY", () => {
    expect(parseExpiry("08/29")).toEqual({ month: 8, year: 2029 });
    expect(parseExpiry(" 1 / 2030 ")).toEqual({ month: 1, year: 2030 });
    expect(parseExpiry("13/29")).toBeNull();
    expect(parseExpiry("0829")).toBeNull();
  });

  it("counts a card as valid through the end of its expiry month", () => {
    expect(isExpired(11, 2026, NOW)).toBe(false);
    expect(isExpired(10, 2026, NOW)).toBe(true);
    expect(isExpired(1, 2025, NOW)).toBe(true);
    expect(expiresSoon(12, 2026, NOW)).toBe(true);
    expect(expiresSoon(2, 2027, NOW)).toBe(false);
  });

  it("accepts a good card and tidies it", () => {
    expect(parseCard(good, NOW)).toEqual({ holderName: "Jane Doe", number: "4242424242424242", network: "visa", lastFour: "4242", expMonth: 8, expYear: 2029, cvv: "123" });
  });

  it("refuses bad cards with a reason", () => {
    expect(parseCard({ ...good, holderName: "J" }, NOW)).toMatch(/name on the card/);
    expect(parseCard({ ...good, holderName: "Jane 2" }, NOW)).toMatch(/numbers/);
    expect(parseCard({ ...good, number: "4242 4242 4242 4241" }, NOW)).toMatch(/isn't valid/);
    expect(parseCard({ ...good, number: "4242" }, NOW)).toMatch(/12 to 19/);
    expect(parseCard({ ...good, expiry: "10/26" }, NOW)).toMatch(/expired/);
    expect(parseCard({ ...good, expiry: "1029" }, NOW)).toMatch(/MM\/YY/);
    expect(parseCard({ ...good, cvv: "12" }, NOW)).toMatch(/3-digit/);
    expect(parseCard({ ...good, number: "378282246310005", cvv: "123" }, NOW)).toMatch(/4-digit.*front/);
  });

  it("groups the digits for display", () => {
    expect(formatNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatNumber("378282246310005")).toBe("3782 822463 10005");
  });
});
