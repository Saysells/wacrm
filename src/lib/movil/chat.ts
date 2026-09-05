// ============================================================
// La logica del chat movil: agrupar por dia, decidir de que lado va
// cada burbuja, y la contabilidad del envio optimista.
//
// Puro y sin red, como bandeja.ts. Lo que aca se prueba es justamente
// lo que no se puede mirar en el telefono sin mandar un mensaje real.
// ============================================================

import type { Message, MessageStatus } from "@/types";

/**
 * Prefijo del id de una burbuja que todavia no existe en la base.
 * Tiene que ser distinguible a simple vista de un uuid real: cuando
 * llega el INSERT de realtime hay que saber cual reemplazar.
 */
export const OPTIMISTA_PREFIX = "optimista:";

export function esOptimista(id: string): boolean {
  return id.startsWith(OPTIMISTA_PREFIX);
}

/** ¿La burbuja va a la derecha? El bot va del mismo lado que el agente. */
export function esSaliente(mensaje: Pick<Message, "sender_type">): boolean {
  return mensaje.sender_type === "agent" || mensaje.sender_type === "bot";
}

/**
 * La burbuja que aparece al toque, antes de que el envio salga.
 *
 * Nace en `sending`: si Meta la rechaza queda en `failed` y se ve, en
 * vez de desaparecer y dejar a quien atiende creyendo que mando algo.
 */
export function crearMensajeOptimista({
  conversationId,
  texto,
  senderId,
  replyToMessageId,
  id = `${OPTIMISTA_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`,
  ahora = new Date(),
}: {
  conversationId: string;
  texto: string;
  senderId: string | null;
  replyToMessageId?: string | null;
  id?: string;
  ahora?: Date;
}): Message {
  return {
    id,
    conversation_id: conversationId,
    sender_type: "agent",
    sender_id: senderId ?? undefined,
    content_type: "text",
    content_text: texto,
    status: "sending",
    created_at: ahora.toISOString(),
    reply_to_message_id: replyToMessageId ?? undefined,
  };
}

/**
 * Mete un mensaje que llego por realtime en la lista, sin duplicar.
 *
 * Los dos ordenes posibles y por que hay que contemplar los dos:
 *
 *  1. Contesta primero el POST /api/whatsapp/send: ahi ya sabemos el id
 *     real (`confirmarOptimista`), y cuando llega el INSERT se reemplaza
 *     por id. Caso normal.
 *  2. Llega primero el INSERT de realtime, con el POST todavia en vuelo.
 *     Ahi el id real no lo tenemos y hay que reconocer la burbuja
 *     optimista por su contenido, o el mensaje se ve DOS veces hasta
 *     recargar. Pasa seguido: el trigger de la base publica el INSERT
 *     antes de que la respuesta HTTP vuelva por la red del telefono.
 */
export function fusionarMensaje(
  mensajes: readonly Message[],
  entrante: Message,
): Message[] {
  const porId = mensajes.findIndex((m) => m.id === entrante.id);
  if (porId !== -1) {
    const copia = [...mensajes];
    copia[porId] = { ...mensajes[porId], ...entrante };
    return copia;
  }

  if (esSaliente(entrante)) {
    const optimista = mensajes.findIndex(
      (m) =>
        esOptimista(m.id) &&
        m.status === "sending" &&
        m.content_text === entrante.content_text,
    );
    if (optimista !== -1) {
      const copia = [...mensajes];
      copia[optimista] = entrante;
      return copia;
    }
  }

  return [...mensajes, entrante];
}

/** El POST contesto: la burbuja adopta su id real y pasa a enviada. */
export function confirmarOptimista(
  mensajes: readonly Message[],
  idOptimista: string,
  idReal: string,
): Message[] {
  // Si el INSERT de realtime ya la reemplazo por la fila real, no hay
  // nada que confirmar y volver a insertarla la duplicaria.
  if (mensajes.some((m) => m.id === idReal)) {
    return mensajes.filter((m) => m.id !== idOptimista);
  }
  return mensajes.map((m) =>
    m.id === idOptimista ? { ...m, id: idReal, status: "sent" as MessageStatus } : m,
  );
}

/** El envio fallo. La burbuja se queda, marcada. */
export function marcarFallido(
  mensajes: readonly Message[],
  idOptimista: string,
): Message[] {
  return mensajes.map((m) =>
    m.id === idOptimista ? { ...m, status: "failed" as MessageStatus } : m,
  );
}

/** El separador de dia, como en la maqueta. */
export function etiquetaDia(iso: string, ahora: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === ahora.toDateString()) return "Hoy";
  const ayer = new Date(ahora);
  ayer.setDate(ayer.getDate() - 1);
  if (d.toDateString() === ayer.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

export interface GrupoDia {
  dia: string;
  mensajes: Message[];
}

/**
 * Los mensajes partidos en dias, en orden. Se agrupa por la fecha real
 * y no por el rotulo: dos dias distintos nunca comparten separador
 * aunque el rotulo se repitiera.
 */
export function agruparPorDia(
  mensajes: readonly Message[],
  ahora: Date,
): GrupoDia[] {
  const grupos: GrupoDia[] = [];
  let claveActual: string | null = null;

  for (const m of mensajes) {
    const d = new Date(m.created_at);
    const clave = Number.isNaN(d.getTime()) ? "" : d.toDateString();
    if (clave !== claveActual) {
      claveActual = clave;
      grupos.push({ dia: etiquetaDia(m.created_at, ahora), mensajes: [m] });
    } else {
      grupos[grupos.length - 1].mensajes.push(m);
    }
  }

  return grupos;
}

/**
 * El rotulo arriba de la burbuja saliente.
 *
 *  - bot            → "Bot". Va SIEMPRE, aunque la burbuja sea igual a
 *                     la del agente: es lo unico que las distingue, y
 *                     fue pedido expreso tras verlo en el telefono.
 *  - otro agente    → su nombre, para saber quien contesto.
 *  - uno mismo      → nada. Ya se sabe.
 */
export function rotuloAutor(
  mensaje: Pick<Message, "sender_type" | "sender_id">,
  { userId, nombrePorUsuario }: {
    userId: string | null;
    nombrePorUsuario: Readonly<Record<string, string>>;
  },
): string | null {
  if (mensaje.sender_type === "bot") return "Bot";
  if (mensaje.sender_type !== "agent") return null;
  const autor = mensaje.sender_id;
  if (!autor || autor === userId) return null;
  return nombrePorUsuario[autor] ?? "Otro agente";
}

export type EstadoEnvio = "pendiente" | "enviado" | "entregado" | "leido" | "fallido";

/** El estado que dibuja la burbuja saliente. Entrante no muestra nada. */
export function estadoEnvio(mensaje: Pick<Message, "status">): EstadoEnvio {
  switch (mensaje.status) {
    case "sending":
      return "pendiente";
    case "delivered":
      return "entregado";
    case "read":
      return "leido";
    case "failed":
      return "fallido";
    default:
      return "enviado";
  }
}

/** Vista previa corta de un mensaje citado. */
export function previewCita(mensaje: Message | undefined): string {
  if (!mensaje) return "";
  if (mensaje.content_text) return mensaje.content_text.split("\n")[0].slice(0, 90);
  switch (mensaje.content_type) {
    case "image":
      return "Foto";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
    case "document":
      return "Documento";
    default:
      return "";
  }
}
