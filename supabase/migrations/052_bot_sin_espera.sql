-- ============================================================
-- 052_bot_sin_espera.sql
--
-- Saca el nodo `espera` del bot de primer contacto de Kosmo.
--
-- Por qué: los 25 segundos del guion se pagaban carísimo. El `wait`
-- suspende la corrida y la despierta el cron, que no baja de un
-- minuto, así que la apertura llegaba entre 55 y 85 segundos después
-- del mensaje del lead. Medido en la prueba real del 02/09: mensaje
-- 21:17:58, apertura 21:19:05, 67 segundos.
--
-- Sin el nodo, el arranque corre entero dentro del webhook de Meta y
-- la apertura sale en el mismo momento en que entra el mensaje. Lo
-- único que queda es la demora de Meta, unos 8 segundos, que no
-- depende de nosotros.
--
-- El grafo pasa de `inicio → espera → marcar_en_gestion` a
-- `inicio → marcar_en_gestion`. No se toca ningún otro nodo, ni los
-- mensajes, ni las ramas.
--
-- El tipo de nodo `wait` y la cola `flow_pending_resumes` (migración
-- 048) quedan donde están: el motor los sigue soportando y otro flujo
-- puede usarlos. Lo que se saca es el uso en este flujo.
--
-- Idempotente — se puede correr dos veces sin romper nada.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_cuenta   UUID;
  v_flow     UUID;
  v_colgadas INT;
BEGIN
  SELECT p.account_id INTO v_cuenta
    FROM profiles p
   WHERE lower(p.email) = 'saysellsmatias@gmail.com'
   LIMIT 1;

  IF v_cuenta IS NULL THEN
    RAISE EXCEPTION 'No hay perfil saysellsmatias@gmail.com con cuenta.';
  END IF;

  SELECT id INTO v_flow FROM flows
   WHERE account_id = v_cuenta AND name = 'Bot de primer contacto'
   LIMIT 1;

  IF v_flow IS NULL THEN
    RAISE EXCEPTION 'No está cargado el flujo "Bot de primer contacto" en la cuenta %.', v_cuenta;
  END IF;

  -- ---- 1. El arranque salta directo a la etiqueta ------------------
  UPDATE flow_nodes
     SET config = jsonb_set(config, '{next_node_key}', '"marcar_en_gestion"')
   WHERE flow_id = v_flow AND node_key = 'inicio';

  -- ---- 2. Corridas paradas en el nodo que se va --------------------
  -- Una corrida esperando ahí quedaría apuntando a un nodo que ya no
  -- existe y no avanzaría nunca. Se las adelanta al nodo siguiente,
  -- que es exactamente donde iban a caer.
  SELECT COUNT(*) INTO v_colgadas
    FROM flow_runs
   WHERE flow_id = v_flow AND status = 'active' AND current_node_key = 'espera';

  IF v_colgadas > 0 THEN
    UPDATE flow_runs
       SET current_node_key = 'marcar_en_gestion', last_advanced_at = NOW()
     WHERE flow_id = v_flow AND status = 'active' AND current_node_key = 'espera';
    RAISE NOTICE '% corrida(s) adelantadas del nodo espera.', v_colgadas;
  END IF;

  -- Esperas encoladas que ya no tienen sentido.
  DELETE FROM flow_pending_resumes
   WHERE node_key = 'espera'
     AND status = 'pending'
     AND flow_run_id IN (SELECT id FROM flow_runs WHERE flow_id = v_flow);

  -- ---- 3. Chau nodo ------------------------------------------------
  DELETE FROM flow_nodes WHERE flow_id = v_flow AND node_key = 'espera';

  RAISE NOTICE 'Nodo espera eliminado del flujo %.', v_flow;
END $$;

COMMIT;

-- ============================================================
-- Verificación
-- ============================================================
SELECT 'arranque directo, sin nodo espera' AS check_name,
       (
         NOT EXISTS (
           SELECT 1 FROM flow_nodes n
             JOIN flows f ON f.id = n.flow_id
            WHERE f.name = 'Bot de primer contacto' AND n.node_key = 'espera'
         )
         AND EXISTS (
           SELECT 1 FROM flow_nodes n
             JOIN flows f ON f.id = n.flow_id
            WHERE f.name = 'Bot de primer contacto'
              AND n.node_key = 'inicio'
              AND n.config->>'next_node_key' = 'marcar_en_gestion'
         )
       ) AS ok,
       (SELECT COUNT(*)::text || ' nodos'
          FROM flow_nodes n JOIN flows f ON f.id = n.flow_id
         WHERE f.name = 'Bot de primer contacto') AS detalle;
