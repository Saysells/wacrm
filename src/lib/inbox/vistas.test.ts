import { describe, expect, it } from "vitest";

import type { Tag } from "@/types";
import type { InboxConversation } from "./inbox-conversation";
import {
  applyIncomingMessage,
  normalizeInboxConversation,
  withInboxExtras,
} from "./inbox-conversation";
import {
  AGENDADA_GROUP,
  NEUTRAL_GROUP_COLOR,
  closerFromTag,
  conversationGroup,
  countFunnel,
  countVistas,
  defaultVista,
  durationParts,
  escapeLike,
  filterConversations,
  funnelCount,
  funnelGroups,
  groupColor,
  hasScheduling,
  inVista,
  matchesSearchText,
  parseVista,
  relativeTime,
  scheduledCall,
  shortWhen,
  showsClosedWindow,
  showsTakeNext,
  splitUnread,
  splitsUnread,
  unassignedOldestFirst,
  windowState,
  NO_LIST_FILTERS,
} from "./vistas";

const NOW = new Date(2026, 9, 10, 16, 30).getTime();
const H = 60 * 60 * 1000;
const MIN = 60 * 1000;

let seq = 0;
function tag(name: string, extra: Partial<Tag> = {}): Tag {
  return {
    id: `t${++seq}`,
    user_id: "u",
    name,
    color: "#000",
    grupo: "estado",
    requiere_fecha: false,
    created_at: "2026-01-01",
    ...extra,
  };
}
const NUEVO = tag("Nuevo");
const GESTION = tag("En gestión");
const AG_PAOLA = tag("Agendado a Paola", { requiere_fecha: true });
const AG_EZE = tag("Agendado a Ezequiel", { requiere_fecha: true });
const REAG = tag("Reagendado", { requiere_fecha: true });
const GANADA = tag("Ganada");
const LIBRE = tag("WhatsApp Mati", { grupo: null });
const RARA = tag("Inventada");

function conv(p: Partial<InboxConversation> & { tags?: Tag[]; fecha?: string | null; name?: string; phone?: string; company?: string }): InboxConversation {
  const { tags, fecha, name, phone, company, ...rest } = p;
  return {
    id: `c${++seq}`,
    user_id: "u",
    contact_id: `k${seq}`,
    status: "open",
    unread_count: 0,
    created_at: new Date(NOW - 3 * H).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    last_message_at: new Date(NOW - 10 * MIN).toISOString(),
    last_sender_type: "customer",
    last_customer_message_at: new Date(NOW - 10 * MIN).toISOString(),
    contact: {
      id: `k${seq}`,
      user_id: "u",
      account_id: "a",
      phone: phone ?? "+54 9 11 5555-0101",
      name: name ?? "Paula Méndez",
      company,
      fecha_llamada: fecha ?? null,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      tags: tags ?? [],
    },
    ...rest,
  };
}

describe("vistas", () => {
  it("parsea y elige la vista por defecto según el rol", () => {
    expect(parseVista("para-mi")).toBe("para-mi");
    expect(parseVista("otra")).toBeNull();
    expect(parseVista(null)).toBeNull();
    expect(defaultVista("agent")).toBe("para-mi");
    expect(defaultVista("owner")).toBe("todas");
    expect(defaultVista(null)).toBe("todas");
  });

  it("clasifica por asignación, cierre, llamada y ventana", () => {
    const ctx = { userId: "me", now: NOW };
    const mine = conv({ assigned_agent_id: "me" });
    const free = conv({});
    const closed = conv({ assigned_agent_id: "me", status: "closed" });
    const sched = conv({ assigned_agent_id: "me", tags: [AG_PAOLA], fecha: new Date(NOW + 2 * H).toISOString() });
    const expiring = conv({ assigned_agent_id: "other", last_customer_message_at: new Date(NOW - 23 * H).toISOString() });
    expect(inVista(mine, "para-mi", ctx)).toBe(true);
    expect(inVista(free, "para-mi", ctx)).toBe(false);
    expect(inVista(free, "sin-tomar", ctx)).toBe(true);
    expect(inVista(closed, "para-mi", ctx)).toBe(false);
    expect(inVista(closed, "todas", ctx)).toBe(false);
    expect(inVista(closed, "cerradas", ctx)).toBe(true);
    expect(inVista(sched, "agendadas", ctx)).toBe(true);
    expect(inVista(mine, "agendadas", ctx)).toBe(false);
    expect(inVista(expiring, "por-vencer", ctx)).toBe(true);
    expect(inVista(mine, "por-vencer", ctx)).toBe(false);
    const counts = countVistas([mine, free, closed, sched, expiring], ctx);
    expect(counts).toEqual({ "para-mi": 2, "sin-tomar": 1, agendadas: 1, "por-vencer": 1, todas: 4, cerradas: 0 });
  });
});

describe("embudo", () => {
  it("agrupa toda etiqueta con requiere_fecha en Agendada y ordena sin depender del closer", () => {
    const groups = funnelGroups([GANADA, RARA, AG_EZE, LIBRE, NUEVO, REAG, GESTION, AG_PAOLA]);
    expect(groups.map((g) => g.name)).toEqual(["Nuevo", "En gestión", AGENDADA_GROUP, "Ganada", "Inventada"]);
    expect(groupColor("Nuevo")).toBe("#2F6FD0");
    expect(groupColor("Inventada")).toBe(NEUTRAL_GROUP_COLOR);
    expect(groups.find((g) => g.name === "Inventada")?.color).toBe(NEUTRAL_GROUP_COLOR);
  });

  it("cuenta solo las no cerradas por grupo", () => {
    const counts = countFunnel([
      conv({ tags: [AG_EZE] }),
      conv({ tags: [REAG] }),
      conv({ tags: [NUEVO], status: "closed" }),
      conv({ tags: [LIBRE] }),
    ]);
    expect(funnelCount(counts, AGENDADA_GROUP)).toBe(2);
    expect(funnelCount(counts, "Nuevo")).toBe(0);
    expect(conversationGroup(conv({ tags: [LIBRE] }))).toBeNull();
  });

  it("Agendadas existe solo con una etiqueta de estado que pida fecha", () => {
    expect(hasScheduling([NUEVO, GANADA])).toBe(false);
    expect(hasScheduling([NUEVO, AG_PAOLA])).toBe(true);
  });

  it("saca el closer del nombre de la etiqueta", () => {
    expect(closerFromTag("Agendado a Manuel")).toBe("Manuel");
    expect(closerFromTag("Agendada")).toBeNull();
    expect(closerFromTag("Reagendado")).toBeNull();
    const c = conv({ tags: [AG_EZE], fecha: new Date(NOW + H).toISOString() });
    expect(scheduledCall(c)).toEqual({ closer: "Ezequiel", at: NOW + H });
    expect(scheduledCall(conv({ tags: [REAG], fecha: new Date(NOW + H).toISOString() }))?.closer).toBeNull();
    expect(scheduledCall(conv({ tags: [AG_EZE], fecha: null }))).toBeNull();
    expect(scheduledCall(conv({ tags: [NUEVO], fecha: new Date(NOW + H).toISOString() }))).toBeNull();
  });
});

describe("ventana", () => {
  it("abierta, por vencer, cerrada o sin mensajes del cliente", () => {
    expect(windowState(null, NOW)).toEqual({ kind: "none" });
    expect(windowState(new Date(NOW - 10 * MIN).toISOString(), NOW).kind).toBe("open");
    const w = windowState(new Date(NOW - 23 * H).toISOString(), NOW);
    expect(w.kind).toBe("expiring");
    if (w.kind === "expiring") expect(w.remainingMs).toBe(H);
    expect(windowState(new Date(NOW - 25 * H).toISOString(), NOW).kind).toBe("closed");
  });

  it("Ganada y Perdido no muestran ventana cerrada", () => {
    expect(showsClosedWindow(conv({ tags: [GANADA] }))).toBe(false);
    expect(showsClosedWindow(conv({ tags: [NUEVO] }))).toBe(true);
    expect(showsClosedWindow(conv({}))).toBe(true);
  });
});

describe("lista", () => {
  const ctx = { userId: "me", now: NOW };
  const a = conv({ assigned_agent_id: "me", name: "Paula Méndez", company: "Tienda Paula", unread_count: 2, last_message_at: new Date(NOW - 5 * MIN).toISOString() });
  const b = conv({ assigned_agent_id: "me", name: "Lucas Bianchi", phone: "+54 9 11 5555-0102", last_message_at: new Date(NOW - 50 * MIN).toISOString() });
  const c = conv({ name: "Martina Ríos", tags: [NUEVO], last_message_at: new Date(NOW - MIN).toISOString(), created_at: new Date(NOW - 5 * MIN).toISOString() });
  const d = conv({ name: "Diego Romero", tags: [NUEVO], last_message_at: new Date(NOW - 63 * MIN).toISOString(), created_at: new Date(NOW - 63 * MIN).toISOString() });

  it("filtra por vista y ordena por actividad", () => {
    const r = filterConversations([b, a, c, d], { vista: "para-mi", embudo: null, query: "", messageMatchIds: null, filters: NO_LIST_FILTERS }, ctx);
    expect(r.map((x) => x.id)).toEqual([a.id, b.id]);
  });

  it("el grupo pisa la vista y la búsqueda pisa a los dos", () => {
    const porGrupo = filterConversations([a, b, c, d], { vista: "para-mi", embudo: "nuevo", query: "", messageMatchIds: null, filters: NO_LIST_FILTERS }, ctx);
    expect(porGrupo.map((x) => x.id)).toEqual([c.id, d.id]);
    const porTexto = filterConversations([a, b, c, d], { vista: "sin-tomar", embudo: "nuevo", query: "tienda", messageMatchIds: null, filters: NO_LIST_FILTERS }, ctx);
    expect(porTexto.map((x) => x.id)).toEqual([a.id]);
    const porMensaje = filterConversations([a, b, c, d], { vista: "sin-tomar", embudo: null, query: "promo", messageMatchIds: new Set([b.id]), filters: NO_LIST_FILTERS }, ctx);
    expect(porMensaje.map((x) => x.id)).toEqual([b.id]);
  });

  it("busca por nombre, empresa y teléfono por dígitos", () => {
    expect(matchesSearchText(b, "bian")).toBe(true);
    expect(matchesSearchText(a, "TIENDA")).toBe(true);
    expect(matchesSearchText(b, "5555 0102")).toBe(true);
    expect(matchesSearchText(b, "0101")).toBe(false);
    expect(matchesSearchText(b, "")).toBe(true);
  });

  it("aplica los filtros del desplegable", () => {
    const r = filterConversations([a, b], { vista: "todas", embudo: null, query: "", messageMatchIds: null, filters: { status: "pending", tagIds: [], company: null } }, ctx);
    expect(r).toEqual([]);
    const r2 = filterConversations([a, b], { vista: "todas", embudo: null, query: "", messageMatchIds: null, filters: { status: null, tagIds: [], company: "Tienda Paula" } }, ctx);
    expect(r2.map((x) => x.id)).toEqual([a.id]);
  });

  it("secciones solo en Para mí y Todas; aviso de sin tomar solo en Para mí", () => {
    expect(splitsUnread({ vista: "para-mi", embudo: null, query: "" })).toBe(true);
    expect(splitsUnread({ vista: "todas", embudo: null, query: "" })).toBe(true);
    expect(splitsUnread({ vista: "sin-tomar", embudo: null, query: "" })).toBe(false);
    expect(splitsUnread({ vista: "todas", embudo: "Nuevo", query: "" })).toBe(false);
    expect(splitsUnread({ vista: "todas", embudo: null, query: "x" })).toBe(false);
    expect(splitUnread([a, b])).toEqual({ unread: [a], read: [b] });
    expect(showsTakeNext({ vista: "para-mi", embudo: null, query: "" })).toBe(true);
    expect(showsTakeNext({ vista: "todas", embudo: null, query: "" })).toBe(false);
  });

  it("sin tomar, la más antigua primero por created_at", () => {
    expect(unassignedOldestFirst([a, c, d]).map((x) => x.id)).toEqual([d.id, c.id]);
  });
});

describe("tiempos", () => {
  it("rel()", () => {
    expect(relativeTime(NOW - 20 * 1000, NOW)).toEqual({ kind: "now" });
    expect(relativeTime(NOW - 9 * MIN, NOW)).toEqual({ kind: "minutes", n: 9 });
    expect(relativeTime(NOW - 3 * H, NOW)).toEqual({ kind: "hours", n: 3 });
    expect(relativeTime(NOW - 23 * H, NOW)).toEqual({ kind: "yesterday" });
    expect(relativeTime(NOW - 3 * 24 * H, NOW)).toEqual({ kind: "days", n: 3 });
    expect(relativeTime(NOW - 10 * 24 * H, NOW)).toEqual({ kind: "date", day: 30, month: 9 });
  });

  it("shortWhen() y dur()", () => {
    expect(shortWhen(NOW + 90 * MIN, NOW)).toEqual({ kind: "today", time: "18:00" });
    expect(shortWhen(NOW + 18 * H, NOW)).toEqual({ kind: "tomorrow", time: "10:30" });
    expect(shortWhen(NOW + 5 * 24 * H + 60 * MIN, NOW)).toEqual({ kind: "other", weekday: 4, day: 15, time: "17:30" });
    expect(durationParts(80 * MIN)).toEqual({ hours: 1, minutes: 20 });
    expect(durationParts(2 * H)).toEqual({ hours: 2, minutes: 0 });
    expect(durationParts(10 * 1000)).toEqual({ hours: 0, minutes: 1 });
  });

  it("escapa los comodines de ilike", () => {
    expect(escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
  });
});

describe("fila de la Bandeja", () => {
  it("aplana los embebidos y un mensaje nuevo actualiza la fila", () => {
    const raw = {
      ...conv({}),
      contact: { id: "k", user_id: "u", account_id: "a", phone: "1", fecha_llamada: null, created_at: "x", updated_at: "x", contact_tags: [{ tags: NUEVO }, { tags: null }] },
      last_msg: [{ sender_type: "agent" as const, created_at: "2026-10-10T19:00:00Z" }],
      last_customer_msg: [{ created_at: "2026-10-10T18:00:00Z" }],
    };
    const row = normalizeInboxConversation(raw);
    expect(row.last_sender_type).toBe("agent");
    expect(row.last_customer_message_at).toBe("2026-10-10T18:00:00Z");
    expect(row.contact?.tags?.map((t) => t.name)).toEqual(["Nuevo"]);
    expect("last_msg" in row).toBe(false);

    const next = applyIncomingMessage(row, { content_text: "hola", created_at: "2026-10-10T20:00:00Z", sender_type: "customer" }, false);
    expect(next.last_sender_type).toBe("customer");
    expect(next.last_customer_message_at).toBe("2026-10-10T20:00:00Z");
    expect(next.unread_count).toBe(1);
    const active = applyIncomingMessage(row, { content_text: "ok", created_at: "2026-10-10T20:01:00Z", sender_type: "agent" }, true);
    expect(active.unread_count).toBe(0);
    expect(active.last_customer_message_at).toBe("2026-10-10T18:00:00Z");

    const plain = withInboxExtras({ ...row, last_sender_type: undefined } as never, row);
    expect(plain.last_customer_message_at).toBe("2026-10-10T18:00:00Z");
  });
});
