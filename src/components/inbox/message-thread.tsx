"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useNow } from "@/hooks/use-now";
import { usePresence } from "@/hooks/use-presence";
import { PresenceDot } from "@/components/presence/presence-dot";
import { presenceLabel } from "@/lib/presence";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  ContactNote,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
  InteractiveMessagePayload,
} from "@/types";
import {
  ArrowLeft,
  Check,
  CircleCheck,
  Copy,
  Ellipsis,
  MessagesSquare,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  RotateCcw,
  StickyNote,
  UserPlus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageBubble } from "./message-bubble";
import { MessageActions } from "./message-actions";
import { MediaLightbox } from "./media-lightbox";
import { collectMediaGallery } from "@/lib/media/gallery";
import {
  MessageComposer,
  CHAT_MEDIA_BUCKET,
  type SendMediaPayload,
} from "./message-composer";
import { deleteAccountMedia } from "@/lib/storage/upload-media";
import { TemplatePicker, type TemplateSendValues } from "./template-picker";
import { AiThreadBanner } from "./ai-thread-banner";
import { buildReplyPreview } from "./reply-quote";
import { renderTemplateBody } from "@/lib/whatsapp/template-body";
import { avatarColors, initialsOf, windowState } from "@/lib/inbox/vistas";
import {
  buildTimeline,
  lastCustomerMessageAt,
  type DayLabel,
} from "@/lib/inbox/thread";
import { toast } from "sonner";

// ============================================================
// Hilo de la Bandeja de escritorio (rediseño, sesión C).
//
// Prototipo `thread()`: encabezado de 72 px (avatar, nombre, empresa y
// teléfono; a la derecha la acción principal, cerrar y "Más"), los
// mensajes sobre fondo blanco con separadores de día y las notas
// internas intercaladas, y abajo el cuadro de mensaje (composer).
//
// La lógica no cambió: los mensajes se piden y se mandan como antes
// (`/api/whatsapp/send`), las reacciones tienen su canal, el estado y
// la asignación son los mismos UPDATE de `conversations`. Lo que se
// movió: la ventana de 24 h ya no es un badge de horas enteras en el
// encabezado sino el indicador vivo del cuadro (`windowState` +
// `useNow`, la misma regla que la lista), y pasar a abierta /
// pendiente, asignar, actualizar y copiar el teléfono viven en el menú
// "Más" hasta que la sesión D lleve la asignación a la ficha.
// ============================================================

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null,
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by "Actualizar" in the "Más" menu. The parent typically bumps
   * the same `resyncToken` it controls — this gives the user a way to
   * force a refetch when they suspect realtime missed an event. Optional
   * so existing callers keep working; the entry is only rendered when
   * this is provided.
   */
  onRefresh?: () => void;
  /**
   * Desktop-only contact-panel toggle. The page owns the open/closed
   * state (it's the one that renders the sidebar), so the thread just
   * reflects it and asks the page to flip it. Both optional so existing
   * callers keep working; the toggle button only renders when
   * `onToggleContactPanel` is wired up.
   */
  contactPanelOpen?: boolean;
  onToggleContactPanel?: () => void;
}

type Translator = ReturnType<typeof useTranslations>;

/** Botón redondo de 40 px del prototipo (`.ib`). */
const ICON_BUTTON_CLASS =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-secondary-foreground transition-colors hover:bg-hover-strong hover:text-foreground disabled:opacity-50 [&_svg]:size-5";

function formatDayLabel(label: DayLabel, t: Translator): string {
  switch (label.kind) {
    case "today":
      return t("today");
    case "yesterday":
      return t("yesterday");
    case "date": {
      const weekdays = t("weekdaysLong").split(",");
      const months = t("months").split(",");
      const weekday = weekdays[label.weekday] ?? "";
      const month = months[label.month] ?? "";
      const text = label.sameYear
        ? t("dayDate", { weekday, day: label.day, month })
        : t("dayDateYear", { weekday, day: label.day, month, year: label.year });
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
  }
}

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onAssignChange,
  onBack,
  resyncToken = 0,
  onRefresh,
  contactPanelOpen,
  onToggleContactPanel,
}: MessageThreadProps) {
  const t = useTranslations("Inbox.messageThread");
  const tQuote = useTranslations("Inbox.replyQuote");

  const { user } = useAuth();
  const { getPresence, getRow, now: presenceNow } = usePresence();
  const now = useNow();
  const [loading, setLoading] = useState(false);
  // Conversación cuyos mensajes ya se cargaron: hasta que coincide con
  // la abierta, la ventana es "desconocida" y el cuadro no decide entre
  // texto y plantillas (evita que el panel de plantillas parpadee un
  // instante al cambiar de hilo, cuando `messages` todavía está vacío).
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  // Which attachment the media viewer is showing. Lives here rather than in
  // the bubble so the viewer can page through every image/video in the
  // thread (issue #373). Paired with the conversation it belongs to and read
  // back through that check below, so switching threads closes the viewer
  // without an effect racing the messages refetch.
  const [openMedia, setOpenMedia] = useState<{
    conversationId: string;
    messageId: string;
  } | null>(null);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — the account's members. They name the assignee in "Más" and the
  // author of each internal note.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch profiles:", error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const contactId = contact?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  const mediaMessageId =
    openMedia && openMedia.conversationId === conversationId
      ? openMedia.messageId
      : null;
  const handleMediaChange = useCallback(
    (messageId: string | null) => {
      setOpenMedia(
        messageId && conversationId ? { conversationId, messageId } : null,
      );
    },
    [conversationId],
  );

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch messages:", error);
      } else {
        onMessagesLoadedRef.current(data ?? []);
        setLoadedConversationId(conversationId);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Notas internas del contacto (`contact_notes`): las mismas que lista
  // la ficha, intercaladas en el hilo por fecha. Se releen con el hilo
  // (cambio de contacto o `resyncToken`); una nota que otra persona
  // agrega mientras tanto aparece al actualizar.
  useEffect(() => {
    if (!contactId) {
      setNotes([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch contact notes:", error);
        return;
      }
      setNotes((data as ContactNote[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch reactions:", error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith("temp-") &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id,
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .then(({ error }) => {
        if (error) console.error("Failed to reset unread_count:", error);
      });
  }, [conversationId, hasUnread]);

  // Auto-scroll to bottom on new messages (and new notes).
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, notes]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(t("sendFailed", { reason }));
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : t("networkError");
        toast.error(t("sendFailed", { reason }));
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage, t]
  );

  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload) => {
      if (!conversation) return;

      // Documents show their filename in our own bubble (and to the
      // recipient as the Meta caption when no caption was typed); other
      // kinds use the caption as-is. Audio carries no caption.
      const contentText =
        payload.kind === "document"
          ? payload.caption || payload.filename || "Document"
          : payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: payload.kind,
        content_text: contentText,
        media_url: payload.mediaUrl,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error("Failed to send media:", reason);
          toast.error(t("sendFailed", { reason }));
          onUpdateMessage(tempId, { status: "failed" });
          // The upload never reached the recipient — GC the orphaned
          // object rather than leaving it in the public bucket forever.
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send media:", err);
        const reason = err instanceof Error ? err.message : t("networkError");
        toast.error(t("sendFailed", { reason }));
        onUpdateMessage(tempId, { status: "failed" });
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
      }
    },
    [conversation, onNewMessage, onUpdateMessage, t],
  );

  const handleSendInteractive = useCallback(
    async (payload: InteractiveMessagePayload, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;
      // Optimistic bubble — renders the buttons/list immediately via the
      // interactive_payload, same as the persisted row will.
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "interactive",
        content_text: payload.body,
        interactive_payload: payload,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "interactive",
            interactive_payload: payload,
            reply_to_message_id: replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error("Failed to send interactive message:", reason);
          toast.error(t("sendFailed", { reason }));
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send interactive message:", err);
        const reason = err instanceof Error ? err.message : t("networkError");
        toast.error(t("sendFailed", { reason }));
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage, t],
  );

  // Estado de la conversación: el mismo UPDATE de siempre. Cerrar y
  // reabrir son los dos botones del encabezado; abierta / pendiente
  // quedaron en "Más". Devuelve si la base aceptó el cambio.
  const handleStatusChange = useCallback(
    async (status: ConversationStatus): Promise<boolean> => {
      if (!conversation) return false;

      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ status })
        .eq("id", conversation.id);
      if (error) {
        console.error("Failed to update conversation status:", error);
        toast.error(t("statusUpdateFailed"));
        return false;
      }

      onStatusChange(conversation.id, status);
      return true;
    },
    [conversation, onStatusChange, t]
  );

  const handleCloseConversation = useCallback(async () => {
    if (!(await handleStatusChange("closed"))) return;
    toast(t("closed"), {
      action: {
        label: t("undo"),
        onClick: () => {
          void handleStatusChange("open");
        },
      },
    });
  }, [handleStatusChange, t]);

  const handleReopenConversation = useCallback(async () => {
    if (!(await handleStatusChange("open"))) return;
    toast(t("reopened"));
  }, [handleStatusChange, t]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    try {
      await navigator.clipboard.writeText(contact.phone);
      toast.success(t("phoneCopied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }, [contact?.phone, t]);

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (template: MessageTemplate, values: TemplateSendValues) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "template",
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send template:", reason);
          toast.error(t("sendTemplateFailed", { reason }));
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = err instanceof Error ? err.message : t("networkError");
        toast.error(t("sendTemplateFailed", { reason }));
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage, t],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Images + videos in the thread, in order — the set the media viewer
  // pages through with ← / →.
  const mediaGallery = useMemo(() => collectMediaGallery(messages), [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  // Nombre por user_id para el autor de cada nota y el asignado.
  const namesByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of profiles) map.set(p.user_id, p.full_name);
    return map;
  }, [profiles]);

  // Mensajes y notas intercalados con sus separadores de día. `now`
  // entra para que "Hoy" pase a "Ayer" solo, a medianoche.
  const timeline = useMemo(
    () => buildTimeline(messages, notes, now),
    [messages, notes, now],
  );

  // Ventana de 24 h: la misma regla que la lista (`windowState`) sobre el
  // último mensaje del cliente del hilo cargado. Desconocida (null)
  // hasta que los mensajes de ESTA conversación terminaron de cargar.
  const windowReady = !!conversationId && loadedConversationId === conversationId && !loading;
  const win = windowReady ? windowState(lastCustomerMessageAt(messages), now) : null;

  const contactDisplayName = contact?.name || contact?.phone || t("unknownContact");

  // Author label for a quoted message: "Vos" when we sent the parent,
  // contact name when the customer sent it.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg =
        m.sender_type === "agent" || m.sender_type === "bot";
      return isAgentMsg ? t("you") : contactDisplayName;
    },
    [contactDisplayName, t],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg, tQuote),
      });
    },
    [authorLabelFor, tQuote],
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error(t("waitForSend"));
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === "agent" &&
            r.actor_id === userId,
        );
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : t("networkError");
        toast.error(t("reactionFailed", { reason }));
        setReactions(snapshot);
      }
    },
    [conversation, user?.id, t],
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ assigned_agent_id: agentId })
        .eq("id", conversation.id);

      if (error) {
        console.error("Failed to update assignment:", error);
        toast.error(t("assignFailed"));
        return;
      }

      onAssignChange(conversation.id, agentId);
    },
    [conversation, onAssignChange, t],
  );

  // Vacío del prototipo (`.nosel`), sin la línea de J y K: los atajos
  // son de la sesión E.
  if (!conversation || !contact) {
    return (
      <div className="flex flex-1 items-center justify-center bg-card">
        <div className="px-7 py-12 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-selected text-primary">
            <MessagesSquare className="size-[26px]" strokeWidth={1.8} />
          </div>
          <b className="mt-3 block text-base font-semibold text-foreground">
            {t("selectConversation")}
          </b>
        </div>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const [avatarBg, avatarInk] = avatarColors(displayName);
  const isClosed = conversation.status === "closed";
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const subtitle = contact.company ? `${contact.company} · ${contact.phone}` : contact.phone;

  return (
    // `min-w-0` is load-bearing: the page already puts min-w-0 on the
    // thread's flex *wrapper* (issue #165), but this root keeps the
    // default `min-width: auto`, so a single wide message (long unbroken
    // URL/word) expands the whole thread past its flex share and the chat
    // paints on top of the contact sidebar at lg+ — outgoing bubbles get
    // clipped and the hover toolbar overlaps the Tags panel. Letting the
    // root shrink lets the bubbles' break-words / max-w caps apply.
    // Issue #257.
    <div className="flex min-w-0 flex-1 flex-col bg-card">
      {/* Encabezado (prototipo `.th`): 72 px, avatar de 42, nombre de
          17 px y "empresa · teléfono" debajo; a la derecha la acción
          principal (Agendar llamada es de la sesión D; hoy solo
          "Reabrir" cuando está cerrada), cerrar y "Más". */}
      <div className="flex h-[72px] shrink-0 items-center gap-3 border-b border-border px-3 sm:px-4 sm:pl-6">
        {/* Back-to-list button — mobile only. Hidden on lg+ where the
            conversation list is always visible next to the thread. */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t("backToConversations")}
            className={cn(ICON_BUTTON_CLASS, "-ml-1 lg:hidden")}
          >
            <ArrowLeft />
          </button>
        )}
        <div
          className="grid size-[42px] shrink-0 place-items-center rounded-full text-[15px] font-semibold"
          style={{ background: avatarBg, color: avatarInk }}
        >
          {initialsOf(displayName)}
        </div>
        <div className="min-w-0">
          <b className="block truncate text-[17px] font-semibold text-foreground">{displayName}</b>
          <span className="block truncate text-[13px] text-muted-foreground">{subtitle}</span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Contact-panel toggle — desktop only. Lets agents reclaim the
              sidebar's width when they just want to read and reply.
              Issue #258. */}
          {onToggleContactPanel && (
            <button
              type="button"
              onClick={onToggleContactPanel}
              aria-label={
                contactPanelOpen ? t("hideContactPanel") : t("showContactPanel")
              }
              title={contactPanelOpen ? t("hideContact") : t("showContact")}
              aria-pressed={contactPanelOpen}
              className={cn(
                ICON_BUTTON_CLASS,
                "hidden lg:inline-flex",
                contactPanelOpen && "text-primary",
              )}
            >
              {contactPanelOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </button>
          )}

          {isClosed ? (
            <Button variant="outline" onClick={handleReopenConversation}>
              <RotateCcw />
              {t("reopen")}
            </Button>
          ) : (
            <button
              type="button"
              onClick={handleCloseConversation}
              aria-label={t("close")}
              title={t("close")}
              className={ICON_BUTTON_CLASS}
            >
              <CircleCheck />
            </button>
          )}

          {/* "Más": lo que no es la acción principal. Pasar a abierta /
              pendiente, asignar y actualizar esperan acá a que la
              sesión D lleve la asignación a la ficha. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("more")}
              title={t("more")}
              className={cn(ICON_BUTTON_CLASS, "aria-expanded:bg-selected-strong aria-expanded:text-primary")}
            >
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[240px]">
              {/* DropdownMenuGroup es OBLIGATORIO alrededor de cada
                  DropdownMenuLabel (Menu.GroupLabel de base-ui; issue
                  #336). */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("menuConversation")}</DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={conversation.status === "open"}
                  onClick={() => void handleStatusChange("open")}
                >
                  {t("markOpen")}
                  {conversation.status === "open" && <Check className="ml-auto text-muted-foreground" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={conversation.status === "pending"}
                  onClick={() => void handleStatusChange("pending")}
                >
                  {t("markPending")}
                  {conversation.status === "pending" && <Check className="ml-auto text-muted-foreground" />}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <UserPlus />
                  <span className="min-w-0 flex-1 truncate">
                    {assignedAgentId
                      ? (namesByUserId.get(assignedAgentId) ?? t("assigned"))
                      : t("assignTo")}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-[240px]">
                  {profiles.length === 0 ? (
                    <DropdownMenuItem disabled>{t("noTeammates")}</DropdownMenuItem>
                  ) : (
                    profiles.map((p) => {
                      const isSelected = p.user_id === assignedAgentId;
                      const presence = getPresence(p.user_id);
                      return (
                        <DropdownMenuItem
                          key={p.id}
                          onClick={() => handleAssignChange(p.user_id)}
                          className={cn(isSelected && "bg-selected")}
                        >
                          <PresenceDot
                            status={presence}
                            label={presenceLabel(
                              presence,
                              getRow(p.user_id)?.last_seen_at ?? null,
                              presenceNow
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {p.full_name}
                            {p.user_id === user?.id ? t("me") : ""}
                          </span>
                          {isSelected && <Check className="text-muted-foreground" />}
                        </DropdownMenuItem>
                      );
                    })
                  )}
                  {assignedAgentId && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleAssignChange(null)}
                        className="text-muted-foreground"
                      >
                        {t("unassign")}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {onRefresh && (
                <DropdownMenuItem onClick={onRefresh}>
                  <RefreshCw />
                  {t("refresh")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => void handleCopyPhone()}>
                <Copy />
                {t("copyPhone")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* AI auto-reply banner — take over an active bot, or resume it
          after a handoff. Renders nothing unless the account has
          auto-reply configured. */}
      <AiThreadBanner
        conversationId={conversation.id}
        disabled={conversation.ai_autoreply_disabled ?? false}
        handoffSummary={conversation.ai_handoff_summary}
        assignedAgentId={assignedAgentId}
        currentUserId={user?.id}
        onChange={(patch) => {
          if ("assigned_agent_id" in patch) {
            onAssignChange(conversation.id, patch.assigned_agent_id ?? null);
          }
        }}
      />

      {/* Mensajes (prototipo `.msgs`): fondo blanco, columna con 8 px
          entre burbujas y un espaciador arriba que las apoya abajo
          cuando son pocas. */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col justify-end gap-2 px-4 pb-2 pt-5 sm:px-10">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t("noMessagesYet")}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{t("sendTemplateHint")}</p>
            </div>
          ) : (
            timeline.map((item) => {
              if (item.kind === "day") {
                return (
                  <span
                    key={item.key}
                    className="my-1.5 self-center text-[12.5px] font-medium text-muted-foreground"
                  >
                    {formatDayLabel(item.label, t)}
                  </span>
                );
              }
              if (item.kind === "note") {
                const author = namesByUserId.get(item.note.user_id);
                return (
                  <div
                    key={item.key}
                    className="max-w-[70%] self-end whitespace-pre-wrap break-words rounded-2xl border border-warning/30 bg-warning-soft px-3.5 py-[9px] text-sm text-foreground"
                  >
                    <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-warning">
                      <StickyNote className="size-[13px]" />
                      {author ? t("noteBy", { author }) : t("noteInternal")}
                    </div>
                    {item.note.note_text}
                  </div>
                );
              }
              const msg = item.message;
              const parent = msg.reply_to_message_id
                ? messagesById.get(msg.reply_to_message_id)
                : null;
              const reply = parent
                ? {
                    authorLabel: authorLabelFor(parent),
                    preview: buildReplyPreview(parent, tQuote),
                  }
                : null;
              const msgReactions = reactionsByMessageId.get(msg.id);
              // Toggle is computed at the call site — `msgReactions`
              // and `user?.id` are already in scope, no extra hook.
              const handlePillToggle = (emoji: string) => {
                const own = msgReactions?.find(
                  (r) =>
                    r.actor_type === "agent" &&
                    r.actor_id === user?.id,
                );
                const next = own?.emoji === emoji ? "" : emoji;
                void postReaction(msg.id, next);
              };
              return (
                <MessageActions
                  key={item.key}
                  message={msg}
                  onReply={() => handleStartReply(msg)}
                  onReact={(emoji) => {
                    if (emoji) void postReaction(msg.id, emoji);
                  }}
                >
                  <MessageBubble
                    message={msg}
                    reply={reply}
                    reactions={msgReactions}
                    currentUserId={user?.id}
                    onToggleReaction={handlePillToggle}
                    onOpenMedia={handleMediaChange}
                  />
                </MessageActions>
              );
            })
          )}
        </div>
      </div>

      {/* Cuadro de mensaje. Con `key` por conversación: el borrador, el
          adjunto en curso y la grabación son de ESTE hilo y no viajan
          al siguiente. */}
      <MessageComposer
        key={conversation.id}
        conversationId={conversation.id}
        sessionExpired={win ? win.kind === "closed" || win.kind === "none" : false}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onSendInteractive={handleSendInteractive}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />

      {/* Full-size viewer for the thread's images/videos. Renders nothing
          until a bubble opens it. */}
      <MediaLightbox
        items={mediaGallery}
        activeId={mediaMessageId}
        onActiveIdChange={handleMediaChange}
        contactLabel={contactDisplayName}
      />
    </div>
  );
}
