-- 901_asignacion_matias: toda consulta nueva de la Bandeja USA entra asignada a Matías
--
-- Cuando alguien le escribe al número por primera vez, la Bandeja deja la
-- conversación en pendiente y asignada a Matías (saysellsmatias@gmail.com).
-- No manda ningún mensaje: la bienvenida todavía no está definida. Cuando se
-- defina, va en una migración posterior que reemplaza los nodos de este mismo
-- flujo y agrega el mensaje antes del traspaso.
--
-- Matías es agente: ve las conversaciones asignadas a él y las que no tienen
-- a nadie. Como todas entran asignadas a él, en la práctica ve solo las suyas.
-- Si un administrador (Ezequiel) se asigna una a mano, Matías deja de verla.
-- Responder no reasigna: los administradores contestan sin quedarse con la
-- conversación (src/lib/inbox/auto-assign.ts).
--
-- El disparador es el primer mensaje entrante de la conversación. Ojo si algún
-- día se inician conversaciones desde la Bandeja con una plantilla: la primera
-- respuesta de esa persona también dispara el flujo.
--
-- Nada está hardcodeado salvo el mail de Matías: la cuenta es la única de la
-- instancia y su usuario se resuelve por mail. Los usuarios los crea
-- usa-usuarios-v1.mjs antes de esta migración.
--
-- También prende la beta de Flujos en el propietario y los administradores,
-- que es lo que muestra "Flujos" en el menú. El motor corre los flujos activos
-- igual, con o sin la beta. Los agentes no ven Flujos por permiso.
--
-- Idempotente y no destructiva: si el flujo ya existe por nombre se actualiza
-- en el lugar y se reemplazan sus nodos, sin borrar la fila (borrarla se
-- llevaría el historial de corridas).

do $$
declare
  v_account uuid;
  v_user    uuid;
  v_matias  uuid;
  v_flow    uuid;
  v_n       int;

  c_nombre constant text := 'Asignación a Matías';
  c_desc   constant text := 'Toda consulta nueva entra en pendiente y asignada a Matías. Sin mensaje automático: la bienvenida se suma cuando esté definida.';
  c_mail_matias constant text := 'saysellsmatias@gmail.com';

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

  select p.user_id into v_matias
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where lower(u.email) = c_mail_matias
    and p.account_id = v_account
    and p.account_role = 'agent';

  if v_matias is null then
    raise exception 'No encuentro a Matías (%) como agente de la cuenta. Correr antes usa-usuarios-v1.mjs.', c_mail_matias;
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
     and account_role in ('owner', 'admin')
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
     jsonb_build_object('next_node_key', 'asignar_matias'), 0, 0),

    (v_flow, 'asignar_matias', 'handoff',
     jsonb_build_object(
       'assign_to', v_matias,
       'note', 'Consulta nueva. Asignada a Matías.'
     ),
     0, 120);

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
  (select u.email from public.flow_nodes n
     join auth.users u on u.id::text = n.config->>'assign_to'
    where n.flow_id = f.id and n.node_type = 'handoff')              as asigna_a,
  (select count(*) from public.profiles p
    where p.account_id = f.account_id and 'flows' = any(p.beta_features))::text as perfiles_con_flujos
from public.flows f
order by f.created_at;
