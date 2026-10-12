// ============================================================
// Agendar llamada desde la Bandeja (rediseño, sesión D).
//
// Parte PURA del modal "Agendar llamada" (prototipo `openSchedule`,
// `drawSchedule`, `busy`, `saveSchedule`, `setState`): quiénes son los
// closers, qué etiqueta de estado se aplica, qué horarios están
// ocupados y cómo se arma el calendario. Sin red, sin React, sin DOM;
// la parte con red (`applySchedule`) está al final, separada, igual
// que fecha-llamada.ts.
//
// Del prototipo a los datos reales:
//   closer       etiqueta de estado con requiere_fecha que se llama
//                "Agendado a <nombre>" (`closerFromTag`)
//   llamada      estado con requiere_fecha + contacts.fecha_llamada
//   ocupado      otra conversación con el mismo closer, el mismo día y
//                la misma hora y minuto (`scheduledCall` del store)
//
// QUÉ ETIQUETA SE APLICA (decisión de Emi del 12/10/2026):
//   1. Agendar, sin llamada vigente: "Agendado a <closer elegido>"; si
//      la cuenta no tiene closers, la etiqueta de estado con fecha que
//      no es "Reagendado", en el orden del embudo ("Agendada").
//   2. Reagendar, con llamada vigente: "Reagendado". Si se elige un
//      closer distinto del actual, "Agendado a <nuevo>". Si la cuenta
//      no tiene "Reagendado", la que corresponde es la actual.
//   3. Elegir en Estado una etiqueta con fecha: "Agendado a X" abre el
//      modal con X elegido; "Agendada" o "Reagendado" lo abren sin
//      lista de closers y aplican esa (`fixedTag`). Elegir el estado
//      actual, si es con fecha, abre Reagendar.
//   4. Si el contacto ya tiene la etiqueta que corresponde, después de
//      guardar la fecha se saca y se vuelve a poner: el aviso al CRM
//      sale del INSERT en contact_tags y un duplicado (unique) no
//      inserta nada, así que sin eso el CRM no recibiría la fecha nueva.
//
// Y siempre: PRIMERO la fecha, DESPUÉS la etiqueta (ver fecha-llamada.ts).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { estadoRank } from "@/lib/contacts/tag-groups";
import type { Tag } from "@/types";
import { attachTag, detachTag } from "./contact-tags";
import { saveFechaLlamada } from "./fecha-llamada";
import type { InboxConversation } from "./inbox-conversation";
import {
  closerFromTag,
  DAY_MS,
  groupRank,
  isClosed,
  scheduledCall,
  type ScheduledCall,
} from "./vistas";

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export interface Closer {
  /** "Manuel" en "Agendado a Manuel". */
  name: string;
  tag: Tag;
}

/**
 * Etiquetas de estado con fecha de la cuenta, en orden de embudo. Todo
 * "Agendado a …" va donde van las de Paola y Gustavo sea quien sea el
 * closer (`groupRank`); entre closers desconocidos, alfabético.
 */
export function schedulingTags(accountTags: readonly Tag[]): Tag[] {
  return accountTags
    .filter((t) => t.grupo === "estado" && t.requiere_fecha)
    .sort(
      (a, b) =>
        groupRank(a.name) - groupRank(b.name) ||
        estadoRank(a.name) - estadoRank(b.name) ||
        a.name.localeCompare(b.name),
    );
}

/** Los closers de la cuenta: una etiqueta "Agendado a <nombre>" por cada uno. */
export function closersOf(accountTags: readonly Tag[]): Closer[] {
  const out: Closer[] = [];
  for (const tag of schedulingTags(accountTags)) {
    const name = closerFromTag(tag.name);
    if (name) out.push({ name, tag });
  }
  return out;
}

export function closerTag(accountTags: readonly Tag[], closer: string): Tag | null {
  return closersOf(accountTags).find((c) => nameKey(c.name) === nameKey(closer))?.tag ?? null;
}

export function reagendadoTag(accountTags: readonly Tag[]): Tag | null {
  return schedulingTags(accountTags).find((t) => nameKey(t.name) === "reagendado") ?? null;
}

/**
 * Sin closers: la etiqueta de estado con fecha que no es "Reagendado",
 * la primera en el orden del embudo (en las cuentas de hoy, "Agendada").
 */
export function defaultScheduleTag(accountTags: readonly Tag[]): Tag | null {
  return schedulingTags(accountTags).find((t) => nameKey(t.name) !== "reagendado") ?? null;
}

export type ScheduleMode = "new" | "re";

export interface ScheduleRequest {
  mode: ScheduleMode;
  /** Closer marcado al abrir, si corresponde ("Agendado a X" desde Estado, o el actual). */
  presetCloser: string | null;
  /** "Agendada" o "Reagendado" elegida en Estado: se aplica esa, sin lista de closers. */
  fixedTag: Tag | null;
}

/** Con llamada vigente se reagenda; sin ella se agenda. */
export function scheduleModeFor(currentCall: ScheduledCall | null): ScheduleMode {
  return currentCall ? "re" : "new";
}

/** Agendar o Cambiar desde la ficha, el encabezado o la tecla: el closer actual queda marcado. */
export function requestFromAction(currentCall: ScheduledCall | null): ScheduleRequest {
  return {
    mode: scheduleModeFor(currentCall),
    presetCloser: currentCall?.closer ?? null,
    fixedTag: null,
  };
}

/**
 * Elegir en Estado una etiqueta con fecha (regla 3). El estado actual
 * abre Reagendar; "Agendado a X" marca a X; "Agendada" / "Reagendado"
 * fijan la etiqueta.
 */
export function requestFromEstado(
  picked: Tag,
  currentEstado: Tag | null,
  currentCall: ScheduledCall | null,
): ScheduleRequest {
  if (currentEstado && picked.id === currentEstado.id) {
    return requestFromAction(currentCall);
  }
  const closer = closerFromTag(picked.name);
  if (closer) return { mode: "new", presetCloser: closer, fixedTag: null };
  return { mode: scheduleModeFor(currentCall), presetCloser: currentCall?.closer ?? null, fixedTag: picked };
}

export interface ResolveTagInput {
  mode: ScheduleMode;
  accountTags: readonly Tag[];
  /** Etiqueta de estado actual del contacto (puede no ser con fecha). */
  currentEstado: Tag | null;
  /** Closer de la llamada vigente, null si no hay o si la etiqueta no lo nombra. */
  currentCloser: string | null;
  /** Closer elegido en el modal; null si la cuenta no tiene closers o no se eligió. */
  chosenCloser: string | null;
  fixedTag: Tag | null;
}

/** Reglas 1 a 3. Null solo si la cuenta no tiene ninguna etiqueta con fecha. */
export function resolveScheduleTag(input: ResolveTagInput): Tag | null {
  const { accountTags } = input;
  if (input.fixedTag) return input.fixedTag;

  if (input.mode === "new") {
    if (input.chosenCloser) return closerTag(accountTags, input.chosenCloser) ?? defaultScheduleTag(accountTags);
    return defaultScheduleTag(accountTags);
  }

  // Reagendar.
  if (
    input.chosenCloser &&
    (!input.currentCloser || nameKey(input.chosenCloser) !== nameKey(input.currentCloser))
  ) {
    const changed = closerTag(accountTags, input.chosenCloser);
    if (changed) return changed;
  }
  const re = reagendadoTag(accountTags);
  if (re) return re;
  if (input.currentEstado?.requiere_fecha) return input.currentEstado;
  if (input.chosenCloser) return closerTag(accountTags, input.chosenCloser) ?? defaultScheduleTag(accountTags);
  return defaultScheduleTag(accountTags);
}

/** Regla 4: la tiene puesta, así que hay que sacarla y volver a ponerla. */
export function needsReattach(attached: readonly Tag[], tag: Tag): boolean {
  return attached.some((t) => t.id === tag.id);
}

// ------------------------------------------------------------
// Calendario y horarios
// ------------------------------------------------------------

/** Horarios del prototipo: 09:00 a 12:30 y 14:00 a 18:30, cada 30 minutos. */
export const SLOTS: readonly string[] = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30",
];

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Instante de un horario "HH:MM" dentro de un día (inicio del día en ms, hora local). */
export function slotTime(day: number, slot: string): number {
  const [h, m] = slot.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function hhmmOf(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function sameCloser(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return nameKey(a) === nameKey(b);
}

/**
 * Llamadas agendadas de un closer (null = las etiquetas que no nombran
 * a nadie, "Agendada" / "Reagendado") en conversaciones no cerradas,
 * sin la conversación que se está agendando.
 */
export function callsOfCloser(
  convs: readonly InboxConversation[],
  closer: string | null,
  excludeConversationId: string | null,
): ScheduledCall[] {
  const out: ScheduledCall[] = [];
  for (const conv of convs) {
    if (conv.id === excludeConversationId || isClosed(conv)) continue;
    const call = scheduledCall(conv);
    if (call && sameCloser(call.closer, closer)) out.push(call);
  }
  return out;
}

/** Horarios ocupados de un día: misma hora y minuto que otra llamada del closer. */
export function busySlots(
  convs: readonly InboxConversation[],
  closer: string | null,
  day: number,
  excludeConversationId: string | null,
): Set<string> {
  const start = startOfDay(day);
  const out = new Set<string>();
  for (const call of callsOfCloser(convs, closer, excludeConversationId)) {
    if (startOfDay(call.at) === start) out.add(hhmmOf(call.at));
  }
  return out;
}

/** Días del mes (1..31) con alguna llamada del closer: el punto del calendario. */
export function daysWithCalls(
  convs: readonly InboxConversation[],
  closer: string | null,
  year: number,
  month: number,
  excludeConversationId: string | null,
): Set<number> {
  const out = new Set<number>();
  for (const call of callsOfCloser(convs, closer, excludeConversationId)) {
    const d = new Date(call.at);
    if (d.getFullYear() === year && d.getMonth() === month) out.add(d.getDate());
  }
  return out;
}

/** "N llamadas en los próximos 7 días": desde el inicio de hoy, 7 días. */
export function callsNextWeek(
  convs: readonly InboxConversation[],
  closer: string | null,
  now: number,
): number {
  const from = startOfDay(now);
  const to = from + 7 * DAY_MS;
  return callsOfCloser(convs, closer, null).filter((c) => c.at >= from && c.at < to).length;
}

export interface MonthGrid {
  /** Celdas vacías antes del día 1 (semana que arranca el lunes). */
  offset: number;
  /** Cantidad de días del mes. */
  days: number;
}

export function monthGrid(year: number, month: number): MonthGrid {
  const first = new Date(year, month, 1);
  return {
    offset: (first.getDay() + 6) % 7,
    days: new Date(year, month + 1, 0).getDate(),
  };
}

export interface ScheduleDraft {
  year: number;
  month: number;
  /** Inicio del día elegido en ms, o null. */
  day: number | null;
  /** "HH:MM" elegido, o null. */
  slot: string | null;
}

/**
 * Con qué se abre el modal: la llamada vigente marcada (Reagendar), o el
 * mes de pasado mañana sin día ni horario (Agendar), como el prototipo.
 */
export function initialScheduleDraft(currentCall: ScheduledCall | null, now: number): ScheduleDraft {
  if (currentCall) {
    const d = new Date(currentCall.at);
    return {
      year: d.getFullYear(),
      month: d.getMonth(),
      day: startOfDay(currentCall.at),
      slot: hhmmOf(currentCall.at),
    };
  }
  const base = new Date(now + 2 * DAY_MS);
  return { year: base.getFullYear(), month: base.getMonth(), day: null, slot: null };
}

export function shiftMonth(draft: ScheduleDraft, delta: number): ScheduleDraft {
  const d = new Date(draft.year, draft.month + delta, 1);
  return { ...draft, year: d.getFullYear(), month: d.getMonth() };
}

/** Un día pasado no se elige; un horario pasado u ocupado tampoco. */
export function isPastDay(day: number, now: number): boolean {
  return day < startOfDay(now);
}

export function isPastSlot(day: number, slot: string, now: number): boolean {
  return slotTime(day, slot) < now;
}

/** La fecha elegida, o null hasta que haya día y horario. */
export function chosenTime(draft: ScheduleDraft): number | null {
  if (draft.day === null || !draft.slot) return null;
  return slotTime(draft.day, draft.slot);
}

// ------------------------------------------------------------
// Parte con red.
// ------------------------------------------------------------

export interface ApplyScheduleInput {
  db: SupabaseClient;
  contactId: string;
  tag: Tag;
  fecha: Date;
  /** Etiquetas actuales del contacto. */
  attached: Tag[];
}

export interface ApplyScheduleResult {
  fechaLlamada: string;
  attached: Tag[];
}

/**
 * Primero la fecha; después la etiqueta. Si el contacto ya la tiene, se
 * saca y se vuelve a poner para que el INSERT (y el aviso al CRM)
 * ocurra con la fecha nueva. Si guardar la fecha falla, no se toca
 * ninguna etiqueta.
 */
export async function applySchedule(input: ApplyScheduleInput): Promise<ApplyScheduleResult> {
  const fechaLlamada = await saveFechaLlamada(input.db, input.contactId, input.fecha);
  let attached = input.attached;
  if (needsReattach(attached, input.tag)) {
    attached = await detachTag(input.contactId, input.tag.id, attached);
  }
  attached = await attachTag(input.contactId, input.tag, attached);
  return { fechaLlamada, attached };
}
