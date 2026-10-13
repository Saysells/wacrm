import { describe, expect, it } from "vitest";

import type { Notification } from "@/types";
import {
  contactDisplayName,
  missingContactIds,
  notificationText,
  prependNotification,
  unreadCount,
  withContactNames,
} from "./notificaciones";

function notif(over: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    account_id: "a",
    user_id: "me",
    type: "conversation_assigned",
    conversation_id: "c1",
    contact_id: "k1",
    actor_user_id: "u-mati",
    title: "Conversation assigned to you",
    body: "Matías Pérez assigned you a conversation",
    created_at: "2026-10-12T10:00:00Z",
    ...over,
  };
}

const members = new Map([["u-mati", "Matías Pérez"], ["u-sin", ""]]);
const contacts = new Map([["k1", "Juan López"]]);

describe("notificationText", () => {
  it("con actor: nombre de pila + contacto", () => {
    expect(notificationText(notif(), members, contacts)).toEqual({
      kind: "assignedBy",
      actor: "Matías",
      contact: "Juan López",
    });
  });

  it("sin actor (automatización): 'Te asignaron…'", () => {
    expect(notificationText(notif({ actor_user_id: undefined }), members, contacts)).toEqual({
      kind: "assigned",
      contact: "Juan López",
    });
  });

  it("actor desconocido o sin nombre cae en 'Te asignaron…'", () => {
    expect(notificationText(notif({ actor_user_id: "u-nadie" }), members, contacts).kind).toBe("assigned");
    expect(notificationText(notif({ actor_user_id: "u-sin" }), members, contacts).kind).toBe("assigned");
  });

  it("contacto que no está en el mapa queda en null ('un contacto')", () => {
    expect(notificationText(notif({ contact_id: "k-otro" }), members, contacts)).toEqual({
      kind: "assignedBy",
      actor: "Matías",
      contact: null,
    });
    expect(notificationText(notif({ contact_id: undefined }), members, contacts).kind).toBe("assignedBy");
  });

  it("otro tipo: título y texto de la fila", () => {
    const n = notif({ type: "otro" as Notification["type"], body: "  " });
    expect(notificationText(n, members, contacts)).toEqual({
      kind: "raw",
      title: "Conversation assigned to you",
      body: null,
    });
  });
});

describe("contactos de la lista", () => {
  it("nombre o teléfono", () => {
    expect(contactDisplayName({ name: " Ana ", phone: "549" })).toBe("Ana");
    expect(contactDisplayName({ name: "", phone: "549" })).toBe("549");
    expect(contactDisplayName({ name: null, phone: null })).toBeNull();
  });

  it("pide solo los que faltan, sin repetir", () => {
    const list = [notif({ contact_id: "k1" }), notif({ contact_id: "k2" }), notif({ contact_id: "k2" }), notif({ contact_id: undefined })];
    expect(missingContactIds(list, contacts)).toEqual(["k2"]);
  });

  it("suma nombres sin pisar los conocidos con vacío", () => {
    const next = withContactNames(contacts, [
      { id: "k2", name: "Beto", phone: "1" },
      { id: "k3", name: null, phone: null },
    ]);
    expect(next.get("k1")).toBe("Juan López");
    expect(next.get("k2")).toBe("Beto");
    expect(next.has("k3")).toBe(false);
    expect(contacts.has("k2")).toBe(false);
  });
});

describe("lista", () => {
  it("un INSERT entra arriba una sola vez", () => {
    const a = notif({ id: "a" });
    const b = notif({ id: "b" });
    expect(prependNotification(null, a)).toEqual([a]);
    expect(prependNotification([a], b).map((n) => n.id)).toEqual(["b", "a"]);
    expect(prependNotification([b, a], b).map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("cuenta las sin leer", () => {
    expect(unreadCount(null)).toBe(0);
    expect(unreadCount([notif(), notif({ read_at: "2026-10-12T11:00:00Z" })])).toBe(1);
  });
});
