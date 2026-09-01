-- 045_puente_crm.sql
-- Puente bandeja → crm.saysells.com. Cuando a un contacto se le pone una
-- etiqueta etapa_*, la base le avisa a la Edge Function bandeja-webhook
-- del CRM (pg_net, asincronico). Config por cuenta en integracion_crm:
-- url, secreto compartido y a que cuenta del CRM corresponde.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS integracion_crm (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  cuenta_crm TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE integracion_crm ENABLE ROW LEVEL SECURITY;
-- Sin policies a proposito: solo la lee el trigger (SECURITY DEFINER). Nada desde el navegador.

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
  IF v_tag.name IS NULL OR v_tag.name NOT LIKE 'etapa\_%' THEN RETURN NEW; END IF;

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

SELECT 'pg_net habilitado' AS check_name, EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') AS ok
UNION ALL
SELECT 'integracion_crm existe', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'integracion_crm')
UNION ALL
SELECT 'trigger de aviso al CRM existe', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_crm_on_etapa_tag');

COMMIT;
