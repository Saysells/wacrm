"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  canSeeConversation,
  conversationVisibilityFilter,
} from "@/lib/auth/visibility";
import { useAuth } from "@/hooks/use-auth";
import type { Conversation } from "@/types";

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Used by the sidebar to surface a green dot on the
 * Inbox nav entry when the user is elsewhere in the app.
 *
 * Lives on its own realtime channel (distinct from the inbox page's
 * "inbox-realtime") so both can coexist without sharing state.
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);
  // Visibility scope: agents don't count threads assigned to another
  // agent — the badge should match what their filtered inbox shows.
  const { user, accountRole, profileLoading } = useAuth();
  const userId = user?.id ?? null;

  // Keep a live local mirror of {id: unread_count} so INSERT/UPDATE/DELETE
  // events can adjust the total in O(1) without refetching.
  const countsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    // Wait for the role — the agent filter below depends on it. The
    // effect refires once profileLoading settles.
    if (profileLoading) return;

    const supabase = createClient();
    let cancelled = false;

    // Initial load. RLS scopes this to the signed-in user automatically —
    // no explicit user_id filter needed here.
    (async () => {
      let query = supabase
        .from("conversations")
        .select("id, unread_count");
      const orFilter = conversationVisibilityFilter(accountRole, userId ?? "");
      if (orFilter) query = query.or(orFilter);
      const { data, error } = await query;
      if (cancelled || error || !data) return;

      const map = new Map<string, number>();
      let sum = 0;
      for (const row of data as { id: string; unread_count: number }[]) {
        const n = row.unread_count ?? 0;
        map.set(row.id, n);
        if (n > 0) sum += 1;
      }
      countsRef.current = map;
      setTotal(sum);
    })();

    const channel = supabase
      .channel("total-unread-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const map = countsRef.current;
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Conversation>;
            if (oldRow.id) map.delete(oldRow.id);
          } else {
            const row = payload.new as Conversation;
            // A thread assigned to another agent doesn't count for an
            // agent — and one reassigned away mid-session drops out.
            if (
              canSeeConversation(
                accountRole,
                userId,
                row.assigned_agent_id ?? null,
              )
            ) {
              map.set(row.id, row.unread_count ?? 0);
            } else {
              map.delete(row.id);
            }
          }
          // Recompute — cheap, conversations per user stay small.
          let sum = 0;
          for (const n of map.values()) if (n > 0) sum += 1;
          setTotal(sum);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // Auth deps settle once (loading → resolved) and refire the first
    // real load + subscription.
  }, [profileLoading, accountRole, userId]);

  return total;
}
