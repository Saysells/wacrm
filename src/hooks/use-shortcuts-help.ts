"use client";

import { useSyncExternalStore } from "react";

// ============================================================
// Modal "Atajos de teclado" (rediseño, sesión E): abierto o cerrado.
//
// Lo abren dos lugares que no se conocen: la tecla ? en la Bandeja y el
// botón de la barra superior, en todas las pantallas. Store externo
// leído con useSyncExternalStore, como la búsqueda y la barra plegada;
// el modal vive en el shell y lee de acá.
// ============================================================

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openShortcutsHelp(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeShortcutsHelp(): void {
  if (!open) return;
  open = false;
  emit();
}

export function useShortcutsHelpOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}
