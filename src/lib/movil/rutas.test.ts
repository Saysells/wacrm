import { describe, expect, it } from "vitest";

import { MOBILE_TABS, activeTab, showsTabBar } from "@/lib/movil/rutas";

describe("rutas de la app movil", () => {
  it("son las cinco pestañas de la maqueta, en orden", () => {
    expect(MOBILE_TABS.map((t) => t.id)).toEqual([
      "bandeja",
      "contactos",
      "flujos",
      "panel",
      "ajustes",
    ]);
  });

  it("la raiz movil es Bandeja, con o sin barra final", () => {
    expect(activeTab("/m")).toBe("bandeja");
    expect(activeTab("/m/")).toBe("bandeja");
  });

  it("una pestaña no se activa por prefijo de otra", () => {
    expect(activeTab("/m/ajustes")).toBe("ajustes");
    expect(activeTab("/m/contactos")).toBe("contactos");
  });

  it("el chat no es pestaña y esconde el tabbar", () => {
    expect(activeTab("/m/chat/abc-123")).toBeNull();
    expect(showsTabBar("/m/chat/abc-123")).toBe(false);
    expect(showsTabBar("/m")).toBe(true);
  });
});
