// ============================================================
// Role-based data visibility — pure, unit-testable, no I/O.
//
// Product rule (roles session, 2026-08-31): an 'agent' sees
// unassigned conversations and their own, but not threads assigned
// to somebody else. Contact visibility derives from the contact's
// conversation (contacts have no assignee column of their own):
// a contact whose thread belongs to another agent is hidden too.
// Owner, admin and viewer see everything.
//
// IMPORTANT: these filters run in the client queries and API
// routes, NOT in RLS — an agent with the anon key and a console
// can still read other rows. Database-level enforcement needs a
// migration (out of scope for the no-SQL session that added this;
// see CLAUDE.md → Roles y permisos → Pendientes).
// ============================================================

import type { AccountRole } from "./roles";

/**
 * PostgREST `.or()` clause restricting a `conversations` query to the
 * rows `role` may see, or null when no restriction applies. Usage:
 *
 *   const orFilter = conversationVisibilityFilter(role, userId);
 *   if (orFilter) query = query.or(orFilter);
 */
export function conversationVisibilityFilter(
  role: AccountRole | null,
  userId: string,
): string | null {
  if (role !== "agent") return null;
  return `assigned_agent_id.is.null,assigned_agent_id.eq.${userId}`;
}

/**
 * Client-side counterpart of {@link conversationVisibilityFilter} for
 * rows that arrive outside the filtered query — realtime events,
 * hydration fetches. Fails open on a null role: the realtime path has
 * no reliable role yet during the first render, and hiding everything
 * would blank the inbox for owners; the server-filtered list query is
 * the authoritative source.
 */
export function canSeeConversation(
  role: AccountRole | null,
  userId: string | null,
  assignedAgentId: string | null | undefined,
): boolean {
  if (role !== "agent") return true;
  if (assignedAgentId == null) return true;
  return assignedAgentId === userId;
}

/**
 * Contact ids an agent must NOT see, derived from conversation rows
 * (`contact_id` + `assigned_agent_id`). Feed it the result of a
 * `conversations` query for rows assigned to somebody else; exists as
 * a pure function so the derivation rule stays testable.
 */
export function hiddenContactIds(
  rows: Array<{ contact_id: string; assigned_agent_id: string | null }>,
  userId: string,
): string[] {
  return rows
    .filter(
      (r) => r.assigned_agent_id !== null && r.assigned_agent_id !== userId,
    )
    .map((r) => r.contact_id);
}

/**
 * PostgREST value for `.not('id', 'in', ...)` excluding `ids`, or
 * null when there's nothing to exclude (callers skip the filter).
 */
export function contactExclusionList(ids: string[]): string | null {
  if (ids.length === 0) return null;
  return `(${ids.join(",")})`;
}
