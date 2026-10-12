"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { uniqueChannelName } from "@/lib/realtime/channel-name";
import {
  canSeeConversation,
  conversationVisibilityFilter,
} from "@/lib/auth/visibility";
import {
  INBOX_CONVERSATION_SELECT,
  LAST_CUSTOMER_MSG_ALIAS,
  LAST_MSG_ALIAS,
  applyIncomingMessage,
  normalizeInboxConversation,
  withInboxExtras,
  type InboxConversation,
} from "@/lib/inbox/inbox-conversation";
import type { AccountRole } from "@/lib/auth/roles";
import { beginLoad, createLoadSequence, shouldApply } from "@/lib/inbox/load-sequence";
import type { Contact, Conversation, Message, Tag } from "@/types";

// ============================================================
// Store compartido de la Bandeja (rediseño, sesión B).
//
// UNA lista de conversaciones para toda la app: la barra lateral
// cuenta las vistas y el embudo sobre ella y la lista de la Bandeja la
// filtra y la pinta. Al salir de la misma lista, un contador y la lista
// no pueden contar distinto. Vive en el shell (todas las pantallas) y
// se carga una vez cuando el perfil resuelve, con el mismo filtro de
// visibilidad que la Bandeja usaba (`conversationVisibilityFilter`).
//
// Se mantiene al día con UN canal de realtime de nombre único
// (`uniqueChannelName`; ver channel-name.ts por qué): mensajes,
// conversaciones, etiquetas del contacto y contactos. Cada evento
// toca la fila que le corresponde en memoria; nunca vuelve a pedir
// todo (eso fue #106). Solo una fila que no conocemos se hidrata
// sola, deduplicada por id mientras la consulta está en vuelo.
//
// El hilo abierto sigue siendo del inbox/page.tsx: el store solo sabe
// cuál es (`setActiveConversationId`) para no subir el contador de no
// leídos de un hilo que la persona está mirando, y avisa por
// `subscribeConversationUpdates` cuando esa fila cambia.
// ============================================================

export interface InboxStore {
  conversations: InboxConversation[];
  /** True hasta que la primera carga termina (o falla). */
  loading: boolean;
  /** Etiquetas de la cuenta: el embudo sale de las de estado; los filtros, de todas. */
  tags: Tag[];
  /** Nombre por `user_id` de los miembros que el RLS deja ver (el setter de cada fila). */
  memberNames: ReadonlyMap<string, string>;
  /** Actualiza filas en memoria (optimista). */
  patch: (updater: (prev: InboxConversation[]) => InboxConversation[]) => void;
  /**
   * Copia campos del contacto (etiquetas, fecha de la llamada, nombre…)
   * a toda fila que lo tenga. Es lo que la ficha avisa después de
   * escribir (sesión D): la lista, los contadores, la pestaña Llamadas
   * y el encabezado del hilo leen de acá, así se actualizan sin
   * recargar y sin esperar al realtime.
   */
  patchContact: (contactId: string, changes: Partial<Contact>) => void;
  /** Suma al catálogo en memoria una etiqueta recién creada desde la ficha. */
  addTag: (tag: Tag) => void;
  /** Trae una conversación por id con su contacto y la mete en la lista. */
  hydrate: (conversationId: string) => Promise<InboxConversation | null>;
  /** Vuelve a pedir la lista entera (reconexión, pestaña visible, botón de refrescar). */
  refetch: () => void;
  setActiveConversationId: (id: string | null) => void;
  subscribeConversationUpdates: (listener: (conv: Conversation) => void) => () => void;
}

const InboxStoreContext = createContext<InboxStore | null>(null);

function logSupabaseError(label: string, error: { message: string; details?: string; hint?: string; code?: string }) {
  // Supabase errors have non-enumerable properties — log fields explicitly.
  console.error(label, {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
  });
}

export function InboxStoreProvider({ children }: { children: ReactNode }) {
  const { user, accountRole, permissionOverrides, profileLoading } = useAuth();
  const userId = user?.id ?? null;

  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<Tag[]>([]);
  const [memberNames, setMemberNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [resyncToken, setResyncToken] = useState(0);

  // Espejos síncronos para los handlers de realtime (identidad estable).
  const visibilityRef = useRef<{
    role: AccountRole | null;
    overrides: Record<string, unknown>;
    userId: string | null;
  }>({ role: null, overrides: {}, userId: null });
  useEffect(() => {
    visibilityRef.current = { role: accountRole, overrides: permissionOverrides, userId };
  }, [accountRole, permissionOverrides, userId]);

  const knownRef = useRef<Map<string, InboxConversation>>(new Map());
  useEffect(() => {
    const next = new Map<string, InboxConversation>();
    for (const c of conversations) next.set(c.id, c);
    knownRef.current = next;
  }, [conversations]);

  const activeIdRef = useRef<string | null>(null);
  const hydratingRef = useRef<Set<string>>(new Set());
  const listenersRef = useRef<Set<(conv: Conversation) => void>>(new Set());
  // Número de pedido de la carga: gana la respuesta más nueva. Ver
  // load-sequence.ts por qué no hay un guard de "una sola en vuelo".
  const loadSeqRef = useRef(createLoadSequence());

  const setActiveConversationId = useCallback((id: string | null) => {
    activeIdRef.current = id;
  }, []);

  const subscribeConversationUpdates = useCallback(
    (listener: (conv: Conversation) => void) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    [],
  );

  const patch = useCallback(
    (updater: (prev: InboxConversation[]) => InboxConversation[]) => {
      setConversations(updater);
    },
    [],
  );

  const patchContact = useCallback((contactId: string, changes: Partial<Contact>) => {
    setConversations((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        if (!c.contact || c.contact.id !== contactId) return c;
        changed = true;
        return { ...c, contact: { ...c.contact, ...changes } };
      });
      return changed ? next : prev;
    });
  }, []);

  const addTag = useCallback((tag: Tag) => {
    setTags((prev) =>
      prev.some((t) => t.id === tag.id)
        ? prev
        : [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }, []);

  const refetch = useCallback(() => {
    setResyncToken((n) => n + 1);
  }, []);

  // ---- carga inicial / resync -------------------------------------
  // Cada corrida pide SIEMPRE y se aplica solo la respuesta más nueva.
  // Las dependencias cambian más de una vez al arrancar (el perfil se
  // pide dos veces); con el guard viejo de "una sola consulta en vuelo"
  // más el cancelled del cleanup, la respuesta en vuelo se descartaba
  // y la corrida nueva no pedía: la lista quedaba cargando para siempre.
  useEffect(() => {
    if (profileLoading) return;
    const requestId = beginLoad(loadSeqRef.current);
    const supabase = createClient();

    (async () => {
      let query = supabase
        .from("conversations")
        .select(INBOX_CONVERSATION_SELECT)
        .order("last_message_at", { ascending: false })
        // Último mensaje y último mensaje del cliente, UNO por
        // conversación, en la misma consulta (orden + límite sobre el
        // embebido). Sin una consulta por fila y sin funciones nuevas.
        .order("created_at", { referencedTable: LAST_MSG_ALIAS, ascending: false })
        .limit(1, { referencedTable: LAST_MSG_ALIAS })
        .eq(`${LAST_CUSTOMER_MSG_ALIAS}.sender_type`, "customer")
        .order("created_at", { referencedTable: LAST_CUSTOMER_MSG_ALIAS, ascending: false })
        .limit(1, { referencedTable: LAST_CUSTOMER_MSG_ALIAS });

      const orFilter = conversationVisibilityFilter(accountRole, permissionOverrides, userId ?? "");
      if (orFilter) query = query.or(orFilter);

      const { data, error } = await query;
      // Otra corrida pidió después: su respuesta es la que vale.
      if (!shouldApply(loadSeqRef.current, requestId)) return;
      if (error) {
        logSupabaseError("Failed to fetch conversations:", error);
        setLoading(false);
        return;
      }
      // El parser de tipos de postgrest no entiende los embebidos con
      // alias; la forma real la fija normalizeInboxConversation.
      const rows = (data ?? []) as unknown as Parameters<typeof normalizeInboxConversation>[0][];
      setConversations(rows.map(normalizeInboxConversation));
      setLoading(false);
    })();
  }, [resyncToken, profileLoading, accountRole, permissionOverrides, userId]);

  // ---- etiquetas de la cuenta --------------------------------------
  useEffect(() => {
    if (profileLoading) return;
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileLoading, resyncToken]);

  // ---- miembros (setter de cada fila) ------------------------------
  // Mismo origen que el selector de asignación del hilo: `profiles`,
  // acotado por RLS a la cuenta. Una lectura por carga.
  useEffect(() => {
    if (profileLoading) return;
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .order("full_name");
      if (cancelled || !data) return;
      const next = new Map<string, string>();
      for (const row of data as { user_id: string; full_name: string | null; email: string | null }[]) {
        next.set(row.user_id, row.full_name?.trim() || row.email || "");
      }
      setMemberNames(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileLoading, resyncToken]);

  // ---- hidratar una fila -------------------------------------------
  const hydrate = useCallback(async (convId: string): Promise<InboxConversation | null> => {
    if (hydratingRef.current.has(convId)) return knownRef.current.get(convId) ?? null;
    hydratingRef.current.add(convId);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("conversations")
        .select(INBOX_CONVERSATION_SELECT)
        .eq("id", convId)
        .order("created_at", { referencedTable: LAST_MSG_ALIAS, ascending: false })
        .limit(1, { referencedTable: LAST_MSG_ALIAS })
        .eq(`${LAST_CUSTOMER_MSG_ALIAS}.sender_type`, "customer")
        .order("created_at", { referencedTable: LAST_CUSTOMER_MSG_ALIAS, ascending: false })
        .limit(1, { referencedTable: LAST_CUSTOMER_MSG_ALIAS })
        .maybeSingle();
      if (error) {
        logSupabaseError("Failed to hydrate conversation:", error);
        return null;
      }
      if (!data) return null;
      const fetched = normalizeInboxConversation(
        data as unknown as Parameters<typeof normalizeInboxConversation>[0],
      );
      const { role, overrides, userId: uid } = visibilityRef.current;
      if (!canSeeConversation(role, overrides, uid, fetched.assigned_agent_id ?? null)) {
        return null;
      }
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === fetched.id);
        if (existing) {
          // Ya estaba: una fila de realtime puede haber dejado la vista
          // previa y el contador más frescos que lo que acabamos de
          // leer. Se completa lo que el payload nunca trae (el contacto
          // con sus etiquetas y los dos datos de mensajes).
          return prev.map((c) =>
            c.id === fetched.id
              ? {
                  ...c,
                  contact: fetched.contact ?? c.contact,
                  last_sender_type: fetched.last_sender_type ?? c.last_sender_type,
                  last_customer_message_at:
                    fetched.last_customer_message_at ?? c.last_customer_message_at,
                }
              : c,
          );
        }
        return [fetched, ...prev];
      });
      return fetched;
    } finally {
      hydratingRef.current.delete(convId);
    }
  }, []);

  // ---- realtime ----------------------------------------------------
  const subscribedOnceRef = useRef(false);
  useEffect(() => {
    if (profileLoading) return;
    const supabase = createClient();

    const onMessage = (message: Message) => {
      const isActive = activeIdRef.current === message.conversation_id;
      if (knownRef.current.has(message.conversation_id)) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === message.conversation_id ? applyIncomingMessage(c, message, isActive) : c,
          ),
        );
      } else {
        // Primer mensaje de un hilo que no conocemos: el INSERT de la
        // conversación no llegó todavía o se perdió. Se hidrata una vez.
        void hydrate(message.conversation_id);
      }
    };

    const onConversation = (eventType: string, conv: Conversation) => {
      const { role, overrides, userId: uid } = visibilityRef.current;
      if (!canSeeConversation(role, overrides, uid, conv.assigned_agent_id ?? null)) {
        // Un hilo que pasó a otro agente sale de la lista del que no lo ve.
        if (eventType === "UPDATE") {
          setConversations((prev) => prev.filter((c) => c.id !== conv.id));
        }
        return;
      }
      if (eventType === "INSERT") {
        if (!knownRef.current.has(conv.id)) {
          setConversations((prev) =>
            prev.some((c) => c.id === conv.id) ? prev : [withInboxExtras(conv), ...prev],
          );
          void hydrate(conv.id);
        }
        return;
      }
      if (eventType === "UPDATE") {
        if (knownRef.current.has(conv.id)) {
          const isActive = activeIdRef.current === conv.id;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conv.id
                ? {
                    ...c,
                    ...conv,
                    contact: c.contact,
                    last_sender_type: c.last_sender_type,
                    last_customer_message_at: c.last_customer_message_at,
                    // La persona está leyendo ese hilo ahora mismo: un
                    // contador positivo solo parpadearía hasta que el
                    // reset del servidor dé la vuelta.
                    unread_count: isActive ? 0 : conv.unread_count,
                  }
                : c,
            ),
          );
        } else {
          void hydrate(conv.id);
        }
        for (const listener of listenersRef.current) listener(conv);
        return;
      }
      if (eventType === "DELETE") {
        setConversations((prev) => prev.filter((c) => c.id !== conv.id));
      }
    };

    // Etiqueta puesta o sacada a un contacto (el estado cambió, en
    // esta pestaña o en otra): se relee ESA conversación, no la lista.
    const onContactTag = (row: { contact_id?: string }) => {
      if (!row.contact_id) return;
      for (const c of knownRef.current.values()) {
        if (c.contact_id === row.contact_id) void hydrate(c.id);
      }
    };

    // Contacto editado (nombre, empresa, fecha de la llamada): se copian
    // los campos a la fila; las etiquetas quedan como estaban.
    const onContact = (contact: Contact) => {
      setConversations((prev) => {
        let changed = false;
        const next = prev.map((c) => {
          if (c.contact_id !== contact.id) return c;
          changed = true;
          return { ...c, contact: { ...contact, tags: c.contact?.tags ?? [] } };
        });
        return changed ? next : prev;
      });
    };

    const channel = supabase
      .channel(uniqueChannelName("inbox-store"))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => onMessage(payload.new as Message),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) =>
          onConversation(
            payload.eventType,
            (payload.eventType === "DELETE" ? payload.old : payload.new) as Conversation,
          ),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "contact_tags" },
        (payload) => onContactTag(payload.new as { contact_id?: string }),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "contact_tags" },
        (payload) => onContactTag(payload.old as { contact_id?: string }),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "contacts" },
        (payload) => onContact(payload.new as Contact),
      )
      .subscribe((status) => {
        // Reconexión después de la primera: lo que pasó mientras el
        // socket estaba caído se perdió; se vuelve a pedir la lista.
        if (status === "SUBSCRIBED") {
          if (subscribedOnceRef.current) setResyncToken((n) => n + 1);
          subscribedOnceRef.current = true;
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profileLoading, hydrate]);

  // Pestaña que vuelve a estar visible: el navegador puede haber
  // frenado el socket sin cortarlo. Barato; la carga dedupea sola.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") setResyncToken((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const value = useMemo<InboxStore>(
    () => ({
      conversations,
      loading,
      tags,
      memberNames,
      patch,
      patchContact,
      addTag,
      hydrate,
      refetch,
      setActiveConversationId,
      subscribeConversationUpdates,
    }),
    [conversations, loading, tags, memberNames, patch, patchContact, addTag, hydrate, refetch, setActiveConversationId, subscribeConversationUpdates],
  );

  return <InboxStoreContext.Provider value={value}>{children}</InboxStoreContext.Provider>;
}

const EMPTY_STORE: InboxStore = {
  conversations: [],
  loading: true,
  tags: [],
  memberNames: new Map(),
  patch: () => {},
  patchContact: () => {},
  addTag: () => {},
  hydrate: async () => null,
  refetch: () => {},
  setActiveConversationId: () => {},
  subscribeConversationUpdates: () => () => {},
};

/** Fuera del provider (una pantalla sin shell) devuelve un store vacío e inerte. */
export function useInboxStore(): InboxStore {
  return useContext(InboxStoreContext) ?? EMPTY_STORE;
}
