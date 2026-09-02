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
}

const VAR_PATTERN = /\{\{vars\.([a-zA-Z0-9_]+)\}\}/g;

export function interpolate(
  template: string | undefined | null,
  ctx: InterpolationContext,
): string {
  if (!template) return "";
  return template.replace(VAR_PATTERN, (_, key: string) => {
    const v = ctx.vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}
