"use client";

import { useRef } from "react";

import {
  esSaliente,
  estadoEnvio,
  previewCita,
  rotuloAutor,
} from "@/lib/movil/chat";
import { IconCheck, IconClock, IconDoubleCheck } from "@/components/movil/icons";
import type { Message } from "@/types";

/** Cuanto hay que mantener apretado para que cuente como pulsacion larga. */
const PULSACION_LARGA_MS = 450;
/** Si el dedo se movio mas que esto, era un scroll y no una pulsacion. */
const TOLERANCIA_PX = 10;

function Estado({ mensaje }: { mensaje: Message }) {
  const estado = estadoEnvio(mensaje);
  if (estado === "fallido") return <span className="failed">No se envió</span>;
  if (estado === "pendiente") return <IconClock />;
  if (estado === "enviado") return <IconCheck />;
  // Entregado y leido comparten el doble tilde; el leido lo pinta el CSS
  // por la clase, como en la maqueta.
  return <IconDoubleCheck />;
}

export function MessageBubble({
  mensaje,
  citado,
  userId,
  nombrePorUsuario,
  nombreContacto,
  hora,
  onResponder,
}: {
  mensaje: Message;
  /** El mensaje al que responde, si lo tenemos cargado. */
  citado: Message | undefined;
  userId: string | null;
  nombrePorUsuario: Readonly<Record<string, string>>;
  nombreContacto: string;
  hora: string;
  /** Pulsacion larga: responder citando. */
  onResponder: (mensaje: Message) => void;
}) {
  const saliente = esSaliente(mensaje);
  const rotulo = rotuloAutor(mensaje, { userId, nombrePorUsuario });
  const estado = estadoEnvio(mensaje);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origenRef = useRef<{ x: number; y: number } | null>(null);

  const cancelar = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  return (
    <div
      className={`m-m ${saliente ? "out" : "in"}`}
      onTouchStart={(e) => {
        const t = e.touches[0];
        origenRef.current = { x: t.clientX, y: t.clientY };
        timerRef.current = setTimeout(() => onResponder(mensaje), PULSACION_LARGA_MS);
      }}
      onTouchMove={(e) => {
        const o = origenRef.current;
        if (!o) return;
        const t = e.touches[0];
        if (
          Math.abs(t.clientX - o.x) > TOLERANCIA_PX ||
          Math.abs(t.clientY - o.y) > TOLERANCIA_PX
        ) {
          cancelar();
        }
      }}
      onTouchEnd={cancelar}
      onTouchCancel={cancelar}
      // Desde una computadora (asi se prueba sin telefono) el equivalente
      // es el menu contextual del boton derecho.
      onContextMenu={(e) => {
        e.preventDefault();
        onResponder(mensaje);
      }}
    >
      <div className="m-b">
        {/* El bot lleva "Bot" arriba y por lo demas es identico a la
            burbuja del agente: mismo lado, mismo azul. Pedido expreso. */}
        {rotulo ? <div className="m-who">{rotulo}</div> : null}
        {citado ? (
          <div className="m-quote">
            <small>{esSaliente(citado) ? "Vos" : nombreContacto}</small>
            {previewCita(citado)}
          </div>
        ) : null}
        {mensaje.content_text ? (
          mensaje.content_text
        ) : (
          <span style={{ opacity: 0.75 }}>{previewCita(mensaje) || "Mensaje"}</span>
        )}
        <div className={`m-meta${estado === "leido" ? " leido" : ""}`}>
          {hora}
          {saliente ? <Estado mensaje={mensaje} /> : null}
        </div>
      </div>
    </div>
  );
}
