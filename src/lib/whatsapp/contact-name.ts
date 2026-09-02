/**
 * Quién le gana a quién cuando hay dos nombres para el mismo contacto.
 *
 * El caso real, medido en producción: un lead llena el formulario de
 * Tally con "Emiliano", el Tally lo manda a WhatsApp, y el primer
 * mensaje entrante trae como nombre de perfil "Emi" — o, peor, el
 * nombre del negocio ("Family Store Phone"), que es lo que muchos
 * mayoristas tienen puesto. El webhook pisaba `contacts.name` con el
 * perfil en CADA mensaje, así que el dato bueno del formulario duraba
 * lo que tardaba el lead en escribir.
 *
 * La regla es entonces: el webhook **completa** el nombre cuando
 * falta, no lo **corrige** cuando ya hay uno. El nombre de perfil solo
 * entra si el contacto no tiene nombre propio.
 *
 * Efecto colateral aceptado y buscado: un contacto creado por un
 * mensaje entrante que después cambia su nombre de perfil ya no se
 * actualiza solo. Es preferible a pisar el dato bueno.
 */

import { phonesMatch } from "./phone-utils";

/**
 * ¿El nombre que tiene el contacto es un relleno y no un nombre?
 *
 * Dos formas de relleno:
 *   - vacío o solo espacios;
 *   - el teléfono, que es con lo que se crea un contacto sin nombre
 *     (`name: name || phone` en el webhook).
 *
 * La comparación con el teléfono exige que el nombre no tenga letras.
 * Sin esa guarda, "Local 4 · 11 2233-4455" se leería como teléfono
 * (los dígitos coinciden) y el perfil de WhatsApp se lo llevaría
 * puesto, que es exactamente lo que estamos evitando.
 */
export function isPlaceholderName(
  name: string | null | undefined,
  phones: Array<string | null | undefined>,
): boolean {
  const actual = (name ?? "").trim();
  if (!actual) return true;
  if (/\p{L}/u.test(actual)) return false;
  return phones.some((p) => p && phonesMatch(actual, p));
}

/**
 * El nombre con el que hay que actualizar el contacto, o `null` para
 * dejarlo como está.
 *
 * Devuelve un valor solo cuando el mensaje trae un nombre usable Y el
 * contacto no tiene uno propio. Un nombre entrante idéntico al que ya
 * está guardado tampoco genera escritura: sería un UPDATE por mensaje
 * sin cambiar nada.
 */
export function nameToFillIn(args: {
  /** Nombre guardado hoy en `contacts.name`. */
  existingName: string | null | undefined;
  /** Teléfono guardado en la fila del contacto. */
  existingPhone: string | null | undefined;
  /** Teléfono del que llegó el mensaje, ya normalizado. */
  incomingPhone: string | null | undefined;
  /** Nombre de perfil de WhatsApp que trae el mensaje. */
  incomingName: string | null | undefined;
}): string | null {
  const incoming = (args.incomingName ?? "").trim();
  if (!incoming) return null;
  const phones = [args.existingPhone, args.incomingPhone];
  // Un perfil que se llama como el teléfono no completa nada.
  if (isPlaceholderName(incoming, phones)) return null;
  if (!isPlaceholderName(args.existingName, phones)) return null;
  if (incoming === (args.existingName ?? "").trim()) return null;
  return incoming;
}
