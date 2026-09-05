// ============================================================
// El selector de canal de la Bandeja movil.
//
// La lista de canales sale de `account_channels` (migracion 055), NUNCA
// de una constante en el codigo. Las tres reglas, tal cual se pidieron:
//
//   fila + enabled=true   → se puede elegir, y filtra por
//                           conversations.channel
//   fila + enabled=false  → se ve, apagado, y no se puede elegir
//   sin fila              → no se muestra
//
// Prender Instagram es un UPDATE de `enabled` en la base. Si para que
// ande hubiera que tocar codigo, esto estaria mal hecho.
//
// Puro, sin React ni red.
// ============================================================

import type { AccountChannel, Channel, Conversation } from "@/types";

export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

/** Orden fijo de presentacion. No depende del orden que devuelva la base. */
const ORDEN: readonly Channel[] = ["whatsapp", "instagram"];

/**
 * El canal de una conversacion. En la base `channel` es NOT NULL
 * DEFAULT 'whatsapp' desde la 055, asi que toda fila leida lo trae; el
 * fallback cubre los objetos que se arman a mano (tests, escritorio).
 */
export function conversationChannel(
  conversation: Pick<Conversation, "channel">,
): Channel {
  return conversation.channel ?? "whatsapp";
}

export interface CanalVisible {
  channel: Channel;
  /** false ⇒ se dibuja apagado y al tocarlo avisa, no filtra. */
  enabled: boolean;
}

/**
 * Los canales que la fila de píldoras dibuja, en orden. Solo los que
 * tienen fila: un canal sin fila no existe para esta cuenta.
 */
export function canalesVisibles(
  filas: readonly Pick<AccountChannel, "channel" | "enabled">[],
): CanalVisible[] {
  const porCanal = new Map<Channel, boolean>();
  for (const fila of filas) {
    // Un valor fuera del CHECK de la base no deberia existir; si
    // apareciera, se ignora en vez de dibujar una píldora sin nombre.
    if (ORDEN.includes(fila.channel)) porCanal.set(fila.channel, fila.enabled);
  }
  return ORDEN.filter((c) => porCanal.has(c)).map((channel) => ({
    channel,
    enabled: porCanal.get(channel) === true,
  }));
}

/**
 * ¿Se dibuja la fila de canales?
 *
 * Con un solo canal con fila, no: seria una píldora sola ocupando una
 * fila entera para decir algo que no se puede cambiar. Con dos o mas se
 * muestra SIEMPRE, aunque alguno este apagado — ese es justo el caso de
 * hoy (WhatsApp prendido, Instagram apagado) y es lo que se quiere ver.
 */
export function mostrarSelectorDeCanal(
  filas: readonly Pick<AccountChannel, "channel" | "enabled">[],
): boolean {
  return canalesVisibles(filas).length >= 2;
}

/**
 * Con que canal arranca la Bandeja: el primer prendido, en el orden de
 * ORDEN. Null cuando no hay ninguno prendido — ahi no se filtra por
 * canal en vez de dejar la lista vacia sin explicacion.
 */
export function canalInicial(
  filas: readonly Pick<AccountChannel, "channel" | "enabled">[],
): Channel | null {
  return canalesVisibles(filas).find((c) => c.enabled)?.channel ?? null;
}
