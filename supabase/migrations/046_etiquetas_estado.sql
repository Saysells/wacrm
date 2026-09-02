-- 046_etiquetas_estado.sql
--
-- Las etiquetas de estado dejan de llamarse etapa_* y pasan a tener nombre
-- humano ("En gestión", "Agendado a Paola"). Para que la base siga sabiendo
-- cuales son "de estado" sin depender del nombre, tags gana la columna
-- `grupo`: 'estado' | 'origen' | 'senal' | null.
--
-- 1. tags.grupo.
-- 2. Renombrar etapa_* -> nombre humano y marcar grupo='estado' (por cuenta).
-- 3. Crear las etiquetas nuevas del proceso setter/comercial (por cuenta).
-- 4. origen_* -> grupo 'origen'; senal_* -> grupo 'senal' (nombre sin tocar,
--    son del bot de Kosmo).
-- 5. Etapa unica por contacto: ahora por grupo='estado'.
-- 6. Aviso al CRM (puente): ahora por grupo='estado', manda el nombre tal cual.
--
-- Orden importante: los movimientos de datos van ANTES de reescribir los
-- triggers, asi ningun insert de esta migracion dispara avisos al CRM.

BEGIN;

-- ---- 1. grupo ---------------------------------------------------------------
ALTER TABLE tags ADD COLUMN IF NOT EXISTS grupo TEXT;
ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_grupo_check;
ALTER TABLE tags ADD CONSTRAINT tags_grupo_check
  CHECK (grupo IS NULL OR grupo IN ('estado', 'origen', 'senal'));

-- ---- 2 y 3. Renombrar y crear, por cuenta ----------------------------------
DO $$
DECLARE
  cta RECORD;
  par RECORD;
  v_owner UUID;
  v_old UUID;
  v_new UUID;
BEGIN
  FOR cta IN SELECT id FROM accounts LOOP
    SELECT p.user_id INTO v_owner
      FROM profiles p WHERE p.account_id = cta.id AND p.account_role = 'owner'
      LIMIT 1;
    IF v_owner IS NULL THEN
      RAISE NOTICE 'Cuenta % sin owner, se saltea', cta.id;
      CONTINUE;
    END IF;

    -- (viejo, nuevo, color). viejo NULL = etiqueta nueva sin antecesor.
    FOR par IN
      SELECT * FROM (VALUES
        ('etapa_nuevo',          'Nuevo',              '#3b82f6'),
        ('etapa_contactado',     'En gestión',         '#06b6d4'),
        (NULL,                   'No responde',        '#64748b'),
        (NULL,                   'Agendado a Paola',   '#8b5cf6'),
        (NULL,                   'Agendado a Gustavo', '#8b5cf6'),
        ('etapa_ll1_agendada',   'Agendada',           '#8b5cf6'),
        (NULL,                   'No se presentó',     '#f43f5e'),
        (NULL,                   'Reagendado',         '#a855f7'),
        ('etapa_ll1_realizada',  'Realizada',          '#f59e0b'),
        ('etapa_propuesta_ll2',  'Propuesta',          '#f97316'),
        (NULL,                   'En negociación',     '#eab308'),
        ('etapa_ganado',         'Ganada',             '#10b981'),
        ('etapa_perdido',        'Perdido',            '#ef4444')
      ) AS t(viejo, nuevo, color)
    LOOP
      SELECT id INTO v_old FROM tags
        WHERE account_id = cta.id AND par.viejo IS NOT NULL
          AND lower(btrim(name)) = par.viejo LIMIT 1;
      SELECT id INTO v_new FROM tags
        WHERE account_id = cta.id AND lower(btrim(name)) = lower(par.nuevo) LIMIT 1;

      IF v_old IS NOT NULL AND v_new IS NULL THEN
        -- Renombrar en el lugar: no toca contact_tags.
        UPDATE tags SET name = par.nuevo, grupo = 'estado' WHERE id = v_old;
      ELSIF v_old IS NOT NULL AND v_new IS NOT NULL THEN
        -- Ya existia el nombre humano: se mueven los contactos y se borra el viejo.
        INSERT INTO contact_tags (contact_id, tag_id)
          SELECT contact_id, v_new FROM contact_tags WHERE tag_id = v_old
          ON CONFLICT (contact_id, tag_id) DO NOTHING;
        DELETE FROM tags WHERE id = v_old;
        UPDATE tags SET grupo = 'estado' WHERE id = v_new;
      ELSIF v_new IS NOT NULL THEN
        UPDATE tags SET grupo = 'estado' WHERE id = v_new;
      ELSE
        INSERT INTO tags (user_id, account_id, name, color, grupo)
        VALUES (v_owner, cta.id, par.nuevo, par.color, 'estado');
      END IF;

      v_old := NULL; v_new := NULL;
    END LOOP;
  END LOOP;
END $$;

-- ---- 4. Los demas grupos -----------------------------------------------------
UPDATE tags SET grupo = 'origen' WHERE grupo IS NULL AND lower(btrim(name)) LIKE 'origen\_%';
UPDATE tags SET grupo = 'senal'  WHERE grupo IS NULL AND lower(btrim(name)) LIKE 'senal\_%';

-- ---- 5. Una etapa a la vez, por grupo ---------------------------------------
CREATE OR REPLACE FUNCTION enforce_single_etapa_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE es_estado BOOLEAN;
BEGIN
  SELECT (grupo = 'estado') INTO es_estado FROM tags WHERE id = NEW.tag_id;
  IF COALESCE(es_estado, false) THEN
    DELETE FROM contact_tags ct
    USING tags t
    WHERE ct.contact_id = NEW.contact_id
      AND ct.tag_id = t.id
      AND ct.tag_id <> NEW.tag_id
      AND t.grupo = 'estado';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_single_etapa_tag ON contact_tags;
CREATE TRIGGER trg_single_etapa_tag
  AFTER INSERT ON contact_tags
  FOR EACH ROW EXECUTE FUNCTION enforce_single_etapa_tag();

-- ---- 6. Aviso al CRM, por grupo ---------------------------------------------
CREATE OR REPLACE FUNCTION notify_crm_on_etapa_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tag tags%ROWTYPE;
  v_contact contacts%ROWTYPE;
  v_cfg integracion_crm%ROWTYPE;
  v_conv_id UUID;
BEGIN
  SELECT * INTO v_tag FROM tags WHERE id = NEW.tag_id;
  IF v_tag.id IS NULL OR COALESCE(v_tag.grupo, '') <> 'estado' THEN RETURN NEW; END IF;

  SELECT * INTO v_contact FROM contacts WHERE id = NEW.contact_id;
  SELECT * INTO v_cfg FROM integracion_crm WHERE account_id = v_contact.account_id AND activo;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT id INTO v_conv_id FROM conversations
  WHERE contact_id = v_contact.id AND account_id = v_contact.account_id
  ORDER BY updated_at DESC NULLS LAST LIMIT 1;

  PERFORM net.http_post(
    url := v_cfg.url,
    body := jsonb_build_object(
      'cuenta', v_cfg.cuenta_crm,
      'telefono', v_contact.phone,
      'etapa', v_tag.name,
      'nombre', v_contact.name,
      'contacto_id', v_contact.id::text,
      'conversacion_id', v_conv_id::text,
      'origen', 'bandeja'
    ),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bridge-secret', v_cfg.secret),
    timeout_milliseconds := 8000
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_crm_on_etapa_tag ON contact_tags;
CREATE TRIGGER trg_notify_crm_on_etapa_tag
  AFTER INSERT ON contact_tags
  FOR EACH ROW EXECUTE FUNCTION notify_crm_on_etapa_tag();

-- ---- Verificacion -----------------------------------------------------------
SELECT 'tags.grupo existe' AS check_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tags' AND column_name = 'grupo') AS ok
UNION ALL
SELECT 'cada cuenta tiene las 13 etiquetas de estado',
  NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE (SELECT COUNT(*) FROM tags WHERE account_id = a.id AND grupo = 'estado') <> 13
  )
UNION ALL
SELECT 'no queda ninguna etapa_*',
  NOT EXISTS (SELECT 1 FROM tags WHERE lower(name) LIKE 'etapa\_%')
UNION ALL
SELECT 'ningun contacto con mas de una etiqueta de estado',
  NOT EXISTS (
    SELECT ct.contact_id FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
    WHERE t.grupo = 'estado' GROUP BY ct.contact_id HAVING COUNT(*) > 1
  );

COMMIT;
