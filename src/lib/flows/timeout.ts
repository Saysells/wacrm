/**
 * Timeout de una corrida: cuándo vence y qué se hace cuando vence.
 *
 * `on_timeout_hours` existía en la política desde el principio, pero
 * lo único que pasaba al cumplirse era que la corrida quedaba marcada
 * `timed_out`. Del lado del contacto no quedaba nada: ni etiqueta, ni
 * conversación pendiente, ni nadie enterado. Este módulo es la parte
 * pura de la decisión (qué timeout rige y qué corridas vencieron); la
 * escritura está en `engine.ts` y el disparo en el cron.
 *
 * La regla de precedencia es "el nodo le gana a la política, campo por
 * campo". No es un capricho: un mismo flujo puede tener pasos donde el
 * silencio significa desinterés (No responde) y pasos donde significa
 * lo contrario — alguien que ya dijo que sí y solo no mandó el
 * horario. Ahí el timeout es un traspaso.
 */

import { resolveTimeoutAction } from "./fallback";
import type { FlowFallbackPolicy, FlowNodeTimeout } from "./types";

export interface ResolvedTimeout {
  hours: number;
  action: "tag_and_end" | "handoff";
  tag_id?: string;
  note?: string;
  /** De dónde salió la acción. Solo para el evento de auditoría. */
  source: "policy" | "node";
}

/**
 * El timeout que rige para una corrida parada en un nodo dado.
 *
 * Lo que el nodo no define lo hereda de la política, así que un
 * `timeout: { hours: 2 }` acorta la espera sin cambiar la acción.
 */
export function resolveTimeout(
  policy: FlowFallbackPolicy,
  nodeConfig: Record<string, unknown> | null | undefined,
): ResolvedTimeout {
  const base = resolveTimeoutAction(policy.on_timeout);
  const raw = (nodeConfig as { timeout?: FlowNodeTimeout } | null | undefined)
    ?.timeout;
  if (!raw || typeof raw !== "object") {
    return { hours: policy.on_timeout_hours, ...base, source: "policy" };
  }
  const hours =
    typeof raw.hours === "number" && raw.hours > 0
      ? raw.hours
      : policy.on_timeout_hours;
  const action =
    raw.action === "handoff" || raw.action === "tag_and_end"
      ? raw.action
      : base.action;
  const tag_id = typeof raw.tag_id === "string" && raw.tag_id ? raw.tag_id : base.tag_id;
  const note = typeof raw.note === "string" && raw.note ? raw.note : base.note;
  return {
    hours,
    action,
    ...(tag_id ? { tag_id } : {}),
    ...(note ? { note } : {}),
    source: "node",
  };
}

export interface SweepCandidate {
  id: string;
  /** `flow_runs.last_advanced_at`. */
  last_advanced_at: string;
  policy: FlowFallbackPolicy;
  /** Config del nodo donde está parada, para la sobreescritura. */
  nodeConfig?: Record<string, unknown> | null;
}

export interface SweepDecision {
  id: string;
  timeout: ResolvedTimeout;
  /** Horas de silencio, redondeadas a un decimal, para el evento. */
  age_hours: number;
}

/**
 * Las corridas vencidas y qué hacer con cada una.
 *
 * Se mide contra `last_advanced_at` y no contra `started_at`: lo que
 * vence es el silencio desde el último movimiento, no la corrida
 * entera. Una fecha ilegible se ignora (no se barre) en vez de tratarse
 * como infinitamente vieja: cerrar corridas vivas por un dato roto es
 * mucho peor que dejar una zombi para la pasada siguiente.
 */
export function selectExpiredRuns(
  rows: SweepCandidate[],
  now: Date,
): SweepDecision[] {
  const out: SweepDecision[] = [];
  for (const row of rows) {
    const last = new Date(row.last_advanced_at).getTime();
    if (!Number.isFinite(last)) continue;
    const timeout = resolveTimeout(row.policy, row.nodeConfig);
    const ageHours = (now.getTime() - last) / (1000 * 60 * 60);
    if (ageHours < timeout.hours) continue;
    out.push({
      id: row.id,
      timeout,
      age_hours: Math.round(ageHours * 10) / 10,
    });
  }
  return out;
}
