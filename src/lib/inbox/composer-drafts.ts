// ============================================================
// Borradores del cuadro de mensaje, por conversación (rediseño,
// sesiones C y D).
//
// Antes vivían en dos `Map` de módulo adentro de message-composer.tsx.
// Salieron a este store para que alguien de afuera pueda dejar un
// texto listo en el cuadro: el modal "Agendar llamada" escribe el
// mensaje para el cliente en el borrador de Responder de ESA
// conversación (`prefillReplyDraft`) y el cuadro montado se entera por
// suscripción, pasa a Responder y pone el foco al final. Si había un
// borrador, el mensaje se agrega abajo; nunca se envía solo.
//
// Parte pura (`appendDraft`) separada y testeable; el resto es un
// store en memoria sin red ni DOM.
// ============================================================

const replyDrafts = new Map<string, string>();
const noteDrafts = new Map<string, string>();
const replyListeners = new Map<string, Set<(text: string) => void>>();

export function getReplyDraft(conversationId: string): string {
  return replyDrafts.get(conversationId) ?? "";
}

export function setReplyDraft(conversationId: string, text: string): void {
  replyDrafts.set(conversationId, text);
}

export function getNoteDraft(conversationId: string): string {
  return noteDrafts.get(conversationId) ?? "";
}

export function setNoteDraft(conversationId: string, text: string): void {
  noteDrafts.set(conversationId, text);
}

/**
 * Qué queda en el cuadro al dejar listo un texto: el texto solo si el
 * cuadro estaba vacío (o con espacios), y si no el borrador que había,
 * un salto de línea y el texto nuevo abajo.
 */
export function appendDraft(existing: string, addition: string): string {
  const base = existing.trimEnd();
  if (!base) return addition;
  return `${base}\n${addition}`;
}

/**
 * Deja un texto listo en Responder de esa conversación y avisa al cuadro
 * montado (si lo hay). Devuelve el borrador resultante.
 */
export function prefillReplyDraft(conversationId: string, text: string): string {
  const next = appendDraft(getReplyDraft(conversationId), text);
  replyDrafts.set(conversationId, next);
  const listeners = replyListeners.get(conversationId);
  if (listeners) for (const l of listeners) l(next);
  return next;
}

/** El cuadro de una conversación se suscribe a los prellenados de afuera. */
export function subscribeReplyDraft(
  conversationId: string,
  listener: (text: string) => void,
): () => void {
  let set = replyListeners.get(conversationId);
  if (!set) {
    set = new Set();
    replyListeners.set(conversationId, set);
  }
  set.add(listener);
  return () => {
    const current = replyListeners.get(conversationId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) replyListeners.delete(conversationId);
  };
}

/** Solo para pruebas: vacía los borradores y las suscripciones. */
export function resetDraftsForTests(): void {
  replyDrafts.clear();
  noteDrafts.clear();
  replyListeners.clear();
}
