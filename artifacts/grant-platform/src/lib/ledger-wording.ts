/** The application charge is stored with the ledger kind "Application fee"; this is how a kind reads on screen. */
export const ledgerKindLabel = (kind: string) => (kind === 'Application fee' ? 'Application charge' : kind);
