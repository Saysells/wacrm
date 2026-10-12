// ============================================================
// Fila de conversación de la Bandeja de escritorio (rediseño, sesión B).
//
// Es la fila de `conversations` con el contacto y sus etiquetas
// (CONVERSATION_SELECT) más dos datos que la tabla no guarda y que la
// lista necesita en cada fila: quién mandó el último mensaje ("Vos:" /
// "Bot:") y cuándo escribió el cliente por última vez (la ventana de
// 24 h). Los dos salen de `messages`, embebidos en LA MISMA consulta
// con orden y límite por conversación, nunca con una consulta por
// fila. Sin funciones ni índices nuevos en la base.
// ============================================================

import type { Conversation, SenderType } from "@/types";
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from "@/lib/inbox/conversations";

export interface InboxConversation extends Conversation {
  /** `sender_type` del último mensaje; null si la conversación no tiene ninguno. */
  last_sender_type: SenderType | null;
  /** `created_at` del último mensaje con `sender_type = 'customer'`; null si nunca escribió. */
  last_customer_message_at: string | null;
}

/** Alias de los dos embebidos de `messages`. */
export const LAST_MSG_ALIAS = "last_msg";
export const LAST_CUSTOMER_MSG_ALIAS = "last_customer_msg";

export const INBOX_CONVERSATION_SELECT =
  `${CONVERSATION_SELECT}, ${LAST_MSG_ALIAS}:messages(sender_type, created_at), ` +
  `${LAST_CUSTOMER_MSG_ALIAS}:messages(created_at)`;

type RawInboxRow = Parameters<typeof normalizeConversation>[0] & {
  [LAST_MSG_ALIAS]?: { sender_type: SenderType; created_at: string }[] | null;
  [LAST_CUSTOMER_MSG_ALIAS]?: { created_at: string }[] | null;
};

/** Aplana la fila cruda (contacto + etiquetas + los dos embebidos). */
export function normalizeInboxConversation(raw: RawInboxRow): InboxConversation {
  const {
    [LAST_MSG_ALIAS]: lastMsg,
    [LAST_CUSTOMER_MSG_ALIAS]: lastCustomer,
    ...rest
  } = raw;
  const base = normalizeConversation(rest);
  return {
    ...base,
    last_sender_type: lastMsg?.[0]?.sender_type ?? null,
    last_customer_message_at: lastCustomer?.[0]?.created_at ?? null,
  };
}

/**
 * Una fila que llega sin los embebidos (un evento de realtime, una
 * hidratación con CONVERSATION_SELECT) entra con los dos datos en lo
 * que ya sabíamos de esa conversación, o en null si es nueva.
 */
export function withInboxExtras(
  conv: Conversation,
  previous?: Pick<InboxConversation, "last_sender_type" | "last_customer_message_at"> | null,
): InboxConversation {
  return {
    ...conv,
    last_sender_type: previous?.last_sender_type ?? null,
    last_customer_message_at: previous?.last_customer_message_at ?? null,
  };
}

/**
 * Qué cambia en la fila cuando entra un mensaje nuevo: la vista previa,
 * la hora, quién lo mandó y, si lo escribió el cliente, la ventana.
 * `activeUnread` = false suma uno al contador; true lo deja en cero
 * porque la persona está mirando ese hilo ahora mismo.
 */
export function applyIncomingMessage(
  conv: InboxConversation,
  message: { content_text?: string | null; created_at: string; sender_type: SenderType },
  isActive: boolean,
): InboxConversation {
  return {
    ...conv,
    last_message_text: message.content_text ?? "",
    last_message_at: message.created_at,
    last_sender_type: message.sender_type,
    last_customer_message_at:
      message.sender_type === "customer"
        ? message.created_at
        : conv.last_customer_message_at,
    unread_count: isActive ? 0 : conv.unread_count + 1,
  };
}
