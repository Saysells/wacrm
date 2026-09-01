-- 044_etapas_y_senales.sql
--
-- 1. Unique de nombre de campo personalizado por cuenta (pendiente de la
--    sesion de Tally, mismo criterio que la 043 para etiquetas).
-- 2. Etiquetas creadas por codigo en todas las cuentas:
--    etapa_*  = espejo exacto de los 7 estados del pipeline de
--               crm.saysells.com (una sola a la vez por contacto).
--    senal_*  = señales del bot de Kosmo, libres.
--    origen_ads (origen_form ya existe).
-- 3. Regla en la base: al poner una etapa_* a un contacto, se sacan las
--    otras etapa_* que tuviera. Aplica a UI, API, automatizaciones y al
--    puente con el CRM por igual.

BEGIN;

-- ---- 1. custom_fields: unique por cuenta, case/espacios insensible ----
DO $$
DECLARE dup_count INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'custom_fields' AND column_name = 'account_id'
  ) THEN
    RAISE EXCEPTION 'custom_fields.account_id no existe, no es el esquema esperado';
  END IF;

  SELECT COUNT(*) INTO dup_count FROM (
    SELECT account_id, lower(btrim(field_name))
    FROM custom_fields
    GROUP BY account_id, lower(btrim(field_name))
    HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Hay % nombre(s) de campo duplicados por cuenta. Diagnostico: SELECT account_id, field_name, COUNT(*) FROM custom_fields GROUP BY account_id, lower(btrim(field_name)), field_name HAVING COUNT(*) > 1;', dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_fields_account_name_unique
  ON custom_fields (account_id, lower(btrim(field_name)));

-- ---- 2. Etiquetas por codigo, en todas las cuentas ----
-- user_id: el owner de cada cuenta (tags.user_id es NOT NULL).
INSERT INTO tags (user_id, account_id, name, color)
SELECT p.user_id, a.id, t.name, t.color
FROM accounts a
JOIN profiles p ON p.account_id = a.id AND p.account_role = 'owner'
CROSS JOIN (VALUES
  ('etapa_nuevo',           '#3b82f6'),
  ('etapa_contactado',      '#06b6d4'),
  ('etapa_ll1_agendada',    '#8b5cf6'),
  ('etapa_ll1_realizada',   '#f59e0b'),
  ('etapa_propuesta_ll2',   '#f97316'),
  ('etapa_ganado',          '#10b981'),
  ('etapa_perdido',         '#ef4444'),
  ('senal_prefiere_chat',   '#64748b'),
  ('senal_lead_grande',     '#64748b'),
  ('senal_recompra',        '#64748b'),
  ('senal_consumidor_final','#64748b'),
  ('senal_fuera_de_alcance','#64748b'),
  ('senal_bot_fallo',       '#64748b'),
  ('senal_nurture',         '#64748b'),
  ('origen_ads',            '#06b6d4')
) AS t(name, color)
WHERE NOT EXISTS (
  SELECT 1 FROM tags x
  WHERE x.account_id = a.id AND lower(btrim(x.name)) = t.name
);

-- ---- 3. Una etapa a la vez, en la base ----
CREATE OR REPLACE FUNCTION enforce_single_etapa_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE es_etapa BOOLEAN;
BEGIN
  SELECT (name LIKE 'etapa\_%') INTO es_etapa FROM tags WHERE id = NEW.tag_id;
  IF es_etapa THEN
    DELETE FROM contact_tags ct
    USING tags t
    WHERE ct.contact_id = NEW.contact_id
      AND ct.tag_id = t.id
      AND ct.tag_id <> NEW.tag_id
      AND t.name LIKE 'etapa\_%';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_single_etapa_tag ON contact_tags;
CREATE TRIGGER trg_single_etapa_tag
  AFTER INSERT ON contact_tags
  FOR EACH ROW EXECUTE FUNCTION enforce_single_etapa_tag();

-- ---- Verificacion ----
SELECT 'unique de custom_fields existe' AS check_name,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_custom_fields_account_name_unique') AS ok
UNION ALL
SELECT 'cada cuenta tiene las 7 etapas',
  NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE (SELECT COUNT(*) FROM tags WHERE account_id = a.id AND name LIKE 'etapa\_%') <> 7
  )
UNION ALL
SELECT 'trigger de etapa unica existe',
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_single_etapa_tag');

COMMIT;
