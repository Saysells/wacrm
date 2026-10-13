import { describe, expect, it } from "vitest";

import {
  TABLERO_ORDER,
  countOf,
  joinEstado,
  tableroCards,
  whatsappEstado,
} from "./tablero";

describe("tableroCards", () => {
  it("arranca con las seis tarjetas del prototipo, en su orden", () => {
    expect(TABLERO_ORDER.slice(0, 6)).toEqual([
      "whatsapp",
      "templates",
      "quick-replies",
      "fields",
      "members",
      "appearance",
    ]);
  });

  it("sigue con las cuatro que el prototipo no dibuja", () => {
    expect(TABLERO_ORDER.slice(6)).toEqual(["profile", "security", "deals", "api"]);
  });

  it("hoy todos los roles ven las diez (los permisos viven adentro de cada panel)", () => {
    for (const role of ["owner", "admin", "agent", "viewer", null] as const) {
      expect(tableroCards(role)).toEqual(TABLERO_ORDER);
    }
  });

  it("no incluye el Resumen (es la pantalla que las muestra)", () => {
    expect(TABLERO_ORDER).not.toContain("overview");
  });
});

describe("whatsappEstado", () => {
  it("es null mientras carga", () => {
    expect(whatsappEstado(null)).toBeNull();
  });
  it("sin configurar gana a conectado", () => {
    expect(whatsappEstado({ configured: false, connected: true })).toBe("notSetup");
  });
  it("configurado y conectado", () => {
    expect(whatsappEstado({ configured: true, connected: true })).toBe("connected");
  });
  it("configurado pero caído pide reconexión", () => {
    expect(whatsappEstado({ configured: true, connected: false })).toBe("needsReconnecting");
  });
});

describe("joinEstado", () => {
  it("une con punto medio y salta vacíos", () => {
    expect(joinEstado(["3 miembros", null, "", "1 invitación pendiente", false])).toBe(
      "3 miembros · 1 invitación pendiente",
    );
  });
  it("vacío si no hay nada", () => {
    expect(joinEstado([null, undefined, ""])).toBe("");
  });
});

describe("countOf", () => {
  it("devuelve el count de una consulta resuelta", () => {
    expect(countOf({ status: "fulfilled", value: { count: 4 } })).toBe(4);
  });
  it("null si la consulta falló o no trajo count", () => {
    expect(countOf({ status: "rejected", reason: new Error("x") })).toBeNull();
    expect(countOf({ status: "fulfilled", value: { count: null } })).toBeNull();
    expect(countOf({ status: "fulfilled", value: null })).toBeNull();
  });
});
