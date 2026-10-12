// ============================================================
// Vista de closer (rediseño, sesión E): quién es closer, Mis llamadas,
// la tarjeta de la llamada y sus resultados. Prototipo: `ISCLOSER()`,
// `ME()`, `inView(c, 'calls')`, `callCount()`, `callRow()`,
// `dayLabel()`, `side()` (`.callc` / `.outc`), `outcome()`,
// `primaryAction()` ("Crear propuesta").
//
// Parte PURA: ni red, ni React, ni DOM. Con pruebas en closer.test.ts.
//
// Del prototipo a los datos reales:
//   closer       la persona cuyo nombre de pila (primera palabra de
//                profiles.full_name, sin mayúsculas ni acentos) es el
//                de una etiqueta "Agendado a <nombre>" de la cuenta.
//                Si dos miembros comparten el nombre de pila, ninguno
//                es closer de esa etiqueta: no hay forma de saber cuál.
//   llamada mía  estado con fecha a mi nombre, o uno que no nombra a
//                nadie ("Agendada" / "Reagendado"): la Bandeja no sabe
//                de quién es, así que se muestra con "Sin closer".
//   resultado    la etiqueta de estado con ese nombre (Realizada, No se
//                presentó, Propuesta); la base saca la de fecha
//                (trg_single_etapa_tag) y el puente avisa al CRM.
//                No hay dónde guardar el resultado en la llamada: al
//                recargar vuelve la ficha común.
// ============================================================

import type { Tag } from "@/types";
import { closersOf } from "./agendar";
import type { InboxConversation } from "./inbox-conversation";
import { dayLabel } from "./thread";
import {
  HOUR_MS,
  isCloserCall,
  isClosed,
  personKey,
  scheduledCall,
  type ScheduledCall,
} from "./vistas";

/** Propuestas se arman afuera; "Crear propuesta" y el botón Propuesta abren esto en otra pestaña. */
export const PROPOSALS_URL = "https://propuestas.saysells.com";

/** "Ezequiel Pérez" → "ezequiel"; "  Manuel" → "manuel"; "" → "". */
export function firstNameKey(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return personKey(first);
}

export interface CloserInput {
  /** `profiles.full_name` de la persona con sesión. */
  fullName: string | null | undefined;
  /** Nombres de TODOS los miembros que el RLS deja ver (incluida la persona). */
  memberNames: Iterable<string>;
  accountTags: readonly Tag[];
}

/**
 * El nombre del closer que es la persona (tal como lo escribe su
 * etiqueta, "Manuel" en "Agendado a Manuel"), o null si no es closer:
 * sin etiqueta con su nombre de pila, o con otro miembro que se llama
 * igual.
 */
export function closerNameOf(input: CloserInput): string | null {
  const mine = firstNameKey(input.fullName);
  if (!mine) return null;
  const match = closersOf(input.accountTags).find((c) => personKey(c.name) === mine);
  if (!match) return null;
  let sameName = 0;
  for (const name of input.memberNames) {
    if (firstNameKey(name) === mine) sameName += 1;
  }
  if (sameName > 1) return null;
  return match.name;
}

export interface CloserCall {
  conversation: InboxConversation;
  call: ScheduledCall;
}

/**
 * Las llamadas pendientes del closer (prototipo `inView(c, 'calls')` +
 * `callCount()`): conversaciones no cerradas con estado con fecha a su
 * nombre o sin closer, por hora, la más próxima primero.
 */
export function closerCalls(convs: readonly InboxConversation[], closer: string): CloserCall[] {
  const out: CloserCall[] = [];
  for (const conversation of convs) {
    if (isClosed(conversation)) continue;
    const call = scheduledCall(conversation);
    if (call && isCloserCall(call, closer)) out.push({ conversation, call });
  }
  return out.sort((a, b) => a.call.at - b.call.at);
}

/** Con menos de esto por delante, la fila dice "En X" (prototipo: 3 h). */
export const SOON_MS = 3 * HOUR_MS;

/** Estado de la fila de Mis llamadas (`callRow`): ya pasó, es pronto, o agendada. */
export type CallStatus =
  | { kind: "past" }
  | { kind: "soon"; inMs: number }
  | { kind: "scheduled" };

export function callStatus(at: number, now: number): CallStatus {
  if (at < now) return { kind: "past" };
  if (at - now < SOON_MS) return { kind: "soon", inMs: at - now };
  return { kind: "scheduled" };
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface CallDayGroup<T> {
  /** Inicio del día en ms (hora local). */
  day: number;
  items: T[];
}

/** Agrupa por día calendario, en orden, conservando el orden de entrada dentro del día. */
export function groupByDay<T>(items: readonly T[], timeOf: (item: T) => number): CallDayGroup<T>[] {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const day = startOfDay(timeOf(item));
    const list = groups.get(day);
    if (list) list.push(item);
    else groups.set(day, [item]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, list]) => ({ day, items: list }));
}

/** Encabezado de un día de Mis llamadas (prototipo `dayLabel`): "Hoy · jueves 15 de octubre". */
export interface CallDayHeading {
  /** Hoy, mañana o ayer; null para cualquier otro día. */
  relative: "today" | "tomorrow" | "yesterday" | null;
  weekday: number;
  day: number;
  month: number;
}

export function callDayHeading(t: number, now: number): CallDayHeading {
  const label = dayLabel(t, now);
  const d = new Date(t);
  return {
    relative: label.kind === "date" ? null : label.kind,
    weekday: d.getDay(),
    day: d.getDate(),
    month: d.getMonth(),
  };
}

// ------------------------------------------------------------
// Tarjeta de la llamada y resultados
// ------------------------------------------------------------

/** Los tres resultados con etiqueta propia; Reagendar abre el modal de la D. */
export type CallOutcome = "realizada" | "no_se_presento" | "propuesta";

export const CALL_OUTCOMES: readonly CallOutcome[] = ["realizada", "no_se_presento", "propuesta"];

const OUTCOME_TAG_NAMES: Record<CallOutcome, string> = {
  realizada: "Realizada",
  no_se_presento: "No se presentó",
  propuesta: "Propuesta",
};

/** La etiqueta de estado de la cuenta para ese resultado, o null (y el botón no va). */
export function outcomeTag(accountTags: readonly Tag[], outcome: CallOutcome): Tag | null {
  const key = personKey(OUTCOME_TAG_NAMES[outcome]);
  return accountTags.find((t) => t.grupo === "estado" && personKey(t.name) === key) ?? null;
}

/**
 * ¿La ficha muestra la tarjeta de la llamada? Solo a un closer, y solo
 * si la llamada de la conversación abierta es suya o no nombra closer.
 */
export function showsCallCard(closer: string | null, call: ScheduledCall | null): boolean {
  return closer !== null && call !== null && isCloserCall(call, closer);
}

/** "Crear propuesta" como acción principal: closer con llamada suya, y del equipo de Saysells. */
export function showsProposalAction(
  closer: string | null,
  call: ScheduledCall | null,
  saysellsTeam: boolean,
): boolean {
  return saysellsTeam && showsCallCard(closer, call);
}
