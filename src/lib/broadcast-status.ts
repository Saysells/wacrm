/**
 * Shared status badge config for broadcasts + recipients.
 *
 * Previously `statusConfig` was defined inline in both
 * /broadcasts/page.tsx and /broadcasts/[id]/page.tsx with slight
 * drift risk. One source of truth now.
 *
 * Rediseño (sesión F2): cada estado mapea a una variante del `Badge`
 * del sistema (rectángulo de 5 px), no a clases sueltas. El naranja
 * (`pending`) queda para lo que espera respuesta; "enviando" va en
 * ámbar (`warning`) porque está en curso, no esperando a nadie.
 */

import type { BroadcastStatus, RecipientStatus } from "@/types";

export type StatusVariant = "secondary" | "info" | "warning" | "success" | "danger" | "selected";

export interface StatusDisplay {
  label: string;
  variant: StatusVariant;
  /**
   * Set true for statuses that should pulse in the UI to convey
   * "live / in-flight" — currently only `sending`.
   */
  pulse?: boolean;
}

export const broadcastStatusConfig: Record<BroadcastStatus, StatusDisplay> = {
  draft: { label: "draft", variant: "secondary" },
  scheduled: { label: "scheduled", variant: "info" },
  sending: { label: "sending", variant: "warning", pulse: true },
  sent: { label: "sent", variant: "success" },
  failed: { label: "failed", variant: "danger" },
};

export const recipientStatusConfig: Record<RecipientStatus, StatusDisplay> = {
  pending: { label: "pending", variant: "secondary" },
  sent: { label: "sent", variant: "info" },
  delivered: { label: "delivered", variant: "success" },
  read: { label: "read", variant: "success" },
  replied: { label: "replied", variant: "selected" },
  failed: { label: "failed", variant: "danger" },
};

/**
 * Tolerant lookup — callers often have a generic string status
 * coming from Supabase. Falls back to the "draft" / "pending"
 * entry so the UI never crashes on an unknown value.
 */
export function getBroadcastStatus(status: string): StatusDisplay {
  return (
    broadcastStatusConfig[status as BroadcastStatus] ??
    broadcastStatusConfig.draft
  );
}

export function getRecipientStatus(status: string): StatusDisplay {
  return (
    recipientStatusConfig[status as RecipientStatus] ??
    recipientStatusConfig.pending
  );
}
