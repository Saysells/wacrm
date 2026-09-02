import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resolveFallbackPolicy } from '@/lib/flows/fallback'
import { applyFlowTimeout, resumeFlowRun } from '@/lib/flows/engine'
import { selectExpiredRuns, type SweepCandidate } from '@/lib/flows/timeout'

/**
 * Cron de flujos. Hace dos cosas, en este orden:
 *
 *   1. **Drena `flow_pending_resumes`** — las esperas del nodo `wait`
 *      que ya vencieron. Va primero porque una corrida que tenía que
 *      despertar hace un rato no debería, en la misma pasada, contarse
 *      como abandonada.
 *
 *   2. **Barre las corridas vencidas** (lo que este endpoint ya hacía).
 *
 * Cada cuánto correrlo: el barrido de timeouts se conforma con una vez
 * por hora, pero un `wait` de 25 segundos se siente como 25 segundos
 * solo si el cron corre cada minuto. La cola es la fuente de verdad
 * (una corrida encolada no se pierde aunque el cron se atrase); la
 * frecuencia solo define la precisión.
 *
 * El barrido, en detalle: para cada corrida activa se resuelve qué
 * timeout rige — el del nodo donde está parada si lo trae, si no el de
 * la política del flujo — y, si venció, se aplica la acción
 * configurada: `tag_and_end` (etiqueta al contacto y cierra) o
 * `handoff` (deja la conversación pendiente). Antes esto solo marcaba
 * la corrida `timed_out` y del lado del contacto no quedaba rastro de
 * que se lo había perdido.
 *
 * Without this sweep, a customer who abandons a flow mid-conversation
 * keeps a row in `idx_one_active_run_per_contact` (the partial unique
 * index on `flow_runs WHERE status='active'`) forever — blocking any
 * new triggers for them. The cron is therefore not optional.
 *
 * Auth: re-uses `AUTOMATION_CRON_SECRET` so operators only have one
 * secret to provision. The two endpoints (`/api/automations/cron`
 * and this one) are independent operations; we keep them on separate
 * URLs so one failing doesn't block the other.
 *
 * Hosting: hit on a schedule (Vercel Cron / GitHub Actions / external
 * pinger). Ver arriba por qué ahora conviene cada minuto y no cada
 * cinco.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  // Constant-time compare so an attacker who can hit the endpoint
  // can't recover the secret byte-by-byte from response-time deltas.
  // Length pre-check is required by timingSafeEqual (throws otherwise)
  // and leaks only the length itself, which isn't sensitive.
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const now = new Date()

  // ============================================================
  // 1. Esperas vencidas (nodo `wait`)
  // ============================================================
  const resumed = await drainDueResumes(admin, now)

  // ============================================================
  // 2. Corridas vencidas
  // ============================================================
  //
  // Se trae la corrida, la política de su flujo y el nodo donde está
  // parada — el nodo puede sobreescribir el timeout, y sin él no se
  // sabría que el paso 4 de un bot no es "No responde" sino traspaso.
  const { data: runs, error } = await admin
    .from('flow_runs')
    .select(
      'id, flow_id, current_node_key, last_advanced_at, flows ( fallback_policy )',
    )
    .eq('status', 'active')

  if (error) {
    console.error('[flows-cron] active-run scan failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!runs?.length) return NextResponse.json({ swept: 0, resumed })

  type Row = {
    id: string
    flow_id: string
    current_node_key: string | null
    last_advanced_at: string
    flows: { fallback_policy: unknown } | { fallback_policy: unknown }[] | null
  }
  const typed = runs as Row[]

  // Una sola consulta para los nodos de todos los flujos en juego, en
  // vez de una por corrida. El conjunto de flujos con corridas activas
  // es chico.
  const nodeConfigs = await loadNodeConfigs(
    admin,
    [...new Set(typed.map((r) => r.flow_id))],
  )

  const candidates: SweepCandidate[] = typed.map((r) => {
    const flowsField = Array.isArray(r.flows) ? r.flows[0] : r.flows
    return {
      id: r.id,
      last_advanced_at: r.last_advanced_at,
      policy: resolveFallbackPolicy(flowsField?.fallback_policy ?? null),
      nodeConfig: r.current_node_key
        ? (nodeConfigs.get(`${r.flow_id}:${r.current_node_key}`) ?? null)
        : null,
    }
  })

  let swept = 0
  for (const decision of selectExpiredRuns(candidates, now)) {
    const result = await applyFlowTimeout({
      runId: decision.id,
      timeout: decision.timeout,
      ageHours: decision.age_hours,
    })
    if (result.applied) swept += 1
  }

  return NextResponse.json({ swept, resumed })
}

/**
 * Reanuda las esperas vencidas.
 *
 * El claim (`status = 'running'` condicionado a que siga en
 * `'pending'`) es el lock: dos invocaciones solapadas del cron no
 * procesan la misma fila. Mismo patrón, a propósito, que
 * `/api/automations/cron`.
 */
async function drainDueResumes(
  admin: ReturnType<typeof supabaseAdmin>,
  now: Date
): Promise<number> {
  const { data: due, error } = await admin
    .from('flow_pending_resumes')
    .select('id, flow_run_id, node_key, resume_node_key')
    .eq('status', 'pending')
    .lte('run_at', now.toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) {
    console.error('[flows-cron] due-resume scan failed:', error.message)
    return 0
  }
  if (!due?.length) return 0

  type Row = {
    id: string
    flow_run_id: string
    node_key: string
    resume_node_key: string
  }

  let resumed = 0
  for (const row of due as Row[]) {
    const { data: claim } = await admin
      .from('flow_pending_resumes')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    const result = await resumeFlowRun({
      runId: row.flow_run_id,
      waitNodeKey: row.node_key,
      resumeNodeKey: row.resume_node_key,
    })
    // 'done' incluso cuando no se reanudó: la fila ya se evaluó y no
    // hay que volver a mirarla. El por qué queda en `flow_run_events`.
    await admin
      .from('flow_pending_resumes')
      .update({ status: 'done' })
      .eq('id', row.id)
    if (result.resumed) resumed += 1
  }
  return resumed
}

/**
 * Configs de los nodos de estos flujos, indexadas por
 * `flow_id:node_key`. Solo se usa el campo `timeout`, pero traer el
 * config entero es una columna menos que enumerar.
 */
async function loadNodeConfigs(
  admin: ReturnType<typeof supabaseAdmin>,
  flowIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>()
  if (flowIds.length === 0) return map
  const { data, error } = await admin
    .from('flow_nodes')
    .select('flow_id, node_key, config')
    .in('flow_id', flowIds)
  if (error) {
    // Sin los nodos se pierde la sobreescritura, pero la política
    // sigue rigiendo: el barrido corre igual, con el timeout de cuenta.
    console.error('[flows-cron] node-config scan failed:', error.message)
    return map
  }
  for (const row of (data ?? []) as {
    flow_id: string
    node_key: string
    config: Record<string, unknown> | null
  }[]) {
    map.set(`${row.flow_id}:${row.node_key}`, row.config ?? {})
  }
  return map
}
