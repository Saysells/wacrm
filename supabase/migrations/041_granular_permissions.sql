-- 041_granular_permissions.sql
--
-- Permisos granulares por persona, pedidos por Eze: en vez de que
-- todo dependa del rol fijo (owner/admin/agent/viewer), cada perfil
-- puede tener overrides individuales que pisan el default del rol.
-- Si no se toca nada, el comportamiento de hoy sigue igual.
--
-- No reescribe las políticas RLS de la migración 040: les reemplaza
-- el motor de adentro (can_view_by_assignment ahora consulta
-- effective_permission en vez del rol a secas), así que conversations,
-- messages y contacts heredan el cambio sin tocarlas.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_role_enum') THEN
    RAISE EXCEPTION 'account_role_enum no existe, no es el esquema esperado';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'account_role'
  ) THEN
    RAISE EXCEPTION 'profiles.account_role no existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_view_by_assignment') THEN
    RAISE EXCEPTION 'can_view_by_assignment no existe: correr primero la migracion 040';
  END IF;
END $$;

-- Overrides por persona. Ausente = usa el default del rol.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS permission_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- Resuelve un permiso: override explícito primero, si no, el
-- default según rol. IMMUTABLE: solo depende de sus argumentos,
-- no lee tablas. Claves desconocidas caen en false (fail-closed).
--
-- Claves: view_all_data, can_export_contacts, nav_dashboard,
-- nav_notifications, nav_contacts, nav_pipelines, nav_broadcasts,
-- nav_automations, nav_flows, nav_ai_agents.
-- ============================================================
CREATE OR REPLACE FUNCTION effective_permission(
  target_role account_role_enum,
  overrides JSONB,
  perm_key TEXT
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    (overrides ->> perm_key)::boolean,
    CASE perm_key
      WHEN 'view_all_data'       THEN target_role IN ('owner', 'admin', 'viewer')
      WHEN 'can_export_contacts' THEN target_role IN ('owner', 'admin')
      WHEN 'nav_dashboard'       THEN target_role IN ('owner', 'admin', 'viewer')
      WHEN 'nav_notifications'   THEN true
      WHEN 'nav_contacts'        THEN true
      WHEN 'nav_pipelines'       THEN target_role IN ('owner', 'admin', 'viewer')
      WHEN 'nav_broadcasts'      THEN target_role IN ('owner', 'admin', 'viewer')
      WHEN 'nav_automations'     THEN target_role IN ('owner', 'admin', 'viewer')
      WHEN 'nav_flows'           THEN target_role IN ('owner', 'admin', 'viewer')
      WHEN 'nav_ai_agents'       THEN target_role IN ('owner', 'admin', 'viewer')
      ELSE false
    END
  );
$$;

ALTER FUNCTION effective_permission(account_role_enum, JSONB, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION effective_permission(account_role_enum, JSONB, TEXT) TO authenticated, service_role;

-- Mismo nombre y firma que la 040: las policies que ya la llaman
-- (conversations_select, messages_select, messages_modify,
-- contacts_select) quedan actualizadas solas.
CREATE OR REPLACE FUNCTION can_view_by_assignment(
  target_account_id UUID,
  row_assigned_agent_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND (
        effective_permission(p.account_role, p.permission_overrides, 'view_all_data')
        OR row_assigned_agent_id IS NULL
        OR row_assigned_agent_id = auth.uid()
      )
  );
$$;

SELECT 'permission_overrides existe' AS check_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'permission_overrides') AS ok
UNION ALL
SELECT 'agent sin override no ve nav_dashboard',
  effective_permission('agent', '{}'::jsonb, 'nav_dashboard') = false
UNION ALL
SELECT 'agent con override ve nav_dashboard',
  effective_permission('agent', '{"nav_dashboard": true}'::jsonb, 'nav_dashboard') = true
UNION ALL
SELECT 'agent siempre ve contactos',
  effective_permission('agent', '{}'::jsonb, 'nav_contacts') = true
UNION ALL
SELECT 'admin ve todo por default',
  effective_permission('admin', '{}'::jsonb, 'view_all_data') = true
UNION ALL
SELECT 'admin puede perder view_all_data con override',
  effective_permission('admin', '{"view_all_data": false}'::jsonb, 'view_all_data') = false
UNION ALL
SELECT 'clave desconocida cae en false',
  effective_permission('owner', '{}'::jsonb, 'clave_inventada') = false;

COMMIT;
