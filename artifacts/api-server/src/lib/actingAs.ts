import { AsyncLocalStorage } from "node:async_hooks";

/**
 * While an administrator is signed in as a user ("Sign in as user", lib/auth.ts), the request runs inside this context,
 * so code deep in lib/ that records the applicant as the actor of an audit, ledger or application-history row can name
 * the administrator instead, without every function having to take the request.
 */
const acting = new AsyncLocalStorage<{ admin: string }>();

export function runActingAs<T>(admin: string, fn: () => T): T {
  return acting.run({ admin }, fn);
}

/** The actor to record for something the applicant did: their name, or the administrator acting as them. */
export function asApplicant(name: string): string {
  const admin = acting.getStore()?.admin;
  return admin ? `${admin} (signed in as ${name})` : name;
}
