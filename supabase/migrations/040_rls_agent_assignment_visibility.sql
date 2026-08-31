-- 040_rls_agent_assignment_visibility.sql
--
-- Cierra el hueco de RLS que quedó documentado en CLAUDE.md tras la
-- sesión de roles: la visibilidad de agent hoy es solo de query/app,
-- no de RLS. owner/admin/viewer ven todo el account; agent solo ve
-- lo asignado a sí mismo o lo que no tiene dueño todavía.

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
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'assigned_agent_id'
  ) THEN
    RAISE EXCEPTION 'conversations.assigned_agent_id no existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'account_id'
  ) THEN
    RAISE EXCEPTION 'contacts.account_id no existe';
  END IF;
END $$;

-- SECURITY DEFINER para leer profiles sin recursión de RLS.
-- owner/admin/viewer: true siempre. agent: solo si la fila es suya
-- o no tiene asignado todavía.
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
        p.account_role IN ('owner', 'admin', 'viewer')
        OR (
          p.account_role = 'agent'
          AND (row_assigned_agent_id IS NULL OR row_assigned_agent_id = auth.uid())
        )
      )
  );
$$;

ALTER FUNCTION can_view_by_assignment(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION can_view_by_assignment(UUID, UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT USING (
  can_view_by_assignment(account_id, assigned_agent_id)
);

DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND can_view_by_assignment(c.account_id, c.assigned_agent_id)
  )
);

DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND can_view_by_assignment(c.account_id, c.assigned_agent_id)
      AND is_account_member(c.account_id, 'agent')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND can_view_by_assignment(c.account_id, c.assigned_agent_id)
      AND is_account_member(c.account_id, 'agent')
  )
);

DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT USING (
  can_view_by_assignment(
    account_id,
    (
      SELECT c.assigned_agent_id
      FROM conversations c
      WHERE c.contact_id = contacts.id
        AND c.account_id = contacts.account_id
      LIMIT 1
    )
  )
);

SELECT 'can_view_by_assignment existe' AS check_name,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_view_by_assignment') AS ok
UNION ALL
SELECT 'conversations_select actualizada',
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversations' AND policyname = 'conversations_select' AND qual LIKE '%can_view_by_assignment%')
UNION ALL
SELECT 'messages_select actualizada',
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'messages_select' AND qual LIKE '%can_view_by_assignment%')
UNION ALL
SELECT 'contacts_select actualizada',
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'contacts' AND policyname = 'contacts_select' AND qual LIKE '%can_view_by_assignment%');

COMMIT;
