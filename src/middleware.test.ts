import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` — cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns — including redirects.
let mockUser: { id: string } | null = null;
// `mockRole`      — the account_role the middleware's permission gate
//                   reads off the profile for nav-gated paths.
// `mockOverrides` — the permission_overrides JSONB alongside it.
let mockRole: string | null = "owner";
let mockOverrides: Record<string, unknown> = {};
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    },
  ) => ({
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getUser(), which rotates the refresh token and
      // pushes the new cookies through setAll() before resolving.
      getUser: async () => {
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return { data: { user: mockUser } };
      },
    },
    // Only the role gate queries the DB from the middleware, and only
    // ever `profiles.account_role` — a single chainable stub suffices.
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({
        data:
          mockRole === null
            ? null
            : { account_role: mockRole, permission_overrides: mockOverrides },
        error: null,
      });
      return b;
    },
  }),
}));

// Imported after the mock is registered.
const { middleware } = await import("./middleware");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockUser = null;
  mockRole = "owner";
  mockOverrides = {};
  refreshedCookies = [];
});

afterEach(() => vi.clearAllMocks());

const ROTATED = {
  name: "sb-test-auth-token",
  value: "rotated-refresh-token",
  options: { path: "/", httpOnly: true },
};

describe("middleware — refreshed auth cookies survive redirects", () => {
  it("carries the rotated token when redirecting a signed-in user off /login", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login"),
    );

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("carries the rotated token when redirecting an unauth user to /login", async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: "cleared" }];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.cookies.get(ROTATED.name)?.value).toBe("cleared");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login?invite=abc123"),
    );

    expect(res.headers.get("location")).toContain("/join/abc123");
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("passes through (no redirect) for a signed-in user on a protected page", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});

describe("middleware — agent role gate", () => {
  beforeEach(() => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];
  });

  it.each([
    "/dashboard",
    "/pipelines",
    "/broadcasts",
    "/automations",
    "/flows",
    "/agents",
  ])("redirects an agent from %s to /inbox", async (path) => {
    mockRole = "agent";

    const res = await middleware(new NextRequest(`https://app.test${path}`));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/inbox");
    // The rotated auth cookie must survive this redirect too.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it.each(["/inbox", "/notifications", "/contacts", "/settings"])(
    "lets an agent through to %s",
    async (path) => {
      mockRole = "agent";

      const res = await middleware(new NextRequest(`https://app.test${path}`));

      expect(res.headers.get("location")).toBeNull();
    },
  );

  it.each(["owner", "admin", "viewer"])(
    "does not restrict the %s role",
    async (role) => {
      mockRole = role;

      const res = await middleware(
        new NextRequest("https://app.test/broadcasts"),
      );

      expect(res.headers.get("location")).toBeNull();
    },
  );

  it("fails open for a pre-017 profile with no account_role", async () => {
    mockRole = null;

    const res = await middleware(new NextRequest("https://app.test/dashboard"));

    expect(res.headers.get("location")).toBeNull();
  });
});

describe("middleware — permission overrides (migración 041)", () => {
  beforeEach(() => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];
  });

  it("deja pasar a un agent con nav_dashboard:true a /dashboard", async () => {
    mockRole = "agent";
    mockOverrides = { nav_dashboard: true };

    const res = await middleware(new NextRequest("https://app.test/dashboard"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("el override de un agent es puntual: /broadcasts sigue cerrado", async () => {
    mockRole = "agent";
    mockOverrides = { nav_dashboard: true };

    const res = await middleware(
      new NextRequest("https://app.test/broadcasts"),
    );

    expect(res.status).toBe(307);
    // Con nav_dashboard habilitado, el aterrizaje es el Panel.
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("bloquea a un admin con nav_pipelines:false y lo manda al Panel", async () => {
    mockRole = "admin";
    mockOverrides = { nav_pipelines: false };

    const res = await middleware(new NextRequest("https://app.test/pipelines"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("un admin sin nav_dashboard aterriza en /inbox al ser bloqueado", async () => {
    mockRole = "admin";
    mockOverrides = { nav_dashboard: false, nav_flows: false };

    const res = await middleware(new NextRequest("https://app.test/flows"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/inbox");
  });
});
