"use client";

import Link from "next/link";

import {
  claseEstado,
  estadoDe,
  horaRelativa,
  iniciales,
  nombreVisible,
  previsualizacion,
} from "@/lib/movil/bandeja";
import type { Conversation } from "@/types";

/**
 * Una fila de la lista, tal cual la maqueta: avatar, nombre, hora,
 * vista previa, contador de no leidos y los chips de estado.
 *
 * Es un <Link> y no un div con onClick para que Next prefetchee el
 * chat y el toque abra sin espera.
 */
export function ConversationRow({
  conversation,
  ahora,
}: {
  conversation: Conversation;
  /**
   * El "ahora" contra el que se calcula la hora, provisto por la lista
   * para que las 26 filas usen el mismo y no se corran entre si.
   */
  ahora: Date;
}) {
  const nombre = nombreVisible(conversation.contact);
  const sinLeer = conversation.unread_count > 0;
  const estado = estadoDe(conversation.contact);
  const inicial = iniciales(nombre);
  const preview = previsualizacion(conversation);

  return (
    <li>
      <Link href={`/m/chat/${conversation.id}`} className="m-row">
        <div className="m-av" aria-hidden="true">
          {conversation.contact?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatar de Meta, dominio no fijo
            <img src={conversation.contact.avatar_url} alt="" />
          ) : (
            inicial
          )}
        </div>
        <div className="m-rowmain">
          <div className="m-rowtop">
            <span className="m-rowname">{nombre}</span>
            <span className={`m-rowtime${sinLeer ? " unread" : ""}`}>
              {horaRelativa(conversation.last_message_at, ahora)}
            </span>
          </div>
          <div className="m-rowbot">
            <span className={`m-rowprev${sinLeer ? " unread" : ""}`}>{preview}</span>
            {sinLeer ? (
              <span className="m-badge" aria-label={`${conversation.unread_count} sin leer`}>
                {conversation.unread_count}
              </span>
            ) : null}
          </div>
          {estado ? (
            <div className="m-chips">
              <span className={`m-chip ${claseEstado(estado.name)}`}>{estado.name}</span>
            </div>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
