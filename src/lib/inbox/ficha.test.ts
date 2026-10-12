import { describe, expect, it } from "vitest";

import type { Tag } from "@/types";
import type { InboxConversation } from "./inbox-conversation";
import {
  contactOrigin,
  hasEmail,
  nonEstadoTags,
  originOfTag,
  tagChipLabel,
  upcomingCalls,
} from "./ficha";

let seq = 0;
function tag(name: string, extra: Partial<Tag> = {}): Tag {
  return {
    id: `t${++seq}`,
    user_id: "u",
    name,
    color: "#000",
    grupo: null,
    requiere_fecha: false,
    created_at: "2026-01-01",
    ...extra,
  };
}

const NUEVO = tag("Nuevo", { grupo: "estado" });
const AGENDADO = tag("Agendado a Paola", { grupo: "estado", requiere_fecha: true });
const AGENDADA = tag("Agendada", { grupo: "estado", requiere_fecha: true });
const VIP = tag("VIP");
const ADS = tag("origen_ads", { grupo: "origen" });
const FORM = tag("origen_form", { grupo: "origen" });
const SENAL = tag("senal_prefiere_chat", { grupo: "senal" });

function conv(
  id: string,
  extra: Partial<InboxConversation> = {},
  contact: Partial<NonNullable<InboxConversation["contact"]>> = {},
): InboxConversation {
  return {
    id,
    user_id: "u",
    contact_id: `c-${id}`,
    status: "open",
    unread_count: 0,
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
    last_sender_type: null,
    last_customer_message_at: null,
    contact: {
      id: `c-${id}`,
      user_id: "u",
      account_id: "a",
      phone: "5491100000000",
      created_at: "2026-10-01T10:00:00.000Z",
      updated_at: "2026-10-01T10:00:00.000Z",
      fecha_llamada: null,
      tags: [],
      ...contact,
    },
    ...extra,
  };
}

describe("nonEstadoTags", () => {
  it("saca la de estado y conserva el orden de las demás (manuales, origen y señal)", () => {
    expect(nonEstadoTags([VIP, NUEVO, ADS, SENAL]).map((t) => t.id)).toEqual([
      VIP.id,
      ADS.id,
      SENAL.id,
    ]);
    expect(nonEstadoTags(undefined)).toEqual([]);
  });
});

describe("origen", () => {
  it("origen_ads es el anuncio y origen_form el formulario", () => {
    expect(originOfTag(ADS)).toEqual({ kind: "ads", name: "origen_ads" });
    expect(originOfTag(FORM)).toEqual({ kind: "form", name: "origen_form" });
    expect(originOfTag({ name: "Origen_Ads" }).kind).toBe("ads");
  });

  it("otra etiqueta de origen se muestra sin el prefijo", () => {
    expect(originOfTag({ name: "origen_referido" })).toEqual({ kind: "other", name: "referido" });
    expect(originOfTag({ name: "Catálogo" })).toEqual({ kind: "other", name: "Catálogo" });
  });

  it("'Llegó por' sale de la primera etiqueta de grupo origen, o no sale", () => {
    expect(contactOrigin([VIP, NUEVO, FORM])?.kind).toBe("form");
    expect(contactOrigin([VIP, NUEVO])).toBeNull();
    expect(contactOrigin(undefined)).toBeNull();
  });

  it("el chip de una etiqueta de origen lleva el prefijo; el resto va tal cual", () => {
    expect(tagChipLabel(ADS)).toEqual({ kind: "origin", origin: { kind: "ads", name: "origen_ads" } });
    expect(tagChipLabel(VIP)).toEqual({ kind: "plain", name: "VIP" });
    expect(tagChipLabel(SENAL)).toEqual({ kind: "plain", name: "senal_prefiere_chat" });
  });
});

describe("upcomingCalls", () => {
  it("lista las llamadas agendadas de conversaciones no cerradas, la más próxima primero", () => {
    const later = conv("later", {}, { tags: [AGENDADO], fecha_llamada: "2026-10-16T13:00:00.000Z" });
    const sooner = conv("sooner", {}, { tags: [AGENDADA], fecha_llamada: "2026-10-15T20:30:00.000Z" });
    const noDate = conv("nodate", {}, { tags: [AGENDADO] });
    const noEstado = conv("noestado", {}, { tags: [VIP], fecha_llamada: "2026-10-14T10:00:00.000Z" });
    const closed = conv(
      "closed",
      { status: "closed" },
      { tags: [AGENDADO], fecha_llamada: "2026-10-13T10:00:00.000Z" },
    );
    const nuevo = conv("nuevo", {}, { tags: [NUEVO], fecha_llamada: "2026-10-12T10:00:00.000Z" });

    const out = upcomingCalls([later, noDate, noEstado, closed, sooner, nuevo]);
    expect(out.map((u) => u.conversation.id)).toEqual(["sooner", "later"]);
    expect(out[0].call.closer).toBeNull();
    expect(out[1].call.closer).toBe("Paola");
  });

  it("sin llamadas devuelve vacío", () => {
    expect(upcomingCalls([conv("a")])).toEqual([]);
  });
});

describe("hasEmail", () => {
  it("solo con contenido", () => {
    expect(hasEmail("ana@x.com")).toBe(true);
    expect(hasEmail("   ")).toBe(false);
    expect(hasEmail(undefined)).toBe(false);
    expect(hasEmail(null)).toBe(false);
  });
});
