import { describe, expect, it } from "vitest";

import {
  claseEstado,
  estadoDe,
  filtrarConversaciones,
  formatearTelefono,
  horaRelativa,
  iniciales,
  nombreVisible,
  previsualizacion,
  type FiltrosBandeja,
} from "@/lib/movil/bandeja";
import type { Contact, Conversation, Tag } from "@/types";

const tag = (id: string, name: string, grupo: Tag["grupo"] = null): Tag => ({
  id,
  user_id: "u",
  name,
  color: "#000",
  grupo,
  requiere_fecha: false,
  created_at: "2026-01-01T00:00:00Z",
});

const contacto = (over: Partial<Contact> = {}): Contact => ({
  id: "c1",
  user_id: "u",
  account_id: "a1",
  phone: "5491122334455",
  fecha_llamada: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: "v1",
  user_id: "u",
  contact_id: "c1",
  status: "open",
  unread_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  contact: contacto(),
  ...over,
});

const FILTROS: FiltrosBandeja = {
  vista: "todas",
  userId: "yo",
  canal: "whatsapp",
  tagId: null,
  busqueda: "",
};

describe("nombreVisible", () => {
  it("usa el nombre cuando lo hay", () => {
    expect(nombreVisible(contacto({ name: "Ana Perez" }))).toBe("Ana Perez");
  });

  it("sin nombre cae al telefono formateado", () => {
    expect(nombreVisible(contacto({ name: "  " }))).toBe("+54 9 11 2233 4455");
  });

  it("sin contacto no rompe", () => {
    expect(nombreVisible(undefined)).toBe("Sin nombre");
  });
});

describe("formatearTelefono", () => {
  it("arma el formato argentino desde el wa_id", () => {
    expect(formatearTelefono("5491122334455")).toBe("+54 9 11 2233 4455");
    expect(formatearTelefono("5493514445566")).toBe("+54 9 351 444 5566");
  });

  it("un numero de otro pais sale con los digitos como vinieron", () => {
    expect(formatearTelefono("14155552671")).toBe("+14155552671");
  });
});

describe("iniciales", () => {
  it("toma hasta dos", () => {
    expect(iniciales("Ana Maria Perez")).toBe("AM");
    expect(iniciales("Ana")).toBe("A");
  });

  it("un contacto que se llama como su telefono no tiene inicial", () => {
    expect(iniciales("+54 9 11 2233 4455")).toBe("");
  });
});

describe("estadoDe y claseEstado", () => {
  it("encuentra la unica etiqueta de estado del contacto", () => {
    const c = contacto({
      tags: [tag("t1", "origen_form", "origen"), tag("t2", "Ganada", "estado")],
    });
    expect(estadoDe(c)?.name).toBe("Ganada");
  });

  it("sin etiquetas devuelve null", () => {
    expect(estadoDe(contacto())).toBeNull();
  });

  it("colorea el embudo como la maqueta", () => {
    expect(claseEstado("Ganada")).toBe("ok");
    expect(claseEstado("Perdido")).toBe("bad");
    expect(claseEstado("No responde")).toBe("bad");
    expect(claseEstado("Agendado a Paola")).toBe("warn");
    expect(claseEstado("En gestión")).toBe("estado");
  });
});

describe("horaRelativa", () => {
  const ahora = new Date("2026-09-05T15:00:00");

  it("de hoy muestra la hora", () => {
    expect(horaRelativa("2026-09-05T09:30:00", ahora)).toBe("09:30");
  });

  it("de ayer dice ayer", () => {
    expect(horaRelativa("2026-09-04T09:30:00", ahora)).toBe("ayer");
  });

  it("mas atras, el dia de la semana", () => {
    expect(horaRelativa("2026-09-01T09:30:00", ahora)).not.toBe("");
    expect(horaRelativa("2026-09-01T09:30:00", ahora)).not.toContain(".");
  });

  it("sin fecha no rompe la fila", () => {
    expect(horaRelativa(undefined, ahora)).toBe("");
    expect(horaRelativa("no es una fecha", ahora)).toBe("");
  });
});

describe("previsualizacion", () => {
  it("toma solo la primera linea", () => {
    expect(previsualizacion(conv({ last_message_text: "hola\nchau" }))).toBe(
      "hola",
    );
  });

  it("un hilo sin mensajes no inventa texto", () => {
    expect(previsualizacion(conv())).toBe("");
  });
});

describe("filtrarConversaciones", () => {
  it("ordena por ultimo mensaje, el mas nuevo primero", () => {
    const viejo = conv({ id: "viejo", last_message_at: "2026-09-01T10:00:00Z" });
    const nuevo = conv({ id: "nuevo", last_message_at: "2026-09-05T10:00:00Z" });
    const r = filtrarConversaciones([viejo, nuevo], FILTROS);
    expect(r.map((c) => c.id)).toEqual(["nuevo", "viejo"]);
  });

  it("un hilo sin mensajes no se pierde: va al final", () => {
    const sinNada = conv({ id: "sinNada" });
    const conMsg = conv({ id: "conMsg", last_message_at: "2026-09-05T10:00:00Z" });
    const r = filtrarConversaciones([sinNada, conMsg], FILTROS);
    expect(r.map((c) => c.id)).toEqual(["conMsg", "sinNada"]);
  });

  it("filtra por canal", () => {
    const wa = conv({ id: "wa", channel: "whatsapp" });
    const ig = conv({ id: "ig", channel: "instagram" });
    expect(
      filtrarConversaciones([wa, ig], FILTROS).map((c) => c.id),
    ).toEqual(["wa"]);
  });

  it("una conversacion previa a la 055 cuenta como whatsapp", () => {
    const vieja = conv({ id: "vieja" }); // sin `channel`
    expect(
      filtrarConversaciones([vieja], FILTROS).map((c) => c.id),
    ).toEqual(["vieja"]);
  });

  it("sin canal prendido no filtra por canal", () => {
    const ig = conv({ id: "ig", channel: "instagram" });
    const r = filtrarConversaciones([ig], { ...FILTROS, canal: null });
    expect(r.map((c) => c.id)).toEqual(["ig"]);
  });

  it("Pendientes mira conversations.status", () => {
    const abierta = conv({ id: "abierta", status: "open" });
    const pendiente = conv({ id: "pendiente", status: "pending" });
    const r = filtrarConversaciones([abierta, pendiente], {
      ...FILTROS,
      vista: "pendientes",
    });
    expect(r.map((c) => c.id)).toEqual(["pendiente"]);
  });

  it("Mias son las asignadas a quien mira", () => {
    const mia = conv({ id: "mia", assigned_agent_id: "yo" });
    const ajena = conv({ id: "ajena", assigned_agent_id: "otro" });
    const libre = conv({ id: "libre" });
    const r = filtrarConversaciones([mia, ajena, libre], {
      ...FILTROS,
      vista: "mias",
    });
    expect(r.map((c) => c.id)).toEqual(["mia"]);
  });

  it("Mias sin sesion resuelta no muestra de mas", () => {
    const mia = conv({ id: "mia", assigned_agent_id: "yo" });
    const r = filtrarConversaciones([mia], {
      ...FILTROS,
      vista: "mias",
      userId: null,
    });
    expect(r).toEqual([]);
  });

  it("filtra por etiqueta de estado", () => {
    const conEstado = conv({
      id: "conEstado",
      contact: contacto({ tags: [tag("t1", "Ganada", "estado")] }),
    });
    const sinEstado = conv({ id: "sinEstado" });
    const r = filtrarConversaciones([conEstado, sinEstado], {
      ...FILTROS,
      tagId: "t1",
    });
    expect(r.map((c) => c.id)).toEqual(["conEstado"]);
  });

  it("busca por nombre y por telefono, ignorando el formato", () => {
    const ana = conv({
      id: "ana",
      contact: contacto({ id: "c1", name: "Ana Perez", phone: "5491122334455" }),
    });
    const beto = conv({
      id: "beto",
      contact: contacto({ id: "c2", name: "Beto Diaz", phone: "5491199887766" }),
    });
    const todas = [ana, beto];
    expect(
      filtrarConversaciones(todas, { ...FILTROS, busqueda: "ana" }).map((c) => c.id),
    ).toEqual(["ana"]);
    expect(
      filtrarConversaciones(todas, { ...FILTROS, busqueda: "9988" }).map((c) => c.id),
    ).toEqual(["beto"]);
    expect(
      filtrarConversaciones(todas, {
        ...FILTROS,
        busqueda: "+54 9 11 2233",
      }).map((c) => c.id),
    ).toEqual(["ana"]);
  });

  it("los filtros se acumulan", () => {
    const objetivo = conv({
      id: "objetivo",
      status: "pending",
      assigned_agent_id: "yo",
      channel: "whatsapp",
      contact: contacto({ name: "Ana", tags: [tag("t1", "Ganada", "estado")] }),
    });
    const casi = conv({ id: "casi", status: "pending", assigned_agent_id: "otro" });
    const r = filtrarConversaciones([objetivo, casi], {
      vista: "pendientes",
      userId: "yo",
      canal: "whatsapp",
      tagId: "t1",
      busqueda: "ana",
    });
    expect(r.map((c) => c.id)).toEqual(["objetivo"]);
  });
});
