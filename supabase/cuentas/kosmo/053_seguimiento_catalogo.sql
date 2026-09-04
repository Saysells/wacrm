-- ============================================================
-- 053_seguimiento_catalogo.sql
--
-- El seguimiento del catálogo, en la rama de la lista del bot de
-- primer contacto de Kosmo.
--
-- Hoy esa rama termina en el traspaso: se manda la lista, se le pasa
-- la conversación a Matías y la corrida se cierra. Si el lead mira el
-- catálogo y no dice nada más, no vuelve a pasar nada nunca.
--
-- El mapa pasa de:
--
--   paso3_lista_msg → traspaso_lista (cierra)
--
-- a:
--
--   paso3_lista_msg → traspaso_lista (asigna a Matías, SIGUE)
--     → lista_cierre  ("Cualquier duda o consulta me avisás.")
--         cualquier respuesta → fin_lista
--         24 h de silencio    → seguimiento
--     → seguimiento   ("¿pudiste ver el catálogo?...")
--         sí                  → paso4 (el rango horario, ya existe)
--         no / no se entiende → traspaso_no_quiere
--         24 h de silencio    → traspaso a Matías
--
-- Las dos piezas que lo hacen posible son de esta misma tanda: el
-- `next_node_key` del nodo `handoff` (el traspaso deja la conversación
-- a Matías y la corrida sigue viva) y la acción de timeout `goto` (a
-- las 24 horas la corrida avanza sola en vez de cerrarse).
--
-- **Las tres salidas de `lista_cierre` van al mismo `end`** a
-- propósito: cualquier cosa que el lead conteste ahí significa que hay
-- conversación, y donde hay conversación el bot se corre. Lo que
-- importa de ese nodo no es por dónde sale sino que el silencio de 24
-- horas tenga a alguien esperándolo.
--
-- **Si Matías contesta en cualquier momento de esas 24 horas**, la
-- corrida pasa a `paused_by_agent` (send-message.ts) y el seguimiento
-- no sale. Eso es lo buscado, no un efecto colateral.
--
-- Quien cuenta las 24 horas es el barrido de `/api/flows/cron`, que
-- corre cada minuto. Para una espera de un día, sobra.
--
-- **Nada hardcodeado**: la cuenta sale del perfil de Matías y el flujo
-- de su nombre, igual que la 050. Las listas de palabras son las
-- mismas de la 050, copiadas para que este archivo se lea solo.
--
-- **Idempotente y no destructiva**: los cuatro nodos nuevos se
-- insertan con ON CONFLICT DO UPDATE y el traspaso existente se
-- parcha campo por campo. Correrla dos veces no cambia nada y no toca
-- ninguna corrida en curso.
--
-- OJO si alguien vuelve a correr la 050: esa migración borra y
-- reinserta TODOS los nodos del flujo, así que se lleva puesto esto.
-- El orden correcto es 050 → 052 → 053.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_cuenta UUID;
  v_matias UUID;
  v_flow   UUID;
  v_nodos  INT;

  c_nombre CONSTANT TEXT := 'Bot de primer contacto';

  -- Mismas listas que la 050. Se comparan normalizadas (sin acentos,
  -- sin signos, minúscula) y por palabra o frase completa, así que van
  -- sin acentos a propósito.
  l_neg CONSTANT TEXT[] := ARRAY[
    'no', 'nono', 'nop', 'nah', 'negativo', 'no puedo', 'no me sirve',
    'no gracias', 'no fui yo', 'equivocado', 'ahora no', 'por ahora no',
    'todavia no', 'despues', 'mas adelante', 'otro momento', 'no me interesa'
  ];
  l_pos CONSTANT TEXT[] := ARRAY[
    'si', 'sisi', 'sii', 'sip', 'dale', 'ok', 'oka', 'okey', 'claro',
    'obvio', 'exacto', 'correcto', 'asi es', 'perfecto', 'buenisimo',
    'genial', 'de una', 'me sirve', 'va', 'bueno', 'listo', 'joya'
  ];

  -- Cierre de la entrega de la lista. Corto a propósito: es la última
  -- cosa que dice el bot antes de dejarle la conversación a Matías.
  m_cierre CONSTANT TEXT :=
    E'Cualquier duda o consulta me avisás.';

  -- El seguimiento, 24 horas después. Mismo registro que el resto del
  -- guion: voseo, nada de "has podido".
  m_seguimiento CONSTANT TEXT :=
    E'Hola{{contact.nombre_coma}} ¿pudiste ver el catálogo? ¿Te parece agendar una llamada de 10 a 15 minutos con un asesor?';
BEGIN
  -- ============================================================
  -- 1. Identidades
  -- ============================================================
  SELECT p.user_id, p.account_id INTO v_matias, v_cuenta
    FROM profiles p
   WHERE lower(p.email) = 'saysellsmatias@gmail.com'
   LIMIT 1;

  IF v_matias IS NULL OR v_cuenta IS NULL THEN
    RAISE EXCEPTION 'No hay perfil saysellsmatias@gmail.com con cuenta: el seguimiento le traspasa a él y no se puede cargar sin ese dato.';
  END IF;

  SELECT id INTO v_flow FROM flows
   WHERE account_id = v_cuenta AND name = c_nombre
   LIMIT 1;

  IF v_flow IS NULL THEN
    RAISE EXCEPTION 'No está cargado el flujo "%" en la cuenta %. Corré antes la 050.', c_nombre, v_cuenta;
  END IF;

  -- Los nodos que el seguimiento reusa tienen que estar: si no están,
  -- el flujo no es el que esta migración cree que es.
  IF NOT EXISTS (
    SELECT 1 FROM flow_nodes
     WHERE flow_id = v_flow AND node_key IN ('traspaso_lista', 'paso4')
     GROUP BY flow_id HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'El flujo % no tiene los nodos traspaso_lista y paso4.', v_flow;
  END IF;

  -- ============================================================
  -- 2. El traspaso de la lista deja de ser el final
  -- ============================================================
  -- Conserva su nota y su asignación a Matías: la conversación queda
  -- con él igual que hasta ahora. Lo único que cambia es que la
  -- corrida no muere ahí.
  UPDATE flow_nodes
     SET config = config || jsonb_build_object('next_node_key', 'lista_cierre')
   WHERE flow_id = v_flow AND node_key = 'traspaso_lista';

  -- ============================================================
  -- 3. Los nodos del seguimiento
  -- ============================================================
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
  VALUES
    -- ---- cierre de la entrega ----------------------------------------
    -- Las tres salidas van al mismo `end`: cualquier respuesta acá
    -- significa que hay conversación y el bot se corre. Lo que este
    -- nodo aporta es el reloj: 24 horas de silencio y sale el
    -- seguimiento.
    (v_flow, 'lista_cierre', 'classify_reply',
     jsonb_build_object(
       'prompt_text', m_cierre,
       'negative', to_jsonb(l_neg),
       'positive', to_jsonb(l_pos),
       'negative_next', 'fin_lista',
       'positive_next', 'fin_lista',
       'unknown_next', 'fin_lista',
       'timeout', jsonb_build_object(
         'hours', 24,
         'action', 'goto',
         'next_node_key', 'seguimiento'
       )
     ), -340, 1320),

    (v_flow, 'fin_lista', 'end', '{}'::jsonb, -680, 1440),

    -- ---- el seguimiento, 24 h después --------------------------------
    -- Silencio acá SÍ es un traspaso, no un "No responde": a esta
    -- persona ya le mandamos el catálogo y la conversación es de
    -- Matías. Por eso el nodo se sobreescribe la política.
    (v_flow, 'seguimiento', 'classify_reply',
     jsonb_build_object(
       'prompt_text', m_seguimiento,
       'negative', to_jsonb(l_neg),
       'positive', to_jsonb(l_pos),
       'negative_next', 'traspaso_no_quiere',
       'positive_next', 'paso4',
       'unknown_next', 'traspaso_no_quiere',
       'timeout', jsonb_build_object(
         'hours', 24,
         'action', 'handoff',
         'note', 'No respondió al seguimiento del catálogo'
       )
     ), -340, 1440),

    -- Vio el catálogo y no quiere la llamada: se lo pasamos a Matías
    -- con esa información. Terminal, sin next_node_key: acá el bot
    -- ya no tiene nada más que preguntar.
    (v_flow, 'traspaso_no_quiere', 'handoff',
     jsonb_build_object('note', 'Vio el catálogo, no quiere llamada',
                        'assign_to', v_matias),
     -680, 1560)
  ON CONFLICT (flow_id, node_key) DO UPDATE
    SET node_type  = EXCLUDED.node_type,
        config     = EXCLUDED.config,
        position_x = EXCLUDED.position_x,
        position_y = EXCLUDED.position_y;

  SELECT COUNT(*) INTO v_nodos FROM flow_nodes WHERE flow_id = v_flow;
  RAISE NOTICE 'Seguimiento del catálogo cargado en el flujo "%" (% nodos en total).',
    c_nombre, v_nodos;
END $$;

COMMIT;

-- ============================================================
-- Verificación
-- ============================================================
SELECT 'la rama de la lista sigue después del traspaso' AS check_name,
       (
         EXISTS (
           SELECT 1 FROM flow_nodes n JOIN flows f ON f.id = n.flow_id
            WHERE f.name = 'Bot de primer contacto'
              AND n.node_key = 'traspaso_lista'
              AND n.config->>'next_node_key' = 'lista_cierre'
              AND n.config->>'assign_to' IS NOT NULL
         )
         AND EXISTS (
           SELECT 1 FROM flow_nodes n JOIN flows f ON f.id = n.flow_id
            WHERE f.name = 'Bot de primer contacto'
              AND n.node_key = 'lista_cierre'
              AND n.config->'timeout'->>'action' = 'goto'
              AND n.config->'timeout'->>'next_node_key' = 'seguimiento'
         )
         AND EXISTS (
           SELECT 1 FROM flow_nodes n JOIN flows f ON f.id = n.flow_id
            WHERE f.name = 'Bot de primer contacto'
              AND n.node_key = 'seguimiento'
              AND n.config->>'positive_next' = 'paso4'
              AND n.config->'timeout'->>'action' = 'handoff'
         )
       ) AS ok,
       (SELECT COUNT(*)::text || ' nodos'
          FROM flow_nodes n JOIN flows f ON f.id = n.flow_id
         WHERE f.name = 'Bot de primer contacto') AS detalle;
