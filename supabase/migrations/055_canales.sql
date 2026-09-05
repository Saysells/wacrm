-- ============================================================
-- 055_canales.sql  ·  producto
--
-- El modelo de canal, para que la Bandeja deje de ser solo de WhatsApp.
-- Primera migración de producto después de la separación por cuenta: los
-- números 050 a 054 quedaron quemados por Kosmo y no se reutilizan.
--
-- Esto NO conecta Instagram. Solo prepara el modelo para que la interfaz
-- pueda mostrar el canal, filtrar por canal y tener la pestaña de Instagram
-- visible y apagada. El webhook y el envío vienen después, cuando la sonda
-- de permisos de Meta diga que se puede.
--
-- ── Las tres decisiones, con su razón ────────────────────────────────────
--
-- 1. El canal vive en `conversations`, NO en `messages`. Un mensaje pertenece
--    a una conversación y la conversación ya sabe por dónde entró; repetirlo
--    en cada mensaje solo abre la puerta a que queden inconsistentes.
--
-- 2. En `contacts` no va un canal: va un identificador nuevo, `ig_id`. El
--    contacto es la persona, no el canal por el que llegó. La misma persona
--    puede tener teléfono e Instagram, y entonces es un solo contacto con dos
--    conversaciones.
--
-- 3. `idx_conversations_account_contact` es único por (cuenta, contacto), así
--    que hoy la misma persona no podría tener una conversación de WhatsApp y
--    otra de Instagram a la vez. El canal entra en ese índice.
--
-- Idempotente.
-- ============================================================

-- ── preflight ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'conversations') then
    raise exception 'No existe public.conversations. Esta migración no va acá.';
  end if;
end $$;

-- ============================================================
-- 1. El canal de la conversación
-- ============================================================
alter table public.conversations
  add column if not exists channel text not null default 'whatsapp';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_channel_check') then
    alter table public.conversations
      add constraint conversations_channel_check
      check (channel in ('whatsapp', 'instagram'));
  end if;
end $$;

comment on column public.conversations.channel is
  'Canal por el que entró la conversación. El default whatsapp deja intactas las existentes.';

-- ── el índice único, ahora con el canal ─────────────────────────────────────
-- Se crea el nuevo antes de borrar el viejo: si por lo que sea hubiera un
-- duplicado, la migración falla sin haber dejado la tabla sin protección.
create unique index if not exists idx_conversations_account_contact_channel
  on public.conversations (account_id, contact_id, channel);

drop index if exists public.idx_conversations_account_contact;

-- ── índice para filtrar la bandeja por canal ────────────────────────────────
create index if not exists idx_conversations_account_channel
  on public.conversations (account_id, channel);

-- ============================================================
-- 2. El identificador de Instagram del contacto
-- ============================================================
alter table public.contacts
  add column if not exists ig_id text;

comment on column public.contacts.ig_id is
  'IGSID del contacto en Instagram. Nulo mientras el contacto sea solo de WhatsApp.';

-- Un contacto de Instagram no tiene teléfono, así que `phone` deja de ser
-- obligatorio. A cambio, la fila tiene que tener al menos uno de los dos:
-- un contacto sin teléfono y sin IGSID no es alcanzable por ningún canal.
alter table public.contacts alter column phone drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_alcanzable') then
    alter table public.contacts
      add constraint contacts_alcanzable
      check (phone is not null or ig_id is not null);
  end if;
end $$;

create unique index if not exists idx_contacts_account_ig_id
  on public.contacts (account_id, ig_id) where ig_id is not null;

-- ============================================================
-- 3. Qué canales tiene prendidos cada cuenta
-- ============================================================
-- Sin esto la pestaña de Instagram sería una decisión escrita en el frontend.
-- Acá cada cuenta decide: en Saysells se va a usar, en Kosmo aparece apagada.
create table if not exists public.account_channels (
  account_id uuid not null references public.accounts(id) on delete cascade,
  channel    text not null check (channel in ('whatsapp', 'instagram')),
  enabled    boolean not null default false,
  config     jsonb   not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, channel)
);

comment on table public.account_channels is
  'Qué canales tiene habilitados cada cuenta. La interfaz muestra el canal si hay fila; lo deja usable si enabled.';

alter table public.account_channels enable row level security;

-- Mismo patrón que `tags`: lee cualquier miembro, escribe solo admin.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'account_channels'
                    and policyname = 'account_channels_select') then
    create policy account_channels_select on public.account_channels
      for select using (is_account_member(account_id));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'account_channels'
                    and policyname = 'account_channels_insert') then
    create policy account_channels_insert on public.account_channels
      for insert with check (is_account_member(account_id, 'admin'::account_role_enum));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'account_channels'
                    and policyname = 'account_channels_update') then
    create policy account_channels_update on public.account_channels
      for update using (is_account_member(account_id, 'admin'::account_role_enum));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'account_channels'
                    and policyname = 'account_channels_delete') then
    create policy account_channels_delete on public.account_channels
      for delete using (is_account_member(account_id, 'admin'::account_role_enum));
  end if;
end $$;

-- ── siembra: WhatsApp prendido, Instagram apagado ───────────────────────────
-- Instagram entra con fila para que la pestaña exista y se vea apagada, que es
-- justo lo pedido. Se prende cambiando `enabled`, sin tocar código.
insert into public.account_channels (account_id, channel, enabled)
select a.id, c.channel, c.enabled
from public.accounts a
cross join (values ('whatsapp', true), ('instagram', false)) as c(channel, enabled)
on conflict (account_id, channel) do nothing;

-- ============================================================
-- Verificación
-- ============================================================
select 'modelo de canal listo' as check_name,
       (
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'conversations'
             and column_name = 'channel') = 1
         and (select count(*) from information_schema.columns
               where table_schema = 'public' and table_name = 'contacts'
                 and column_name = 'ig_id') = 1
         and (select count(*) from pg_indexes
               where schemaname = 'public'
                 and indexname = 'idx_conversations_account_contact_channel') = 1
         and (select count(*) from pg_indexes
               where schemaname = 'public'
                 and indexname = 'idx_conversations_account_contact') = 0
         and (select count(*) from pg_policies
               where schemaname = 'public' and tablename = 'account_channels') = 4
       ) as ok,
       (select string_agg(a.name || ': ' || ac.channel ||
                          case when ac.enabled then ' (prendido)' else ' (apagado)' end,
                          ' · ' order by a.name, ac.channel)
          from public.account_channels ac
          join public.accounts a on a.id = ac.account_id) as detalle;
