-- ============================================================
-- 051_cron_interno.sql
--
-- El disparador del cron, adentro de la misma base.
--
-- Los endpoints `/api/flows/cron` y `/api/automations/cron` existen
-- desde siempre y su secreto ya está cargado en Vercel (los dos
-- responden 401, no 503). Lo que nunca existió es algo que los llame:
-- no hay `vercel.json`, no hay workflow de GitHub Actions y no hay
-- ningún pinger externo. Las colas nunca se drenaron porque nadie
-- tocaba la puerta.
--
-- Se resuelve con pg_cron + pg_net en la misma base en vez de un
-- servicio externo: no hay una cuenta más que mantener, el secreto no
-- sale de Postgres y si la base está viva el cron está vivo.
--
--   1. `pg_cron`. Se crea en `pg_catalog` con los grants que pide la
--      documentación de Supabase (Cron → Install, consultada el
--      02/09/2026). Sin esos dos grants la extensión queda instalada
--      pero sin acceso al schema `cron`, que es el bug conocido de
--      crearla por migración (supabase/cli#1591).
--
--   2. `cron_config`. El secreto vive en una fila, igual que el de
--      `integracion_crm`. No entra por este archivo: se carga después
--      desde el portapapeles, así no pasa por git ni por el chat.
--
--   3. Dos jobs.
--      - `flows-cron`, cada minuto. La cola `flow_pending_resumes` no
--        pierde nada si el cron se atrasa, pero su frecuencia es la
--        precisión de la espera: el `wait` de 25 segundos del bot de
--        Kosmo se siente como 25 segundos solo con el job por minuto.
--      - `automations-cron`, cada cinco. Solo drena delays de
--        automatizaciones, donde un minuto de más no cambia nada.
--
-- El `from cron_config` de cada job no es decorativo: si la fila del
-- secreto no está, la consulta devuelve cero filas y el job no hace
-- request, en vez de mandar un header nulo y comerse un 401 por
-- minuto.
--
-- URL: cuando `kosmo.wpp.saysells.com` esté apuntando, hay que
-- actualizar las dos de acá (migración nueva, no UPDATE a mano).
--
-- Idempotente: se puede correr dos veces sin duplicar jobs.
-- ============================================================

-- ============================================================
-- 1. pg_cron
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- ============================================================
-- 2. cron_config
-- ============================================================
CREATE TABLE IF NOT EXISTS cron_config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cron_config IS
  'Configuración del cron interno. La fila clave=cron_secret guarda el valor de AUTOMATION_CRON_SECRET, el mismo que espera el header x-cron-secret de los endpoints.';

ALTER TABLE cron_config ENABLE ROW LEVEL SECURITY;
-- Sin políticas para `authenticated`: la lee el job, que corre como
-- postgres y no pasa por RLS. Nadie del frontend tiene que verla.

-- ============================================================
-- 3. Los jobs
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flows-cron') THEN
    PERFORM cron.unschedule('flows-cron');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automations-cron') THEN
    PERFORM cron.unschedule('automations-cron');
  END IF;

  PERFORM cron.schedule('flows-cron', '* * * * *', $job$
    SELECT net.http_get(
      url := 'https://saysells-wacrm.vercel.app/api/flows/cron',
      headers := jsonb_build_object('x-cron-secret', c.valor),
      timeout_milliseconds := 8000
    )
    FROM cron_config c
    WHERE c.clave = 'cron_secret';
  $job$);

  PERFORM cron.schedule('automations-cron', '*/5 * * * *', $job$
    SELECT net.http_get(
      url := 'https://saysells-wacrm.vercel.app/api/automations/cron',
      headers := jsonb_build_object('x-cron-secret', c.valor),
      timeout_milliseconds := 8000
    )
    FROM cron_config c
    WHERE c.clave = 'cron_secret';
  $job$);
END $$;

-- ============================================================
-- Verificación
-- ============================================================
SELECT 'pg_cron instalado y dos jobs programados' AS check_name,
       (
         (SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_cron') = 1
         AND (SELECT COUNT(*) FROM cron.job
               WHERE jobname IN ('flows-cron', 'automations-cron')
                 AND active) = 2
       ) AS ok,
       (SELECT COALESCE(string_agg(jobname || ' → ' || schedule, ' | ' ORDER BY jobname), 'sin jobs')
          FROM cron.job
         WHERE jobname IN ('flows-cron', 'automations-cron')) AS detalle;
