"use client";

import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import type { Conversation, ContactNote, Message, Contact, ConversationStatus } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { canSendMessages } from "@/lib/auth/roles";
import { useRealtime } from "@/hooks/use-realtime";
import { useInboxStore } from "@/hooks/use-inbox-store";
import { setInboxSearch, useInboxSearch } from "@/hooks/use-inbox-search";
import { useSidePanel } from "@/hooks/use-side-panel";
import { useSaysellsSelector } from "@/hooks/use-saysells-selector";
import { useCloser } from "@/hooks/use-closer";
import { useNow } from "@/hooks/use-now";
import { uniqueChannelName } from "@/lib/realtime/channel-name";
import type { InboxConversation } from "@/lib/inbox/inbox-conversation";
import {
  NO_LIST_FILTERS,
  defaultVista,
  escapeLike,
  filterConversations,
  hasScheduling,
  parseVista,
  scheduledCall,
  unassignedOldestFirst,
  type ListFilters,
  type ListSelection,
  type Vista,
} from "@/lib/inbox/vistas";
import { showsProposalAction } from "@/lib/inbox/closer";
import { isTypingTarget, neighborId, shortcutFor } from "@/lib/inbox/shortcuts";
import { sendComposerCommand } from "@/lib/inbox/composer-commands";
import { openShortcutsHelp } from "@/hooks/use-shortcuts-help";
import { requestFromAction, type ScheduleRequest } from "@/lib/inbox/agendar";
import { effectiveSideTab, tabAfterOpeningConversation } from "@/lib/inbox/side-panel";
import { beginLoad, createLoadSequence, shouldApply } from "@/lib/inbox/load-sequence";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { SidePanel } from "@/components/inbox/side-panel";
import { ScheduleCallDialog, type ScheduledResult } from "@/components/inbox/schedule-call-dialog";
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
// viejos. Desde la sesión D también es dueña de las NOTAS del contacto
// abierto (las comparten el hilo y la ficha) y del panel lateral, que
// lee la fila VIVA del store de la conversación abierta.
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
  const { user: authUser, accountId, accountRole } = useAuth();
  const userId = authUser?.id ?? null;
  // Tomar siguiente: mismo permiso que enviar.
  const canTakeNext = !!accountRole && canSendMessages(accountRole);
  const store = useInboxStore();
  const now = useNow();
  // Closer (sesión E): arranca en Mis llamadas, ve la tarjeta de la
  // llamada en la ficha y "Crear propuesta" como acción principal.
  const { closer, isCloser } = useCloser();

  const deepLinkConvId = searchParams.get("c");
  const vista: Vista = parseVista(searchParams.get("vista")) ?? defaultVista(accountRole, isCloser);
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

  // Panel lateral (riel): abierto o plegado y pestaña (sesión D). Una
  // pestaña que la cuenta o la persona no tienen cae en la ficha.
  const sidePanel = useSidePanel();
  const saysells = useSaysellsSelector();
  const panelTab = effectiveSideTab(sidePanel.tab, {
    scheduling: hasScheduling(store.tags),
    saysells: saysells.visible,
  });

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

  // Los filtros del desplegable de la lista viven acá (sesión E): la
  // lista filtrada se calcula UNA vez y es la misma que pinta la lista
  // y la que recorren J y K.
  const [listFilters, setListFilters] = useState<ListFilters>(NO_LIST_FILTERS);
  const setListFiltersWith = useCallback(
    (updater: (prev: ListFilters) => ListFilters) => setListFilters(updater),
    [],
  );
  const listCtx = useMemo(() => ({ userId, now, closer }), [userId, now, closer]);
  const visibleConversations = useMemo(
    () => filterConversations(store.conversations, { ...selection, filters: listFilters }, listCtx),
    [store.conversations, selection, listFilters, listCtx],
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

  const { patch } = store;

  // La fila VIVA del store de la conversación abierta: trae el contacto
  // con sus etiquetas y la fecha de la llamada tal como los pintan la
  // lista y los contadores. El panel y el encabezado leen de acá, así
  // que lo que la ficha escribe (y lo que llega por realtime) se ve en
  // todos lados sin recargar.
  const activeRow = useMemo(
    () =>
      activeConversation
        ? (store.conversations.find((c) => c.id === activeConversation.id) ?? null)
        : null,
    [store.conversations, activeConversation],
  );
  const liveContact = activeRow?.contact ?? activeContact;
  // Llamada agendada del contacto abierto (estado con fecha + fecha).
  const activeCall = useMemo(() => (activeRow ? scheduledCall(activeRow) : null), [activeRow]);
  // Agendar: la cuenta tiene etiquetas con fecha y la persona es agent+.
  const canSchedule = hasScheduling(store.tags) && canTakeNext;
  // "Crear propuesta" (prototipo `primaryAction`): closer con la llamada
  // abierta a su nombre, del equipo de Saysells.
  const proposalAction = showsProposalAction(closer, activeCall, saysells.visible);

  // ---- modal "Agendar llamada" ----------------------------------------
  // Lo abren la acción principal del encabezado, Agendar / Cambiar de la
  // fila Llamada de la ficha y los estados con fecha. Al guardar, la
  // fecha y las etiquetas nuevas se copian al store (lista, contadores,
  // Llamadas y encabezado) y se relee la fila.
  const [scheduleRequest, setScheduleRequest] = useState<ScheduleRequest | null>(null);
  const openSchedule = useCallback((request: ScheduleRequest) => setScheduleRequest(request), []);
  const closeSchedule = useCallback(() => setScheduleRequest(null), []);
  const handleScheduleFromHeader = useCallback(() => {
    openSchedule(requestFromAction(activeCall));
  }, [openSchedule, activeCall]);
  const { patchContact, hydrate: hydrateRow } = store;
  const handleScheduled = useCallback(
    (result: ScheduledResult) => {
      // Sin fecha, `fecha_llamada` no se tocó: solo las etiquetas.
      patchContact(
        result.contactId,
        result.fechaLlamada === null
          ? { tags: result.attached }
          : { fecha_llamada: result.fechaLlamada, tags: result.attached },
      );
      void hydrateRow(result.conversationId);
    },
    [patchContact, hydrateRow],
  );

  // ---- notas internas del contacto abierto ---------------------------
  // Las comparten el hilo (línea de tiempo) y la ficha (grupo Notas):
  // una nota cargada en cualquiera de los dos aparece en el otro sin
  // recargar. Se piden por contacto y con `resyncToken` (Actualizar,
  // reconexión); gana la respuesta más nueva (load-sequence.ts). Las de
  // otras personas siguen llegando al actualizar: `contact_notes` no
  // está en la publicación de realtime y eso es SQL.
  const activeContactId = activeContact?.id ?? null;
  const [notesState, setNotesState] = useState<{ contactId: string; notes: ContactNote[] } | null>(
    null,
  );
  const notesSeqRef = useRef(createLoadSequence());
  useEffect(() => {
    if (!activeContactId) return;
    const requestId = beginLoad(notesSeqRef.current);
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", activeContactId)
        .order("created_at", { ascending: true });
      if (!shouldApply(notesSeqRef.current, requestId)) return;
      if (error) {
        console.error("Failed to fetch contact notes:", error);
        return;
      }
      setNotesState({ contactId: activeContactId, notes: (data as ContactNote[]) ?? [] });
    })();
  }, [activeContactId, resyncToken]);
  const notes = useMemo(
    () => (notesState && notesState.contactId === activeContactId ? notesState.notes : []),
    [notesState, activeContactId],
  );

  // El alta de `contact_notes` de siempre (account_id y user_id; RLS
  // agent+). Nunca sale por WhatsApp. Devuelve si quedó guardada.
  const tThread = useTranslations("Inbox.messageThread");
  const handleSaveNote = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!activeContactId || !accountId || !trimmed) return false;
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contact_notes")
        .insert({
          contact_id: activeContactId,
          account_id: accountId,
          user_id: userId ?? undefined,
          note_text: trimmed,
        })
        .select()
        .single();
      if (error || !data) {
        console.error("Failed to save note:", error);
        toast.error(tThread("noteSaveFailed"));
        return false;
      }
      const note = data as ContactNote;
      setNotesState((prev) =>
        prev && prev.contactId === activeContactId
          ? { contactId: prev.contactId, notes: [...prev.notes, note] }
          : { contactId: activeContactId, notes: [note] },
      );
      toast.success(tThread("noteSaved"));
      return true;
    },
    [activeContactId, accountId, userId, tThread],
  );

  const { setActiveConversationId } = store;
  const { setTab: setSidePanelTab, close: closeSidePanel } = sidePanel;
  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      // Re-clicking the already-active conversation would clear the
      // messages array, but the fetch effect in MessageThread only re-runs
      // when conversationId changes — so messages would stay empty until
      // the user navigated away and back. Bail out early instead.
      if (activeConversation?.id === conv.id) return;
      // Con Llamadas o Propuestas a la vista, el panel pasa a la ficha.
      setSidePanelTab(tabAfterOpeningConversation(sidePanel.tab));
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
    [activeConversation?.id, router, urlWithConversation, patch, setActiveConversationId, setSidePanelTab, sidePanel.tab],
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

  // Estado de la conversación (sesión E): el UPDATE de `status` de
  // siempre, ahora en la página, para que el botón del hilo y la tecla E
  // cierren por el mismo camino. Devuelve si la base aceptó el cambio.
  const setConversationStatus = useCallback(
    async (conversationId: string, status: ConversationStatus): Promise<boolean> => {
      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ status })
        .eq("id", conversationId);
      if (error) {
        console.error("Failed to update conversation status:", error);
        toast.error(tThread("statusUpdateFailed"));
        return false;
      }
      patch((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
      );
      setActiveConversation((prev) =>
        prev && prev.id === conversationId ? { ...prev, status } : prev,
      );
      return true;
    },
    [patch, tThread],
  );

  /** Cerrar con "Deshacer" (prototipo `closeConv`): el botón del hilo y la tecla E. */
  const closeConversation = useCallback(
    async (conversationId: string) => {
      if (!(await setConversationStatus(conversationId, "closed"))) return;
      toast(tThread("closed"), {
        action: {
          label: tThread("undo"),
          onClick: () => {
            void setConversationStatus(conversationId, "open");
          },
        },
      });
    },
    [setConversationStatus, tThread],
  );

  const activeConversationId = activeConversation?.id ?? null;
  const handleSetActiveStatus = useCallback(
    (status: ConversationStatus) =>
      activeConversationId ? setConversationStatus(activeConversationId, status) : Promise.resolve(false),
    [activeConversationId, setConversationStatus],
  );
  const handleCloseActive = useCallback(() => {
    if (activeConversationId) void closeConversation(activeConversationId);
  }, [activeConversationId, closeConversation]);

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

  /**
   * Tecla A con la conversación abierta sin tomar: la misma asignación
   * que el Setter de la ficha (UPDATE de `assigned_agent_id`). Si ya
   * tiene dueño, Tomar siguiente.
   */
  const takeActiveConversation = useCallback(async () => {
    const active = activeConversation;
    if (!userId || !active || active.assigned_agent_id) {
      void handleTakeNext();
      return;
    }
    const supabase = createClient();
    const { error } = await supabase
      .from("conversations")
      .update({ assigned_agent_id: userId })
      .eq("id", active.id);
    if (error) {
      console.error("Failed to take conversation:", error);
      toast.error(t("takeNextFailed"));
      return;
    }
    handleAssignChange(active.id, userId);
    toast(t("tookConversation", { name: active.contact?.name || active.contact?.phone || "" }));
  }, [activeConversation, userId, handleTakeNext, handleAssignChange, t]);

  // ---- atajos de teclado (sesión E, prototipo `keydown`) -------------
  // Un solo manejador para toda la Bandeja. Qué hace cada tecla lo
  // decide `shortcutFor` (puro, con pruebas) con tres medidas del DOM:
  // si el foco está en un campo, si hay un modal, menú o popover abierto
  // (base-ui los monta con role="dialog" / "menu" / "listbox" solo
  // mientras están abiertos) y si hay un modificador apretado.
  const visibleIdsRef = useRef<string[]>([]);
  useEffect(() => {
    visibleIdsRef.current = visibleConversations.map((c) => c.id);
  }, [visibleConversations]);
  const openByIdRef = useRef(openConversationById);
  useEffect(() => {
    openByIdRef.current = openConversationById;
  }, [openConversationById]);
  const actionsRef = useRef({
    take: takeActiveConversation,
    schedule: handleScheduleFromHeader,
    close: handleCloseActive,
  });
  useEffect(() => {
    actionsRef.current = {
      take: takeActiveConversation,
      schedule: handleScheduleFromHeader,
      close: handleCloseActive,
    };
  }, [takeActiveConversation, handleScheduleFromHeader, handleCloseActive]);

  const activeIsClosed = activeConversation?.status === "closed";
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat) return;
      const target = e.target as HTMLElement | null;
      const action = shortcutFor(e.key, {
        typing: isTypingTarget(target?.tagName, !!target?.isContentEditable),
        overlayOpen:
          document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') !== null,
        modifier: e.metaKey || e.ctrlKey || e.altKey,
        canAct: canTakeNext,
      });
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case "next":
        case "prev": {
          const id = neighborId(visibleIdsRef.current, activeConversationId, action === "next" ? 1 : -1);
          if (id) void openByIdRef.current(id);
          return;
        }
        case "take":
          void actionsRef.current.take();
          return;
        case "schedule":
          // Sin etiquetas con fecha no hay nada que agendar; cerrada, tampoco.
          if (canSchedule && activeConversationId && !activeIsClosed) actionsRef.current.schedule();
          return;
        case "close":
          if (activeConversationId && !activeIsClosed) actionsRef.current.close();
          return;
        case "note":
          if (activeConversationId) sendComposerCommand(activeConversationId, "note");
          return;
        case "slash":
          if (activeConversationId) sendComposerCommand(activeConversationId, "slash");
          return;
        case "help":
          openShortcutsHelp();
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canTakeNext, canSchedule, activeConversationId, activeIsClosed]);

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
            conversations={visibleConversations}
            allConversations={store.conversations}
            filters={listFilters}
            onFiltersChange={setListFiltersWith}
            loading={store.loading}
            tags={store.tags}
            memberNames={store.memberNames}
            selection={selection}
            now={now}
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
            contact={liveContact}
            messages={messages}
            onMessagesLoaded={handleMessagesLoaded}
            onNewMessage={handleNewMessage}
            onUpdateMessage={handleUpdateMessage}
            onSetStatus={handleSetActiveStatus}
            onCloseConversation={handleCloseActive}
            onAssignChange={handleAssignChange}
            onBack={handleCloseConversation}
            resyncToken={resyncToken}
            onRefresh={handleManualRefresh}
            notes={notes}
            onSaveNote={handleSaveNote}
            memberNames={store.memberNames}
            call={activeCall}
            canSchedule={canSchedule}
            onSchedule={handleScheduleFromHeader}
            proposalAction={proposalAction}
          />
        </div>

        {/* Panel lateral (sesión D): Ficha, Llamadas, Notas o Propuestas
            según la pestaña del riel. Solo escritorio; en mobile no
            existe. Abierto o cerrado lo decide el riel (y la cruz). */}
        {sidePanel.open && (
          <div className="hidden h-full lg:flex">
            <SidePanel
              tab={panelTab}
              onClose={closeSidePanel}
              conversation={activeRow}
              notes={notes}
              onSaveNote={handleSaveNote}
              onAssignChange={handleAssignChange}
              onOpenConversation={handleSelectConversation}
              onSchedule={openSchedule}
              now={now}
            />
          </div>
        )}
      </div>

      {/* Modal "Agendar llamada" (prototipo `drawSchedule`). */}
      <ScheduleCallDialog
        request={scheduleRequest}
        onClose={closeSchedule}
        conversation={activeRow}
        conversations={store.conversations}
        accountTags={store.tags}
        now={now}
        onScheduled={handleScheduled}
      />
    </div>
  );
}
