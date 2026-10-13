// ============================================================
// Selector de bandejas y lanzador de apps (rediseño, sesión A).
//
// Parte PURA: parsea las dos variables de servidor y decide qué ve la
// persona. Sin red, sin Next, sin Supabase: la ruta
// `GET /api/saysells/selector` la llama con el mail de la sesión y
// devuelve el resultado tal cual. Tests en `selector.test.ts`.
//
//   SELECTOR_BANDEJAS  "Nombre|URL|Grupo,Nombre|URL,…". URL vacía quiere
//                      decir "próximamente": aparece deshabilitada. El
//                      tercer campo (sesión F1) es opcional: con grupos,
//                      el menú los lista en orden de aparición y las
//                      bandejas sin grupo van al final.
//   SELECTOR_EQUIPO    "mail,mail,…". Solo esas personas ven el
//                      selector y el lanzador.
//
// Las dos son de servidor a propósito (nunca NEXT_PUBLIC_): la lista
// de bandejas de Saysells y de su equipo no tiene por qué viajar en el
// bundle de una Bandeja de un cliente.
// ============================================================

export interface Bandeja {
  /** Nombre que se muestra ("Saysells ARG", "Kosmo"). */
  nombre: string;
  /** Dirección completa (`https://…`) o null si todavía no existe. */
  url: string | null;
  /** Host sin protocolo, para mostrar debajo del nombre y marcar la actual. */
  dominio: string | null;
  /** Grupo del menú ("Saysells", "Clientes"), o null si la variable no lo trae. */
  grupo: string | null;
}

export interface SelectorResult {
  visible: boolean;
  bandejas: Bandeja[];
}

export const SELECTOR_HIDDEN: SelectorResult = { visible: false, bandejas: [] };

/** Host en minúscula de una URL, o null si no es una URL absoluta válida. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * `"Saysells ARG|https://wpp.saysells.com|Saysells,LaudoPet|"` →
 * `[{ nombre: "Saysells ARG", url: "https://…", dominio: "wpp.saysells.com", grupo: "Saysells" },
 *   { nombre: "LaudoPet", url: null, dominio: null, grupo: null }]`.
 *
 * Tolerante con espacios de borde. Una entrada sin nombre se descarta;
 * una URL que no es absoluta (sin `https://`) se trata como vacía, así
 * un tipeo en la variable deja la bandeja en "próximamente" en vez de
 * mandar a la gente a una dirección rota.
 */
export function parseBandejas(raw: string | null | undefined): Bandeja[] {
  if (!raw) return [];
  const out: Bandeja[] = [];
  for (const entry of raw.split(",")) {
    const [rawNombre = "", rawUrl = "", rawGrupo = ""] = entry.split("|");
    const nombre = rawNombre.trim();
    if (!nombre) continue;
    const trimmedUrl = rawUrl.trim();
    const dominio = hostOf(trimmedUrl);
    out.push({
      nombre,
      url: dominio ? trimmedUrl.replace(/\/+$/, "") : null,
      dominio,
      grupo: rawGrupo.trim() || null,
    });
  }
  return out;
}

export interface BandejaGroup {
  /** Null para las bandejas sin grupo (van al final, bajo el rótulo de siempre). */
  grupo: string | null;
  bandejas: Bandeja[];
}

/**
 * Prototipo, menú `switch`: un grupo por nombre en el orden en que
 * aparece en la variable (sin distinguir mayúsculas), con sus bandejas
 * en su orden; las que no tienen grupo cierran la lista. Sin ningún
 * grupo devuelve un solo bloque con `grupo: null`: el menú de hoy.
 */
export function groupBandejas(bandejas: readonly Bandeja[]): BandejaGroup[] {
  const groups: BandejaGroup[] = [];
  const ungrouped: Bandeja[] = [];
  for (const bandeja of bandejas) {
    if (!bandeja.grupo) {
      ungrouped.push(bandeja);
      continue;
    }
    const key = bandeja.grupo.toLowerCase();
    let hit = groups.find((g) => g.grupo?.toLowerCase() === key);
    if (!hit) {
      hit = { grupo: bandeja.grupo, bandejas: [] };
      groups.push(hit);
    }
    hit.bandejas.push(bandeja);
  }
  if (ungrouped.length > 0 || groups.length === 0) {
    groups.push({ grupo: null, bandejas: ungrouped });
  }
  return groups;
}

/**
 * El número de WhatsApp para mostrar debajo del nombre (prototipo
 * `.picker span.num`), sacado de la respuesta de `GET /api/whatsapp/
 * config`: solo con `connected: true` y un `display_phone_number` con
 * contenido. Cualquier otra forma (no conectado, error, cuerpo raro)
 * devuelve null y la barra muestra el dominio, como hoy.
 */
export function displayNumberFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { connected?: unknown; phone_info?: unknown };
  if (b.connected !== true || !b.phone_info || typeof b.phone_info !== "object") return null;
  const num = (b.phone_info as { display_phone_number?: unknown }).display_phone_number;
  return typeof num === "string" && num.trim() ? num.trim() : null;
}

/** `"a@x.com, B@Y.com"` → `["a@x.com", "b@y.com"]` (sin vacíos, sin duplicados). */
export function parseEquipo(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const mail = entry.trim().toLowerCase();
    if (mail) seen.add(mail);
  }
  return [...seen];
}

/**
 * Lo que ve una persona. Visible solo si su mail está en la lista del
 * equipo Y hay al menos una bandeja configurada; si falta cualquiera
 * de las dos variables, o el mail no está, la barra muestra solo el
 * nombre de la Bandeja (sin desplegable ni lanzador).
 */
export function resolveSelector(input: {
  email: string | null | undefined;
  bandejasRaw: string | null | undefined;
  equipoRaw: string | null | undefined;
}): SelectorResult {
  const email = input.email?.trim().toLowerCase();
  if (!email) return SELECTOR_HIDDEN;
  const equipo = parseEquipo(input.equipoRaw);
  if (!equipo.includes(email)) return SELECTOR_HIDDEN;
  const bandejas = parseBandejas(input.bandejasRaw);
  if (bandejas.length === 0) return SELECTOR_HIDDEN;
  return { visible: true, bandejas };
}

/** La bandeja cuyo dominio coincide con el host actual, si está en la lista. */
export function isCurrentBandeja(bandeja: Bandeja, currentHost: string | null | undefined): boolean {
  if (!bandeja.dominio || !currentHost) return false;
  return bandeja.dominio === currentHost.trim().toLowerCase();
}

/** "Saysells ARG" → "SA"; "Kosmo" → "K"; "Star Energy" → "SE". */
export function bandejaInitials(nombre: string): string {
  const words = nombre.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

/**
 * Paleta de cuadrados del selector (prototipo `.bdg`): navy para la
 * casa y tonos vecinos para el resto. Se elige por hash del nombre
 * para que la misma bandeja tenga siempre el mismo color en todas
 * las instancias sin configurar nada.
 */
export const BANDEJA_COLORS = [
  "#1C2B48",
  "#4B4F9C",
  "#1E6B5C",
  "#3A5A8C",
  "#9A5B2E",
  "#5C7FA3",
] as const;

export function bandejaColor(nombre: string): string {
  let hash = 0;
  for (const ch of nombre.trim().toLowerCase()) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return BANDEJA_COLORS[hash % BANDEJA_COLORS.length];
}

/** Apps del lanzador de 9 puntos. Fijas: son las de Saysells. */
export interface SaysellsApp {
  key: "bandejas" | "crm" | "propuestas" | "sayworld" | "portal";
  nombre: string;
  /** null = abre el selector de bandejas en vez de navegar. */
  url: string | null;
  color: string;
}

export const SAYSELLS_APPS: ReadonlyArray<SaysellsApp> = [
  { key: "bandejas", nombre: "Bandejas", url: null, color: "#1C2B48" },
  { key: "crm", nombre: "CRM", url: "https://crm.saysells.com", color: "#2F6FD0" },
  { key: "propuestas", nombre: "Propuestas", url: "https://propuestas.saysells.com", color: "#E84419" },
  { key: "sayworld", nombre: "SayWorld", url: "https://team.saysells.com", color: "#2D8C4E" },
  { key: "portal", nombre: "Portal", url: "https://miembros.saysells.com", color: "#5C7FA3" },
];
