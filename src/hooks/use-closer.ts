"use client";

import { useMemo } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useInboxStore } from "@/hooks/use-inbox-store";
import { closerNameOf } from "@/lib/inbox/closer";

// ============================================================
// ¿La persona con sesión es closer? (rediseño, sesión E)
//
// Lo decide `closerNameOf` (puro, con pruebas) con tres datos que ya
// están en memoria: el `full_name` del perfil, los nombres de los
// miembros de la cuenta (el roster del store, acotado por RLS) y las
// etiquetas de la cuenta ("Agendado a <nombre>"). Nada de red ni de
// configuración: en USA y Star Energy no hay etiquetas con closer y
// acá da null para todo el mundo.
// ============================================================

export interface CloserState {
  /** El nombre del closer tal como lo escribe su etiqueta, o null. */
  closer: string | null;
  isCloser: boolean;
}

export function useCloser(): CloserState {
  const { profile } = useAuth();
  const { tags, memberNames } = useInboxStore();
  const fullName = profile?.full_name ?? null;
  const closer = useMemo(
    () => closerNameOf({ fullName, memberNames: memberNames.values(), accountTags: tags }),
    [fullName, memberNames, tags],
  );
  return { closer, isCloser: closer !== null };
}
