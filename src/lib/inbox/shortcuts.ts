// ============================================================
// Atajos de teclado de la Bandeja (rediseño, sesión E), prototipo: el
// manejador de `keydown` y `openKeys()`.
//
// Parte PURA: qué tecla hace qué según el rol, el foco y lo que hay
// abierto, y a qué conversación saltan J y K. Sin DOM: el componente
// (inbox/page.tsx) mide `typing`, `overlayOpen` y `modifier` y acá se
// decide. Con pruebas en shortcuts.test.ts.
//
// Reglas:
//   - Solo en la Bandeja (el manejador vive en su página).
//   - Nunca escribiendo en un campo, con un modal o menú abierto, ni
//     con Cmd, Ctrl o Alt apretados.
//   - J, K y ? son de todos. A, L, E, N y / piden poder actuar
//     (agent+): el viewer solo se mueve y mira la ayuda.
// ============================================================

export type ShortcutAction =
  | "next"
  | "prev"
  | "take"
  | "schedule"
  | "close"
  | "note"
  | "slash"
  | "help";

export interface ShortcutScope {
  /** El foco está en un input, textarea, select o contenteditable. */
  typing: boolean;
  /** Hay un modal, menú o popover abierto. */
  overlayOpen: boolean;
  /** Cmd, Ctrl o Alt apretados. */
  modifier: boolean;
  /** La persona puede actuar (agent+); el viewer solo J, K y ?. */
  canAct: boolean;
}

const EVERYONE: Record<string, ShortcutAction> = {
  j: "next",
  k: "prev",
  "?": "help",
};

const ACTORS: Record<string, ShortcutAction> = {
  a: "take",
  l: "schedule",
  e: "close",
  n: "note",
  "/": "slash",
};

/** La acción de una tecla (`KeyboardEvent.key`) en ese contexto, o null. */
export function shortcutFor(key: string, scope: ShortcutScope): ShortcutAction | null {
  if (scope.typing || scope.overlayOpen || scope.modifier) return null;
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k in EVERYONE) return EVERYONE[k];
  if (scope.canAct && k in ACTORS) return ACTORS[k];
  return null;
}

/** ¿Un elemento con este tag o editable recibe texto? */
export function isTypingTarget(tagName: string | null | undefined, contentEditable: boolean): boolean {
  if (contentEditable) return true;
  const tag = (tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Como `move()` del prototipo: la conversación siguiente (+1) o
 * anterior (-1) de la lista a la vista. Sin conversación abierta, o con
 * una que ya no está en la lista, va a la primera. En los bordes se
 * queda. Null con la lista vacía o si no hay adónde moverse.
 */
export function neighborId(
  ids: readonly string[],
  currentId: string | null,
  delta: 1 | -1,
): string | null {
  if (ids.length === 0) return null;
  const index = currentId === null ? -1 : ids.indexOf(currentId);
  const next = index < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, index + delta));
  const id = ids[next];
  return id === currentId ? null : id;
}

/** La lista del modal (prototipo `openKeys`), en su orden. */
export interface ShortcutHelpRow {
  keys: string;
  labelKey: string;
}

export const SHORTCUT_HELP: readonly ShortcutHelpRow[] = [
  { keys: "J", labelKey: "next" },
  { keys: "K", labelKey: "prev" },
  { keys: "A", labelKey: "take" },
  { keys: "L", labelKey: "schedule" },
  { keys: "E", labelKey: "close" },
  { keys: "/", labelKey: "slash" },
  { keys: "N", labelKey: "note" },
  { keys: "Esc", labelKey: "escape" },
  { keys: "?", labelKey: "help" },
];
