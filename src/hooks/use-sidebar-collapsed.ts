"use client";

import { useCallback, useSyncExternalStore } from "react";

// ============================================================
// Barra lateral plegada a solo iconos (escritorio).
//
// El estado no vive adentro de la barra porque hay otro consumidor: la
// lista de la Bandeja pinta las etiquetas del contacto como chips
// enteros cuando la barra esta contraida (hay ancho) y como puntitos
// cuando esta abierta (no lo hay). Los dos leen de aca.
//
// Es un store externo (localStorage) leido con `useSyncExternalStore`,
// no un estado de React sembrado desde un efecto: asi no hay un render
// en cascada al montar, el HTML del servidor usa el snapshot de
// servidor (expandido) sin desajuste de hidratacion, y plegar en una
// pestaña se refleja en las otras por el evento `storage`.
//
// Device-scoped, igual que el panel de contacto de la Bandeja
// ("wacrm:inbox:contact-panel-open").
// ============================================================

const STORAGE_KEY = "wacrm:layout:sidebar-collapsed";

/** Cache del valor leido; `null` mientras todavia no se leyo ninguno. */
let cached: boolean | null = null;
const listeners = new Set<() => void>();

function readStorage(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // localStorage puede tirar en navegacion privada / sandbox.
    return false;
  }
}

// `getSnapshot` se llama en cada render: tiene que devolver siempre el
// mismo valor mientras nada cambie, de ahi el cache.
function getSnapshot(): boolean {
  if (cached === null) cached = readStorage();
  return cached;
}

// En el servidor no hay preferencia guardada: la barra sale expandida,
// que es como se comportaba la app antes de esto.
function getServerSnapshot(): boolean {
  return false;
}

function emit() {
  for (const listener of listeners) listener();
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

function setCollapsed(next: boolean) {
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // Persistir es best-effort; si falla, vale para esta sesion.
  }
  emit();
}

export interface SidebarCollapsedState {
  collapsed: boolean;
  toggle: () => void;
}

export function useSidebarCollapsed(): SidebarCollapsedState {
  const collapsed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const toggle = useCallback(() => setCollapsed(!getSnapshot()), []);
  return { collapsed, toggle };
}
