// ============================================================
// La logica de la Bandeja movil: que fila se ve y como se rotula.
//
// Parte pura, separada de la parte con red, igual que contact-tags.ts y
// overrides-api.ts. Aca no hay React ni Supabase: entra un array de
// conversaciones y salen las que van en pantalla.
// ============================================================

import { findEstadoTag } from "@/lib/contacts/tag-groups";
import { conversationChannel } from "@/lib/movil/canales";
import type { Channel, Contact, Conversation, Tag } from "@/types";

/** Las tres vistas del segmentado de la maqueta. */
export type Vista = "todas" | "pendientes" | "mias";

export const VISTAS: readonly { id: Vista; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "pendientes", label: "Pendientes" },
  { id: "mias", label: "Mías" },
] as const;

export interface FiltrosBandeja {
  vista: Vista;
  /** Quien mira. Sin el, "Mías" no puede decir nada y no devuelve nada. */
  userId: string | null;
  /** null ⇒ no se filtra por canal (ningun canal prendido). */
  canal: Channel | null;
  /** Etiqueta de estado elegida en el filtro, o null. */
  tagId: string | null;
  busqueda: string;
}

/** Solo digitos, para comparar un telefono contra lo que se tipeo. */
function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/**
 * El nombre que se muestra. El webhook de Meta crea contactos cuyo
 * `name` es el propio telefono, asi que un nombre vacio y un nombre
 * igual al numero terminan en el mismo lugar: el telefono formateado.
 */
export function nombreVisible(contact: Contact | undefined): string {
  const nombre = contact?.name?.trim();
  if (nombre) return nombre;
  const tel = contact?.phone?.trim();
  if (tel) return formatearTelefono(tel);
  return "Sin nombre";
}

/**
 * `+54 9 11 2233 4455` a partir del wa_id. Solo se entiende el formato
 * argentino, que es el de las dos cuentas; cualquier otro sale con un
 * `+` adelante y los digitos como vinieron. Nunca se adivina un pais.
 */
export function formatearTelefono(raw: string): string {
  const d = soloDigitos(raw);
  if (d.startsWith("549")) {
    const r = d.slice(3);
    if (r.startsWith("11") && r.length === 10) {
      return `+54 9 11 ${r.slice(2, 6)} ${r.slice(6)}`;
    }
    if (r.length === 10) {
      return `+54 9 ${r.slice(0, 3)} ${r.slice(3, 6)} ${r.slice(6)}`;
    }
  }
  return d ? `+${d}` : raw;
}

/** Las iniciales del avatar: hasta dos, en mayuscula. */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letras = partes
    .map((p) => p[0])
    .filter((c) => /\p{L}/u.test(c ?? ""))
    .join("")
    .toUpperCase();
  // Un contacto que se llama como su telefono no tiene inicial que
  // valga: el avatar queda vacio y manda el nombre de la fila.
  return letras;
}

/** La etiqueta de estado del contacto, si tiene. Una sola, regla de la base. */
export function estadoDe(contact: Contact | undefined): Tag | null {
  return findEstadoTag(contact?.tags);
}

/**
 * La clase de color del chip de estado. Espeja `estadoClase()` de la
 * maqueta: lo ganado en verde, lo perdido y el silencio en rojo, todo
 * lo agendado en ambar, el resto neutro.
 */
export function claseEstado(nombre: string): string {
  if (/Ganada/i.test(nombre)) return "ok";
  if (/Perdid|No responde/i.test(nombre)) return "bad";
  if (/Agend|Reagend|Realizada|Propuesta/i.test(nombre)) return "warn";
  return "estado";
}

/**
 * La hora de la fila, como en la maqueta: la hora si es de hoy, "ayer"
 * si es de ayer, y el dia de la semana abreviado mas atras.
 */
export function horaRelativa(iso: string | undefined, ahora: Date): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === ahora.toDateString()) {
    return d.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  const ayer = new Date(ahora);
  ayer.setDate(ayer.getDate() - 1);
  if (d.toDateString() === ayer.toDateString()) return "ayer";
  return d
    .toLocaleDateString("es-AR", { weekday: "short" })
    .replace(".", "");
}

/** La linea de vista previa. Vacia cuando el hilo todavia no tiene mensajes. */
export function previsualizacion(conversation: Conversation): string {
  return (conversation.last_message_text ?? "").split("\n")[0] ?? "";
}

/**
 * Las conversaciones que van en pantalla, ya ordenadas por el ultimo
 * mensaje. Se ordena aca y no solo en la query porque un mensaje que
 * llega por realtime tiene que subir la fila sin recargar.
 */
export function filtrarConversaciones(
  conversaciones: readonly Conversation[],
  { vista, userId, canal, tagId, busqueda }: FiltrosBandeja,
): Conversation[] {
  const q = busqueda.trim().toLowerCase();
  const qDigitos = soloDigitos(q);

  const filtradas = conversaciones.filter((c) => {
    if (canal !== null && conversationChannel(c) !== canal) return false;

    // "Pendientes" es el estado de la conversacion, no el de la
    // etiqueta: `conversations.status` es 'open' | 'pending' | 'closed'
    // y es lo mismo que filtra el desplegable del escritorio.
    if (vista === "pendientes" && c.status !== "pending") return false;

    // "Mias" sin sesion resuelta no puede afirmar nada, y prefiere no
    // mostrar de mas: devuelve vacio hasta que el perfil carga.
    if (vista === "mias" && (!userId || c.assigned_agent_id !== userId)) {
      return false;
    }

    if (tagId !== null) {
      const tags = c.contact?.tags ?? [];
      if (!tags.some((t) => t.id === tagId)) return false;
    }

    if (q) {
      const nombre = nombreVisible(c.contact).toLowerCase();
      const tel = soloDigitos(c.contact?.phone ?? "");
      const porNombre = nombre.includes(q);
      const porTelefono = qDigitos.length > 0 && tel.includes(qDigitos);
      if (!porNombre && !porTelefono) return false;
    }

    return true;
  });

  return filtradas.sort((a, b) => {
    const ta = a.last_message_at ? Date.parse(a.last_message_at) : 0;
    const tb = b.last_message_at ? Date.parse(b.last_message_at) : 0;
    return tb - ta;
  });
}
