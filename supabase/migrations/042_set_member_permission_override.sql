-- 042_set_member_permission_override.sql
--
-- Camino de escritura para los overrides granulares de la 041.
-- La UI de Miembros deja tildar permisos por persona, pero el RLS
-- de profiles (profiles_update, migración 017) solo permite
-- actualizar el PROPIO perfil, y ningún RPC de 018/019 escribe
-- permission_overrides — sin esto, el PATCH del dashboard no puede
-- guardar nada. Mismo patrón supervisado que set_member_role:
-- SECURITY DEFINER owned by postgres, autorización adentro.
--
-- Reglas:
--   - caller autenticado, admin+ y del mismo account que el target;
--   - la clave tiene que ser una de las 10 del motor (fail-closed);
--   - value true/false escribe el override; NULL lo borra (el
--     permiso vuelve al default del rol);
--   - los overrides del owner solo los toca el propio owner (un
--     admin no puede degradar al dueño de la cuenta);
--   - editarse a sí mismo está permitido: un admin no escala nada
--     que no controle ya, y el caso "me saqué un permiso por error"
--     se arregla solo re-tildando.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'permission_overrides'
  ) THEN
    RAISE EXCEPTION 'profiles.permission_overrides no existe: correr primero la migración 041';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_member_permission_override(
  p_user_id UUID,
  p_key TEXT,
  p_value BOOLEAN  -- NULL = quitar el override
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_key IS NULL OR p_key NOT IN (
    'view_all_data', 'can_export_contacts', 'nav_dashboard',
    'nav_notifications', 'nav_contacts', 'nav_pipelines',
    'nav_broadcasts', 'nav_automations', 'nav_flows', 'nav_ai_agents'
  ) THEN
    RAISE EXCEPTION 'Unknown permission key: %', COALESCE(p_key, '<null>')
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Un admin no puede recortarle permisos al owner.
  IF v_target_role = 'owner' AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the owner can edit the owner''s permissions'
      USING ERRCODE = '42501';
  END IF;

  IF p_value IS NULL THEN
    UPDATE profiles
    SET permission_overrides = permission_overrides - p_key
    WHERE user_id = p_user_id;
  ELSE
    UPDATE profiles
    SET permission_overrides =
      jsonb_set(permission_overrides, ARRAY[p_key], to_jsonb(p_value), true)
    WHERE user_id = p_user_id;
  END IF;
END;
$$;

ALTER FUNCTION public.set_member_permission_override(UUID, TEXT, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_permission_override(UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_permission_override(UUID, TEXT, BOOLEAN) TO authenticated;

SELECT 'set_member_permission_override existe' AS check_name,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_member_permission_override') AS ok;

COMMIT;
