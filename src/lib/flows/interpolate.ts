/**
 * Interpolación de variables en los textos de un flujo.
 *
 * Vivía adentro de `engine.ts` como un helper privado de
 * `send_message`. Salió acá porque ahora la usan también el prompt de
 * `classify_reply` y la **nota del handoff** — y una nota que dice
 * "Quiere la llamada. Rango: {{vars.rango_horario}}" sin interpolar no
 * le sirve a nadie.
 *
 * Regla: una variable que no existe se renderiza como cadena vacía, no
 * como el literal `{{vars.x}}`. Es el mismo criterio del motor de
 * automatizaciones, y es el que hace que un mensaje con un dato
 * opcional siga leyéndose bien cuando el dato falta.
 */

export interface InterpolationContext {
  /** `flow_runs.vars` — lo que capturaron collect_input / classify_reply. */
  vars: Record<string, unknown>;
  /**
   * Lo que ya sabíamos del contacto antes de la conversación: nombre,
   * rubro, campos del formulario. Lo arma `contact-vars.ts`. Cuando no
   * está (una corrida sin contacto), `{{contact.x}}` queda vacío.
   */
  contact?: Record<string, string>;
}

const PATTERN = /\{\{(vars|contact)\.([a-zA-Z0-9_]+)\}\}/g;

export function interpolate(
  template: string | undefined | null,
  ctx: InterpolationContext,
): string {
  if (!template) return "";
  return template.replace(PATTERN, (_, scope: string, key: string) => {
    const v = scope === "contact" ? ctx.contact?.[key] : ctx.vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * ¿Este texto necesita los datos del contacto?
 *
 * Sirve para no pagar las consultas de `loadContactVars` en un flujo
 * que no usa ninguna: la mayoría de los nodos interpolan solo
 * `{{vars.x}}`, que ya está en memoria.
 */
export function hasContactVars(template: string | undefined | null): boolean {
  return typeof template === "string" && template.includes("{{contact.");
}
