import { db, demoProfilesTable, demoAuditTable, demoSettingsTable } from "@workspace/db";

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
    }
    await tx.insert(demoSettingsTable).values({ id: "platform", frozen: false }).onConflictDoNothing();
  });
}
