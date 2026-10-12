// ============================================================
// Respuestas rápidas con "/" (rediseño, sesión C).
//
// Parte PURA del panel que abre el cuadro de mensaje al escribir "/"
// al principio (prototipo `qrPop()` / `qrItems()`): qué se está
// buscando, qué respuestas coinciden y cómo se mueve la selección con
// las flechas. Los datos son las `quick_replies` que ya existen
// (`/api/quick-replies`); acá no hay red.
// ============================================================

import type { QuickReply } from "@/types";

/**
 * Texto de búsqueda si el cuadro está en "modo barra": empieza con "/"
 * y es una sola línea. Null en cualquier otro caso (el panel no se
 * muestra). "/" solo devuelve "" y lista todo.
 */
export function slashQuery(text: string): string | null {
  if (!text.startsWith("/")) return null;
  if (text.includes("\n")) return null;
  return text.slice(1).trim().toLowerCase();
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Coincidencia por título o por contenido, sin distinguir mayúsculas;
 * el "/" con el que alguien haya nombrado la respuesta no cuenta. Las
 * que coinciden por título van primero, en su orden de llegada.
 */
export function filterQuickReplies(
  items: readonly QuickReply[],
  query: string,
): QuickReply[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  const byTitle: QuickReply[] = [];
  const byBody: QuickReply[] = [];
  for (const item of items) {
    const title = normalize(item.title).replace(/^\//, "");
    if (title.includes(q)) {
      byTitle.push(item);
      continue;
    }
    if (normalize(item.content_text).includes(q)) byBody.push(item);
  }
  return [...byTitle, ...byBody];
}

/** Flecha arriba / abajo: se queda en los bordes, no da la vuelta. */
export function moveSelection(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index + delta));
}

/** Índice seguro dentro de una lista que puede haberse achicado al filtrar. */
export function clampSelection(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(0, index), length - 1);
}
