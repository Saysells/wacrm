-- 900_etiquetas_starenergy: etiquetas de arranque de la Bandeja de Star Energy
--
-- Set corto, decidido por Emi el 09/10/2026:
--
--   · 5 de estado, con nombres del embudo estándar. El orden del embudo está
--     fijo en el frontend (ESTADO_FUNNEL, src/lib/contacts/tag-groups.ts): un
--     estado con nombre propio quedaría al final y fuera de orden. Por eso lo
--     propio del concesionario va como etiqueta simple y no como estado.
--   · 4 simples (sin grupo): las tres intenciones que pregunta el primer
--     mensaje automático y "Derivado", para lo que Joel pasa a su WhatsApp.
--   · 1 de origen: origen_ads, las consultas que llegan por la campaña.
--
-- Ninguna pide fecha: el modal de fecha del producto dice "Fecha y hora de la
-- llamada" y acá no hay llamadas.
--
-- Esta instancia no tiene puente con el CRM: sin fila en integracion_crm, el
-- trigger de aviso (046/047) sale sin hacer nada.
--
-- Idempotente: se puede correr dos veces sin duplicar.

do $$
declare
  v_account uuid;
  v_user    uuid;
  v_n       int;
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

  -- ── etiquetas ────────────────────────────────────────────────────────────
  -- Configuración → Etiquetas las lista por fecha de creación. Un insert de
  -- varias filas les pone a todas la misma, así que cada una lleva un
  -- milisegundo más que la anterior: el listado sale en este orden y no al azar.
  insert into public.tags (name, color, grupo, requiere_fecha, account_id, user_id, created_at)
  select d.name, d.color, d.grupo, false, v_account, v_user,
         now() + (d.orden * interval '1 millisecond')
  from (values
    (1,  'Nuevo',          '#3b82f6', 'estado'),
    (2,  'En gestión',     '#06b6d4', 'estado'),
    (3,  'No responde',    '#64748b', 'estado'),
    (4,  'Ganada',         '#10b981', 'estado'),
    (5,  'Perdido',        '#ef4444', 'estado'),
    (6,  'Compra directa', '#f59e0b', null),
    (7,  'Financiación',   '#8b5cf6', null),
    (8,  'Test drive',     '#f97316', null),
    (9,  'Derivado',       '#14b8a6', null),
    (10, 'origen_ads',     '#06b6d4', 'origen')
  ) as d(orden, name, color, grupo)
  where not exists (
    select 1 from public.tags t
    where t.account_id = v_account and lower(btrim(t.name)) = lower(btrim(d.name))
  )
  order by d.orden;

  select count(*) into v_n from public.tags where account_id = v_account;
  raise notice 'Etiquetas en la cuenta: %', v_n;
end
$$;

-- ── informe final ────────────────────────────────────────────────────────────
select
  coalesce(grupo, 'simples')                                as grupo,
  count(*)::text                                            as cuantas,
  string_agg(name, ', ' order by created_at, name)          as etiquetas
from public.tags
group by 1
order by 1;
