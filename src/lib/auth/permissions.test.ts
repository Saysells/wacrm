import { describe, expect, it } from "vitest";

import { ACCOUNT_ROLES } from "./roles";
import {
  PERMISSION_KEYS,
  effectivePermission,
  isPermissionKey,
} from "./permissions";

// Espejo de los self-checks del final de la migración 041, más la
// matriz completa de defaults — si el CASE de SQL cambia, este
// archivo tiene que fallar hasta que lo actualicen a juego.

describe("effectivePermission — self-checks de la migración 041", () => {
  it("agent sin override no ve nav_dashboard", () => {
    expect(effectivePermission("agent", {}, "nav_dashboard")).toBe(false);
  });

  it("agent con override ve nav_dashboard", () => {
    expect(
      effectivePermission("agent", { nav_dashboard: true }, "nav_dashboard"),
    ).toBe(true);
  });

  it("agent siempre ve contactos", () => {
    expect(effectivePermission("agent", {}, "nav_contacts")).toBe(true);
  });

  it("admin ve todo por default", () => {
    expect(effectivePermission("admin", {}, "view_all_data")).toBe(true);
  });

  it("admin puede perder view_all_data con override", () => {
    expect(
      effectivePermission("admin", { view_all_data: false }, "view_all_data"),
    ).toBe(false);
  });

  it("clave desconocida cae en false", () => {
    expect(effectivePermission("owner", {}, "clave_inventada")).toBe(false);
  });
});

describe("effectivePermission — matriz de defaults del CASE", () => {
  // Copiada 1:1 del CASE de effective_permission (migración 041).
  const DEFAULTS: Record<string, Record<string, boolean>> = {
    view_all_data: { owner: true, admin: true, agent: false, viewer: true },
    can_export_contacts: {
      owner: true,
      admin: true,
      agent: false,
      viewer: false,
    },
    nav_dashboard: { owner: true, admin: true, agent: false, viewer: true },
    nav_notifications: { owner: true, admin: true, agent: true, viewer: true },
    nav_contacts: { owner: true, admin: true, agent: true, viewer: true },
    nav_pipelines: { owner: true, admin: true, agent: false, viewer: true },
    nav_broadcasts: { owner: true, admin: true, agent: false, viewer: true },
    nav_automations: { owner: true, admin: true, agent: false, viewer: true },
    nav_flows: { owner: true, admin: true, agent: false, viewer: true },
    nav_ai_agents: { owner: true, admin: true, agent: false, viewer: true },
  };

  it("cubre exactamente las 10 claves", () => {
    expect(Object.keys(DEFAULTS).sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it.each(PERMISSION_KEYS)("defaults de %s por rol", (key) => {
    for (const role of ACCOUNT_ROLES) {
      expect(effectivePermission(role, {}, key), `${key} para ${role}`).toBe(
        DEFAULTS[key][role],
      );
    }
  });

  it.each(PERMISSION_KEYS)("el override pisa el default en %s", (key) => {
    for (const role of ACCOUNT_ROLES) {
      expect(effectivePermission(role, { [key]: true }, key)).toBe(true);
      expect(effectivePermission(role, { [key]: false }, key)).toBe(false);
    }
  });

  it("overrides ausentes, null o con basura caen al default", () => {
    expect(effectivePermission("agent", undefined, "nav_contacts")).toBe(true);
    expect(effectivePermission("agent", null, "nav_dashboard")).toBe(false);
    // Un valor no-boolean se ignora (el endpoint valida, esto es defensa).
    expect(
      effectivePermission("agent", { nav_dashboard: "true" }, "nav_dashboard"),
    ).toBe(false);
    expect(
      effectivePermission("admin", { view_all_data: 0 }, "view_all_data"),
    ).toBe(true);
  });
});

describe("isPermissionKey", () => {
  it("acepta las 10 y rechaza el resto", () => {
    for (const key of PERMISSION_KEYS) expect(isPermissionKey(key)).toBe(true);
    expect(isPermissionKey("nav_inbox")).toBe(false);
    expect(isPermissionKey("view_all")).toBe(false);
    expect(isPermissionKey(42)).toBe(false);
  });
});
