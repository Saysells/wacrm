// ============================================================
// Vistas, embudo, ventana y tiempos de la Bandeja (rediseño, sesión B).
//
// Parte PURA: ni red, ni React, ni DOM. La barra lateral cuenta y la
// lista filtra con ESTAS funciones sobre LA MISMA lista de
// conversaciones (el store compartido), así un contador y la lista no
// pueden contar distinto. Prototipo: `inView`, `viewCount`,
// `funnelGroups`, `GROUP`, `GCOL`, `win`, `rel`, `shortWhen`, `dur`.
//
// Del prototipo a los datos reales:
//   setter        conversations.assigned_agent_id (sin tomar = null)
//   cerrada       conversations.status = 'closed'
//   estado        la etiqueta del contacto con grupo = 'estado'
//   grupo         toda etiqueta de estado con requiere_fecha va a
//                 "Agendada"; las demás son su propio grupo
//   llamada       estado con requiere_fecha + contacts.fecha_llamada
//   ventana       24 h desde el último mensaje del cliente
// ============================================================

import { estadoRank, findEstadoTag } from "@/lib/contacts/tag-groups";
import type { AccountRole } from "@/lib/auth/roles";
import type { Tag } from "@/types";
import type { InboxConversation } from "./inbox-conversation";

export const VISTAS = [
  "mis-llamadas",
  "para-mi",
  "sin-tomar",
  "agendadas",
  "por-vencer",
  "todas",
  "cerradas",
] as const;

export type Vista = (typeof VISTAS)[number];

export function parseVista(value: string | null | undefined): Vista | null {
  return (VISTAS as readonly string[]).includes(value ?? "") ? (value as Vista) : null;
}

/**
 * Sin parámetro en la URL: Mis llamadas para un closer (sesión E), Para
 * mí para el agent y Todas para los demás roles.
 */
export function defaultVista(role: AccountRole | null, isCloser = false): Vista {
  if (isCloser) return "mis-llamadas";
  return role === "agent" ? "para-mi" : "todas";
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** Ventana de WhatsApp: 24 h desde el último mensaje del cliente. */
export const WINDOW_MS = DAY_MS;
/** "Por vencer": quedan menos de 2 h. */
export const EXPIRING_MS = 2 * HOUR_MS;

// ------------------------------------------------------------
// Embudo
// ------------------------------------------------------------

/** Grupo al que va toda etiqueta de estado que pide fecha. */
export const AGENDADA_GROUP = "Agendada";

/** Colores del prototipo (`GCOL`), por nombre de grupo. */
export const GROUP_COLORS: Readonly<Record<string, string>> = {
  Nuevo: "#2F6FD0",
  "En gestión": "#5A6B88",
  [AGENDADA_GROUP]: "#1C2B48",
  Realizada: "#2B7A82",
  "No se presentó": "#B0573A",
  Propuesta: "#C98A00",
  "En negociación": "#A47A12",
  Ganada: "#2D8C4E",
  "No responde": "#A3ADBD",
  Perdido: "#C62828",
};

/** Gris neutro para un grupo que no está en `GROUP_COLORS`. */
export const NEUTRAL_GROUP_COLOR = "#717D90";

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function groupColor(group: string): string {
  const hit = Object.keys(GROUP_COLORS).find((k) => nameKey(k) === nameKey(group));
  return hit ? GROUP_COLORS[hit] : NEUTRAL_GROUP_COLOR;
}

const AGENDADO_A = /^agendado a\s+(.+)$/i;

/** Grupo del embudo de una etiqueta de estado. */
export function estadoGroupOf(tag: Pick<Tag, "name" | "requiere_fecha">): string {
  if (tag.requiere_fecha) return AGENDADA_GROUP;
  return tag.name.trim();
}

/**
 * Posición del grupo en el embudo. "Agendada" (y cualquier "Agendado a
 * …", sea quien sea el closer) va donde ESTADO_FUNNEL pone a las de
 * Paola y Gustavo; los demás nombres usan su propio lugar y los
 * desconocidos quedan al final, alfabéticos.
 */
export function groupRank(group: string): number {
  if (nameKey(group) === nameKey(AGENDADA_GROUP) || AGENDADO_A.test(group.trim())) {
    return estadoRank("Agendado a Paola");
  }
  return estadoRank(group);
}

export interface FunnelGroup {
  name: string;
  color: string;
}

/**
 * Los grupos del embudo de la cuenta, en orden, a partir de sus
 * etiquetas de estado (uno por grupo aunque tenga cero
 * conversaciones, como `funnelGroups` del prototipo).
 */
export function funnelGroups(accountTags: readonly Tag[]): FunnelGroup[] {
  const seen = new Map<string, string>();
  for (const tag of accountTags) {
    if (tag.grupo !== "estado") continue;
    const group = estadoGroupOf(tag);
    const key = nameKey(group);
    if (!seen.has(key)) seen.set(key, group);
  }
  return [...seen.values()]
    .sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b))
    .map((name) => ({ name, color: groupColor(name) }));
}

/** ¿La cuenta tiene alguna etiqueta de estado que pida fecha? Sin eso no hay vista Agendadas. */
export function hasScheduling(accountTags: readonly Tag[]): boolean {
  return accountTags.some((t) => t.grupo === "estado" && t.requiere_fecha);
}

/** Etiqueta de estado y grupo de una conversación (null sin estado). */
export function conversationEstado(conv: InboxConversation): Tag | null {
  return findEstadoTag(conv.contact?.tags);
}

export function conversationGroup(conv: InboxConversation): string | null {
  const estado = conversationEstado(conv);
  return estado ? estadoGroupOf(estado) : null;
}

/** "Agendado a Manuel" → "Manuel"; "Agendada" / "Reagendado" → null. */
export function closerFromTag(name: string): string | null {
  const m = AGENDADO_A.exec(name.trim());
  return m ? m[1].trim() : null;
}

/** Clave de comparación de un nombre: sin acentos, sin mayúsculas, sin bordes. */
export function personKey(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase();
}

/**
 * ¿La llamada es de este closer? La suya, o una que no nombra a nadie
 * ("Agendada" / "Reagendado"): desde la decisión de Emi del 12/10 la
 * Bandeja no sabe de quién son, así que se le muestran para que no se
 * pierdan (en la lista llevan el chip "Sin closer").
 */
export function isCloserCall(call: Pick<ScheduledCall, "closer">, closer: string): boolean {
  return call.closer === null || personKey(call.closer) === personKey(closer);
}

export interface ScheduledCall {
  /** Nombre del closer, o null si la etiqueta no nombra a nadie. */
  closer: string | null;
  /** `contacts.fecha_llamada` en ms. */
  at: number;
}

/** Llamada agendada: estado con requiere_fecha + fecha en el contacto. */
export function scheduledCall(conv: InboxConversation): ScheduledCall | null {
  const estado = conversationEstado(conv);
  if (!estado || !estado.requiere_fecha) return null;
  const raw = conv.contact?.fecha_llamada;
  if (!raw) return null;
  const at = new Date(raw).getTime();
  if (Number.isNaN(at)) return null;
  return { closer: closerFromTag(estado.name), at };
}

// ------------------------------------------------------------
// Ventana de 24 h
// ------------------------------------------------------------

export type WindowState =
  | { kind: "none" }
  | { kind: "open"; remainingMs: number; until: number }
  | { kind: "expiring"; remainingMs: number; until: number }
  | { kind: "closed"; sinceMs: number; until: number };

export function windowState(
  lastCustomerAt: string | null | undefined,
  now: number,
): WindowState {
  if (!lastCustomerAt) return { kind: "none" };
  const last = new Date(lastCustomerAt).getTime();
  if (Number.isNaN(last)) return { kind: "none" };
  const until = last + WINDOW_MS;
  const remaining = until - now;
  if (remaining <= 0) return { kind: "closed", sinceMs: -remaining, until };
  if (remaining < EXPIRING_MS) return { kind: "expiring", remainingMs: remaining, until };
  return { kind: "open", remainingMs: remaining, until };
}

/** Estados en los que "Ventana cerrada" no se muestra: ya no hay nada que vencer. */
const FINAL_GROUPS = new Set(["ganada", "perdido"]);

export function showsClosedWindow(conv: InboxConversation): boolean {
  const group = conversationGroup(conv);
  return !group || !FINAL_GROUPS.has(nameKey(group));
}

// ------------------------------------------------------------
// Vistas
// ------------------------------------------------------------

export interface VistaContext {
  userId: string | null;
  now: number;
  /** Nombre del closer que es la persona (null si no lo es): solo lo usa Mis llamadas. */
  closer?: string | null;
}

export function isClosed(conv: InboxConversation): boolean {
  return conv.status === "closed";
}

export function isUnassigned(conv: InboxConversation): boolean {
  return !conv.assigned_agent_id;
}

/** Como `inView` del prototipo. Salvo Cerradas, ninguna vista cuenta las cerradas. */
export function inVista(conv: InboxConversation, vista: Vista, ctx: VistaContext): boolean {
  if (vista === "cerradas") return isClosed(conv);
  if (isClosed(conv)) return false;
  switch (vista) {
    case "mis-llamadas": {
      if (!ctx.closer) return false;
      const call = scheduledCall(conv);
      return call !== null && isCloserCall(call, ctx.closer);
    }
    case "para-mi":
      return !!ctx.userId && conv.assigned_agent_id === ctx.userId;
    case "sin-tomar":
      return isUnassigned(conv);
    case "agendadas":
      return scheduledCall(conv) !== null;
    case "por-vencer":
      return windowState(conv.last_customer_message_at, ctx.now).kind === "expiring";
    case "todas":
      return true;
  }
}

export type VistaCounts = Record<Vista, number>;

/** Contadores de la barra lateral. Cerradas no se cuenta (queda en 0). */
export function countVistas(convs: readonly InboxConversation[], ctx: VistaContext): VistaCounts {
  const counts: VistaCounts = {
    "mis-llamadas": 0,
    "para-mi": 0,
    "sin-tomar": 0,
    agendadas: 0,
    "por-vencer": 0,
    todas: 0,
    cerradas: 0,
  };
  for (const conv of convs) {
    for (const vista of VISTAS) {
      if (vista === "cerradas") continue;
      if (inVista(conv, vista, ctx)) counts[vista] += 1;
    }
  }
  return counts;
}

/** Conversaciones NO cerradas por grupo del embudo. */
export function countFunnel(convs: readonly InboxConversation[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const conv of convs) {
    if (isClosed(conv)) continue;
    const group = conversationGroup(conv);
    if (!group) continue;
    const key = nameKey(group);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function funnelCount(counts: Map<string, number>, group: string): number {
  return counts.get(nameKey(group)) ?? 0;
}

// ------------------------------------------------------------
// Lista: filtro, orden, secciones, sin tomar
// ------------------------------------------------------------

export interface ListFilters {
  /** `status` abierta/pendiente, o null para todas. */
  status: "open" | "pending" | null;
  /** Ids de etiqueta; pasa si el contacto tiene alguna (OR). */
  tagIds: string[];
  /** Empresa exacta, o null. */
  company: string | null;
}

export const NO_LIST_FILTERS: ListFilters = { status: null, tagIds: [], company: null };

export interface ListSelection {
  vista: Vista;
  /** Grupo del embudo elegido en la barra; pisa la vista. */
  embudo: string | null;
  /** Búsqueda de la barra superior (ya recortada); pisa vista y grupo. */
  query: string;
  /** Ids con el texto buscado en sus mensajes (los trae la base). */
  messageMatchIds: ReadonlySet<string> | null;
  filters: ListFilters;
}

/** Dígitos de un teléfono, para comparar sin espacios ni signos. */
export function digitsOf(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * Búsqueda local: nombre, empresa y teléfono por dígitos. El texto de
 * los mensajes viene aparte (`messageMatchIds`).
 */
export function matchesSearchText(conv: InboxConversation, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  const name = conv.contact?.name?.toLocaleLowerCase() ?? "";
  const company = conv.contact?.company?.toLocaleLowerCase() ?? "";
  if (name.includes(q) || company.includes(q)) return true;
  const qDigits = digitsOf(q);
  if (qDigits.length >= 3 && digitsOf(conv.contact?.phone).includes(qDigits)) return true;
  return false;
}

export function matchesListFilters(conv: InboxConversation, filters: ListFilters): boolean {
  if (filters.status && conv.status !== filters.status) return false;
  if (filters.tagIds.length > 0) {
    const tags = conv.contact?.tags ?? [];
    if (!tags.some((t) => filters.tagIds.includes(t.id))) return false;
  }
  if (filters.company !== null && conv.contact?.company?.trim() !== filters.company) {
    return false;
  }
  return true;
}

export function activityOf(conv: InboxConversation): number {
  const t = new Date(conv.last_message_at ?? conv.created_at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Última actividad primero. No muta la entrada. */
export function sortByActivity(convs: readonly InboxConversation[]): InboxConversation[] {
  return [...convs].sort((a, b) => activityOf(b) - activityOf(a));
}

/** Mis llamadas: por hora de la llamada, la más próxima primero. No muta la entrada. */
export function sortByCallTime(convs: readonly InboxConversation[]): InboxConversation[] {
  const at = (c: InboxConversation) => scheduledCall(c)?.at ?? Number.MAX_SAFE_INTEGER;
  return [...convs].sort((a, b) => at(a) - at(b) || activityOf(b) - activityOf(a));
}

/** La vista de llamadas se lista por hora y agrupada por día (prototipo `list()`). */
export function listsCalls(sel: Pick<ListSelection, "vista" | "embudo" | "query">): boolean {
  return sel.vista === "mis-llamadas" && !sel.embudo && !sel.query.trim();
}

/** Como `listConvs` del prototipo: búsqueda > grupo > vista, y encima los filtros. */
export function filterConversations(
  convs: readonly InboxConversation[],
  sel: ListSelection,
  ctx: VistaContext,
): InboxConversation[] {
  const query = sel.query.trim();
  let result: InboxConversation[];
  if (query) {
    result = convs.filter(
      (c) => matchesSearchText(c, query) || (sel.messageMatchIds?.has(c.id) ?? false),
    );
  } else if (sel.embudo) {
    const key = nameKey(sel.embudo);
    result = convs.filter((c) => !isClosed(c) && nameKey(conversationGroup(c) ?? "") === key);
  } else {
    result = convs.filter((c) => inVista(c, sel.vista, ctx));
  }
  result = result.filter((c) => matchesListFilters(c, sel.filters));
  return listsCalls(sel) ? sortByCallTime(result) : sortByActivity(result);
}

/** "Sin leer" / "Leídas" solo en Para mí y Todas, sin búsqueda ni grupo. */
export function splitsUnread(sel: Pick<ListSelection, "vista" | "embudo" | "query">): boolean {
  if (sel.query.trim() || sel.embudo) return false;
  return sel.vista === "para-mi" || sel.vista === "todas";
}

export interface ListSections {
  unread: InboxConversation[];
  read: InboxConversation[];
}

export function splitUnread(convs: readonly InboxConversation[]): ListSections {
  return {
    unread: convs.filter((c) => c.unread_count > 0),
    read: convs.filter((c) => c.unread_count <= 0),
  };
}

/** Sin tomar y no cerradas, la más antigua primero (por `created_at`). */
export function unassignedOldestFirst(
  convs: readonly InboxConversation[],
): InboxConversation[] {
  return convs
    .filter((c) => !isClosed(c) && isUnassigned(c))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

/** Si el aviso "N consultas sin tomar" va en esta selección (solo Para mí, sin búsqueda ni grupo). */
export function showsTakeNext(sel: Pick<ListSelection, "vista" | "embudo" | "query">): boolean {
  return sel.vista === "para-mi" && !sel.embudo && !sel.query.trim();
}

// ------------------------------------------------------------
// Tiempos (`rel`, `shortWhen`, `dur`); el texto lo pone el componente.
// ------------------------------------------------------------

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayDiff(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

export type RelativeTime =
  | { kind: "now" }
  | { kind: "minutes"; n: number }
  | { kind: "hours"; n: number }
  | { kind: "yesterday" }
  | { kind: "days"; n: number }
  | { kind: "date"; day: number; month: number };

/** Como `rel` del prototipo. */
export function relativeTime(t: number, now: number): RelativeTime {
  const diff = now - t;
  const MIN = 60 * 1000;
  if (diff < MIN) return { kind: "now" };
  if (diff < HOUR_MS) return { kind: "minutes", n: Math.floor(diff / MIN) };
  if (dayDiff(t, now) === 0) return { kind: "hours", n: Math.floor(diff / HOUR_MS) };
  const days = dayDiff(t, now);
  if (days === 1) return { kind: "yesterday" };
  if (days < 7) return { kind: "days", n: days };
  const d = new Date(t);
  return { kind: "date", day: d.getDate(), month: d.getMonth() + 1 };
}

export type ShortWhen =
  | { kind: "today"; time: string }
  | { kind: "tomorrow"; time: string }
  | { kind: "other"; weekday: number; day: number; time: string };

export function hhmm(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Como `shortWhen` del prototipo: "hoy 16:00", "mañana 10:00", "jue 15, 17:30". */
export function shortWhen(t: number, now: number): ShortWhen {
  const days = dayDiff(now, t);
  const time = hhmm(t);
  if (days === 0) return { kind: "today", time };
  if (days === 1) return { kind: "tomorrow", time };
  const d = new Date(t);
  return { kind: "other", weekday: d.getDay(), day: d.getDate(), time };
}

export interface DurationParts {
  hours: number;
  minutes: number;
}

/** Como `dur` del prototipo: horas y minutos, nunca menos de 1 min. */
export function durationParts(ms: number): DurationParts {
  const safe = Math.max(0, ms);
  const hours = Math.floor(safe / HOUR_MS);
  const minutes = Math.floor((safe % HOUR_MS) / (60 * 1000));
  if (hours === 0 && minutes === 0) return { hours: 0, minutes: 1 };
  return { hours, minutes };
}

/** Escapa `%` y `_` (y la barra) para un `ilike` de PostgREST. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** "Saysells ARG" → "SA"; misma regla que el selector de bandejas. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

/** Paleta de avatares del prototipo (`PAL`): fondo y tinta. */
export const AVATAR_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["#DCE7F5", "#24477F"],
  ["#E7E0F3", "#5A3E8A"],
  ["#DDEFE3", "#1F6B3A"],
  ["#F7E3D9", "#9A4422"],
  ["#DDEEF0", "#22636B"],
  ["#F3EBD3", "#7A5A10"],
  ["#E6E9EE", "#3B4A66"],
  ["#F3DDE6", "#8A3358"],
  ["#E1E6F4", "#334C8F"],
  ["#DCEFEA", "#1E6A58"],
];

export function avatarColors(name: string): readonly [string, string] {
  let hash = 0;
  for (const ch of name.trim().toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
