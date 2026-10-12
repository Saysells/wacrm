"use client";

import { useEffect, useSyncExternalStore } from "react";

import { useAuth } from "@/hooks/use-auth";
import {
  SELECTOR_HIDDEN,
  type SelectorResult,
} from "@/lib/saysells/selector";

// Trae UNA vez por proceso lo que `GET /api/saysells/selector` dice que
// ve esta persona, y lo comparte entre todos los que lo montan (la
// barra superior y, desde la sesión D, el riel del panel lateral).
// Arranca oculto, que es el estado seguro: la barra muestra solo el
// nombre de la Bandeja hasta que la ruta confirme que hay selector.
// Ante cualquier error queda oculto, nunca rompe la barra.
//
// Store externo leído con useSyncExternalStore (como la barra plegada):
// el primer montaje dispara el fetch, los demás leen el mismo resultado
// sin pedirlo de nuevo. Se vuelve a pedir solo si cambia la persona
// (cerrar sesión y entrar con otra cuenta sin recargar).

let result: SelectorResult = SELECTOR_HIDDEN;
let fetchedFor: string | null = null;
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

function getSnapshot(): SelectorResult {
  return result;
}

function getServerSnapshot(): SelectorResult {
  return SELECTOR_HIDDEN;
}

async function load(): Promise<SelectorResult> {
  try {
    const res = await fetch("/api/saysells/selector", { credentials: "same-origin" });
    if (!res.ok) return SELECTOR_HIDDEN;
    const body = (await res.json()) as Partial<SelectorResult>;
    if (!body || body.visible !== true || !Array.isArray(body.bandejas)) {
      return SELECTOR_HIDDEN;
    }
    return { visible: true, bandejas: body.bandejas };
  } catch {
    return SELECTOR_HIDDEN;
  }
}

function ensureFetched(userId: string) {
  if (fetchedFor === userId) return;
  fetchedFor = userId;
  result = SELECTOR_HIDDEN;
  emit();
  void load().then((next) => {
    // Otra persona entró mientras tanto: su pedido es el que vale.
    if (fetchedFor !== userId) return;
    result = next;
    emit();
  });
}

export function useSaysellsSelector(): SelectorResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (userId) ensureFetched(userId);
  }, [userId]);
  return value;
}
