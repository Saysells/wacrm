"use client";

import { useSyncExternalStore } from "react";

// ============================================================
// Búsqueda de la barra superior mientras estamos en la Bandeja
// (rediseño, sesión B). Store externo leído con useSyncExternalStore,
// igual que use-sidebar-collapsed: la barra superior escribe, la lista
// y la barra lateral leen, y ningún componente necesita un efecto que
// siembre un useState (el compilador de React lo rechaza). No persiste:
// vive en memoria y se limpia al salir de la Bandeja.
// ============================================================

let current = "";
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

export function getInboxSearch(): string {
  return current;
}

export function setInboxSearch(value: string) {
  if (value === current) return;
  current = value;
  emit();
}

function getServerSnapshot(): string {
  return "";
}

export function useInboxSearch(): string {
  return useSyncExternalStore(subscribe, getInboxSearch, getServerSnapshot);
}
