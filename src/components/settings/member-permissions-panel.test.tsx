import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PERMISSION_KEYS, type PermissionKey } from "@/lib/auth/permissions";
import { MemberPermissionsPanel } from "./member-permissions-panel";

// Sin testing-library en el repo (y sin librerías nuevas por regla de
// sesión), el contrato se verifica sobre el markup estático: cada fila
// expone data-permission-row / data-effective, así que "los checkboxes
// reflejan el valor EFECTIVO" es comprobable sin DOM interactivo. El
// camino del click (clave + valor correctos al endpoint) se cubre en
// overrides-api.test.ts (nextOverrideValue + saveMemberPermissionOverride),
// que es exactamente lo que onToggle encadena en members-tab.

const LABELS = Object.fromEntries(
  PERMISSION_KEYS.map((k) => [k, k]),
) as Record<PermissionKey, string>;

function render(props: Partial<React.ComponentProps<typeof MemberPermissionsPanel>>) {
  return renderToStaticMarkup(
    React.createElement(MemberPermissionsPanel, {
      role: "agent",
      overrides: {},
      labels: LABELS,
      hint: "hint",
      busyKey: null,
      onToggle: () => {},
      ...props,
    }),
  );
}

function effectiveOf(html: string, key: PermissionKey): string {
  const match = html.match(
    new RegExp(`data-permission-row="${key}" data-effective="(true|false)"`),
  );
  if (!match) throw new Error(`no row for ${key}`);
  return match[1];
}

describe("MemberPermissionsPanel", () => {
  it("renderiza las 10 claves", () => {
    const html = render({});
    for (const key of PERMISSION_KEYS) {
      expect(html).toContain(`data-permission-row="${key}"`);
    }
  });

  it("un agent sin overrides muestra tildado solo lo efectivo por default", () => {
    const html = render({ role: "agent", overrides: {} });
    expect(effectiveOf(html, "nav_notifications")).toBe("true");
    expect(effectiveOf(html, "nav_contacts")).toBe("true");
    expect(effectiveOf(html, "nav_dashboard")).toBe("false");
    expect(effectiveOf(html, "view_all_data")).toBe("false");
    expect(effectiveOf(html, "can_export_contacts")).toBe("false");
  });

  it("muestra el valor EFECTIVO con override, no el default del rol", () => {
    const html = render({
      role: "agent",
      overrides: { nav_dashboard: true, nav_contacts: false },
    });
    expect(effectiveOf(html, "nav_dashboard")).toBe("true");
    expect(effectiveOf(html, "nav_contacts")).toBe("false");
  });

  it("un admin con view_all_data:false aparece destildado ahí y tildado en el resto", () => {
    const html = render({
      role: "admin",
      overrides: { view_all_data: false },
    });
    expect(effectiveOf(html, "view_all_data")).toBe("false");
    expect(effectiveOf(html, "nav_dashboard")).toBe("true");
    expect(effectiveOf(html, "can_export_contacts")).toBe("true");
  });
});
