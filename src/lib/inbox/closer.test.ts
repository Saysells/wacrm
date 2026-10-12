import { describe, expect, it } from "vitest";

import type { Tag } from "@/types";
import {
  callDayHeading,
  callStatus,
  closerCalls,
  closerNameOf,
  firstNameKey,
  groupByDay,
  outcomeTag,
  showsCallCard,
  showsProposalAction,
} from "./closer";
import type { InboxConversation } from "./inbox-conversation";
import { withInboxExtras } from "./inbox-conversation";
import { countVistas, defaultVista, filterConversations, inVista, NO_LIST_FILTERS } from "./vistas";

// Jueves 15 de octubre de 2026, 14:00 hora local.
const NOW = new Date(2026, 9, 15, 14, 0).getTime();
const H = 60 * 60 * 1000;

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
const AG_MANUEL = tag("Agendado a Manuel", { requiere_fecha: true });
const AG_EZE = tag("Agendado a Ezequiel", { requiere_fecha: true });
const AGENDADA = tag("Agendada", { requiere_fecha: true });
const REAGENDADO = tag("Reagendado", { requiere_fecha: true });
const REALIZADA = tag("Realizada");
const NO_SHOW = tag("No se presentó");
const PROPUESTA = tag("Propuesta");
const ORIGEN = tag("Propuesta", { grupo: "origen" });
const TAGS = [AG_MANUEL, AG_EZE, AGENDADA, REAGENDADO, REALIZADA, NO_SHOW, PROPUESTA];

function conv(
  id: string,
  opts: { tags?: Tag[]; fecha?: number | null; status?: InboxConversation["status"]; assigned?: string | null } = {},
): InboxConversation {
  return withInboxExtras({
    id,
    contact_id: `k-${id}`,
    status: opts.status ?? "open",
    assigned_agent_id: opts.assigned ?? undefined,
    unread_count: 0,
    created_at: new Date(NOW - 10 * H).toISOString(),
    last_message_at: new Date(NOW - H).toISOString(),
    contact: {
      id: `k-${id}`,
      user_id: "u",
      phone: "5491100000000",
      name: id,
      tags: opts.tags ?? [],
      fecha_llamada: opts.fecha === null || opts.fecha === undefined ? null : new Date(opts.fecha).toISOString(),
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    },
  } as unknown as Parameters<typeof withInboxExtras>[0]);
}

describe("closerNameOf", () => {
  it("el nombre de pila del perfil contra las etiquetas, sin mayúsculas ni acentos", () => {
    expect(closerNameOf({ fullName: "manuel garcía", memberNames: ["manuel garcía"], accountTags: TAGS })).toBe("Manuel");
    expect(closerNameOf({ fullName: "EZEQUIÉL R.", memberNames: ["EZEQUIÉL R."], accountTags: TAGS })).toBe("Ezequiel");
  });

  it("firstNameKey toma la primera palabra", () => {
    expect(firstNameKey("  María José Pérez ")).toBe("maria");
    expect(firstNameKey(null)).toBe("");
  });

  it("sin etiqueta con su nombre no es closer; tampoco con un nombre vacío", () => {
    expect(closerNameOf({ fullName: "Paola", memberNames: ["Paola"], accountTags: TAGS })).toBeNull();
    expect(closerNameOf({ fullName: "", memberNames: [], accountTags: TAGS })).toBeNull();
    expect(closerNameOf({ fullName: null, memberNames: [], accountTags: TAGS })).toBeNull();
  });

  it("si dos miembros comparten el nombre de pila, ninguno es closer", () => {
    expect(
      closerNameOf({ fullName: "Manuel A", memberNames: ["Manuel A", "Manuel B", "Ezequiel"], accountTags: TAGS }),
    ).toBeNull();
    // Y con uno solo que se llame así, sí.
    expect(closerNameOf({ fullName: "Manuel A", memberNames: ["Manuel A", "Ezequiel"], accountTags: TAGS })).toBe("Manuel");
  });

  it("una cuenta sin closers (USA, Star Energy) no tiene closer aunque haya Agendada", () => {
    expect(closerNameOf({ fullName: "Manuel", memberNames: ["Manuel"], accountTags: [AGENDADA, REALIZADA] })).toBeNull();
  });
});

describe("closerCalls y la vista Mis llamadas", () => {
  const mine = conv("mia", { tags: [AG_MANUEL], fecha: NOW + 2 * H });
  const noCloser = conv("agendada", { tags: [AGENDADA], fecha: NOW + 26 * H });
  const re = conv("re", { tags: [REAGENDADO], fecha: NOW - H });
  const other = conv("eze", { tags: [AG_EZE], fecha: NOW + H });
  const noDate = conv("sinfecha", { tags: [AG_MANUEL] });
  const closed = conv("cerrada", { tags: [AG_MANUEL], fecha: NOW + H, status: "closed" });
  const all = [other, noCloser, mine, closed, re, noDate];

  it("lista las mías y las sin closer, nunca las de otro closer ni las cerradas, por hora", () => {
    expect(closerCalls(all, "manuel").map((c) => c.conversation.id)).toEqual(["re", "mia", "agendada"]);
  });

  it("inVista y countVistas usan el closer del contexto", () => {
    const ctx = { userId: null, now: NOW, closer: "Manuel" };
    expect(inVista(mine, "mis-llamadas", ctx)).toBe(true);
    expect(inVista(noCloser, "mis-llamadas", ctx)).toBe(true);
    expect(inVista(other, "mis-llamadas", ctx)).toBe(false);
    expect(inVista(closed, "mis-llamadas", ctx)).toBe(false);
    expect(inVista(mine, "mis-llamadas", { userId: null, now: NOW })).toBe(false);
    expect(countVistas(all, ctx)["mis-llamadas"]).toBe(3);
    expect(countVistas(all, { userId: null, now: NOW })["mis-llamadas"]).toBe(0);
  });

  it("la lista de Mis llamadas sale por hora de la llamada, no por actividad", () => {
    const sel = { vista: "mis-llamadas" as const, embudo: null, query: "", messageMatchIds: null, filters: NO_LIST_FILTERS };
    expect(filterConversations(all, sel, { userId: null, now: NOW, closer: "Manuel" }).map((c) => c.id)).toEqual([
      "re",
      "mia",
      "agendada",
    ]);
  });

  it("el closer arranca en Mis llamadas; los demás como antes", () => {
    expect(defaultVista("admin", true)).toBe("mis-llamadas");
    expect(defaultVista("agent", true)).toBe("mis-llamadas");
    expect(defaultVista("agent")).toBe("para-mi");
    expect(defaultVista("admin", false)).toBe("todas");
  });
});

describe("callStatus, días y encabezados", () => {
  it("ya pasó, en X con menos de 3 h, agendada si no", () => {
    expect(callStatus(NOW - 1, NOW)).toEqual({ kind: "past" });
    expect(callStatus(NOW + 2 * H, NOW)).toEqual({ kind: "soon", inMs: 2 * H });
    expect(callStatus(NOW + 3 * H, NOW)).toEqual({ kind: "scheduled" });
  });

  it("agrupa por día calendario en orden, conservando el orden dentro del día", () => {
    const items = [
      { id: "b", at: new Date(2026, 9, 15, 16, 0).getTime() },
      { id: "a", at: new Date(2026, 9, 15, 10, 0).getTime() },
      { id: "c", at: new Date(2026, 9, 16, 9, 0).getTime() },
    ];
    const groups = groupByDay(items, (i) => i.at);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([["b", "a"], ["c"]]);
    expect(groups[0].day).toBe(new Date(2026, 9, 15).getTime());
  });

  it("el encabezado dice hoy, mañana o ayer y siempre trae la fecha", () => {
    expect(callDayHeading(NOW, NOW)).toEqual({ relative: "today", weekday: 4, day: 15, month: 9 });
    expect(callDayHeading(new Date(2026, 9, 16, 9).getTime(), NOW)).toMatchObject({ relative: "tomorrow", day: 16 });
    expect(callDayHeading(new Date(2026, 9, 14, 9).getTime(), NOW)).toMatchObject({ relative: "yesterday", day: 14 });
    expect(callDayHeading(new Date(2026, 9, 20, 9).getTime(), NOW)).toMatchObject({ relative: null, weekday: 2, day: 20 });
  });
});

describe("tarjeta de la llamada y resultados", () => {
  const call = { closer: "Manuel", at: NOW + H };
  const callNoCloser = { closer: null, at: NOW + H };
  const callOther = { closer: "Ezequiel", at: NOW + H };

  it("la tarjeta es del closer con llamada suya o sin closer", () => {
    expect(showsCallCard("Manuel", call)).toBe(true);
    expect(showsCallCard("manuel", callNoCloser)).toBe(true);
    expect(showsCallCard("Manuel", callOther)).toBe(false);
    expect(showsCallCard("Manuel", null)).toBe(false);
    expect(showsCallCard(null, call)).toBe(false);
  });

  it("Crear propuesta solo para el equipo de Saysells", () => {
    expect(showsProposalAction("Manuel", call, true)).toBe(true);
    expect(showsProposalAction("Manuel", call, false)).toBe(false);
    expect(showsProposalAction("Manuel", callOther, true)).toBe(false);
  });

  it("cada resultado es la etiqueta de estado con ese nombre; sin ella no hay botón", () => {
    expect(outcomeTag(TAGS, "realizada")).toBe(REALIZADA);
    expect(outcomeTag(TAGS, "no_se_presento")).toBe(NO_SHOW);
    expect(outcomeTag(TAGS, "propuesta")).toBe(PROPUESTA);
    expect(outcomeTag([AG_MANUEL, ORIGEN], "propuesta")).toBeNull();
    expect(outcomeTag([tag("REALIZADA")], "realizada")?.name).toBe("REALIZADA");
  });
});
