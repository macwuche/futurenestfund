import { describe, expect, it } from "vitest";
import { GRANTS, RECOMMEND_AT, daysUntil, rankGrants, scoreGrant, type Grant, type MatchAnswers } from "./grantCatalog";

const TODAY = "2026-10-30";
const grant = (over: Partial<Grant> = {}): Grant => ({
  id: "g", title: "Test grant", category: "Environment", amount: 20000, deadline: "2026-11-20",
  orgTypes: ["Nonprofit"], goals: ["Equipment"], ...over,
});
const answers = (over: Partial<MatchAnswers> = {}): MatchAnswers => ({
  orgType: "Nonprofit", focusAreas: ["Environment"], goals: ["Equipment"], fundingSize: "10to30k", timeline: "30days", ...over,
});

describe("daysUntil", () => {
  it("counts whole days, 0 on the deadline and negative after it", () => {
    expect(daysUntil("2026-11-29", TODAY)).toBe(30);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
    expect(daysUntil("2026-10-29", TODAY)).toBe(-1);
  });
});

describe("scoreGrant", () => {
  it("awards every rule for a perfect fit, with one reason each", () => {
    const m = scoreGrant(grant(), answers(), TODAY);
    expect(m).toMatchObject({ score: 100, eligible: true, open: true, recommended: true });
    expect(m.reasons).toEqual([
      "Matches your focus: Environment",
      "Funds what you need: equipment",
      "Amount fits your size ($10,000–$30,000)",
      "Decided soon enough: closes in 21 days",
    ]);
  });

  it("makes a grant for other organization types ineligible, whatever else fits", () => {
    const m = scoreGrant(grant({ orgTypes: ["School or university"] }), answers(), TODAY);
    expect(m).toMatchObject({ score: 0, eligible: false, recommended: false, reasons: ["Not open to nonprofits"] });
  });

  it("never recommends a closed grant", () => {
    const m = scoreGrant(grant({ deadline: "2026-10-29" }), answers(), TODAY);
    expect(m).toMatchObject({ score: 0, open: false, recommended: false });
  });

  it("needs a focus-area match to be recommended (the other rules add up to 60)", () => {
    const m = scoreGrant(grant(), answers({ focusAreas: ["Health"] }), TODAY);
    expect(m.score).toBe(60);
    expect(m.score).toBeLessThan(RECOMMEND_AT);
    expect(m.recommended).toBe(false);
  });

  it("gives part credit for a neighbouring size band and none for a distant one", () => {
    expect(scoreGrant(grant({ amount: 50000 }), answers(), TODAY).score).toBe(88);
    expect(scoreGrant(grant({ amount: 50000 }), answers({ fundingSize: "under10k" }), TODAY).score).toBe(80);
    expect(scoreGrant(grant({ amount: 5000 }), answers({ fundingSize: "any" }), TODAY).score).toBe(100);
  });

  it("scores timing against when the money is needed", () => {
    const late = grant({ deadline: "2027-01-28" }); // 90 days away
    expect(scoreGrant(late, answers({ timeline: "30days" }), TODAY).score).toBe(85);
    expect(scoreGrant(late, answers({ timeline: "90days" }), TODAY).score).toBe(100);
    expect(scoreGrant(grant({ deadline: "2027-02-01" }), answers({ timeline: "90days" }), TODAY).score).toBe(90);
    expect(scoreGrant(late, answers({ timeline: "flexible" }), TODAY).reasons.at(-1)).toBe("Open now: closes in 90 days");
    expect(scoreGrant(grant({ deadline: TODAY }), answers(), TODAY).reasons.at(-1)).toBe("Decided soon enough: closes today");
  });

  it("recommends exactly at the threshold", () => {
    // focus 40 + size 20 + late timing 10 = 70, no goal match
    const m = scoreGrant(grant({ deadline: "2027-02-01" }), answers({ goals: ["Operating costs"], timeline: "90days" }), TODAY);
    expect(m.score).toBe(RECOMMEND_AT);
    expect(m.recommended).toBe(true);
  });
});

describe("rankGrants", () => {
  it("scores the whole catalogue, best first, ties by earliest deadline", () => {
    const ranked = rankGrants(answers({ focusAreas: ["Environment", "Community"], goals: ["Grow an existing program"], fundingSize: "any", timeline: "flexible" }), TODAY);
    expect(ranked).toHaveLength(GRANTS.length);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    expect(ranked.slice(0, 2).map((m) => m.grantId)).toEqual(["grant-community", "grant-water"]);
  });

  it("is deterministic for equal scores (deadline, then title)", () => {
    const a = grant({ id: "a", title: "B", deadline: "2026-12-01" });
    const b = grant({ id: "b", title: "A", deadline: "2026-12-01" });
    const c = grant({ id: "c", title: "C", deadline: "2026-11-15" });
    expect(rankGrants(answers(), TODAY, [a, b, c]).map((m) => m.grantId)).toEqual(["c", "b", "a"]);
  });
});
