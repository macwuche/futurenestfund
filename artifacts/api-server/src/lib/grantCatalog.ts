/**
 * The sample grant catalogue and the rule-based matchmaking that ranks it for an applicant. No AI: every point of a
 * score comes from one of the rules below, and each awarded rule produces a reason the applicant can read.
 */

export const ORG_TYPES = ["Nonprofit", "Small business", "Individual or artist", "School or university", "Community group"] as const;
export const GOALS = ["Start a new project", "Grow an existing program", "Research and development", "Equipment", "Operating costs"] as const;
export const FUNDING_SIZES = ["under10k", "10to30k", "over30k", "any"] as const;
export const TIMELINES = ["30days", "90days", "flexible"] as const;

export type OrgType = (typeof ORG_TYPES)[number];
export type Goal = (typeof GOALS)[number];
export type FundingSize = (typeof FUNDING_SIZES)[number];
export type Timeline = (typeof TIMELINES)[number];

export type MatchAnswers = { orgType: OrgType; focusAreas: string[]; goals: Goal[]; fundingSize: FundingSize; timeline: Timeline };

export type Grant = { id: string; title: string; category: string; amount: number; deadline: string; orgTypes: OrgType[]; goals: Goal[] };

const ALL: OrgType[] = [...ORG_TYPES];

export const GRANTS: Grant[] = [
  { id: "grant-tech", title: "Digital Impact Fellowship", category: "Technology & innovation", amount: 30000, deadline: "2026-11-30", orgTypes: ["Nonprofit", "Small business", "Individual or artist"], goals: ["Start a new project", "Research and development"] },
  { id: "grant-community", title: "Community Builders Fund", category: "Community", amount: 15000, deadline: "2026-12-15", orgTypes: ["Nonprofit", "Community group"], goals: ["Grow an existing program", "Operating costs"] },
  { id: "grant-green", title: "Climate Action Accelerator", category: "Environment", amount: 50000, deadline: "2026-12-01", orgTypes: ["Nonprofit", "Small business"], goals: ["Start a new project", "Research and development", "Equipment"] },
  { id: "grant-arts", title: "Emerging Artists Commission", category: "Arts & culture", amount: 8000, deadline: "2026-11-20", orgTypes: ["Individual or artist"], goals: ["Start a new project"] },
  { id: "grant-edu", title: "Classroom Innovation Award", category: "Education", amount: 12000, deadline: "2027-01-15", orgTypes: ["School or university", "Nonprofit"], goals: ["Start a new project", "Equipment"] },
  { id: "grant-health", title: "Community Health Pilot Fund", category: "Health", amount: 40000, deadline: "2027-02-01", orgTypes: ["Nonprofit", "Community group", "School or university"], goals: ["Start a new project", "Research and development"] },
  { id: "grant-open", title: "Open Source Infrastructure Grant", category: "Technology & innovation", amount: 20000, deadline: "2026-12-31", orgTypes: ALL, goals: ["Grow an existing program", "Operating costs"] },
  { id: "grant-youth", title: "Youth Leadership Micro-grant", category: "Community", amount: 2500, deadline: "2026-11-05", orgTypes: ["Community group", "School or university", "Nonprofit"], goals: ["Start a new project"] },
  { id: "grant-water", title: "Clean Water Access Initiative", category: "Environment", amount: 75000, deadline: "2027-03-01", orgTypes: ["Nonprofit"], goals: ["Equipment", "Grow an existing program"] },
  { id: "grant-heritage", title: "Heritage Digitization Fund", category: "Arts & culture", amount: 18000, deadline: "2027-01-31", orgTypes: ["Nonprofit", "School or university", "Community group"], goals: ["Equipment", "Grow an existing program"] },
  { id: "grant-stem", title: "STEM Scholars Program", category: "Education", amount: 5000, deadline: "2026-11-25", orgTypes: ["School or university", "Individual or artist"], goals: ["Research and development"] },
  { id: "grant-mental", title: "Mental Health Outreach Grant", category: "Health", amount: 22000, deadline: "2026-12-20", orgTypes: ["Nonprofit", "Community group"], goals: ["Grow an existing program", "Operating costs"] },
];

export const CATEGORIES = Array.from(new Set(GRANTS.map((g) => g.category)));

/** A recommendation needs at least this score; focus (40) is then always among the rules met. */
export const RECOMMEND_AT = 70;

export type Match = { grantId: string; score: number; eligible: boolean; open: boolean; recommended: boolean; reasons: string[] };

const SIZE_LABEL: Record<FundingSize, string> = { under10k: "under $10,000", "10to30k": "$10,000–$30,000", over30k: "over $30,000", any: "any amount" };
const sizeBand = (amount: number): Exclude<FundingSize, "any"> => (amount < 10000 ? "under10k" : amount <= 30000 ? "10to30k" : "over30k");
const BAND_ORDER = ["under10k", "10to30k", "over30k"] as const;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural: Record<OrgType, string> = {
  Nonprofit: "nonprofits", "Small business": "small businesses", "Individual or artist": "individuals or artists",
  "School or university": "schools or universities", "Community group": "community groups",
};

/** Whole days from `today` (YYYY-MM-DD) to the deadline; negative once it has passed. The deadline day itself counts as 0. */
export function daysUntil(deadline: string, today: string) {
  return Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Score one grant for one set of answers. */
export function scoreGrant(g: Grant, a: MatchAnswers, today: string): Match {
  const days = daysUntil(g.deadline, today);
  const open = days >= 0;
  if (!g.orgTypes.includes(a.orgType)) {
    return { grantId: g.id, score: 0, eligible: false, open, recommended: false, reasons: [`Not open to ${plural[a.orgType]}`] };
  }
  if (!open) return { grantId: g.id, score: 0, eligible: true, open, recommended: false, reasons: ["Closed: the deadline has passed"] };
  let score = 0;
  const reasons: string[] = [];
  if (a.focusAreas.includes(g.category)) { score += 40; reasons.push(`Matches your focus: ${g.category}`); }
  const goal = a.goals.find((x) => g.goals.includes(x));
  if (goal) { score += 20; reasons.push(`Funds what you need: ${lower(goal)}`); }
  const band = sizeBand(g.amount);
  if (a.fundingSize === "any" || a.fundingSize === band) { score += 20; reasons.push(`Amount fits your size (${SIZE_LABEL[a.fundingSize]})`); }
  else if (Math.abs(BAND_ORDER.indexOf(band) - BAND_ORDER.indexOf(a.fundingSize)) === 1) { score += 8; reasons.push(`Amount is close to your size (${SIZE_LABEL[a.fundingSize]})`); }
  const closes = days === 0 ? "closes today" : `closes in ${days} ${days === 1 ? "day" : "days"}`;
  if (a.timeline === "flexible") { score += 20; reasons.push(`Open now: ${closes}`); }
  else {
    const limit = a.timeline === "30days" ? 30 : 90;
    if (days <= limit) { score += 20; reasons.push(`Decided soon enough: ${closes}`); }
    else { score += a.timeline === "30days" ? 5 : 10; reasons.push(`Later than you need: ${closes}`); }
  }
  return { grantId: g.id, score, eligible: true, open, recommended: score >= RECOMMEND_AT, reasons };
}

/** Every grant scored, best first: score, then the earliest deadline, then the title. */
export function rankGrants(a: MatchAnswers, today: string, grants: Grant[] = GRANTS): Match[] {
  const byId = new Map(grants.map((g) => [g.id, g]));
  return grants.map((g) => scoreGrant(g, a, today)).sort((x, y) =>
    y.score - x.score || byId.get(x.grantId)!.deadline.localeCompare(byId.get(y.grantId)!.deadline) || byId.get(x.grantId)!.title.localeCompare(byId.get(y.grantId)!.title));
}
