-- 900_etiquetas_saysells: etiquetas de estado y de origen de la Bandeja de Saysells
--
-- Espejo de las 13 etiquetas de estado de la Bandeja de Kosmo (las que el puente
-- con crm.saysells.com traduce a estados del embudo) más las dos de origen.
--
-- NO incluye las senal_* ni "WhatsApp Mati": esas son del bot de Kosmo. La
-- Bandeja de Saysells nace sin bot y su flujo propio se escribe después.
--
-- Idempotente: se puede correr dos veces sin duplicar.

do $$
declare
  v_account uuid;
  v_user    uuid;
  v_n       int;
begin
  -- ── preflight ─────────────────────────────────────────────────────────────
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

  -- ── etiquetas ─────────────────────────────────────────────────────────────
  -- El orden de inserción define el orden de creación, que es como la interfaz
  -- las lista. Van en el orden del embudo, no alfabético.
  insert into public.tags (name, color, grupo, requiere_fecha, account_id, user_id)
  select d.name, d.color, d.grupo, d.requiere_fecha, v_account, v_user
  from (values
    ('Nuevo',              '#3b82f6', 'estado', false),
    ('En gestión',         '#06b6d4', 'estado', false),
    ('No responde',        '#64748b', 'estado', false),
    ('Agendado a Paola',   '#8b5cf6', 'estado', true ),
    ('Agendado a Gustavo', '#8b5cf6', 'estado', true ),
    ('Agendada',           '#8b5cf6', 'estado', true ),
    ('No se presentó',     '#f43f5e', 'estado', false),
    ('Reagendado',         '#a855f7', 'estado', true ),
    ('Realizada',          '#f59e0b', 'estado', false),
    ('Propuesta',          '#f97316', 'estado', false),
    ('En negociación',     '#eab308', 'estado', false),
    ('Ganada',             '#10b981', 'estado', false),
    ('Perdido',            '#ef4444', 'estado', false),
    ('origen_form',        '#10b981', 'origen', false),
    ('origen_ads',         '#06b6d4', 'origen', false)
  ) as d(name, color, grupo, requiere_fecha)
  where not exists (
    select 1 from public.tags t
    where t.account_id = v_account and t.name = d.name
  );

  select count(*) into v_n from public.tags where account_id = v_account;
  raise notice 'Etiquetas en la cuenta: %', v_n;
end
$$;

-- ── informe final ───────────────────────────────────────────────────────────
select
  coalesce(grupo, 'sin grupo')                              as grupo,
  count(*)::text                                            as cuantas,
  string_agg(name || case when requiere_fecha then ' (fecha)' else '' end,
             ', ' order by created_at, name)                as etiquetas
from public.tags
group by 1
order by 1;
