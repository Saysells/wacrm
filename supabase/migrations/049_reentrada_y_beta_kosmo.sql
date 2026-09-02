-- ============================================================
-- 049_reentrada_y_beta_kosmo.sql
--
--   1. `accounts.agente_reentrada` — a quién se le asigna la
--      conversación cuando un contacto marcado "No responde" vuelve a
--      escribir.
--
--      Por qué una columna y no una constante en el código: el nombre
--      del setter es dato de la cuenta, no del producto. Cualquier otra
--      instalación de wacrm tiene otro setter, o ninguno — y con la
--      columna en NULL la regla igual devuelve la conversación a
--      pendiente, solo que sin dueño.
--
--   2. La beta de Flujos activada para la cuenta de Kosmo.
--
--   3. `agente_reentrada` apuntando a Matías en esa cuenta.
--
-- Cómo se identifica "la cuenta de Kosmo": es la cuenta a la que
-- pertenece el perfil `saysellsmatias@gmail.com`. Es el mismo dato que ya
-- usa el flujo del bot para las asignaciones, así que no se agrega una
-- segunda forma de nombrarla. Si ese perfil no existe, la migración
-- avisa y no toca nada — adivinar la cuenta podría prenderle una beta a
-- otro cliente.
--
-- Idempotente — se puede correr dos veces sin romper nada.
-- ============================================================

BEGIN;

-- ---- 1. accounts.agente_reentrada ------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS agente_reentrada UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN accounts.agente_reentrada IS
  'Agente que recibe la conversación cuando un contacto en "No responde" vuelve a escribir. NULL = queda pendiente sin asignar.';

-- ---- 2 y 3. Kosmo: beta de Flujos + agente de reentrada ---------------------
DO $$
DECLARE
  v_matias UUID;
  v_cuenta UUID;
BEGIN
  SELECT p.user_id, p.account_id INTO v_matias, v_cuenta
    FROM profiles p
   WHERE lower(p.email) = 'saysellsmatias@gmail.com'
   LIMIT 1;

  IF v_matias IS NULL OR v_cuenta IS NULL THEN
    RAISE NOTICE 'No hay perfil saysellsmatias@gmail.com con cuenta: no se activa la beta de Flujos ni el agente de reentrada.';
    RETURN;
  END IF;

  -- La beta es por perfil (migración 011), así que se prende para
  -- todos los miembros de la cuenta: si la ve solo uno, el resto del
  -- equipo no encuentra Flujos en el menú.
  UPDATE profiles
     SET beta_features = ARRAY(
           SELECT DISTINCT unnest(beta_features || ARRAY['flows'])
         )
   WHERE account_id = v_cuenta
     AND NOT ('flows' = ANY(beta_features));

  UPDATE accounts
     SET agente_reentrada = v_matias
   WHERE id = v_cuenta;

  RAISE NOTICE 'Flujos activado para la cuenta % y reentrada asignada a Matías.', v_cuenta;
END $$;

COMMIT;
