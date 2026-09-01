// ============================================================
// Forma canónica de WhatsApp para un teléfono argentino.
//
// El problema concreto: los formularios (Tally) y las planillas
// traen el número como "+54 11 XXXX-XXXX" — con código de país pero
// SIN el 9 de móvil. WhatsApp, en cambio, entrega el `wa_id` como
// "549" + área + número. Son el mismo teléfono escrito de dos
// formas, y sin unificarlas el lead cargado desde el formulario y el
// mensaje entrante terminan en dos contactos distintos.
//
// `findExistingContact` (dedupe.ts) ya tolera la diferencia al
// BUSCAR — compara los últimos 8 dígitos — pero lo que se GUARDA
// sigue siendo lo que vino, y el índice único de `phone_normalized`
// (migración 022) es exacto. Este módulo canoniza en el momento de
// escribir, así la fila queda en la única forma que Meta acepta y
// los dos caminos convergen en un solo contacto.
//
// Se aplica en los tres caminos que crean o buscan contacto por
// teléfono: el webhook de Meta (entrada), `resolveConversationByPhone`
// ("Nuevo mensaje") y el receptor de Tally.
//
// Regla de oro: si el número NO se entiende como argentino, sale tal
// cual entró (solo dígitos). Nunca se inventa un país.
// ============================================================

/** Solo los dígitos, igual que `sanitizePhoneForMeta`. */
function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Un número nacional argentino válido: siempre 10 dígitos, sin el 0
 * de larga distancia, sin el 15 y sin el 9 de móvil.
 *
 *   11 + 8   → AMBA
 *   2xx/3xx + 7 → áreas de 3 dígitos
 *   2xxx/3xxx + 6 → áreas de 4 dígitos
 *
 * Todas empiezan con 11, 2 o 3, y todas suman 10. Ese doble chequeo
 * es lo que evita convertir por accidente un número de otro país
 * (un móvil coreano "010 1234 5678" queda en 1012345678: 10 dígitos
 * pero empieza con 10, así que no pasa).
 */
export function isArgentineNationalNumber(national: string): boolean {
  return /^(?:11\d{8}|[23]\d{9})$/.test(national);
}

/**
 * Saca el 15 de la marcación doméstica de celular (área + 15 +
 * abonado). Como el área puede tener 2, 3 o 4 dígitos, no se puede
 * saber de antemano dónde cae el 15: se prueban las tres posiciones
 * y se toma la primera que deja un nacional válido de 10 dígitos.
 *
 * Si no hay un 15 en ninguna posición plausible, devuelve la entrada
 * intacta — un número que ya viene sin 15 no se toca.
 */
function stripFifteen(national: string): string {
  // Con 15 el nacional mide 12; sin 15 mide 10. Cualquier otro largo
  // no es esta forma.
  if (national.length !== 12) return national;

  for (const areaLength of [2, 3, 4]) {
    if (national.slice(areaLength, areaLength + 2) !== "15") continue;
    const candidate =
      national.slice(0, areaLength) + national.slice(areaLength + 2);
    if (isArgentineNationalNumber(candidate)) return candidate;
  }

  return national;
}

/**
 * Lleva cualquier escritura de un teléfono argentino a la forma que
 * usa WhatsApp: dígitos, con 54 y con el 9.
 *
 *   "+54 11 XXXX-XXXX"   → "5491 1XXXXXXX"  (se le inserta el 9)
 *   "+549 11 XXXX-XXXX"  → igual, ya estaba canónico
 *   "011 15-XXXX-XXXX"   → se saca el 0 y el 15, se antepone 549
 *   "+1 415 555 0123"    → "14155550123", intacto (no es argentino)
 *
 * Nunca lanza: lo que no se entiende sale como dígitos sin tocar, y
 * el `isValidE164` de cada caller decide si sirve.
 */
export function normalizeArgentinePhone(raw: string): string {
  const digits = onlyDigits(raw ?? "");
  if (!digits) return "";

  // ---- con código de país -------------------------------------
  if (digits.startsWith("54")) {
    let rest = digits.slice(2);
    // El 9 de móvil se saca acá y se vuelve a poner abajo, para que
    // el resto del análisis trabaje siempre sobre el nacional puro.
    // Ningún área argentina empieza con 9, así que no hay ambigüedad.
    if (rest.startsWith("9")) rest = rest.slice(1);
    // El 0 de larga distancia no debería viajar en formato
    // internacional, pero aparece igual en datos cargados a mano.
    if (rest.startsWith("0")) rest = rest.slice(1);
    rest = stripFifteen(rest);
    return isArgentineNationalNumber(rest) ? `549${rest}` : digits;
  }

  // ---- formato doméstico, con el 0 de larga distancia ----------
  if (digits.startsWith("0")) {
    const rest = stripFifteen(digits.slice(1));
    return isArgentineNationalNumber(rest) ? `549${rest}` : digits;
  }

  // ---- cualquier otra cosa ------------------------------------
  // Un nacional argentino suelto (sin 54 y sin 0) es indistinguible
  // de un número de otro país, así que NO se adivina: pasa entero.
  return digits;
}
