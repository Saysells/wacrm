"use client";

import { useCallback, useSyncExternalStore } from "react";

// Panel de contacto de la Bandeja de escritorio: abierto o plegado.
// Device-scoped en localStorage ("wacrm:inbox:contact-panel-open"),
// leído con useSyncExternalStore como la barra lateral plegada: el
// servidor renderiza "abierto" (el comportamiento histórico) y el
// cliente adopta el valor guardado al hidratar, sin un efecto que
// siembre el estado.

const STORAGE_KEY = "wacrm:inbox:contact-panel-open";

let cached: boolean | null = null;
const listeners = new Set<() => void>();

function readStorage(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
    return true;
  }
}

function getSnapshot(): boolean {
  if (cached === null) cached = readStorage();
  return cached;
}

function getServerSnapshot(): boolean {
  return true;
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cached = readStorage();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function setOpen(next: boolean) {
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // Persistence is best-effort; ignore storage failures.
  }
  emit();
}

export function useContactPanelOpen(): { open: boolean; toggle: () => void } {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = useCallback(() => setOpen(!getSnapshot()), []);
  return { open, toggle };
}
