-- 902_flujo_bienvenida: primer mensaje automático de la Bandeja de Star Energy
--
-- Cuando alguien le escribe al número por primera vez, la Bandeja:
--
--   1. marca al contacto como "Nuevo" (estado) y "origen_ads" (origen),
--   2. le manda el mensaje de bienvenida aprobado,
--   3. deja la conversación en pendiente para que la tome una persona.
--
-- No espera respuesta ni interpreta nada: después del mensaje la conversación
-- es de quien atiende. Por eso son cinco nodos y un traspaso sin asignar.
--
-- "origen_ads" va a TODO contacto nuevo. Hoy la Bandeja no distingue si el
-- mensaje llegó desde un anuncio o no (el webhook no guarda el dato "referral"
-- de Meta), y el número se difunde solo por la campaña. Si eso cambia, se saca
-- el nodo "marcar_origen" y la etiqueta vuelve a ser manual.
--
-- El disparador es el primer mensaje entrante de la conversación. Ojo si algún
-- día se inician conversaciones desde la Bandeja con una plantilla: la primera
-- respuesta de esa persona también dispara la bienvenida.
--
-- Nada está hardcodeado: la cuenta es la única de la instancia y las etiquetas
-- se resuelven por nombre (las crea la 900).
--
-- También prende la beta de Flujos en los perfiles de la cuenta, que es lo que
-- muestra "Flujos" en el menú. El motor corre los flujos activos igual, con o
-- sin la beta; sin ella el flujo funcionaría pero no se podría ver ni editar.
--
-- Idempotente y no destructiva: si el flujo ya existe por nombre se actualiza
-- en el lugar y se reemplazan sus nodos, sin borrar la fila (borrarla se
-- llevaría el historial de corridas).

do $$
declare
  v_account uuid;
  v_user    uuid;
  v_flow    uuid;
  v_n       int;
  t_nuevo   uuid;
  t_ads     uuid;

  c_nombre constant text := 'Bienvenida';
  c_desc   constant text := 'Primer mensaje automático a quien escribe por primera vez. Marca Nuevo y origen_ads, saluda y deja la conversación en pendiente.';

  m_bienvenida constant text :=
    '¡Hola! Bienvenido a Star Energy Núñez. Ya recibimos tu mensaje y un asesor te va a responder por acá. Para ganar tiempo, ¿buscabas consultarnos por compra directa, financiación o querés agendar un test drive en el salón?';

  v_politica constant jsonb := jsonb_build_object(
    'on_unknown_reply', 'handoff',
    'max_reprompts', 0,
    'on_timeout_hours', 24,
    'on_timeout', jsonb_build_object('action', 'handoff'),
    'on_exhaust', 'handoff'
  );
begin
  -- ── preflight ────────────────────────────────────────────────────────────
  select count(*) into v_n from public.accounts;
  if v_n <> 1 then
    raise exception 'Se esperaba exactamente 1 cuenta y hay %. Frenar y revisar.', v_n;
  end if;

  select id into v_account from public.accounts;

  select user_id into v_user
  from public.profiles
  where account_id = v_account and account_role = 'owner'
  limit 1;

  if v_user is null then
    raise exception 'La cuenta % no tiene perfil owner.', v_account;
  end if;

  select id into t_nuevo from public.tags
  where account_id = v_account and lower(btrim(name)) = lower('Nuevo') and grupo = 'estado';
  select id into t_ads from public.tags
  where account_id = v_account and lower(btrim(name)) = lower('origen_ads');

  if t_nuevo is null or t_ads is null then
    raise exception 'Faltan las etiquetas "Nuevo" (estado) u "origen_ads" en la cuenta. Las crea la migración 900.';
  end if;

  select count(*) into v_n
  from public.flows
  where account_id = v_account
    and status = 'active'
    and trigger_type = 'first_inbound_message'
    and name <> c_nombre;
  if v_n > 0 then
    raise exception 'Ya hay otro flujo activo con disparador de primer mensaje (%). Dos a la vez se pisan: frenar y revisar.', v_n;
  end if;

  -- ── beta de Flujos (menú) ────────────────────────────────────────────────
  update public.profiles
     set beta_features = array(select distinct unnest(beta_features || array['flows']))
   where account_id = v_account
     and not ('flows' = any(beta_features));

  -- ── el flujo ─────────────────────────────────────────────────────────────
  select id into v_flow from public.flows
  where account_id = v_account and name = c_nombre
  limit 1;

  if v_flow is null then
    insert into public.flows (
      account_id, user_id, name, description, status,
      trigger_type, trigger_config, entry_node_id, fallback_policy
    ) values (
      v_account, v_user, c_nombre, c_desc, 'active',
      'first_inbound_message', '{}'::jsonb, 'inicio', v_politica
    ) returning id into v_flow;
  else
    update public.flows set
      user_id = v_user,
      description = c_desc,
      status = 'active',
      trigger_type = 'first_inbound_message',
      trigger_config = '{}'::jsonb,
      entry_node_id = 'inicio',
      fallback_policy = v_politica,
      updated_at = now()
    where id = v_flow;

    delete from public.flow_nodes where flow_id = v_flow;
  end if;

  -- ── los nodos ────────────────────────────────────────────────────────────
  insert into public.flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
  values
    (v_flow, 'inicio', 'start',
     jsonb_build_object('next_node_key', 'marcar_nuevo'), 0, 0),

    (v_flow, 'marcar_nuevo', 'set_tag',
     jsonb_build_object('mode', 'add', 'tag_id', t_nuevo, 'next_node_key', 'marcar_origen'),
     0, 120),

    (v_flow, 'marcar_origen', 'set_tag',
     jsonb_build_object('mode', 'add', 'tag_id', t_ads, 'next_node_key', 'bienvenida'),
     0, 240),

    (v_flow, 'bienvenida', 'send_message',
     jsonb_build_object('text', m_bienvenida, 'next_node_key', 'traspaso'),
     0, 360),

    (v_flow, 'traspaso', 'handoff',
     jsonb_build_object('note', 'Bienvenida automática enviada. Falta que responda un asesor.'),
     0, 480);

  select count(*) into v_n from public.flow_nodes where flow_id = v_flow;
  raise notice 'Flujo "%" cargado (% nodos).', c_nombre, v_n;
end
$$;

-- ── informe final ────────────────────────────────────────────────────────────
select
  f.name                                                             as flujo,
  f.status                                                           as estado,
  f.trigger_type                                                     as disparador,
  f.entry_node_id                                                    as entrada,
  (select count(*) from public.flow_nodes n where n.flow_id = f.id)::text as nodos,
  (select string_agg(n.node_key || ':' || n.node_type, ' > ' order by n.position_y)
     from public.flow_nodes n where n.flow_id = f.id)                as recorrido,
  (select count(*) from public.profiles p
    where p.account_id = f.account_id and 'flows' = any(p.beta_features))::text as perfiles_con_flujos
from public.flows f
order by f.created_at;
