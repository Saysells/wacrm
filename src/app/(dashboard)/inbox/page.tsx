"use client";

import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import type { Conversation, Message, Contact, ConversationStatus, Tag } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { canSendMessages } from "@/lib/auth/roles";
import { useRealtime } from "@/hooks/use-realtime";
import { useInboxStore } from "@/hooks/use-inbox-store";
import { setInboxSearch, useInboxSearch } from "@/hooks/use-inbox-search";
import { useContactPanelOpen } from "@/hooks/use-contact-panel-open";
import { useNow } from "@/hooks/use-now";
import { uniqueChannelName } from "@/lib/realtime/channel-name";
import type { InboxConversation } from "@/lib/inbox/inbox-conversation";
import {
  defaultVista,
  escapeLike,
  parseVista,
  unassignedOldestFirst,
  type ListSelection,
  type Vista,
} from "@/lib/inbox/vistas";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { ContactSidebar } from "@/components/inbox/contact-sidebar";
import { toast } from "sonner";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

/** Espera entre teclas antes de buscar el texto en los mensajes. */
const MESSAGE_SEARCH_DEBOUNCE_MS = 300;
/** Tope de filas de la búsqueda en mensajes (es una sola consulta). */
const MESSAGE_SEARCH_LIMIT = 1000;

// `useSearchParams` (`?c=`, `?vista=`, `?embudo=`, `?q=`) requires a
// Suspense boundary or the production build bails to CSR and errors
// out. Thin wrapper supplies it; the inner component holds the state.
export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageInner />
    </Suspense>
  );
}

// ============================================================
// Bandeja de escritorio (rediseño, sesión B).
//
// La LISTA vive en el store compartido (`useInboxStore`, montado en el
// shell): se carga una vez, un canal de realtime la mantiene al día y
// la barra lateral cuenta sobre ella. Esta página decide qué parte se
// muestra —vista, grupo del embudo o búsqueda, leídos de la URL— y es
// dueña del HILO abierto: la conversación activa, sus mensajes y los
// cambios que el hilo hace (estado, asignación), que se copian al
// store con `patch` para que la lista y los contadores no queden
// viejos.
//
// Estado en la URL: `/inbox?vista=para-mi|sin-tomar|agendadas|
// por-vencer|todas|cerradas`, `/inbox?embudo=<grupo>`, `/inbox?q=<texto>`
// y `/inbox?c=<id>` (hilo abierto). Sin vista: Para mí para el agent,
// Todas para los demás.
// ============================================================

function InboxPageInner() {
  const t = useTranslations("Inbox.page");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user: authUser, accountRole } = useAuth();
  const userId = authUser?.id ?? null;
  // Tomar siguiente: mismo permiso que enviar.
  const canTakeNext = !!accountRole && canSendMessages(accountRole);
  const store = useInboxStore();
  const now = useNow();

  const deepLinkConvId = searchParams.get("c");
  const vista: Vista = parseVista(searchParams.get("vista")) ?? defaultVista(accountRole);
  const embudo = searchParams.get("embudo");
  const qParam = searchParams.get("q");

  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(
    null
  );
  /**
   * Bumped whenever we want the thread to refetch from the DB — used
   * as a safety net against missed realtime events. Bumped on WS
   * reconnect, on tab visibility → visible and by the refresh button.
   */
  const [resyncToken, setResyncToken] = useState(0);

  // Panel de contacto abierto o plegado (device-scoped; #258).
  const { open: contactPanelOpen, toggle: handleToggleContactPanel } = useContactPanelOpen();

  // ---- búsqueda de la barra superior --------------------------------
  // `?q=` (llegar desde otra pantalla) siembra la búsqueda del store una
  // vez por valor; después manda lo que se escribe en la barra. Al salir
  // de la Bandeja la búsqueda se limpia para que la próxima visita
  // arranque en la vista.
  const seededQRef = useRef<string | null>(null);
  useEffect(() => {
    if (qParam === null || seededQRef.current === qParam) return;
    seededQRef.current = qParam;
    setInboxSearch(qParam);
  }, [qParam]);
  useEffect(() => () => setInboxSearch(""), []);

  const query = useInboxSearch().trim();
  // Ids con el texto en sus mensajes, junto con la búsqueda que los
  // produjo: si la búsqueda ya cambió, el resultado viejo no se usa.
  const [messageMatches, setMessageMatches] = useState<{
    query: string;
    ids: ReadonlySet<string>;
  } | null>(null);
  const messageMatchIds =
    query && messageMatches && messageMatches.query === query ? messageMatches.ids : null;
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    const supabase = createClient();
    const timer = window.setTimeout(async () => {
      // Una consulta para toda la búsqueda, con los comodines escapados.
      // Solo entran conversaciones que la persona ya ve: el cruce con la
      // lista visible lo hace filterConversations.
      const { data, error } = await supabase
        .from("messages")
        .select("conversation_id")
        .ilike("content_text", `%${escapeLike(query)}%`)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_SEARCH_LIMIT);
      if (cancelled) return;
      setMessageMatches({
        query,
        ids: new Set(error ? [] : (data ?? []).map((r) => r.conversation_id as string)),
      });
    }, MESSAGE_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const selection = useMemo<Omit<ListSelection, "filters">>(
    () => ({ vista, embudo, query, messageMatchIds }),
    [vista, embudo, query, messageMatchIds],
  );

  // Espejo síncrono de la lista para los handlers de identidad estable.
  const conversationsRef = useRef<InboxConversation[]>(store.conversations);
  useEffect(() => {
    conversationsRef.current = store.conversations;
  }, [store.conversations]);

  // ---- URL del hilo abierto -------------------------------------------
  const urlWithConversation = useCallback(
    (convId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (convId) params.set("c", convId);
      else params.delete("c");
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [searchParams, pathname],
  );

  // Fire the deep-link auto-select exactly once per URL — later list
  // refreshes must not snap the user back to the deep-linked
  // conversation if they've already clicked elsewhere.
  const autoSelectedForDeepLinkRef = useRef<string | null>(null);

  // Check WhatsApp connection status on mount
  useEffect(() => {
    const checkConnection = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) return;

      // whatsapp_config is one-row-per-account post-multi-user, so
      // the previous `.eq('user_id', user.id)` would miss the row
      // for any teammate who didn't personally save the config —
      // the "WhatsApp not connected" banner would show in the
      // shared inbox even though the admin had it configured.
      // Resolve account_id via the profile and query by that.
      const { data: profile } = await supabase
        .from("profiles")
        .select("account_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const accountId = profile?.account_id as string | undefined;
      if (!accountId) {
        setWhatsappConnected(false);
        return;
      }

      const { data } = await supabase
        .from("whatsapp_config")
        .select("status")
        .eq("account_id", accountId)
        .maybeSingle();

      setWhatsappConnected(data?.status === "connected");
    };

    checkConnection();
  }, []);

  // ---- realtime del HILO -----------------------------------------------
  // La lista la mantiene el store con su propio canal; acá solo entran
  // los mensajes del hilo abierto. Nombre único por montaje (ver
  // channel-name.ts): un remontaje con el nombre fijo de antes podía
  // pisar el canal que todavía se estaba yendo.
  const [threadChannelName] = useState(() => uniqueChannelName("inbox-thread"));
  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new;
      if (event.eventType === "INSERT") {
        if (activeConversation && newMsg.conversation_id === activeConversation.id) {
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            // Replace optimistic message if it exists
            const withoutOptimistic = prev.filter((m) => !m.id.startsWith("temp-"));
            return [...withoutOptimistic, newMsg];
          });
        }
      }
      if (event.eventType === "UPDATE") {
        // Update message status
        setMessages((prev) =>
          prev.map((m) => (m.id === newMsg.id ? { ...m, ...newMsg } : m))
        );
      }
    },
    [activeConversation]
  );

  // Reconexión del canal del hilo: lo enviado mientras el socket estaba
  // caído se perdió; el hilo vuelve a leer.
  const handleReconnect = useCallback(() => {
    setResyncToken((n) => n + 1);
  }, []);
  useRealtime({
    channelName: threadChannelName,
    onMessageEvent: handleMessageEvent,
    onReconnect: handleReconnect,
    enabled: true,
  });

  // El hilo abierto se mantiene al día con los UPDATE de su fila que el
  // store ya procesa (estado, asignación, contador del servidor). Un
  // contador positivo acá dispara el reset de no leídos del hilo, como
  // siempre.
  const { subscribeConversationUpdates } = store;
  useEffect(
    () =>
      subscribeConversationUpdates((conv) => {
        setActiveConversation((prev) =>
          prev && prev.id === conv.id ? { ...prev, ...conv } : prev,
        );
      }),
    [subscribeConversationUpdates],
  );

  /**
   * Refetch when the tab regains focus. Background tabs may have their
   * WS throttled by the browser even without a full disconnect.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setResyncToken((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /** Botón de refrescar del hilo: relee el hilo y la lista entera. */
  const { refetch: refetchStore } = store;
  const handleManualRefresh = useCallback(() => {
    setResyncToken((n) => n + 1);
    refetchStore();
  }, [refetchStore]);

  /**
   * La ficha releyo las etiquetas del contacto (al abrirlo o despues
   * de cambiarle el estado). Se copian al contacto embebido en la
   * lista, que las trajo con su propio fetch y si no quedaria mostrando
   * el estado viejo. Solo la lista: tocar `activeContact` le cambiaria
   * la identidad a la prop de la ficha y la haria releer.
   */
  const { patch } = store;
  const handleContactTagsChange = useCallback(
    (contactId: string, tags: Tag[]) => {
      patch((prev) => {
        let changed = false;
        const next = prev.map((c) => {
          if (!c.contact || c.contact.id !== contactId) return c;
          const current = (c.contact.tags ?? []).map((t) => t.id).join(",");
          if (current === tags.map((t) => t.id).join(",")) return c;
          changed = true;
          return { ...c, contact: { ...c.contact, tags } };
        });
        return changed ? next : prev;
      });
    },
    [patch],
  );

  const { setActiveConversationId } = store;
  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      // Re-clicking the already-active conversation would clear the
      // messages array, but the fetch effect in MessageThread only re-runs
      // when conversationId changes — so messages would stay empty until
      // the user navigated away and back. Bail out early instead.
      if (activeConversation?.id === conv.id) return;
      setActiveConversation(conv);
      setActiveContact(conv.contact ?? null);
      setMessages([]);
      setActiveConversationId(conv.id);
      // Optimistically clear the unread badge for this conv. The
      // server-side reset is fired by the unread-reset effect inside
      // MessageThread (which reads activeConversation.unread_count, not
      // the list copy — so we deliberately leave that intact above to
      // keep the effect firing).
      patch((prev) =>
        prev.map((c) =>
          c.id === conv.id && c.unread_count > 0 ? { ...c, unread_count: 0 } : c,
        ),
      );
      autoSelectedForDeepLinkRef.current = conv.id;
      // Reflect the selection in the URL (keeping the view / group) so a
      // refresh lands back in the same thread. replace() keeps history clean.
      router.replace(urlWithConversation(conv.id), { scroll: false });
    },
    [activeConversation?.id, router, urlWithConversation, patch, setActiveConversationId],
  );

  /**
   * Abrir un hilo del que solo tenemos el id: el deep link `?c=` (también
   * lo usa "Nuevo mensaje" desde la barra lateral). Si la fila no está en
   * la lista se hidrata con su contacto antes de seleccionarla.
   */
  const { hydrate } = store;
  const openConversationById = useCallback(
    async (convId: string) => {
      const known = conversationsRef.current.find((c) => c.id === convId);
      const conv = known ?? (await hydrate(convId));
      if (!conv) {
        toast.error(t("openConversationFailed"));
        return;
      }
      handleSelectConversation(conv);
    },
    [hydrate, handleSelectConversation, t],
  );

  // Deep link: una vez por valor de `?c=`, cuando la lista ya cargó. La
  // apertura va en un callback diferido (no en el cuerpo del efecto):
  // abrir un hilo es un cambio de estado en cascada que el compilador
  // de React no deja disparar sincrónicamente desde un efecto. El ref
  // se marca recién al abrir, así un re-render que cancele el timer no
  // deja el deep link sin resolver.
  useEffect(() => {
    if (!deepLinkConvId || store.loading) return;
    if (autoSelectedForDeepLinkRef.current === deepLinkConvId) return;
    const timer = window.setTimeout(() => {
      if (autoSelectedForDeepLinkRef.current === deepLinkConvId) return;
      autoSelectedForDeepLinkRef.current = deepLinkConvId;
      void openConversationById(deepLinkConvId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [deepLinkConvId, store.loading, openConversationById]);

  // Mobile "back" — deselect the conversation so the list pane comes
  // back. Also clears the ?c= param so a refresh lands on the list.
  const handleCloseConversation = useCallback(() => {
    setActiveConversation(null);
    setActiveContact(null);
    setMessages([]);
    setActiveConversationId(null);
    // Clearing the ref lets the deep-link auto-selector fire again if
    // the user later visits /inbox?c=<same-id> — desirable UX.
    autoSelectedForDeepLinkRef.current = null;
    router.replace(urlWithConversation(null), { scroll: false });
  }, [router, urlWithConversation, setActiveConversationId]);

  // Al cambiar de vista o de grupo no se abre ninguna conversación sola
  // (abrirla la marca como leída). El hilo que ya estaba abierto sigue
  // abierto aunque deje de estar en la lista filtrada.

  /**
   * Tomar siguiente: la consulta sin tomar más antigua. El update lleva
   * `.is('assigned_agent_id', null)` para que dos personas no tomen la
   * misma: si otra la tomó primero no cambia ninguna fila y se sigue
   * con la próxima. Por dentro es la asignación de siempre.
   */
  const handleTakeNext = useCallback(async () => {
    if (!userId) return;
    const candidates = unassignedOldestFirst(conversationsRef.current);
    if (candidates.length === 0) {
      toast(t("takeNextNone"));
      return;
    }
    const supabase = createClient();
    for (const candidate of candidates) {
      const { data, error } = await supabase
        .from("conversations")
        .update({ assigned_agent_id: userId })
        .eq("id", candidate.id)
        .is("assigned_agent_id", null)
        .select("id");
      if (error) {
        console.error("Failed to take conversation:", error);
        toast.error(t("takeNextFailed"));
        return;
      }
      if (!data || data.length === 0) continue; // otra persona la tomó primero
      const taken = { ...candidate, assigned_agent_id: userId };
      patch((prev) => prev.map((c) => (c.id === taken.id ? taken : c)));
      // Se abre en Para mí, que es donde ahora vive.
      const params = new URLSearchParams();
      params.set("vista", "para-mi");
      params.set("c", taken.id);
      router.push(`/inbox?${params.toString()}`);
      return;
    }
    toast(t("takeNextNone"));
  }, [userId, patch, router, t]);

  const handleMessagesLoaded = useCallback((loaded: Message[]) => {
    setMessages(loaded);
  }, []);

  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
      );
    },
    []
  );

  const handleStatusChange = useCallback(
    (conversationId: string, status: ConversationStatus) => {
      patch((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) => (prev ? { ...prev, status } : prev));
      }
    },
    [activeConversation, patch]
  );

  const handleAssignChange = useCallback(
    (conversationId: string, assignedAgentId: string | null) => {
      patch((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, assigned_agent_id: assignedAgentId ?? undefined }
            : c
        )
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) =>
          prev
            ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined }
            : prev
        );
      }
    },
    [activeConversation, patch]
  );

  // On mobile (<lg) we show a SINGLE pane — either the list or the
  // thread — rather than cramming both side-by-side. Selecting a
  // conversation slides the thread in; the thread's back button pops
  // it back to the list. On lg+ both panes render side-by-side as
  // before, unchanged.
  const hasActiveConv = !!activeConversation;

  // Ocupa la tarjeta de contenido entera: los margenes negativos anulan
  // el padding de <main> y el alto los compensa.
  return (
    <div className="-m-4 flex h-[calc(100%+2rem)] flex-col overflow-hidden sm:-m-6 sm:h-[calc(100%+3rem)]">
      {/* WhatsApp connection banner — in the flex column, not absolute,
          so it pushes the panels down instead of overlapping them. */}
      {whatsappConnected === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-warning/20 bg-warning-soft px-4 py-2">
          <WifiOff className="h-4 w-4 text-warning" />
          <p className="text-xs text-warning">
            {t("whatsappNotConnected")}
          </p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Conversation list.
            Hidden on mobile when a conversation is selected so the
            thread can occupy the full width. Always visible on lg+. */}
        <div
          className={cn(
            "flex h-full flex-1 lg:flex-none",
            hasActiveConv ? "hidden lg:flex" : "flex",
          )}
        >
          <ConversationList
            activeConversationId={activeConversation?.id ?? null}
            onSelect={handleSelectConversation}
            conversations={store.conversations}
            loading={store.loading}
            tags={store.tags}
            memberNames={store.memberNames}
            selection={selection}
            now={now}
            userId={userId}
            onTakeNext={canTakeNext ? handleTakeNext : null}
          />
        </div>

        {/* Center panel: Message thread.
            Hidden on mobile when no conversation is selected so the
            list can occupy the full width. Always visible on lg+
            (shows its own empty-state if no thread is picked yet).

            `min-w-0` is load-bearing: without it, a single wide piece
            of content inside the thread (long quote preview, very
            long URL in a message body) forces the flex child past
            its share and pushes the contact-sidebar panel off-screen
            on the right. Issue #165. */}
        <div
          className={cn(
            "flex h-full min-w-0 flex-1 lg:flex",
            hasActiveConv ? "flex" : "hidden lg:flex",
          )}
        >
          <MessageThread
            conversation={activeConversation}
            contact={activeContact}
            messages={messages}
            onMessagesLoaded={handleMessagesLoaded}
            onNewMessage={handleNewMessage}
            onUpdateMessage={handleUpdateMessage}
            onStatusChange={handleStatusChange}
            onAssignChange={handleAssignChange}
            onBack={handleCloseConversation}
            resyncToken={resyncToken}
            onRefresh={handleManualRefresh}
            contactPanelOpen={contactPanelOpen}
            onToggleContactPanel={handleToggleContactPanel}
          />
        </div>

        {/* Right panel: Contact sidebar — desktop only, and only when the
            agent hasn't collapsed it via the thread-header toggle (#258).
            On mobile it's always hidden (the `lg:block` below), so the
            toggle — which is itself desktop-only — never affects it. */}
        {contactPanelOpen && (
          <div className="hidden h-full lg:block">
            <ContactSidebar
              contact={activeContact}
              onTagsChange={handleContactTagsChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
