// ============================================================
// Órdenes de afuera al cuadro de mensaje (rediseño, sesión E).
//
// Los atajos N ("Nota interna con el foco en el cuadro") y "/"
// ("Responder con las respuestas rápidas abiertas") los atiende la
// página de la Bandeja, pero el cuadro es un hijo del hilo con su
// propio estado (pestaña, texto, panel). En vez de subir ese estado,
// la página manda una orden por conversación y el cuadro montado de
// ESA conversación la ejecuta, igual que `prefillReplyDraft` deja un
// texto listo (composer-drafts.ts). Sin cuadro montado, la orden se
// pierde: no hay a quién dársela. Store en memoria, sin red ni DOM.
// ============================================================

export type ComposerCommand = "note" | "slash";

const listeners = new Map<string, Set<(command: ComposerCommand) => void>>();

/** Manda una orden al cuadro de esa conversación. Devuelve si alguien la recibió. */
export function sendComposerCommand(conversationId: string, command: ComposerCommand): boolean {
  const set = listeners.get(conversationId);
  if (!set || set.size === 0) return false;
  for (const l of set) l(command);
  return true;
}

/** El cuadro de una conversación se suscribe a las órdenes de afuera. */
export function subscribeComposerCommands(
  conversationId: string,
  listener: (command: ComposerCommand) => void,
): () => void {
  let set = listeners.get(conversationId);
  if (!set) {
    set = new Set();
    listeners.set(conversationId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(conversationId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(conversationId);
  };
}

/** Solo para pruebas. */
export function resetComposerCommandsForTests(): void {
  listeners.clear();
}
