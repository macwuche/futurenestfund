import { eq } from "drizzle-orm";
import { db, demoProfilesTable, demoAuditTable, type DemoProfile } from "@workspace/db";
import { SaveApplicantMatchmakingBody } from "@workspace/api-zod";
import { GRANTS, rankGrants, type MatchAnswers } from "./grantCatalog";

const today = () => new Date().toISOString().slice(0, 10);

/** The stored answers, or null when unanswered (or saved by an older version in a shape we no longer accept). */
export function storedAnswers(profile: Pick<DemoProfile, "matchmaking">): MatchAnswers | null {
  const parsed = SaveApplicantMatchmakingBody.safeParse(profile.matchmaking);
  return parsed.success ? parsed.data : null;
}

/** The catalogue in dashboard shape. Before the questionnaire is answered nothing is recommended and there are no scores. */
export function grantRecommendations(answers: MatchAnswers | null) {
  if (!answers) return GRANTS.map(({ id, title, category, amount, deadline }) => ({ id, title, category, amount, deadline, recommended: false }));
  const byId = new Map(GRANTS.map((g) => [g.id, g]));
  return rankGrants(answers, today()).map((m) => {
    const { id, title, category, amount, deadline } = byId.get(m.grantId)!;
    return { id, title, category, amount, deadline, recommended: m.recommended, matchScore: m.score, matchReasons: m.reasons };
  });
}

const matchmakingOut = (answers: MatchAnswers | null) => ({ answers, matches: answers ? rankGrants(answers, today()) : [] });

export async function getMatchmaking(profileId: string) {
  const [p] = await db.select({ matchmaking: demoProfilesTable.matchmaking }).from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId));
  if (!p) throw new Error(`Applicant ${profileId} is missing`);
  return matchmakingOut(storedAnswers(p));
}

/** Save (or replace) the answers; audited. Duplicate picks are dropped and the lists kept in a stable order. */
export async function saveMatchmaking(profileId: string, input: MatchAnswers, actor: string) {
  const answers: MatchAnswers = { ...input, focusAreas: [...new Set(input.focusAreas)], goals: [...new Set(input.goals)] };
  await db.transaction(async (tx) => {
    const [p] = await tx.select({ matchmaking: demoProfilesTable.matchmaking }).from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId)).for("update");
    if (!p) throw new Error(`Applicant ${profileId} is missing`);
    if (JSON.stringify(storedAnswers(p)) === JSON.stringify(answers)) return;
    await tx.update(demoProfilesTable).set({ matchmaking: answers }).where(eq(demoProfilesTable.id, profileId));
    await tx.insert(demoAuditTable).values({ profileId, actor, action: p.matchmaking ? "Updated grant matchmaking answers" : "Answered grant matchmaking" });
  });
  return matchmakingOut(answers);
}
