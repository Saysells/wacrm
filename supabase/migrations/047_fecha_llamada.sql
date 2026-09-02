-- 047_fecha_llamada.sql
--
-- La fecha y hora de la llamada agendada vive en el contacto de la Bandeja
-- y viaja al CRM junto con la etiqueta de estado.
--
-- 1. contacts.fecha_llamada (timestamptz).
-- 2. tags.requiere_fecha: las etiquetas que al aplicarse piden fecha y hora
--    (Agendado a Paola, Agendado a Gustavo, Agendada, Reagendado).
-- 3. El aviso al CRM (trigger del puente) manda fecha_llamada.
-- 4. contact_tags y contacts entran en la publicacion de realtime, para que
--    la ficha se entere de un cambio hecho desde el CRM sin recargar.

BEGIN;

-- ---- 1. fecha en el contacto ----------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS fecha_llamada TIMESTAMPTZ;

-- ---- 2. etiquetas que piden fecha --------------------------------------------
ALTER TABLE tags ADD COLUMN IF NOT EXISTS requiere_fecha BOOLEAN NOT NULL DEFAULT false;

UPDATE tags SET requiere_fecha = true
WHERE grupo = 'estado'
  AND lower(btrim(name)) IN ('agendado a paola', 'agendado a gustavo', 'agendada', 'reagendado');

-- ---- 3. el aviso al CRM lleva la fecha ------------------------------------
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
      'fecha_llamada', v_contact.fecha_llamada,
      'origen', 'bandeja'
    ),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bridge-secret', v_cfg.secret),
    timeout_milliseconds := 8000
  );
  RETURN NEW;
END;
$$;

-- ---- 4. realtime ----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contact_tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contact_tags;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
  END IF;
END $$;

-- Realtime necesita identidad completa para mandar el DELETE con sus datos.
ALTER TABLE contact_tags REPLICA IDENTITY FULL;

-- ---- Verificacion -----------------------------------------------------------
SELECT 'contacts.fecha_llamada existe' AS check_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'fecha_llamada') AS ok
UNION ALL
SELECT 'cada cuenta tiene 4 etiquetas que piden fecha',
  NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE (SELECT COUNT(*) FROM tags WHERE account_id = a.id AND requiere_fecha) <> 4
  )
UNION ALL
SELECT 'contact_tags en realtime',
  EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'contact_tags')
UNION ALL
SELECT 'contacts en realtime',
  EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'contacts');

COMMIT;
