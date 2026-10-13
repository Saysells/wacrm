import { describe, expect, it } from "vitest";

import type { Tag } from "@/types";
import {
  EMPTY_FILTER,
  contactGroup,
  conversationHref,
  conversationsByContact,
  filterKind,
  filterOptions,
  filterTagIds,
  hasGroup,
  isFilterEmpty,
  pruneFilter,
  selectedOtherTags,
  showsEstadoColumn,
  showsFilter,
  showsOrigenColumn,
  toggleGroup,
  toggleTag,
} from "./contactos";

function tag(id: string, name: string, grupo: Tag["grupo"] = null, requiere_fecha = false): Tag {
  return { id, user_id: "u", name, color: "#000", grupo, requiere_fecha, created_at: "x" };
}

const NUEVO = tag("t-nuevo", "Nuevo", "estado");
const GESTION = tag("t-gestion", "En gestión", "estado");
const PAOLA = tag("t-paola", "Agendado a Paola", "estado", true);
const GUSTAVO = tag("t-gustavo", "Agendado a Gustavo", "estado", true);
const GANADA = tag("t-ganada", "Ganada", "estado");
const ADS = tag("t-ads", "origen_ads", "origen");
const FORM = tag("t-form", "origen_form", "origen");
const MATI = tag("t-mati", "WhatsApp Mati");
const VIP = tag("t-vip", "Cliente VIP");
const SENAL = tag("t-senal", "senal_prefiere_chat", "senal");

const ALL = [MATI, GANADA, ADS, PAOLA, NUEVO, VIP, GUSTAVO, SENAL, GESTION, FORM];

describe("filterOptions", () => {
  it("lista los grupos del embudo en orden con sus etiquetas, y las otras por nombre", () => {
    const o = filterOptions(ALL);
    expect(o.groups.map((g) => g.name)).toEqual(["Nuevo", "En gestión", "Agendada", "Ganada"]);
    expect(o.groups.find((g) => g.name === "Agendada")?.tagIds).toEqual(["t-paola", "t-gustavo"]);
    expect(o.groups.find((g) => g.name === "Nuevo")?.tagIds).toEqual(["t-nuevo"]);
    expect(o.others.map((t) => t.id)).toEqual(["t-vip", "t-ads", "t-form", "t-senal", "t-mati"]);
  });

  it("sin etiquetas en la cuenta no hay filtro (USA)", () => {
    expect(showsFilter(filterOptions([]))).toBe(false);
    expect(showsFilter(filterOptions([MATI]))).toBe(true);
    expect(showsFilter(filterOptions([NUEVO]))).toBe(true);
  });
});

describe("filtro", () => {
  const o = filterOptions(ALL);

  it("marca y desmarca grupos y etiquetas sin mutar", () => {
    const a = toggleGroup(EMPTY_FILTER, "Nuevo");
    expect(a.groups).toEqual(["Nuevo"]);
    expect(EMPTY_FILTER.groups).toEqual([]);
    expect(hasGroup(a, "nuevo")).toBe(true);
    expect(toggleGroup(a, "NUEVO").groups).toEqual([]);
    const b = toggleTag(a, "t-mati");
    expect(b.tagIds).toEqual(["t-mati"]);
    expect(toggleTag(b, "t-mati").tagIds).toEqual([]);
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true);
    expect(isFilterEmpty(b)).toBe(false);
  });

  it("un grupo aporta todas sus etiquetas de estado, sin duplicados y en orden de marcado", () => {
    const f = toggleTag(toggleGroup(toggleGroup(EMPTY_FILTER, "Agendada"), "Nuevo"), "t-mati");
    expect(filterTagIds(f, o)).toEqual(["t-paola", "t-gustavo", "t-nuevo", "t-mati"]);
    expect(filterTagIds(EMPTY_FILTER, o)).toEqual([]);
  });

  it("rotula el chip según lo marcado", () => {
    expect(filterKind(EMPTY_FILTER)).toBeNull();
    expect(filterKind(toggleGroup(EMPTY_FILTER, "Nuevo"))).toBe("estado");
    expect(filterKind(toggleTag(EMPTY_FILTER, "t-vip"))).toBe("etiqueta");
    expect(filterKind(toggleTag(toggleGroup(EMPTY_FILTER, "Nuevo"), "t-vip"))).toBe("ambos");
    expect(selectedOtherTags(toggleTag(toggleTag(EMPTY_FILTER, "t-vip"), "t-nada"), o)).toEqual([VIP]);
  });

  it("saca lo que ya no existe en la cuenta y conserva la referencia si no cambia nada", () => {
    const f = { groups: ["Nuevo", "Perdido"], tagIds: ["t-mati", "t-borrada"] };
    expect(pruneFilter(f, o)).toEqual({ groups: ["Nuevo"], tagIds: ["t-mati"] });
    const ok = { groups: ["Nuevo"], tagIds: ["t-mati"] };
    expect(pruneFilter(ok, o)).toBe(ok);
  });
});

describe("columnas", () => {
  it("Estado y Origen van solo si la cuenta tiene esas etiquetas", () => {
    expect(showsEstadoColumn(ALL)).toBe(true);
    expect(showsOrigenColumn(ALL)).toBe(true);
    expect(showsEstadoColumn([MATI, ADS])).toBe(false);
    expect(showsOrigenColumn([MATI, NUEVO])).toBe(false);
    expect(showsEstadoColumn([])).toBe(false);
  });

  it("el grupo del contacto sale de su etiqueta de estado", () => {
    expect(contactGroup([MATI, PAOLA])).toBe("Agendada");
    expect(contactGroup([GESTION])).toBe("En gestión");
    expect(contactGroup([MATI, ADS])).toBeNull();
    expect(contactGroup(undefined)).toBeNull();
  });
});

describe("conversación del contacto", () => {
  it("una por contacto; si llegan dos gana la más reciente", () => {
    const rows = [
      { id: "c1", contact_id: "k1", status: "open", assigned_agent_id: null, last_message_at: "2026-10-01T10:00:00Z" },
      { id: "c2", contact_id: "k1", status: "closed", assigned_agent_id: "u1", last_message_at: "2026-10-05T10:00:00Z" },
      { id: "c3", contact_id: "k2", status: "pending", assigned_agent_id: "u2", last_message_at: null },
    ];
    const m = conversationsByContact(rows);
    expect(m.get("k1")?.id).toBe("c2");
    expect(m.get("k2")?.id).toBe("c3");
    expect(m.get("k3")).toBeUndefined();
  });

  it("el clic en la fila abre la Bandeja en Todas, o en Cerradas si está cerrada", () => {
    expect(conversationHref({ id: "c1", status: "open" })).toBe("/inbox?vista=todas&c=c1");
    expect(conversationHref({ id: "c1", status: "pending" })).toBe("/inbox?vista=todas&c=c1");
    expect(conversationHref({ id: "c 2", status: "closed" })).toBe("/inbox?vista=cerradas&c=c%202");
    expect(conversationHref(null)).toBeNull();
  });
});
