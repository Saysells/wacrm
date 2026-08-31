import { describe, expect, it } from "vitest";

import {
  NAV_PERMISSION_BY_PREFIX,
  canAccessPath,
  homePathFor,
  isDashboardPath,
  navPermissionKeyFor,
  showsInNav,
} from "./nav";

const GATED_FOR_AGENT = [
  "/dashboard",
  "/pipelines",
  "/broadcasts",
  "/broadcasts/new",
  "/automations",
  "/flows",
  "/agents",
];

describe("canAccessPath — defaults por rol (espejo sesión 1)", () => {
  it.each(["owner", "admin", "viewer"] as const)(
    "%s abre todas las secciones sin overrides",
    (role) => {
      for (const path of [...GATED_FOR_AGENT, "/inbox", "/notifications", "/contacts", "/settings"]) {
        expect(canAccessPath(role, {}, path)).toBe(true);
      }
    },
  );

  it("agent sin overrides abre solo inbox, notifications, contacts y settings", () => {
    for (const path of ["/inbox", "/notifications", "/contacts", "/settings"]) {
      expect(canAccessPath("agent", {}, path)).toBe(true);
      expect(canAccessPath("agent", {}, `${path}/deep/link`)).toBe(true);
    }
    for (const path of GATED_FOR_AGENT) {
      expect(canAccessPath("agent", {}, path)).toBe(false);
      expect(canAccessPath("agent", {}, `${path}/deep`)).toBe(false);
    }
  });

  it("falla cerrado mientras el rol no resolvió", () => {
    expect(canAccessPath(null, {}, "/dashboard")).toBe(false);
    expect(canAccessPath(null, {}, "/inbox")).toBe(true);
  });

  it("ignora rutas fuera del dashboard", () => {
    expect(canAccessPath("agent", {}, "/join/abc")).toBe(true);
    expect(canAccessPath(null, {}, "/login")).toBe(true);
  });
});

describe("canAccessPath — overrides granulares (migración 041)", () => {
  it("un agent con nav_dashboard:true puede abrir /dashboard", () => {
    const ov = { nav_dashboard: true };
    expect(canAccessPath("agent", ov, "/dashboard")).toBe(true);
    // El override es puntual: el resto sigue cerrado.
    expect(canAccessPath("agent", ov, "/broadcasts")).toBe(false);
  });

  it("un admin con nav_broadcasts:false pierde /broadcasts", () => {
    const ov = { nav_broadcasts: false };
    expect(canAccessPath("admin", ov, "/broadcasts")).toBe(false);
    expect(canAccessPath("admin", ov, "/dashboard")).toBe(true);
  });

  it("un override puede sacarle contactos incluso a un owner", () => {
    expect(canAccessPath("owner", { nav_contacts: false }, "/contacts")).toBe(
      false,
    );
  });
});

describe("showsInNav", () => {
  it("agent sin overrides ve exactamente 3 filas (settings va por el avatar)", () => {
    for (const href of ["/inbox", "/notifications", "/contacts"]) {
      expect(showsInNav("agent", {}, href)).toBe(true);
    }
    expect(showsInNav("agent", {}, "/settings")).toBe(false);
    expect(canAccessPath("agent", {}, "/settings")).toBe(true);
    expect(showsInNav("agent", {}, "/dashboard")).toBe(false);
  });

  it("un agent con nav_dashboard:true ve el Panel en el sidebar", () => {
    expect(showsInNav("agent", { nav_dashboard: true }, "/dashboard")).toBe(
      true,
    );
  });

  it("un admin con nav_flows:false deja de ver Flows", () => {
    expect(showsInNav("admin", { nav_flows: false }, "/flows")).toBe(false);
    expect(showsInNav("admin", {}, "/flows")).toBe(true);
  });

  it("el inbox se muestra siempre — no es una clave del motor", () => {
    for (const role of ["owner", "admin", "agent", "viewer"] as const) {
      expect(showsInNav(role, {}, "/inbox")).toBe(true);
    }
  });

  it("falla cerrado mientras el rol no resolvió", () => {
    expect(showsInNav(null, {}, "/dashboard")).toBe(false);
    expect(showsInNav(null, {}, "/inbox")).toBe(true);
    expect(showsInNav(null, {}, "/settings")).toBe(false);
  });
});

describe("homePathFor", () => {
  it("aterriza según el permiso nav_dashboard, no según el rol", () => {
    expect(homePathFor("agent", {})).toBe("/inbox");
    expect(homePathFor("agent", { nav_dashboard: true })).toBe("/dashboard");
    expect(homePathFor("owner", {})).toBe("/dashboard");
    expect(homePathFor("admin", { nav_dashboard: false })).toBe("/inbox");
    expect(homePathFor(null, {})).toBe("/inbox");
  });
});

describe("navPermissionKeyFor", () => {
  it("mapea cada sección a su clave y deja inbox/settings afuera", () => {
    expect(navPermissionKeyFor("/dashboard")).toBe("nav_dashboard");
    expect(navPermissionKeyFor("/agents/123")).toBe("nav_ai_agents");
    expect(navPermissionKeyFor("/inbox")).toBeNull();
    expect(navPermissionKeyFor("/settings")).toBeNull();
    expect(navPermissionKeyFor("/login")).toBeNull();
  });

  it("no hace prefix-match sobre rutas hermanas", () => {
    expect(isDashboardPath("/inboxes")).toBe(false);
    expect(navPermissionKeyFor("/dashboard-x")).toBeNull();
  });

  it("cubre las 8 secciones gobernadas", () => {
    expect(Object.keys(NAV_PERMISSION_BY_PREFIX)).toHaveLength(8);
  });
});
