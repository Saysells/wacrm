"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useRealtime } from "@/hooks/use-realtime";
import { refitAfterFocus } from "@/hooks/use-viewport-fit";
import { createClient } from "@/lib/supabase/client";
import { CONVERSATION_SELECT, normalizeConversation } from "@/lib/inbox/conversations";
import {
  claseEstado,
  estadoDe,
  iniciales,
  nombreVisible,
} from "@/lib/movil/bandeja";
import {
  agruparPorDia,
  confirmarOptimista,
  crearMensajeOptimista,
  fusionarMensaje,
  marcarFallido,
  previewCita,
  esSaliente,
} from "@/lib/movil/chat";
import { MessageBubble } from "@/components/movil/message-bubble";
import { MobileScreen, useVolver } from "@/components/movil/screen";
import { useToast } from "@/components/movil/toast";
import {
  IconAttach,
  IconClose,
  IconInfo,
  IconMic,
  IconQuick,
  IconSend,
} from "@/components/movil/icons";
import type { Conversation, Message } from "@/types";

/** El alto maximo del textarea antes de que scrollee, como en la maqueta. */
const ALTO_MAX_COMPOSER = 100;

export function Chat({ conversationId }: { conversationId: string }) {
  const { user, canSendMessages } = useAuth();
  const userId = user?.id ?? null;
  const volver = useVolver();
  const toast = useToast();

  const [conversacion, setConversacion] = useState<Conversation | null>(null);
  const [mensajes, setMensajes] = useState<Message[]>([]);
  const [cargando, setCargando] = useState(true);
  const [noEncontrada, setNoEncontrada] = useState(false);
  const [texto, setTexto] = useState("");
  const [citando, setCitando] = useState<Message | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nombrePorUsuario, setNombrePorUsuario] = useState<Record<string, string>>({});

  const cajaRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const alFondo = useCallback(() => {
    const caja = cajaRef.current;
    if (caja) caja.scrollTop = caja.scrollHeight;
  }, []);

  // ── carga ───────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    let cancelado = false;

    (async () => {
      setCargando(true);
      const [conv, msgs, perfiles] = await Promise.all([
        supabase
          .from("conversations")
          .select(CONVERSATION_SELECT)
          .eq("id", conversationId)
          .maybeSingle(),
        supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }),
        supabase.from("profiles").select("user_id, full_name"),
      ]);
      if (cancelado) return;

      // Sin fila no es un 404 del router: puede ser una conversacion de
      // otra cuenta, y ahi la RLS devuelve vacio, no un error.
      if (!conv.data) {
        setNoEncontrada(true);
        setCargando(false);
        return;
      }

      setConversacion(normalizeConversation(conv.data));
      setMensajes((msgs.data as Message[] | null) ?? []);

      const nombres: Record<string, string> = {};
      for (const p of (perfiles.data as { user_id: string; full_name: string | null }[] | null) ??
        []) {
        if (p.full_name) nombres[p.user_id] = p.full_name;
      }
      setNombrePorUsuario(nombres);
      setCargando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, [conversationId]);

  // Al fondo cuando termina de cargar y cuando entra un mensaje.
  useEffect(() => {
    if (!cargando) requestAnimationFrame(alFondo);
  }, [cargando, mensajes.length, alFondo]);

  // ── marcar leido al abrir ───────────────────────────────────
  // Se dispara una sola vez por conversacion abierta y solo si habia
  // algo sin leer: sin esa guarda, el UPDATE dispara un evento de
  // realtime que vuelve como cambio de conversacion y pide otro UPDATE.
  const marcadaRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversacion || marcadaRef.current === conversacion.id) return;
    if ((conversacion.unread_count ?? 0) === 0) return;
    marcadaRef.current = conversacion.id;
    const supabase = createClient();
    void supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversacion.id)
      .then(({ error }) => {
        if (error) console.error("No se pudo marcar como leida:", error.message);
      });
  }, [conversacion]);

  // ── realtime del hilo abierto ───────────────────────────────
  useRealtime({
    channelName: `movil-chat-${conversationId}`,
    onMessageEvent: (evento) => {
      const fila = evento.new;
      // El canal escucha `messages` entera; el hilo abierto se queda
      // solo con lo suyo.
      if (!fila?.id || fila.conversation_id !== conversationId) return;
      if (evento.eventType === "DELETE") return;
      setMensajes((prev) => fusionarMensaje(prev, fila));
    },
    onConversationEvent: (evento) => {
      const fila = evento.new;
      if (!fila?.id || fila.id !== conversationId) return;
      // El payload no trae el contacto: se conserva el que ya tenemos.
      setConversacion((prev) => (prev ? { ...prev, ...fila, contact: prev.contact } : prev));
    },
  });

  // ── enviar ──────────────────────────────────────────────────
  const enviar = useCallback(async () => {
    const limpio = texto.trim();
    if (!limpio || enviando) return;
    if (!canSendMessages) {
      toast("Tu rol no permite enviar mensajes");
      return;
    }

    const optimista = crearMensajeOptimista({
      conversationId,
      texto: limpio,
      senderId: userId,
      replyToMessageId: citando?.id ?? null,
    });

    // La burbuja aparece al toque y el composer queda libre. Si el
    // envio falla, la burbuja se marca; no desaparece, para que nadie
    // se quede creyendo que mando algo que no salio.
    setMensajes((prev) => [...prev, optimista]);
    setTexto("");
    setCitando(null);
    setEnviando(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          message_type: "text",
          content_text: limpio,
          reply_to_message_id: citando?.id,
        }),
      });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok || !datos?.success) {
        setMensajes((prev) => marcarFallido(prev, optimista.id));
        toast(datos?.error ?? "No se pudo enviar");
        return;
      }
      setMensajes((prev) => confirmarOptimista(prev, optimista.id, datos.message_id));
    } catch {
      setMensajes((prev) => marcarFallido(prev, optimista.id));
      toast("Sin conexión: el mensaje no salió");
    } finally {
      setEnviando(false);
    }
  }, [texto, enviando, canSendMessages, conversationId, userId, citando, toast]);

  // ── presentacion ────────────────────────────────────────────
  const contacto = conversacion?.contact;
  const nombre = nombreVisible(contacto);
  const estado = estadoDe(contacto);
  const grupos = useMemo(() => agruparPorDia(mensajes, ahora), [mensajes, ahora]);
  const porId = useMemo(() => {
    const mapa = new Map<string, Message>();
    for (const m of mensajes) mapa.set(m.id, m);
    return mapa;
  }, [mensajes]);

  const hayTexto = texto.trim().length > 0;

  return (
    <MobileScreen
      onBack={volver}
      scroll={false}
      head={
        <div className="m-chathead">
          <div className="m-av sm" aria-hidden="true">
            {iniciales(nombre)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="nm">{nombre}</div>
            {estado ? (
              <div className="st">
                <span className={`m-chip ${claseEstado(estado.name)}`}>{estado.name}</span>
              </div>
            ) : null}
          </div>
        </div>
      }
      actions={
        // Adjuntos, audio y reacciones son de la sesion 2; la ficha del
        // contacto tampoco entra en esta. El boton queda a la vista y
        // sin accion, como se pidio, en vez de desaparecer.
        <button type="button" className="m-ibtn" aria-label="Detalles" aria-disabled="true">
          <IconInfo />
        </button>
      }
    >
      <div className="m-msgs" ref={cajaRef}>
        {cargando ? (
          <div className="m-empty">Cargando…</div>
        ) : noEncontrada ? (
          <div className="m-empty">
            <b>No encontramos esta conversación</b>
            Puede que sea de otra cuenta.
          </div>
        ) : grupos.length === 0 ? (
          <div className="m-empty">
            <b>Todavía no hay mensajes</b>
            Escribí el primero acá abajo.
          </div>
        ) : (
          grupos.map((grupo, i) => (
            <div key={`${grupo.dia}-${i}`} style={{ display: "contents" }}>
              <div className="m-day">{grupo.dia}</div>
              {grupo.mensajes.map((m) => (
                <MessageBubble
                  key={m.id}
                  mensaje={m}
                  citado={m.reply_to_message_id ? porId.get(m.reply_to_message_id) : undefined}
                  userId={userId}
                  nombrePorUsuario={nombrePorUsuario}
                  nombreContacto={nombre}
                  hora={new Date(m.created_at).toLocaleTimeString("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                  onResponder={setCitando}
                />
              ))}
            </div>
          ))
        )}
      </div>

      <div className="m-composer">
        {citando ? (
          <div className="m-reply-bar">
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{esSaliente(citando) ? "Vos" : nombre}</b>
              <span>{previewCita(citando)}</span>
            </div>
            <button
              type="button"
              className="m-ibtn"
              style={{ width: 30, height: 30 }}
              onClick={() => setCitando(null)}
              aria-label="No responder a este mensaje"
            >
              <IconClose />
            </button>
          </div>
        ) : null}

        <div className="m-crow">
          {/* Adjuntar: visible y sin accion, es de la sesion 2. */}
          <button type="button" className="m-ibtn" aria-label="Adjuntar" aria-disabled="true">
            <IconAttach />
          </button>

          <div className="m-cinput">
            <textarea
              ref={textareaRef}
              rows={1}
              value={texto}
              placeholder="Escribí un mensaje"
              enterKeyHint="send"
              onFocus={refitAfterFocus}
              onChange={(e) => {
                setTexto(e.target.value);
                const ta = e.currentTarget;
                ta.style.height = "auto";
                ta.style.height = `${Math.min(ta.scrollHeight, ALTO_MAX_COMPOSER)}px`;
              }}
            />
            {/* Respuestas rapidas: visible y sin accion, es de la sesion 2. */}
            <button
              type="button"
              className="m-ibtn"
              aria-label="Respuestas rápidas"
              aria-disabled="true"
            >
              <IconQuick />
            </button>
          </div>

          {hayTexto ? (
            <button
              type="button"
              className="m-sendbtn"
              onClick={enviar}
              disabled={enviando}
              aria-label="Enviar"
            >
              <IconSend />
            </button>
          ) : (
            // El microfono queda a la vista y sin accion: el audio es de
            // la sesion 2. Esconderlo cambiaria la maqueta.
            <button
              type="button"
              className="m-sendbtn mic"
              aria-label="Grabar un audio"
              aria-disabled="true"
            >
              <IconMic />
            </button>
          )}
        </div>

        <div className="m-hint">
          {hayTexto ? "" : "Mantené presionado un mensaje para responderlo citando"}
        </div>
      </div>
    </MobileScreen>
  );
}
