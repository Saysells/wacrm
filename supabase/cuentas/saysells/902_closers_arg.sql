-- 902_closers_arg: closers de la Bandeja de Saysells ARG
-- (rediseño de la Bandeja, decisión 8 del 12/10/2026; aplicada el 13/10/2026)
--
-- 1. "Agendado a Paola" pasa a "Agendado a Ezequiel" y "Agendado a Gustavo" a
--    "Agendado a Manuel". Se renombran en el lugar: conservan id, color, grupo
--    'estado', requiere_fecha y su posición en el embudo. Si la vieja no está y
--    la nueva tampoco, se crea; si están las dos y la vieja no tiene contactos,
--    se borra la vieja; si la vieja tiene contactos, frena.
-- 2. Manuel (manuel@saysells.com) recibe "ver todos los datos"
--    (permission_overrides.view_all_data = true). Un agente solo ve las
--    conversaciones sin tomar o suyas, y la llamada que le agenda Matías queda
--    en la conversación del setter: con esto la ve en Mis llamadas.
--
-- Del lado del CRM, las filas de bridge_etapas van en la migración
-- "closers_bandeja_saysells" del repo del CRM (mismo ajuste, 13/10/2026).
--
-- Idempotente: se puede correr dos veces. Preflight que aborta. Informe final.

do $$
declare
  v_account uuid;
  v_owner   uuid;
  v_manuel  uuid;
  v_n       int;
  v_usadas  int;
  v_old     uuid;
  v_new     uuid;
  par       record;
begin
  -- ── preflight ─────────────────────────────────────────────────────────────
  select count(*) into v_n from public.accounts;
  if v_n <> 1 then
    raise exception 'Se esperaba exactamente 1 cuenta y hay %. Frenar y revisar.', v_n;
  end if;
  select id into v_account from public.accounts;

  select user_id into v_owner
    from public.profiles
   where account_id = v_account and account_role = 'owner'
   limit 1;
  if v_owner is null then
    raise exception 'La cuenta % no tiene perfil owner.', v_account;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tags' and column_name = 'requiere_fecha'
  ) then
    raise exception 'tags.requiere_fecha no existe: faltan las migraciones 046 y 047.';
  end if;

  select p.user_id into v_manuel
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where p.account_id = v_account and lower(u.email) = 'manuel@saysells.com'
   limit 1;
  if v_manuel is null then
    raise exception 'manuel@saysells.com no está en la cuenta. Correr antes arg-usuarios-v1.mjs.';
  end if;

  -- ── 1. etiquetas ──────────────────────────────────────────────────────────
  for par in
    select * from (values
      ('Agendado a Paola',   'Agendado a Ezequiel'),
      ('Agendado a Gustavo', 'Agendado a Manuel')
    ) as t(viejo, nuevo)
  loop
    select id into v_old from public.tags
     where account_id = v_account and lower(btrim(name)) = lower(par.viejo) limit 1;
    select id into v_new from public.tags
     where account_id = v_account and lower(btrim(name)) = lower(par.nuevo) limit 1;

    if v_new is not null then
      if v_old is not null then
        select count(*) into v_usadas from public.contact_tags where tag_id = v_old;
        if v_usadas > 0 then
          raise exception '"%" y "%" existen las dos y la vieja tiene % contacto(s). Decidir a mano.',
            par.viejo, par.nuevo, v_usadas;
        end if;
        delete from public.tags where id = v_old;
        raise notice '"%" ya existía; "%" no tenía contactos y se borró.', par.nuevo, par.viejo;
      else
        raise notice '"%" ya existía: sin cambios.', par.nuevo;
      end if;
    elsif v_old is not null then
      update public.tags
         set name = par.nuevo, grupo = 'estado', requiere_fecha = true
       where id = v_old;
      raise notice '"%" pasó a "%" (misma etiqueta, mismo lugar en el embudo).', par.viejo, par.nuevo;
    else
      insert into public.tags (name, color, grupo, requiere_fecha, account_id, user_id)
      values (par.nuevo, '#8b5cf6', 'estado', true, v_account, v_owner);
      raise notice 'No estaba "%": se creó "%".', par.viejo, par.nuevo;
    end if;
  end loop;

  -- ── 2. permiso de Manuel ──────────────────────────────────────────────────
  update public.profiles
     set permission_overrides = coalesce(permission_overrides, '{}'::jsonb)
                                || '{"view_all_data": true}'::jsonb
   where user_id = v_manuel
     and coalesce(permission_overrides ->> 'view_all_data', '') <> 'true';
  get diagnostics v_n = row_count;
  if v_n = 1 then
    raise notice 'Manuel: view_all_data = true.';
  else
    raise notice 'Manuel ya tenía view_all_data = true.';
  end if;
end
$$;

-- ── informe final ───────────────────────────────────────────────────────────
select 'etiquetas de estado (orden del embudo)' as que,
       string_agg(name || case when requiere_fecha then ' (fecha)' else '' end,
                  ', ' order by created_at, name) as valor
  from public.tags
 where grupo = 'estado'
union all
select 'quedan Paola o Gustavo',
       count(*)::text || ' (tiene que ser 0)'
  from public.tags
 where lower(btrim(name)) in ('agendado a paola', 'agendado a gustavo')
union all
select 'closers que la Bandeja reconoce',
       coalesce(string_agg(substr(name, length('Agendado a ') + 1), ', ' order by created_at), '(ninguno)')
  from public.tags
 where grupo = 'estado' and name like 'Agendado a %'
union all
select 'Manuel · overrides',
       coalesce(p.permission_overrides::text, '{}')
  from public.profiles p
  join auth.users u on u.id = p.user_id
 where lower(u.email) = 'manuel@saysells.com';
