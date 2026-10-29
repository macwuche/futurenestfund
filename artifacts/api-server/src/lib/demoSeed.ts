import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, demoProfilesTable, demoAuditTable, demoSettingsTable, demoApplicationsTable, demoApplicationEventsTable, demoMilestonesTable, demoKycDocumentsTable, demoLedgerTable } from "@workspace/db";

/** Logs that must never change once written. Truncating (test resets) is still allowed. */
export const APPEND_ONLY_TRIGGERS = ["demo_audit_append_only", "demo_ledger_append_only", "demo_application_events_append_only"];

/** Stable, random-looking UUID for a seeded row, so re-seeding never inserts it twice. */
const seedUuid = (key: string) => {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export async function seedDemoData(): Promise<void> {
  await db.transaction(async (tx) => {
    const people = [
      { id: "usr-jane", name: "Jane Cooper", email: "jane.cooper@example.com", organization: "Acme Foundation", phone: "+1 (415) 555-0132", telegram: "@janecooper", maskedId: "•••• •••• 4829", tier: 2, verificationLevel: "Verified", grantCents: 1500000, depositCents: 425000, cardCents: 125000, joinedAt: "2026-07-12" },
      { id: "usr-david", name: "David Chen", email: "david.chen@example.com", organization: "Green Futures", phone: "+1 (212) 555-0168", telegram: "@davidchen", maskedId: "•••• •••• 1937", tier: 3, verificationLevel: "Verified", grantCents: 2850000, depositCents: 650000, cardCents: 78000, joinedAt: "2026-06-28" },
      { id: "usr-amara", name: "Amara Okafor", email: "amara.okafor@example.com", organization: "Community Lab", phone: "+234 800 555 0124", telegram: "@amarao", maskedId: "•••• •••• 8205", tier: 1, verificationLevel: "Pending", grantCents: 750000, depositCents: 175000, cardCents: 0, joinedAt: "2026-10-01" },
    ];
    for (const person of people) {
      const inserted = await tx.insert(demoProfilesTable).values({
        ...person,
        status: "Active",
        permissions: { emailNotifications: true, withdrawalKycRequired: true, depositKycRequired: false },
        cards: [
          { id: `${person.id}-virtual`, network: "Visa", kind: "Virtual", lastFour: "4829", status: "Active", balance: person.cardCents / 100 },
          { id: `${person.id}-physical`, network: "Mastercard", kind: "Physical", lastFour: "7391", status: "Pending", balance: 0 },
        ],
        documents: [
          { id: `${person.id}-id`, name: "Government ID · sample", kind: "Government ID", status: person.verificationLevel === "Verified" ? "Verified" : "Pending", confidence: 98.4 },
          { id: `${person.id}-bill`, name: "Utility bill · sample", kind: "Proof of address", status: person.verificationLevel === "Verified" ? "Verified" : "Pending", confidence: 96.1 },
        ],
      }).onConflictDoNothing().returning({ id: demoProfilesTable.id });
      if (inserted.length) {
        await tx.insert(demoAuditTable).values({ profileId: person.id, action: "Sample profile created", actor: "Demo workspace" });
      }
      // Sample identity documents (no file behind them; the OCR score is demonstration data).
      const docStatus = person.verificationLevel === "Verified" ? "Verified" : "Pending";
      await tx.insert(demoKycDocumentsTable).values([
        { id: `${person.id}-id`, profileId: person.id, kind: "Government ID", name: "Government ID · sample", status: docStatus, sampleConfidence: 98.4, createdAt: new Date(`${person.joinedAt}T15:00:00Z`) },
        { id: `${person.id}-bill`, profileId: person.id, kind: "Proof of address", name: "Utility bill · sample", status: docStatus, sampleConfidence: 96.1, createdAt: new Date(`${person.joinedAt}T15:00:00Z`) },
      ]).onConflictDoNothing();
    }
    await tx.insert(demoSettingsTable).values({ id: "platform", frozen: false }).onConflictDoNothing();

    // Ledger entries explaining the sample balances (fixed ids, so they're inserted once).
    // Jane's grant balance is the award for her approved application.
    const opening = people.flatMap((person) => ([["grant", person.grantCents], ["deposit", person.depositCents], ["card", person.cardCents]] as const)
      .filter(([, cents]) => cents > 0)
      .map(([account, cents]) => {
        const award = person.id === "usr-jane" && account === "grant";
        return {
          id: seedUuid(`ledger:${person.id}:${account}`), profileId: person.id, account, amountCents: cents,
          kind: award ? "Grant award" : "Opening balance", actor: award ? "Grant review team" : "Demo workspace",
          reason: award ? "Grant award · Sustainable Futures Fund" : "Opening balance (sample)",
          ...(award ? { applicationId: "APP-2026-003" } : {}),
          createdAt: new Date(`${award ? "2026-10-03" : person.joinedAt}T15:00:00Z`),
        };
      }));
    await tx.insert(demoLedgerTable).values(opening).onConflictDoNothing();

    // The append-only triggers come from migration 0002; refuse to run without them rather than silently allow edits.
    const { rows } = await tx.execute<{ tgname: string }>(sql`select tgname from pg_trigger where not tgisinternal and tgname in (${sql.join(APPEND_ONLY_TRIGGERS.map((t) => sql`${t}`), sql`, `)})`);
    const missing = APPEND_ONLY_TRIGGERS.filter((t) => !rows.some((r) => r.tgname === t));
    if (missing.length) throw new Error(`Append-only triggers missing (${missing.join(", ")}): run pnpm --filter @workspace/scripts run db:migrate`);

    // Sample applications with their status history. Each is inserted once; history only for newly inserted rows.
    const at = (d: string) => new Date(`${d}T15:00:00Z`);
    const team = "Grant review team";
    const apps = [
      { id: "APP-2026-001", title: "AI Innovation Grant", category: "Technology & innovation", status: "Review", amountCents: 2500000, submittedAt: at("2026-10-08"),
        events: [["Submitted", "Application submitted", "Jane Cooper", "2026-10-08"], ["Review", "Assigned to a review panel", team, "2026-10-10"]] },
      { id: "APP-2026-002", title: "Community Arts Support", category: "Arts & culture", status: "Submitted", amountCents: 1000000, submittedAt: at("2026-10-12"),
        events: [["Submitted", "Application submitted", "Jane Cooper", "2026-10-12"]] },
      { id: "APP-2026-003", title: "Sustainable Futures Fund", category: "Environment", status: "Approved", amountCents: 1500000, submittedAt: at("2026-09-24"),
        events: [["Submitted", "Application submitted", "Jane Cooper", "2026-09-24"], ["Review", "Assigned to a review panel", team, "2026-09-28"], ["Approved", "Funding of $15,000.00 approved", team, "2026-10-03"]] },
      { id: "APP-2026-004", title: "Youth Coding Bootcamp", category: "Education", status: "Changes requested", amountCents: 1200000, submittedAt: at("2026-10-02"),
        events: [["Submitted", "Application submitted", "Jane Cooper", "2026-10-02"], ["Changes requested", "Please add a detailed budget breakdown and the expected number of participants.", team, "2026-10-09"]] },
    ] as const;
    let firstSeed = false;
    for (const { events, ...app } of apps) {
      const inserted = await tx.insert(demoApplicationsTable).values({ ...app, profileId: "usr-jane", updatedAt: at(events[events.length - 1][3]) })
        .onConflictDoNothing().returning({ id: demoApplicationsTable.id });
      if (!inserted.length) continue;
      if (app.id === "APP-2026-001") firstSeed = true;
      await tx.insert(demoApplicationEventsTable).values(events.map(([status, note, actor, d]) => ({ applicationId: app.id, status, note, actor, createdAt: at(d) })));
    }
    if (firstSeed) {
      await tx.insert(demoMilestonesTable).values([
        { title: "Project kickoff", due: "2026-10-01", done: true },
        { title: "Interim progress report", due: "2026-11-15", done: false },
        { title: "Budget review with funder", due: "2026-12-10", done: false },
        { title: "Final impact report", due: "2027-03-31", done: false },
      ].map(m => ({ ...m, profileId: "usr-jane", grant: "Sustainable Futures Fund" })));
    }
  });
}
