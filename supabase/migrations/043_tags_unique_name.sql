-- 043_tags_unique_name.sql
--
-- Cierra la carrera de "crear etiqueta" del popover de la Bandeja: hoy la
-- validacion de nombre duplicado es solo en memoria contra lo que ya cargo
-- el navegador. Si dos personas crean la misma etiqueta al mismo tiempo,
-- pueden quedar dos filas. La normalizacion coincide con el cliente
-- (src/lib/inbox/contact-tags.ts): trim + lowercase, por cuenta.

BEGIN;

DO $$
DECLARE
  dup_count INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tags' AND column_name = 'account_id'
  ) THEN
    RAISE EXCEPTION 'tags.account_id no existe, no es el esquema esperado';
  END IF;

  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT account_id, lower(btrim(name))
    FROM tags
    GROUP BY account_id, lower(btrim(name))
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Hay % nombre(s) de etiqueta duplicados por cuenta ya en la base. Diagnostico: SELECT account_id, name, COUNT(*) FROM tags GROUP BY account_id, lower(btrim(name)), name HAVING COUNT(*) > 1;', dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_account_name_unique
  ON tags (account_id, lower(btrim(name)));

SELECT 'idx_tags_account_name_unique existe' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_tags_account_name_unique'
  ) AS ok;

COMMIT;
