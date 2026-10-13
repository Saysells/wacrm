"use client";

import { useEffect, useSyncExternalStore } from "react";

import { displayNumberFrom } from "@/lib/saysells/selector";

// El número de WhatsApp de ESTA Bandeja, para el selector de la barra
// superior (rediseño, sesión F1; prototipo `.picker span.num`).
// `whatsapp_config` guarda solo el `phone_number_id`: el número lo
// tiene Meta, y `GET /api/whatsapp/config` (que ya existe y responde a
// cualquier miembro) se lo pide y lo devuelve en
// `phone_info.display_phone_number` cuando `connected` es true.
//
// Se pide UNA vez por pestaña: el resultado (con o sin número) queda en
// sessionStorage, así cambiar de pantalla no vuelve a golpear a Meta.
// Solo se pide cuando el selector es visible (`enabled`). Mientras
// carga, si no está conectado o si falla, devuelve null y la barra
// muestra el dominio, como hoy. La ruta no se toca.

const STORAGE_KEY = "wacrm:selector:whatsapp-number";

let value: string | null = null;
let started = false;
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

function getSnapshot(): string | null {
  return value;
}

function getServerSnapshot(): string | null {
  return null;
}

function readCached(): string | null | undefined {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    return raw || null;
  } catch {
    return undefined;
  }
}

function writeCached(next: string | null) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, next ?? "");
  } catch {
    // Sin sessionStorage (modo privado estricto): se pide una vez por montaje.
  }
}

async function load(): Promise<string | null> {
  try {
    const res = await fetch("/api/whatsapp/config", { credentials: "same-origin" });
    if (!res.ok) return null;
    return displayNumberFrom(await res.json());
  } catch {
    return null;
  }
}

function ensureStarted() {
  if (started) return;
  started = true;
  const cached = readCached();
  if (cached !== undefined) {
    value = cached;
    emit();
    return;
  }
  void load().then((next) => {
    writeCached(next);
    value = next;
    emit();
  });
}

/** Número de WhatsApp de la Bandeja, o null (cargando, no conectado o sin selector). */
export function useWhatsAppNumber(enabled: boolean): string | null {
  const number = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (enabled) ensureStarted();
  }, [enabled]);
  return enabled ? number : null;
}
