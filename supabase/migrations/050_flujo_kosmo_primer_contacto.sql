-- ============================================================
-- 050_flujo_kosmo_primer_contacto.sql
--
-- El bot de primer contacto de Kosmo, cargado como flujo (flows +
-- flow_nodes) en vez de armado a mano en el editor.
--
-- Por qué por migración y no a mano: son 19 nodos, cuatro listas de
-- palabras y seis destinos de traspaso. Armado a mano en el canvas es
-- media hora de clicks, imposible de revisar en un diff e imposible de
-- volver a montar igual si hay que rehacerlo. Acá el guion queda al
-- lado del texto que se envía.
--
-- El guion vive en ~/Downloads/bot-primer-contacto-kosmo.md y los
-- mensajes están copiados de ahí tal cual, incluido el formato de
-- párrafos: la frase de apertura termina en dos puntos y sigue pegada
-- al primer párrafo; entre párrafos, un renglón en blanco. Los saltos
-- de línea se envían tal cual a WhatsApp.
--
-- **Nada está hardcodeado.** Las cuatro etiquetas se resuelven por
-- nombre dentro de la cuenta y Matías por su email. Un UUID pegado acá
-- funcionaría en la base de hoy y en ninguna otra.
--
-- **Idempotente y no destructiva.** Si el flujo ya existe por nombre
-- se REEMPLAZA su contenido conservando la fila: se actualizan los
-- campos, se borran los nodos y se vuelven a insertar. Borrar el flujo
-- entero también sería idempotente pero se llevaría puestas las
-- corridas y su historial (`flow_runs` cascadea), incluidas las
-- activas. Como los `node_key` no cambian, una corrida en curso sigue
-- funcionando después de correr esto.
--
-- El flujo queda ACTIVO. La beta de Flujos para la cuenta la prende la
-- migración 049.
-- ============================================================

BEGIN;

DO $$
DECLARE
  -- ---- identidades resueltas ----
  v_matias  UUID;
  v_cuenta  UUID;
  v_owner   UUID;
  v_flow    UUID;
  v_nodos   INT;
  t_gestion UUID;  -- estado: En gestión
  t_noresp  UUID;  -- estado: No responde
  t_recompra UUID; -- senal_recompra
  t_chat    UUID;  -- senal_prefiere_chat

  c_nombre CONSTANT TEXT := 'Bot de primer contacto';

  -- ---- listas de palabras (guion, sección "Detección de respuestas") ----
  -- Se comparan normalizadas (sin acentos, sin signos, minúscula) y por
  -- palabra o frase completa, así que van sin acentos a propósito.
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
  -- "Prefiere lista / no llamada".
  l_lista CONSTANT TEXT[] := ARRAY[
    'catalogo', 'lista', 'precios', 'por aca', 'por escrito',
    'no puedo llamar', 'llamada no', 'sin llamada', 'mejor por chat',
    'mandame'
  ];

  -- ---- mensajes ----
  m_paso1 CONSTANT TEXT :=
    E'Hola{{contact.nombre_coma}} te escribe Kosmo. Hace unos momentos recibimos tu formulario por tema venta mayorista para {{contact.tipo_negocio}}. ¿Estoy en lo correcto?';

  m_paso2 CONSTANT TEXT :=
    E'Genial genial, te hago una breve intro de nosotros:\nKosmo es importador directo, 30 años en el mercado. Marca propia y stock acá en Argentina. Te cuento{{contact.nombre_coma}} el proceso que hacemos es muy sencillo: hacés una llamada con un asesor del equipo, de 10 a 15 minutos.\n\nNos comentás qué vendés hoy y qué estás necesitando, y en esa misma llamada ves precios y beneficios para mayoristas. Y si te cierra, armamos juntos el primer pedido.\n\nTe consulto, ¿has comprado alguna vez nuestros productos?';

  m_paso2_re CONSTANT TEXT :=
    E'Perdón{{contact.nombre_coma}} ¿compraste alguna vez productos de Kosmo? Sí o no.';

  m_paso2_si CONSTANT TEXT :=
    E'Buenísimo, nos alegra que conozcas los productos de Kosmo.';

  m_paso2_no CONSTANT TEXT :=
    E'Okey perfecto, en la llamada te comentaremos más sobre los productos.';

  m_paso3 CONSTANT TEXT :=
    E'¿Te parece bien que agendemos una llamada de 10 a 15 minutos con el asesor del equipo?';

  m_paso3_re CONSTANT TEXT :=
    E'¿Coordinamos la llamada de 10 minutos con el asesor{{contact.coma_nombre}}? Sí o no.';

  m_lista CONSTANT TEXT :=
    E'Bueno perfecto, te envío la lista para que puedas ver todos los productos:\nLos precios están acá sin los descuentos más grandes para mayorista, esto normalmente lo ves directo en una llamada con el asesor del equipo y definen volumen y condiciones, pero si definís ya un pedido a través de la lista, según el volumen voy a poder brindarte el descuento y condiciones para tu caso.\n\n👉 https://kosmo.click/lista/\nContraseña: mayorista';

  m_paso4 CONSTANT TEXT :=
    E'Bueno excelente{{contact.nombre_coma}} ahora Matías coordina con vos la llamada con el asesor. Mientras, ¿me pasarías un rango horario que te quede cómodo?';
BEGIN
  -- ============================================================
  -- 1. Identidades
  -- ============================================================
  SELECT p.user_id, p.account_id INTO v_matias, v_cuenta
    FROM profiles p
   WHERE lower(p.email) = 'matias@saysells.com'
   LIMIT 1;

  IF v_matias IS NULL OR v_cuenta IS NULL THEN
    RAISE EXCEPTION 'No hay perfil matias@saysells.com con cuenta: el flujo asigna los traspasos a él y no se puede cargar sin ese dato.';
  END IF;

  SELECT a.owner_user_id INTO v_owner FROM accounts a WHERE a.id = v_cuenta;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'La cuenta % no tiene dueño.', v_cuenta;
  END IF;

  -- Etiquetas de estado: las crea la migración 046 en cada cuenta. Si
  -- faltan es que el esquema no es el esperado y adivinar sería peor.
  SELECT id INTO t_gestion FROM tags
   WHERE account_id = v_cuenta AND lower(btrim(name)) = lower('En gestión');
  SELECT id INTO t_noresp FROM tags
   WHERE account_id = v_cuenta AND lower(btrim(name)) = lower('No responde');
  IF t_gestion IS NULL OR t_noresp IS NULL THEN
    RAISE EXCEPTION 'Faltan las etiquetas de estado "En gestión" / "No responde" en la cuenta %.', v_cuenta;
  END IF;

  -- Señales del bot: si no están se crean. Son del guion, no del
  -- esquema, y crearlas es inofensivo (índice único por cuenta+nombre
  -- de la migración 043).
  SELECT id INTO t_recompra FROM tags
   WHERE account_id = v_cuenta AND lower(btrim(name)) = 'senal_recompra';
  IF t_recompra IS NULL THEN
    INSERT INTO tags (account_id, user_id, name, color, grupo)
    VALUES (v_cuenta, v_owner, 'senal_recompra', '#8b5cf6', 'senal')
    RETURNING id INTO t_recompra;
  END IF;

  SELECT id INTO t_chat FROM tags
   WHERE account_id = v_cuenta AND lower(btrim(name)) = 'senal_prefiere_chat';
  IF t_chat IS NULL THEN
    INSERT INTO tags (account_id, user_id, name, color, grupo)
    VALUES (v_cuenta, v_owner, 'senal_prefiere_chat', '#06b6d4', 'senal')
    RETURNING id INTO t_chat;
  END IF;

  -- ============================================================
  -- 2. El flujo
  -- ============================================================
  SELECT id INTO v_flow FROM flows
   WHERE account_id = v_cuenta AND name = c_nombre
   LIMIT 1;

  IF v_flow IS NULL THEN
    INSERT INTO flows (
      account_id, user_id, name, description, status,
      trigger_type, trigger_config, entry_node_id, fallback_policy
    ) VALUES (
      v_cuenta, v_owner, c_nombre,
      'Primer contacto con el lead que llega del formulario. Sin botones: interpreta texto libre.',
      'active',
      'first_inbound_message', '{}'::jsonb, 'inicio',
      jsonb_build_object(
        'on_unknown_reply', 'reprompt',
        'max_reprompts', 1,
        'on_timeout_hours', 24,
        -- 24 h de silencio: "No responde" y se cierra. El paso 4 se lo
        -- saca de encima con su propio timeout (ver más abajo).
        'on_timeout', jsonb_build_object(
          'action', 'tag_and_end',
          'tag_id', t_noresp
        ),
        'on_exhaust', 'handoff'
      )
    ) RETURNING id INTO v_flow;
  ELSE
    UPDATE flows SET
      user_id = v_owner,
      description = 'Primer contacto con el lead que llega del formulario. Sin botones: interpreta texto libre.',
      status = 'active',
      trigger_type = 'first_inbound_message',
      trigger_config = '{}'::jsonb,
      entry_node_id = 'inicio',
      fallback_policy = jsonb_build_object(
        'on_unknown_reply', 'reprompt',
        'max_reprompts', 1,
        'on_timeout_hours', 24,
        'on_timeout', jsonb_build_object(
          'action', 'tag_and_end',
          'tag_id', t_noresp
        ),
        'on_exhaust', 'handoff'
      ),
      updated_at = NOW()
    WHERE id = v_flow;

    -- Los node_key no cambian, así que una corrida activa parada en
    -- "paso3" sigue parada en "paso3" después de esto.
    DELETE FROM flow_nodes WHERE flow_id = v_flow;
  END IF;

  -- ============================================================
  -- 3. Los nodos
  -- ============================================================
  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
  VALUES
    -- ---- arranque: 25 segundos, "En gestión", y a hablar -------------
    (v_flow, 'inicio', 'start',
     jsonb_build_object('next_node_key', 'espera'), 0, 0),

    (v_flow, 'espera', 'wait',
     jsonb_build_object('seconds', 25, 'next_node_key', 'marcar_en_gestion'),
     0, 120),

    (v_flow, 'marcar_en_gestion', 'set_tag',
     jsonb_build_object('mode', 'add', 'tag_id', t_gestion,
                        'next_node_key', 'paso1'),
     0, 240),

    -- ---- paso 1 · apertura -------------------------------------------
    -- Positivo O desconocido siguen al paso 2: si contesta con una
    -- pregunta, el paso 2 la responde igual (qué somos y cómo se
    -- compra). Solo el "no fui yo / equivocado" se desvía.
    (v_flow, 'paso1', 'classify_reply',
     jsonb_build_object(
       'prompt_text', m_paso1,
       'negative', to_jsonb(l_neg),
       'positive', to_jsonb(l_pos),
       'negative_next', 'traspaso_no_formulario',
       'positive_next', 'paso2',
       'unknown_next', 'paso2'
     ), 0, 360),

    (v_flow, 'traspaso_no_formulario', 'handoff',
     jsonb_build_object('note', 'Dice que no llenó el formulario',
                        'assign_to', v_matias),
     -340, 480),

    -- ---- paso 2 · intro y calificación --------------------------------
    -- La rama extra es el caso del lead que contesta que nunca compró Y
    -- que no puede la llamada: eso no es un "no" a la pregunta, es un
    -- pedido de lista, y se salta derecho a la rama de la lista.
    (v_flow, 'paso2', 'classify_reply',
     jsonb_build_object(
       'prompt_text', m_paso2,
       'negative', to_jsonb(l_neg),
       'positive', to_jsonb(l_pos),
       'extra', jsonb_build_object(
         'keywords', to_jsonb(l_lista),
         'next_node_key', 'paso3_no'
       ),
       'negative_next', 'paso2_no_msg',
       'positive_next', 'senal_recompra',
       'unknown_next', 'paso2_repregunta'
     ), 0, 480),

    (v_flow, 'paso2_repregunta', 'classify_reply',
     jsonb_build_object(
       'prompt_text', m_paso2_re,
       'negative', to_jsonb(l_neg),
       'positive', to_jsonb(l_pos),
       'negative_next', 'paso2_no_msg',
       'positive_next', 'senal_recompra',
       'unknown_next', 'traspaso_no_entendi_2'
     ), 340, 600),

    (v_flow, 'traspaso_no_entendi_2', 'handoff',
     jsonb_build_object('note', 'No entendimos la respuesta (paso 2)',
                        'assign_to', v_matias),
     680, 720),

    (v_flow, 'senal_recompra', 'set_tag',
     jsonb_build_object('mode', 'add', 'tag_id', t_recompra,
                        'next_node_key', 'paso2_si_msg'),
     -340, 600),

    (v_flow, 'paso2_si_msg', 'send_message',
     jsonb_build_object('text', m_paso2_si, 'next_node_key', 'paso3'),
     -340, 720),

    (v_flow, 'paso2_no_msg', 'send_message',
     jsonb_build_object('text', m_paso2_no, 'next_node_key', 'paso3'),
     0, 600),

    -- ---- paso 3 · la llamada ------------------------------------------
    (v_flow, 'paso3', 'classify_reply',
     jsonb_build_object(
       'prompt_text', m_paso3,
       'negative', to_jsonb(l_neg),
       'positive', to_jsonb(l_pos),
       'extra', jsonb_build_object(
         'keywords', to_jsonb(l_lista),
         'next_node_key', 'paso3_no'
       ),
       'negative_next', 'paso3_no',
       'positive_next', 'paso4',
       'unknown_next', 'paso3_repregunta'
     ), 0, 840),

    (v_flow, 'paso3_repregunta', 'classify_reply',
     jsonb_build_object(
       'prompt_text', m_paso3_re,
       'negative', to_jsonb(l_neg),
       'positive', to_jsonb(l_pos),
       'extra', jsonb_build_object(
         'keywords', to_jsonb(l_lista),
         'next_node_key', 'paso3_no'
       ),
       'negative_next', 'paso3_no',
       'positive_next', 'paso4',
       'unknown_next', 'traspaso_no_entendi_3'
     ), 340, 960),

    (v_flow, 'traspaso_no_entendi_3', 'handoff',
     jsonb_build_object('note', 'No entendimos la respuesta (paso 3)',
                        'assign_to', v_matias),
     680, 1080),

    -- Prefiere la lista: se marca la señal, se manda la lista y se
    -- traspasa. La conversación sigue "En gestión" — el traspaso no
    -- toca la etiqueta de estado.
    (v_flow, 'paso3_no', 'set_tag',
     jsonb_build_object('mode', 'add', 'tag_id', t_chat,
                        'next_node_key', 'paso3_lista_msg'),
     -340, 960),

    (v_flow, 'paso3_lista_msg', 'send_message',
     jsonb_build_object('text', m_lista, 'next_node_key', 'traspaso_lista'),
     -340, 1080),

    (v_flow, 'traspaso_lista', 'handoff',
     jsonb_build_object('note', 'Pidió la lista, no quiere llamada',
                        'assign_to', v_matias),
     -340, 1200),

    -- ---- paso 4 · rango horario ---------------------------------------
    -- Cualquier respuesta sirve: se guarda y se traspasa. El timeout de
    -- acá NO es "No responde": esta persona ya dijo que quiere la
    -- llamada, solo no mandó el horario. Por eso el nodo se sobreescribe
    -- el timeout de la política y lo convierte en traspaso.
    (v_flow, 'paso4', 'collect_input',
     jsonb_build_object(
       'prompt_text', m_paso4,
       'var_key', 'rango_horario',
       'next_node_key', 'traspaso_horario',
       'timeout', jsonb_build_object(
         'hours', 24,
         'action', 'handoff',
         'note', 'Quiere la llamada, no pasó horario'
       )
     ), 0, 1080),

    (v_flow, 'traspaso_horario', 'handoff',
     jsonb_build_object(
       'note', 'Quiere la llamada. Rango: {{vars.rango_horario}}',
       'assign_to', v_matias
     ), 0, 1200);

  SELECT COUNT(*) INTO v_nodos FROM flow_nodes WHERE flow_id = v_flow;
  RAISE NOTICE 'Flujo "%" cargado en la cuenta % (% nodos).',
    c_nombre, v_cuenta, v_nodos;
END $$;

COMMIT;
