// ============================================================
// Auto-assignment on reply — pure decision rule, no I/O.
//
// Product rule (roles session, 2026-08-31): when an *agent* replies
// in a conversation nobody owns yet, the conversation (and with it
// the contact — contact ownership is derived from the conversation's
// assignee, there is no assigned-agent column on contacts) becomes
// theirs. A thread that already has an assignee is never reassigned
// by merely replying — takeover stays an explicit action.
//
// Owners and admins reply without claiming threads: they routinely
// jump into any conversation to help and shouldn't steal it from the
// queue, nor from the agent it's assigned to.
//
// The caller must still guard the UPDATE with
// `.is('assigned_agent_id', null)` so two simultaneous first replies
// can't both win — this function decides *intent*, the query filter
// settles the race.
// ============================================================

import type { AccountRole } from "@/lib/auth/roles";

export interface AutoAssignParams {
  /** Role of the user who just sent the reply. */
  role: AccountRole;
  /** Current `conversations.assigned_agent_id`, null when unowned. */
  assignedAgentId: string | null;
  /** auth.uid() of the sender. */
  userId: string;
}

/**
 * Who the conversation should be auto-assigned to after this reply,
 * or null when it must be left untouched (non-agent sender, or the
 * thread already has an owner — including the sender themselves).
 */
export function resolveAutoAssignee({
  role,
  assignedAgentId,
  userId,
}: AutoAssignParams): string | null {
  if (role !== "agent") return null;
  if (assignedAgentId !== null) return null;
  return userId;
}
