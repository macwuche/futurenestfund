/**
 * How ledger entries read to people. The application charge is stored with the kind "Application fee" (the ledger is
 * append-only and the API filter uses that value), but it's called the "application charge" everywhere it's shown.
 */
export const ledgerKindLabel = (kind: string) => (kind === "Application fee" ? "Application charge" : kind);
export const ledgerReasonLabel = (reason: string) => reason.replace(/^Application fee · /, "Application charge · ");
