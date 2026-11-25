import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

// "Sign in as user" (X-Act-As) on the real authenticate middleware, in Supabase mode, with the token check, Supabase's
// /user answer and the database stubbed: only administrators may act as a user, and only as one that exists.
vi.hoisted(() => {
  process.env.AUTH_MODE = "supabase";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

const state = vi.hoisted(() => ({ role: "admin" as string, profiles: [] as { id: string; email: string; name: string; auth?: string }[] }));

vi.mock("./tokens", async (orig) => ({
  ...(await orig<typeof import("./tokens")>()),
  verifySupabaseToken: vi.fn(async () => ({ sub: "11111111-1111-4111-8111-111111111111", email: "Boss@Example.org", exp: 9e9, user_metadata: { name: "The Boss" } })),
}));

vi.mock("./industries", () => ({ industryFromSignUp: async () => null }));

// Every query in these paths is select().from().where(): answer with the profile the WHERE asks for, by ID.
vi.mock("@workspace/db", () => {
  return {
    demoProfilesTable: { id: "id", email: "email", name: "name", authUserId: "auth_user_id" },
    db: {
      select: () => ({ from: () => ({ where: async (cond: unknown) => {
        const wanted = JSON.stringify(cond, (_k, v) => (typeof v === "object" && v && "value" in v ? v.value : v));
        return state.profiles.filter((p) => wanted.includes(`"${p.id}"`) || (!!p.auth && wanted.includes(`"${p.auth}"`)));
      } }) }),
      insert: () => ({ values: () => ({ onConflictDoNothing: async () => {} }) }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    },
  };
});

const { authenticate } = await import("./auth");
const { asApplicant } = await import("./actingAs");

beforeEach(() => {
  state.role = "admin";
  state.profiles = [{ id: "usr-amara", email: "amara@example.org", name: "Amara Okafor" }, { id: "usr-me", email: "boss@example.org", name: "Me", auth: "11111111-1111-4111-8111-111111111111" }];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ app_metadata: { role: state.role } }), { status: 200 })));
});

let tokenN = 0;
async function call(opts: { method?: string; header?: string; cookie?: string; path?: string }) {
  const headers: Record<string, string> = { authorization: `Bearer token-${++tokenN}` }; // fresh token: no cached /user answer
  if (opts.header) headers["x-act-as"] = opts.header;
  const req = {
    method: opts.method ?? "GET", path: opts.path ?? "/applicant/dashboard",
    cookies: opts.cookie ? { gp_act_as: opts.cookie } : {},
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const out: { status?: number; body?: unknown; nextCalled: boolean; actorInside?: string } = { nextCalled: false };
  const res = { status(code: number) { out.status = code; return this; }, json(body: unknown) { out.body = body; return this; } } as unknown as Response;
  const next: NextFunction = (err?: unknown) => { if (err) throw err; out.nextCalled = true; out.actorInside = asApplicant(req.identity?.name ?? ""); };
  await authenticate(req, res, next);
  return { ...out, identity: req.identity };
}

describe("X-Act-As (sign in as user)", () => {
  it("lets an administrator act as an existing user", async () => {
    const r = await call({ header: "usr-amara" });
    expect(r.nextCalled).toBe(true);
    expect(r.identity).toMatchObject({ role: "applicant", profileId: "usr-amara", email: "amara@example.org", name: "Amara Okafor", actingAdmin: "boss@example.org" });
    expect(r.actorInside).toBe("boss@example.org (signed in as Amara Okafor)");
  });

  it("also for root", async () => {
    state.role = "root";
    expect((await call({ header: "usr-amara", method: "POST" })).identity?.profileId).toBe("usr-amara");
  });

  it("refuses an applicant, so the header can't open someone else's account", async () => {
    state.role = "applicant";
    const r = await call({ header: "usr-amara" });
    expect(r.status).toBe(403);
    expect(r.nextCalled).toBe(false);
  });

  it("answers 404 for a user that doesn't exist", async () => {
    const r = await call({ header: "usr-gone" });
    expect(r.status).toBe(404);
    expect(r.nextCalled).toBe(false);
  });

  it("honours the cookie for reads only (images, downloads)", async () => {
    expect((await call({ cookie: "usr-amara" })).identity?.profileId).toBe("usr-amara");
    const write = await call({ cookie: "usr-amara", method: "POST", path: "/admin/users" });
    expect(write.identity).toMatchObject({ role: "admin", profileId: null });
    expect(write.identity?.actingAdmin).toBeUndefined();
  });

  it("without the header, nothing changes and actors are named as usual", async () => {
    const r = await call({});
    expect(r.identity).toMatchObject({ role: "admin", email: "boss@example.org" });
    expect(r.actorInside).toBe("The Boss");
  });

  it("keeps concurrent requests apart", async () => {
    const [a, b] = await Promise.all([call({ header: "usr-amara" }), call({})]);
    expect(a.actorInside).toBe("boss@example.org (signed in as Amara Okafor)");
    expect(b.actorInside).toBe("The Boss");
  });
});
