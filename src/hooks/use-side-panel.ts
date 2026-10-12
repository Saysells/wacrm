"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_SIDE_TAB,
  defaultPanelOpen,
  togglePanelTab,
  type SidePanelState,
  type SideTab,
} from "@/lib/inbox/side-panel";

// ============================================================
// Panel lateral de la Bandeja: abierto o cerrado, y qué pestaña muestra
// (rediseño, sesión D; antes `use-contact-panel-open.ts`).
//
// Abierto o cerrado se sigue guardando en localStorage con la MISMA
// clave de siempre ("wacrm:inbox:contact-panel-open"): quien ya lo
// había plegado lo encuentra plegado. Sin nada guardado arranca abierto
// desde 1380 px de ancho de ventana y cerrado abajo, como el prototipo
// (`sideOpen: innerWidth >= 1380`). La pestaña vive solo en memoria
// (`sideTab`, arranca en la ficha).
//
// Store externo leído con useSyncExternalStore, igual que la barra
// plegada: el riel (shell) escribe y lee, la Bandeja lee, y ningún
// componente siembra estado desde un efecto. El snapshot de servidor
// es "abierto, ficha", el comportamiento histórico, así no hay
// desajuste de hidratación.
// ============================================================

const STORAGE_KEY = "wacrm:inbox:contact-panel-open";

let cachedOpen: boolean | null = null;
let tab: SideTab = DEFAULT_SIDE_TAB;
let snapshot: SidePanelState | null = null;
const listeners = new Set<() => void>();

function readStorage(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return defaultPanelOpen(window.innerWidth);
    return stored === "true";
  } catch {
    // localStorage puede tirar en navegación privada / sandbox.
    return typeof window === "undefined" ? true : defaultPanelOpen(window.innerWidth);
  }
}

function getOpen(): boolean {
  if (cachedOpen === null) cachedOpen = readStorage();
  return cachedOpen;
}

// `getSnapshot` se llama en cada render: devuelve el mismo objeto
// mientras nada cambie.
function getSnapshot(): SidePanelState {
  const open = getOpen();
  if (!snapshot || snapshot.open !== open || snapshot.tab !== tab) {
    snapshot = { open, tab };
  }
  return snapshot;
}

const SERVER_SNAPSHOT: SidePanelState = { open: true, tab: DEFAULT_SIDE_TAB };

function getServerSnapshot(): SidePanelState {
  return SERVER_SNAPSHOT;
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cachedOpen = readStorage();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function write(next: SidePanelState) {
  const openChanged = next.open !== getOpen();
  cachedOpen = next.open;
  tab = next.tab;
  if (openChanged) {
    try {
      localStorage.setItem(STORAGE_KEY, String(next.open));
    } catch {
      // Persistir es best-effort; si falla, vale para esta sesión.
    }
  }
  emit();
}

export interface SidePanelControls extends SidePanelState {
  /** Tocar una pestaña del riel estando en la Bandeja: la activa cierra, otra abre. */
  toggleTab: (tab: SideTab) => void;
  /** Abrir el panel en una pestaña (desde otra pantalla, o la fila Llamada de la ficha). */
  show: (tab: SideTab) => void;
  /** Cambiar la pestaña sin tocar abierto/cerrado (al abrir una conversación). */
  setTab: (tab: SideTab) => void;
  close: () => void;
}

export function useSidePanel(): SidePanelControls {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggleTab = useCallback((next: SideTab) => write(togglePanelTab(getSnapshot(), next)), []);
  const show = useCallback((next: SideTab) => write({ open: true, tab: next }), []);
  const setTab = useCallback((next: SideTab) => {
    if (getSnapshot().tab !== next) write({ open: getOpen(), tab: next });
  }, []);
  const close = useCallback(() => write({ open: false, tab: getSnapshot().tab }), []);
  return { open: state.open, tab: state.tab, toggleTab, show, setTab, close };
}
