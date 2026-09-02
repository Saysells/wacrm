-- ============================================================
-- 048_flows_wait_classify.sql
--
-- Dos nodos nuevos para el motor de Flujos, y la cola que hace falta
-- para que uno de ellos exista de verdad.
--
--   1. `flow_nodes.node_type` acepta 'wait' y 'classify_reply'.
--      Mismo patrón de drop-and-recreate que usaron las migraciones
--      010 y 016; la forma del config vive en el JSONB y la chequean
--      los tipos de TypeScript y el validador, no la base.
--
--      - `wait`: suspende la corrida N segundos y sigue sola.
--      - `classify_reply`: interpreta una respuesta de texto libre
--        (sí / no / rama extra / no entendí) y ramifica. Es lo que
--        permite un bot sin botones.
--
--   2. `flow_pending_resumes` — la cola diferida del nodo `wait`.
--
--      Por qué una tabla y no un `setTimeout`: el proceso que atiende
--      el webhook de Meta se apaga apenas devuelve el 200, así que un
--      timer en memoria se va con él y la corrida queda dormida para
--      siempre. Es exactamente el problema que ya resolvió
--      `automation_pending_executions` (migración 006) para las
--      automatizaciones, y esta tabla es su equivalente para flujos:
--      misma forma (status + run_at + índice parcial de "vencidas"),
--      mismo cron que la drena.
--
--      No se reusa `automation_pending_executions` tal cual porque su
--      `automation_id` es NOT NULL y referencia `automations`: una
--      corrida de flujo no tiene automatización a la que colgarse.
--
-- Idempotente — se puede correr dos veces sin romper nada.
-- ============================================================

-- ============================================================
-- 1. flow_nodes.node_type — 'wait' y 'classify_reply'
-- ============================================================
ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'classify_reply',
    'wait',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'end'
  ));

-- ============================================================
-- 2. flow_pending_resumes — cola de reanudaciones diferidas
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_pending_resumes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  -- Tenencia. Redundante con flow_runs.account_id a propósito: el cron
  -- filtra y audita por cuenta sin tener que joinear.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- El nodo `wait` que encoló la espera. El cron lo usa como
  -- precondición: si la corrida ya se movió de ahí (traspaso, timeout,
  -- un agente que la pausó), la fila vencida ya no aplica y reanudar
  -- mandaría un mensaje fuera de guion.
  node_key TEXT NOT NULL,
  -- Desde dónde seguir cuando venza.
  resume_node_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  run_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El único acceso caliente es "dame las vencidas". Índice parcial, como
-- idx_automation_pending_due.
CREATE INDEX IF NOT EXISTS idx_flow_pending_resumes_due
  ON flow_pending_resumes(run_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_flow_pending_resumes_run
  ON flow_pending_resumes(flow_run_id);

ALTER TABLE flow_pending_resumes ENABLE ROW LEVEL SECURITY;
-- Sin políticas para `authenticated`: la cola es interna del motor y se
-- toca solo desde el servidor con service_role, igual que
-- automation_pending_executions.
