-- ============================================================
-- 901_cron_interno.sql  ·  cuenta saysells
--
-- El disparador del cron, adentro de la misma base. Espejo de la 051
-- de Kosmo, con la URL de esta instancia.
--
-- Los endpoints `/api/flows/cron` y `/api/automations/cron` vienen con
-- el producto y su secreto ya está en Vercel (AUTOMATION_CRON_SECRET,
-- cargada al crear el proyecto). Lo que no existe por defecto es algo
-- que los llame: sin esto, las colas no se drenan nunca.
--
-- Se resuelve con pg_cron + pg_net en la misma base en vez de un
-- servicio externo: no hay una cuenta más que mantener, el secreto no
-- sale de Postgres y si la base está viva el cron está vivo.
--
--   1. `pg_cron`. Se crea en `pg_catalog` con los dos grants que pide
--      la documentación de Supabase. Sin ellos la extensión queda
--      instalada pero sin acceso al schema `cron`, que es el bug
--      conocido de crearla por migración (supabase/cli#1591).
--
--   2. `cron_config`. El secreto vive en una fila. No entra por este
--      archivo: se carga después desde el portapapeles, así no pasa
--      por git ni por el chat.
--
--   3. Dos jobs, contra https://wpp.saysells.com.
--      - `flows-cron`, cada minuto. Su frecuencia es la precisión de
--        cualquier espera de un flujo.
--      - `automations-cron`, cada cinco. Solo drena delays de
--        automatizaciones, donde un minuto de más no cambia nada.
--
-- El `from cron_config` de cada job no es decorativo: si la fila del
-- secreto no está, la consulta devuelve cero filas y el job no hace
-- request, en vez de mandar un header nulo y comerse un 401 por
-- minuto.
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
      url := 'https://wpp.saysells.com/api/flows/cron',
      headers := jsonb_build_object('x-cron-secret', c.valor),
      timeout_milliseconds := 8000
    )
    FROM cron_config c
    WHERE c.clave = 'cron_secret';
  $job$);

  PERFORM cron.schedule('automations-cron', '*/5 * * * *', $job$
    SELECT net.http_get(
      url := 'https://wpp.saysells.com/api/automations/cron',
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
