// ============================================================
// Panel lateral de la Bandeja (rediseño, sesión D).
//
// Parte PURA del riel y el panel: qué pestañas hay, con cuál arranca,
// qué pasa al tocar una pestaña del riel y si el panel nace abierto o
// cerrado según el ancho de la ventana. Prototipo: `rail()`, `side()`,
// el estado `sideOpen: innerWidth >= 1380` / `sideTab: 'ficha'` y las
// acciones `sideTab` / `sideClose` / `openConv()`.
//
// Del prototipo a los datos reales:
//   Ficha       el contacto de la conversación abierta
//   Llamadas    solo si la cuenta tiene etiquetas de estado con fecha
//               (`hasScheduling`): sin eso no hay nada que listar
//   Propuestas  solo el equipo de Saysells (`useSaysellsSelector`)
// ============================================================

export const SIDE_TABS = ["ficha", "calls", "notes", "props"] as const;

export type SideTab = (typeof SIDE_TABS)[number];

export const DEFAULT_SIDE_TAB: SideTab = "ficha";

/** Desde este ancho de ventana el panel arranca abierto si no hay nada guardado. */
export const PANEL_OPEN_MIN_WIDTH = 1380;

export function isSideTab(value: unknown): value is SideTab {
  return (SIDE_TABS as readonly unknown[]).includes(value);
}

/** Sin preferencia guardada: abierto en pantallas anchas, cerrado en las demás. */
export function defaultPanelOpen(viewportWidth: number): boolean {
  return viewportWidth >= PANEL_OPEN_MIN_WIDTH;
}

export interface SidePanelState {
  open: boolean;
  tab: SideTab;
}

/**
 * Tocar una pestaña del riel estando en la Bandeja: la activa cierra
 * el panel, cualquier otra lo abre en esa pestaña.
 */
export function togglePanelTab(state: SidePanelState, tab: SideTab): SidePanelState {
  if (state.open && state.tab === tab) return { open: false, tab };
  return { open: true, tab };
}

/**
 * Al abrir una conversación con Llamadas o Propuestas a la vista, el
 * panel pasa a la ficha: lo que la persona quiere ver es ese contacto.
 * Notas se conserva (sigue siendo del contacto abierto).
 */
export function tabAfterOpeningConversation(tab: SideTab): SideTab {
  return tab === "calls" || tab === "props" ? "ficha" : tab;
}

export interface AvailableTabs {
  /** La cuenta tiene etiquetas de estado con fecha. */
  scheduling: boolean;
  /** La persona es del equipo de Saysells. */
  saysells: boolean;
}

/** Las pestañas que el riel muestra, en su orden. */
export function visibleSideTabs(available: AvailableTabs): SideTab[] {
  return SIDE_TABS.filter((tab) => {
    if (tab === "calls") return available.scheduling;
    if (tab === "props") return available.saysells;
    return true;
  });
}

/**
 * Qué pestaña se pinta de verdad: una guardada que ya no está
 * disponible (la cuenta perdió las etiquetas con fecha, la persona no
 * es de Saysells) cae en la ficha en vez de mostrar un panel vacío.
 */
export function effectiveSideTab(tab: SideTab, available: AvailableTabs): SideTab {
  return visibleSideTabs(available).includes(tab) ? tab : DEFAULT_SIDE_TAB;
}
