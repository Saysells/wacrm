"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useRealtime } from "@/hooks/use-realtime";
import { createClient } from "@/lib/supabase/client";
import { APP_NAME } from "@/lib/app-name";
import { canSeeConversation, conversationVisibilityFilter } from "@/lib/auth/visibility";
import { sortByFunnel } from "@/lib/contacts/tag-groups";
import {
  CONVERSATION_SELECT,
  normalizeConversation,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import {
  VISTAS,
  filtrarConversaciones,
  type Vista,
} from "@/lib/movil/bandeja";
import {
  CHANNEL_LABEL,
  canalInicial,
  canalesVisibles,
  mostrarSelectorDeCanal,
} from "@/lib/movil/canales";
import { ConversationRow } from "@/components/movil/conversation-row";
import {
  IconAccount,
  IconCheck,
  IconInstagram,
  IconSearch,
  IconTag,
  IconWhatsApp,
} from "@/components/movil/icons";
import { MobileScreen } from "@/components/movil/screen";
import { MobileSheet } from "@/components/movil/sheet";
import { useToast } from "@/components/movil/toast";
import type { AccountChannel, Channel, Conversation, Tag } from "@/types";

type SheetAbierta = "cuenta" | "estado" | null;

const ICONO_CANAL: Record<Channel, () => React.JSX.Element> = {
  whatsapp: IconWhatsApp,
  instagram: IconInstagram,
};

/**
 * La Bandeja movil contra datos reales.
 *
 * Lee por el cliente de Supabase del navegador, con la sesion del
 * usuario: manda RLS. La service_role no aparece por ningun lado y no
 * puede — es una variable de servidor.
 *
 * El filtro de visibilidad (`conversationVisibilityFilter`) es el mismo
 * que usa la lista de escritorio: un agent sin `view_all_data` ve lo
 * suyo y lo sin asignar. Es una optimizacion sobre lo que la RLS
 * 040/041 ya aplica en la base, no el control de acceso.
 */
export function Bandeja() {
  const { user, accountRole, permissionOverrides, profileLoading, account } = useAuth();
  const userId = user?.id ?? null;
  const toast = useToast();

  const [conversaciones, setConversaciones] = useState<Conversation[]>([]);
  const [cargando, setCargando] = useState(true);
  const [etiquetas, setEtiquetas] = useState<Tag[]>([]);
  const [canales, setCanales] = useState<AccountChannel[] | null>(null);

  const [vista, setVista] = useState<Vista>("todas");
  const [busqueda, setBusqueda] = useState("");
  const [tagId, setTagId] = useState<string | null>(null);
  const [canal, setCanal] = useState<Channel | null>(null);
  const [sheet, setSheet] = useState<SheetAbierta>(null);

  /**
   * El "ahora" de los rotulos de hora. Se refresca por minuto para que
   * un hilo de las 23:59 pase a decir "ayer" sin recargar, y se comparte
   * entre todas las filas para que no se calculen contra relojes
   * distintos.
   */
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  /**
   * Espejo sincronico del rol para los eventos de realtime. Igual que
   * en la pagina de escritorio: los handlers son de larga vida y tienen
   * que leer el rol actual sin volver a suscribirse.
   */
  const visibilidadRef = useRef({
    role: accountRole,
    overrides: permissionOverrides,
    userId,
  });
  useEffect(() => {
    visibilidadRef.current = { role: accountRole, overrides: permissionOverrides, userId };
  }, [accountRole, permissionOverrides, userId]);

  /** Ids que ya estan en la lista, para no re-hidratar de mas. */
  const conocidasRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    conocidasRef.current = new Set(conversaciones.map((c) => c.id));
  }, [conversaciones]);

  /** Hidrataciones en vuelo: el evento de conversacion y el del primer
   *  mensaje llegan con milisegundos de diferencia y pedirian dos. */
  const hidratandoRef = useRef<Set<string>>(new Set());

  // ── carga inicial ───────────────────────────────────────────
  useEffect(() => {
    // Sin rol resuelto todavia no se sabe que filtrar.
    if (profileLoading) return;
    const supabase = createClient();
    let cancelado = false;

    (async () => {
      let query = supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .order("last_message_at", { ascending: false });

      const or = conversationVisibilityFilter(
        accountRole,
        permissionOverrides,
        userId ?? "",
      );
      if (or) query = query.or(or);

      const { data, error } = await query;
      if (cancelado) return;
      if (error) {
        // Los errores de Supabase tienen propiedades no enumerables:
        // sin desarmarlos el console.error imprime `{}`.
        console.error("No se pudieron traer las conversaciones:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setCargando(false);
        return;
      }
      setConversaciones(normalizeConversations(data ?? []));
      setCargando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, [profileLoading, accountRole, permissionOverrides, userId]);

  // ── etiquetas de estado y canales de la cuenta ──────────────
  useEffect(() => {
    const supabase = createClient();
    let cancelado = false;

    (async () => {
      const [tags, channels] = await Promise.all([
        supabase.from("tags").select("*").order("name"),
        supabase.from("account_channels").select("*"),
      ]);
      if (cancelado) return;

      if (tags.data) {
        // Solo las de estado, y en orden de embudo: es el filtro que
        // pidieron, no el catalogo entero de la cuenta.
        setEtiquetas(
          sortByFunnel((tags.data as Tag[]).filter((t) => t.grupo === "estado")),
        );
      }
      // Sin filas (o con la lectura fallada) la fila de canales no se
      // dibuja y no se filtra por canal: la Bandeja sigue andando.
      setCanales((channels.data as AccountChannel[] | null) ?? []);
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  // El canal arranca en el primer prendido, una sola vez, cuando llegan
  // las filas. Despues manda lo que toque el usuario.
  const canalElegidoRef = useRef(false);
  useEffect(() => {
    if (!canales || canalElegidoRef.current) return;
    canalElegidoRef.current = true;
    setCanal(canalInicial(canales));
  }, [canales]);

  // ── realtime ────────────────────────────────────────────────
  /**
   * Trae la fila con su contacto joineado. Los payloads de Realtime
   * solo traen las columnas de la propia tabla, asi que una
   * conversacion nueva llega SIN contacto: sin esto la fila aparece sin
   * nombre y sin etiquetas hasta que se recarga.
   */
  const hidratar = useCallback(async (convId: string) => {
    if (hidratandoRef.current.has(convId)) return;
    hidratandoRef.current.add(convId);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .eq("id", convId)
        .maybeSingle();
      if (error || !data) return;

      const fila = normalizeConversation(data);
      const { role, overrides, userId: uid } = visibilidadRef.current;
      // Un agent filtrado nunca se trae a la lista el hilo de otro.
      if (!canSeeConversation(role, overrides, uid, fila.assigned_agent_id)) return;

      setConversaciones((prev) => {
        const i = prev.findIndex((c) => c.id === fila.id);
        if (i === -1) return [fila, ...prev];
        const copia = [...prev];
        copia[i] = fila;
        return copia;
      });
    } finally {
      hidratandoRef.current.delete(convId);
    }
  }, []);

  useRealtime({
    channelName: "movil-bandeja",
    enabled: !profileLoading,
    onConversationEvent: (evento) => {
      const fila = evento.new;
      if (evento.eventType === "DELETE") {
        const id = (evento.old as Partial<Conversation>).id;
        if (id) setConversaciones((prev) => prev.filter((c) => c.id !== id));
        return;
      }
      if (!fila?.id) return;

      const { role, overrides, userId: uid } = visibilidadRef.current;
      if (!canSeeConversation(role, overrides, uid, fila.assigned_agent_id)) {
        // Se la acaban de asignar a otro: sale de la lista.
        setConversaciones((prev) => prev.filter((c) => c.id !== fila.id));
        return;
      }

      // Nueva ⇒ hidratar (el payload no trae el contacto). Conocida ⇒
      // fusionar las columnas propias y CONSERVAR el contacto que ya
      // tenemos, que es justo lo que el payload no incluye.
      if (!conocidasRef.current.has(fila.id)) {
        void hidratar(fila.id);
        return;
      }
      setConversaciones((prev) =>
        prev.map((c) => (c.id === fila.id ? { ...c, ...fila, contact: c.contact } : c)),
      );
    },
    onMessageEvent: (evento) => {
      if (evento.eventType !== "INSERT") return;
      const convId = evento.new?.conversation_id;
      // Red de seguridad: el trigger de la base actualiza
      // last_message_* y eso ya llega como UPDATE de conversacion. Esto
      // solo cubre el caso de que ese evento se haya perdido o llegue
      // despues del mensaje.
      if (convId && !conocidasRef.current.has(convId)) void hidratar(convId);
    },
  });

  // ── presentacion ────────────────────────────────────────────
  const visibles = useMemo(
    () => filtrarConversaciones(conversaciones, { vista, userId, canal, tagId, busqueda }),
    [conversaciones, vista, userId, canal, tagId, busqueda],
  );

  const pildorasCanal = useMemo(
    () => (canales && mostrarSelectorDeCanal(canales) ? canalesVisibles(canales) : []),
    [canales],
  );

  const etiquetaElegida = etiquetas.find((t) => t.id === tagId) ?? null;

  return (
    <MobileScreen
      title={APP_NAME}
      actions={
        <button
          type="button"
          className="m-ibtn"
          onClick={() => setSheet("cuenta")}
          aria-label="Cuenta"
        >
          <IconAccount />
        </button>
      }
      scroll={false}
    >
      <div className="m-search">
        <IconSearch />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar conversaciones"
          aria-label="Buscar conversaciones"
          type="search"
          enterKeyHint="search"
        />
      </div>

      <div className="m-seg" role="tablist" aria-label="Vista">
        {VISTAS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={vista === v.id}
            className={vista === v.id ? "on" : undefined}
            onClick={() => setVista(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* La fila de canales. Sale de account_channels: con una sola fila
          no se dibuja, con dos o mas se dibuja siempre aunque una este
          apagada — el caso de hoy. Prenderla es un UPDATE, no un deploy. */}
      {pildorasCanal.length > 0 ? (
        <div className="m-filterrow" role="group" aria-label="Canal">
          {pildorasCanal.map(({ channel, enabled }) => {
            const Icono = ICONO_CANAL[channel];
            const activo = enabled && canal === channel;
            return (
              <button
                key={channel}
                type="button"
                className={`m-fbtn${activo ? " active" : ""}${enabled ? "" : " off"}`}
                aria-pressed={activo}
                aria-disabled={!enabled}
                onClick={() =>
                  enabled
                    ? setCanal(channel)
                    : toast(`${CHANNEL_LABEL[channel]} todavía no está conectado`)
                }
              >
                <Icono />
                <span>{CHANNEL_LABEL[channel]}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="m-filterrow">
        <button
          type="button"
          className={`m-fbtn${tagId ? " active" : ""}`}
          onClick={() => setSheet("estado")}
        >
          <IconTag />
          <span>{etiquetaElegida?.name ?? "Estado"}</span>
        </button>
      </div>

      <div className="m-content pad-tab">
        {cargando ? (
          <div className="m-empty">Cargando…</div>
        ) : visibles.length === 0 ? (
          <div className="m-empty">
            <b>Nada por acá</b>
            {conversaciones.length === 0
              ? "Todavía no hay conversaciones en esta cuenta."
              : "Probá con otro filtro o buscá por nombre."}
          </div>
        ) : (
          <ul>
            {visibles.map((c) => (
              <ConversationRow key={c.id} conversation={c} ahora={ahora} />
            ))}
          </ul>
        )}
      </div>

      <MobileSheet
        open={sheet === "cuenta"}
        title="Cuenta"
        onClose={() => setSheet(null)}
      >
        {/* Una sola cuenta, la del perfil: en este producto un usuario
            pertenece a exactamente una (profiles.account_id, migracion
            017) y las dos bandejas son dos instancias con bases
            separadas. No hay switch porque no hay a donde cambiar. */}
        <div className="m-opt sel">
          <div className="ico">
            <IconAccount />
          </div>
          <div className="t">
            {account?.name ?? "Cargando…"}
            <small>{user?.email}</small>
          </div>
          <IconCheck />
        </div>
        <div className="m-sec">Sesión</div>
        <div className="m-kv">
          <span>Rol</span>
          <span>{accountRole ?? "—"}</span>
        </div>
      </MobileSheet>

      <MobileSheet
        open={sheet === "estado"}
        title="Filtrar por estado"
        onClose={() => setSheet(null)}
      >
        <button
          type="button"
          className={`m-opt${tagId === null ? " sel" : ""}`}
          onClick={() => {
            setTagId(null);
            setSheet(null);
          }}
        >
          <div className="t">Todos los estados</div>
          <IconCheck />
        </button>
        {etiquetas.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`m-opt${tagId === t.id ? " sel" : ""}`}
            onClick={() => {
              setTagId(t.id);
              setSheet(null);
            }}
          >
            <div className="t">{t.name}</div>
            <IconCheck />
          </button>
        ))}
        {etiquetas.length === 0 ? (
          <div className="m-empty">Esta cuenta no tiene etiquetas de estado.</div>
        ) : null}
      </MobileSheet>
    </MobileScreen>
  );
}
