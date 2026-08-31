import { describe, expect, it } from "vitest";

import {
  AGENT_ALLOWED_PREFIXES,
  AGENT_NAV_PREFIXES,
  canAccessPath,
  homePathFor,
  isDashboardPath,
  showsInNav,
} from "./nav";

describe("canAccessPath", () => {
  const HIDDEN_FOR_AGENT = [
    "/dashboard",
    "/pipelines",
    "/broadcasts",
    "/broadcasts/new",
    "/automations",
    "/flows",
    "/agents",
  ];

  it.each(["owner", "admin", "viewer"] as const)(
    "%s can open every dashboard section",
    (role) => {
      for (const path of [...HIDDEN_FOR_AGENT, ...AGENT_ALLOWED_PREFIXES]) {
        expect(canAccessPath(role, path)).toBe(true);
      }
    },
  );

  it("agent can open exactly inbox, notifications, contacts and settings", () => {
    for (const path of AGENT_ALLOWED_PREFIXES) {
      expect(canAccessPath("agent", path)).toBe(true);
      expect(canAccessPath("agent", `${path}/deep/link`)).toBe(true);
    }
    for (const path of HIDDEN_FOR_AGENT) {
      expect(canAccessPath("agent", path)).toBe(false);
      expect(canAccessPath("agent", `${path}/deep/link`)).toBe(false);
    }
  });

  it("fails closed while the role is still unresolved", () => {
    expect(canAccessPath(null, "/dashboard")).toBe(false);
    expect(canAccessPath(null, "/inbox")).toBe(true);
  });

  it("ignores non-dashboard paths entirely", () => {
    expect(canAccessPath("agent", "/join/abc")).toBe(true);
    expect(canAccessPath(null, "/login")).toBe(true);
  });

  it("does not prefix-match sibling paths", () => {
    // /inboxes is not /inbox; /dashboard-x is not /dashboard.
    expect(isDashboardPath("/inboxes")).toBe(false);
    expect(canAccessPath("agent", "/contactsFoo")).toBe(true); // not a dashboard path
  });
});

describe("showsInNav", () => {
  it("gives agents exactly three sidebar entries", () => {
    expect(AGENT_NAV_PREFIXES).toHaveLength(3);
    for (const href of AGENT_NAV_PREFIXES) {
      expect(showsInNav("agent", href)).toBe(true);
    }
    // /settings is openable for agents but not a nav row.
    expect(showsInNav("agent", "/settings")).toBe(false);
    expect(canAccessPath("agent", "/settings")).toBe(true);
    expect(showsInNav("agent", "/dashboard")).toBe(false);
  });

  it("shows the full nav to every other role", () => {
    for (const role of ["owner", "admin", "viewer"] as const) {
      expect(showsInNav(role, "/dashboard")).toBe(true);
      expect(showsInNav(role, "/settings")).toBe(true);
      expect(showsInNav(role, "/broadcasts")).toBe(true);
    }
  });

  it("fails closed while the role is unresolved", () => {
    expect(showsInNav(null, "/dashboard")).toBe(false);
    expect(showsInNav(null, "/inbox")).toBe(true);
  });
});

describe("homePathFor", () => {
  it("sends agents to the inbox and everyone else to the dashboard", () => {
    expect(homePathFor("agent")).toBe("/inbox");
    expect(homePathFor("owner")).toBe("/dashboard");
    expect(homePathFor("admin")).toBe("/dashboard");
    expect(homePathFor("viewer")).toBe("/dashboard");
    expect(homePathFor(null)).toBe("/dashboard");
  });
});
