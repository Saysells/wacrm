import { describe, expect, it } from "vitest";

import {
  OPTIMISTA_PREFIX,
  agruparPorDia,
  confirmarOptimista,
  crearMensajeOptimista,
  esOptimista,
  esSaliente,
  estadoEnvio,
  etiquetaDia,
  fusionarMensaje,
  marcarFallido,
  previewCita,
  rotuloAutor,
} from "@/lib/movil/chat";
import type { Message } from "@/types";

const msg = (over: Partial<Message> = {}): Message => ({
  id: "m1",
  conversation_id: "v1",
  sender_type: "customer",
  content_type: "text",
  content_text: "hola",
  status: "delivered",
  created_at: "2026-09-05T10:00:00Z",
  ...over,
});

describe("esSaliente", () => {
  it("el agente y el bot van del mismo lado", () => {
    expect(esSaliente({ sender_type: "agent" })).toBe(true);
    expect(esSaliente({ sender_type: "bot" })).toBe(true);
  });

  it("el contacto va del otro", () => {
    expect(esSaliente({ sender_type: "customer" })).toBe(false);
  });
});

describe("crearMensajeOptimista", () => {
  it("nace pendiente, saliente y reconocible", () => {
    const m = crearMensajeOptimista({
      conversationId: "v1",
      texto: "hola",
      senderId: "yo",
    });
    expect(m.status).toBe("sending");
    expect(esSaliente(m)).toBe(true);
    expect(esOptimista(m.id)).toBe(true);
    expect(m.id.startsWith(OPTIMISTA_PREFIX)).toBe(true);
  });

  it("lleva la cita cuando se responde citando", () => {
    const m = crearMensajeOptimista({
      conversationId: "v1",
      texto: "sí",
      senderId: "yo",
      replyToMessageId: "m9",
    });
    expect(m.reply_to_message_id).toBe("m9");
  });
});

describe("fusionarMensaje", () => {
  const optimista = msg({
    id: `${OPTIMISTA_PREFIX}abc`,
    sender_type: "agent",
    content_text: "hola",
    status: "sending",
  });

  it("un mensaje entrante nuevo se agrega al final", () => {
    const r = fusionarMensaje([msg({ id: "a" })], msg({ id: "b" }));
    expect(r.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("un id que ya esta se reemplaza, no se duplica", () => {
    const r = fusionarMensaje([msg({ id: "a", status: "sent" })], msg({ id: "a", status: "read" }));
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("read");
  });

  it("el INSERT que gana la carrera adopta la burbuja optimista", () => {
    const real = msg({ id: "real-1", sender_type: "agent", content_text: "hola", status: "sent" });
    const r = fusionarMensaje([optimista], real);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("real-1");
  });

  it("no se come un mensaje entrante del contacto con el mismo texto", () => {
    const delContacto = msg({ id: "real-2", sender_type: "customer", content_text: "hola" });
    const r = fusionarMensaje([optimista], delContacto);
    expect(r).toHaveLength(2);
  });

  it("no toca una burbuja optimista ya confirmada", () => {
    const confirmada = { ...optimista, status: "sent" as const };
    const otro = msg({ id: "real-3", sender_type: "agent", content_text: "hola" });
    expect(fusionarMensaje([confirmada], otro)).toHaveLength(2);
  });
});

describe("confirmarOptimista", () => {
  const optimista = msg({
    id: `${OPTIMISTA_PREFIX}abc`,
    sender_type: "agent",
    status: "sending",
  });

  it("la burbuja adopta su id real y queda enviada", () => {
    const r = confirmarOptimista([optimista], optimista.id, "real-1");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("real-1");
    expect(r[0].status).toBe("sent");
  });

  it("si realtime ya la reemplazo, no la duplica", () => {
    const real = msg({ id: "real-1", sender_type: "agent", status: "sent" });
    const r = confirmarOptimista([optimista, real], optimista.id, "real-1");
    expect(r.map((m) => m.id)).toEqual(["real-1"]);
  });
});

describe("marcarFallido", () => {
  it("la burbuja se queda a la vista, marcada", () => {
    const optimista = msg({ id: `${OPTIMISTA_PREFIX}abc`, status: "sending" });
    const r = marcarFallido([optimista], optimista.id);
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("failed");
    expect(estadoEnvio(r[0])).toBe("fallido");
  });
});

describe("etiquetaDia y agruparPorDia", () => {
  const ahora = new Date("2026-09-05T15:00:00");

  it("hoy y ayer tienen nombre propio", () => {
    expect(etiquetaDia("2026-09-05T09:00:00", ahora)).toBe("Hoy");
    expect(etiquetaDia("2026-09-04T09:00:00", ahora)).toBe("Ayer");
  });

  it("mas atras, la fecha larga", () => {
    const r = etiquetaDia("2026-08-30T09:00:00", ahora);
    expect(r).not.toBe("Hoy");
    expect(r).not.toBe("Ayer");
    expect(r.length).toBeGreaterThan(0);
  });

  it("parte el hilo en dias, en orden", () => {
    const grupos = agruparPorDia(
      [
        msg({ id: "a", created_at: "2026-09-04T09:00:00" }),
        msg({ id: "b", created_at: "2026-09-04T20:00:00" }),
        msg({ id: "c", created_at: "2026-09-05T09:00:00" }),
      ],
      ahora,
    );
    expect(grupos.map((g) => g.dia)).toEqual(["Ayer", "Hoy"]);
    expect(grupos[0].mensajes.map((m) => m.id)).toEqual(["a", "b"]);
    expect(grupos[1].mensajes.map((m) => m.id)).toEqual(["c"]);
  });

  it("un hilo vacio no dibuja separadores", () => {
    expect(agruparPorDia([], ahora)).toEqual([]);
  });
});

describe("rotuloAutor", () => {
  const ctx = { userId: "yo", nombrePorUsuario: { otro: "Matías" } };

  it("el bot siempre se rotula: es lo unico que lo distingue del agente", () => {
    expect(rotuloAutor({ sender_type: "bot", sender_id: undefined }, ctx)).toBe("Bot");
  });

  it("otro agente va con su nombre", () => {
    expect(rotuloAutor({ sender_type: "agent", sender_id: "otro" }, ctx)).toBe("Matías");
  });

  it("un agente que no conocemos no queda sin rotulo", () => {
    expect(rotuloAutor({ sender_type: "agent", sender_id: "x" }, ctx)).toBe("Otro agente");
  });

  it("los propios no llevan rotulo", () => {
    expect(rotuloAutor({ sender_type: "agent", sender_id: "yo" }, ctx)).toBeNull();
  });

  it("el contacto tampoco", () => {
    expect(rotuloAutor({ sender_type: "customer", sender_id: undefined }, ctx)).toBeNull();
  });
});

describe("estadoEnvio", () => {
  it("mapea los cuatro estados de la maqueta", () => {
    expect(estadoEnvio({ status: "sending" })).toBe("pendiente");
    expect(estadoEnvio({ status: "sent" })).toBe("enviado");
    expect(estadoEnvio({ status: "delivered" })).toBe("entregado");
    expect(estadoEnvio({ status: "read" })).toBe("leido");
    expect(estadoEnvio({ status: "failed" })).toBe("fallido");
  });
});

describe("previewCita", () => {
  it("toma la primera linea y recorta", () => {
    expect(previewCita(msg({ content_text: "una\ndos" }))).toBe("una");
    expect(previewCita(msg({ content_text: "x".repeat(200) }))).toHaveLength(90);
  });

  it("un adjunto se nombra por su tipo", () => {
    expect(previewCita(msg({ content_text: undefined, content_type: "image" }))).toBe("Foto");
  });

  it("sin mensaje citado no rompe", () => {
    expect(previewCita(undefined)).toBe("");
  });
});
