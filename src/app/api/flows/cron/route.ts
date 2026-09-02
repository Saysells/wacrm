import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resolveFallbackPolicy } from '@/lib/flows/fallback'
import { resumeFlowRun } from '@/lib/flows/engine'

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
 * El barrido, en detalle: reads each active run's parent-flow `fallback_policy.on_timeout_hours`
 * to compute the staleness cutoff (default 24h), then marks any run
 * past its cutoff as `timed_out`. Writes a matching `flow_run_events`
 * row for the audit trail.
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

  // Pull all currently-active runs along with their parent flow's
  // fallback_policy. Joined in one query — the small set of active
  // runs per tenant keeps this cheap.
  const { data: runs, error } = await admin
    .from('flow_runs')
    .select(
      'id, flow_id, user_id, contact_id, last_advanced_at, flows ( fallback_policy )',
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
    user_id: string
    contact_id: string | null
    last_advanced_at: string
    flows: { fallback_policy: unknown } | { fallback_policy: unknown }[] | null
  }

  let swept = 0
  for (const r of runs as Row[]) {
    const flowsField = Array.isArray(r.flows) ? r.flows[0] : r.flows
    const policy = resolveFallbackPolicy(flowsField?.fallback_policy ?? null)
    const lastAdvanced = new Date(r.last_advanced_at)
    const ageHours = (now.getTime() - lastAdvanced.getTime()) / (1000 * 60 * 60)
    if (ageHours < policy.on_timeout_hours) continue

    // Mark timed_out — guarded by the precondition `status='active'`
    // so concurrent advance from a late inbound doesn't overwrite a
    // legitimate update.
    const { data: updated } = await admin
      .from('flow_runs')
      .update({
        status: 'timed_out',
        ended_at: now.toISOString(),
        end_reason: 'stale_sweep',
      })
      .eq('id', r.id)
      .eq('status', 'active')
      .select('id')

    if (Array.isArray(updated) && updated.length > 0) {
      await admin.from('flow_run_events').insert({
        flow_run_id: r.id,
        event_type: 'timeout',
        payload: {
          age_hours: Math.round(ageHours * 10) / 10,
          policy_hours: policy.on_timeout_hours,
        },
      })
      swept += 1
    }
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
