-- ============================================================
-- 054_apertura_sin_formulario.sql
--
-- El bot deja de decirle "recibimos tu formulario" a quien nunca
-- llenó uno.
--
-- El caso real, del 02/09: "Yn Impresiones" escribió directo al número
-- de Kosmo, sin pasar por el Tally. No tiene un solo campo de
-- formulario guardado. El bot lo saludó igual con "Hace unos momentos
-- recibimos tu formulario por tema venta mayorista para tu negocio".
--
-- La causa es el disparador: `first_inbound_message` arranca con el
-- primer mensaje de cualquier contacto nuevo, venga de donde venga. Un
-- lead de un anuncio, de la web o recomendado por un conocido recibe
-- la misma frase. Es la única parte del guion que le dice al cliente
-- algo que no es cierto.
--
-- La solución no toca el motor. El receptor de Tally le pone
-- `origen_form` a todo lead que entra por el formulario (migración
-- 044), así que alcanza con preguntar por esa etiqueta antes de
-- hablar. El nodo `condition` ya sabe evaluar etiquetas con
-- subject 'tag' y operador present/absent.
--
-- El mapa del arranque pasa de:
--
--   inicio → marcar_en_gestion → paso1
--
-- a:
--
--   inicio → marcar_en_gestion → viene_del_form
--       con origen_form  → paso1        (el guion de siempre)
--       sin origen_form  → paso1_directo
--
-- `paso1_directo` no menciona ningún formulario ni el tipo de negocio,
-- que sin Tally tampoco existe. Pregunta lo único que hace falta
-- saber, y con un sí entra al paso 2 y sigue el guion completo:
-- intro, calificación, llamada o lista. No se duplica nada más.
--
-- Un "no" ahí es alguien que escribió por otra cosa, así que va
-- derecho a Matías en vez de recibir la intro mayorista.
--
-- La etiqueta "En gestión" se pone antes de la bifurcación: el lead
-- entró igual, venga de donde venga.
--
-- Idempotente y no destructiva. Orden: 050 → 052 → 053 → 054.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_cuenta UUID;
  v_matias UUID;
  v_flow   UUID;
  v_form   UUID;
  v_nodos  INT;

  c_nombre CONSTANT TEXT := 'Bot de primer contacto';

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

  -- Sin formulario no hay tipo de negocio que nombrar, así que la
  -- apertura pregunta lo único que hace falta saber para seguir.
  m_directo CONSTANT TEXT :=
    E'Hola{{contact.nombre_coma}} te escribe Kosmo. ¿Estás buscando información sobre venta mayorista?';
BEGIN
  -- ============================================================
  -- 1. Identidades
  -- ============================================================
  SELECT p.user_id, p.account_id INTO v_matias, v_cuenta
    FROM profiles p
   WHERE lower(p.email) = 'saysellsmatias@gmail.com'
   LIMIT 1;

  IF v_matias IS NULL OR v_cuenta IS NULL THEN
    RAISE EXCEPTION 'No hay perfil saysellsmatias@gmail.com con cuenta.';
  END IF;

  SELECT id INTO v_flow FROM flows
   WHERE account_id = v_cuenta AND name = c_nombre
   LIMIT 1;

  IF v_flow IS NULL THEN
    RAISE EXCEPTION 'No está cargado el flujo "%" en la cuenta %.', c_nombre, v_cuenta;
  END IF;

  -- La etiqueta que el receptor de Tally le pone a todo lead del
  -- formulario. Si no está, la condición no tendría contra qué
  -- comparar y el bot volvería a mentirle a todos.
  SELECT id INTO v_form FROM tags
   WHERE account_id = v_cuenta AND lower(btrim(name)) = 'origen_form';

  IF v_form IS NULL THEN
    RAISE EXCEPTION 'Falta la etiqueta origen_form en la cuenta %.', v_cuenta;
  END IF;

  -- ============================================================
  -- 2. La bifurcación
  -- ============================================================
  UPDATE flow_nodes
     SET config = config || jsonb_build_object('next_node_key', 'viene_del_form')
   WHERE flow_id = v_flow AND node_key = 'marcar_en_gestion';

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
  VALUES
    (v_flow, 'viene_del_form', 'condition',
     jsonb_build_object(
       'subject', 'tag',
       'subject_key', v_form::text,
       'operator', 'present',
       'true_next', 'paso1',
       'false_next', 'paso1_directo'
     ), 0, 300),

    -- Sin formulario. Un sí entra al guion de siempre por el paso 2.
    (v_flow, 'paso1_directo', 'classify_reply',
     jsonb_build_object(
       'prompt_text', m_directo,
       'negative', to_jsonb(l_neg),
       'positive', to_jsonb(l_pos),
       'negative_next', 'traspaso_otra_consulta',
       'positive_next', 'paso2',
       'unknown_next', 'paso2'
     ), 340, 360),

    (v_flow, 'traspaso_otra_consulta', 'handoff',
     jsonb_build_object('note', 'Escribió sin formulario y no es por mayorista',
                        'assign_to', v_matias),
     680, 480)
  ON CONFLICT (flow_id, node_key) DO UPDATE
    SET node_type  = EXCLUDED.node_type,
        config     = EXCLUDED.config,
        position_x = EXCLUDED.position_x,
        position_y = EXCLUDED.position_y;

  SELECT COUNT(*) INTO v_nodos FROM flow_nodes WHERE flow_id = v_flow;
  RAISE NOTICE 'Apertura sin formulario cargada en "%" (% nodos).', c_nombre, v_nodos;
END $$;

COMMIT;

-- ============================================================
-- Verificación
-- ============================================================
SELECT 'el bot pregunta antes de hablar de formularios' AS check_name,
       (
         EXISTS (
           SELECT 1 FROM flow_nodes n JOIN flows f ON f.id = n.flow_id
            WHERE f.name = 'Bot de primer contacto'
              AND n.node_key = 'marcar_en_gestion'
              AND n.config->>'next_node_key' = 'viene_del_form'
         )
         AND EXISTS (
           SELECT 1 FROM flow_nodes n JOIN flows f ON f.id = n.flow_id
             JOIN tags t ON t.id::text = n.config->>'subject_key'
            WHERE f.name = 'Bot de primer contacto'
              AND n.node_key = 'viene_del_form'
              AND n.config->>'true_next' = 'paso1'
              AND n.config->>'false_next' = 'paso1_directo'
              AND lower(btrim(t.name)) = 'origen_form'
         )
         AND EXISTS (
           SELECT 1 FROM flow_nodes n JOIN flows f ON f.id = n.flow_id
            WHERE f.name = 'Bot de primer contacto'
              AND n.node_key = 'paso1_directo'
              AND n.config->>'positive_next' = 'paso2'
              AND n.config->>'prompt_text' NOT LIKE '%formulario%'
         )
       ) AS ok,
       (SELECT COUNT(*)::text || ' nodos'
          FROM flow_nodes n JOIN flows f ON f.id = n.flow_id
         WHERE f.name = 'Bot de primer contacto') AS detalle;
