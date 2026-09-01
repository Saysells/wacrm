// ============================================================
// "Nuevo mensaje" de la Bandeja: arrancar una conversacion con un
// numero que todavia no escribio.
//
// Reglas que fija Meta (no las ponemos nosotros y no se arreglan con
// codigo): si el numero nunca escribio primero, el primer mensaje
// TIENE que ser una plantilla aprobada, nunca texto libre. Por eso
// el flujo obliga a elegir plantilla antes de habilitar el envio; si
// en Plantillas no hay ninguna aprobada, el selector sale vacio y
// eso es lo esperado.
//
// La parte pura (que paso sigue, si se puede enviar) va separada de
// la parte con red para que las dos sean testeables sin DOM, igual
// que overrides-api.ts y contact-tags.ts.
// ============================================================

import { isValidE164, sanitizePhoneForMeta } from "@/lib/whatsapp/phone-utils";
import { renderTemplateBody } from "@/lib/whatsapp/template-body";
import type { TemplateSendValues } from "@/components/inbox/template-picker";
import type { MessageTemplate } from "@/types";

/** Respuesta de POST /api/inbox/conversations/resolve. */
export interface ResolveResponse {
  phone: string;
  contact_id: string | null;
  conversation_id: string | null;
  contact_created: boolean;
}

/**
 * Pre-validacion local del input, para no ir al servidor con
 * cualquier cosa. Es la MISMA regla que aplica la ruta
 * (sanitizePhoneForMeta + isValidE164), no una segunda definicion de
 * "telefono valido".
 */
export function isSendablePhone(raw: string): boolean {
  return isValidE164(sanitizePhoneForMeta(raw));
}

/**
 * El boton de enviar. Sin plantilla elegida no hay envio posible —
 * ver la regla de Meta arriba.
 */
export function canSendNewMessage(input: {
  phone: string;
  template: MessageTemplate | null;
}): boolean {
  return isSendablePhone(input.phone) && input.template !== null;
}

export type NextStep =
  | { action: "open"; conversationId: string }
  | { action: "template" };

/**
 * Que hacer despues de mirar el numero: si ya tiene hilo se abre
 * directo (no tiene sentido ofrecer plantillas: la ventana de 24 h la
 * decide Meta al momento del envio, y el agente quiere ver el
 * historial). Si no, hay que elegir plantilla.
 */
export function nextStepAfterLookup(found: ResolveResponse): NextStep {
  return found.conversation_id
    ? { action: "open", conversationId: found.conversation_id }
    : { action: "template" };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(payload.error || `HTTP ${res.status}`);
  }
  return payload as T;
}

/** Solo mira: no crea contacto ni conversacion. */
export function lookupConversation(phone: string): Promise<ResolveResponse> {
  return postJson<ResolveResponse>("/api/inbox/conversations/resolve", {
    phone,
  });
}

/**
 * Crea (o reusa) el hilo del numero y manda ahi la plantilla.
 *
 * El resolve corre UNA sola vez y el envio reusa el
 * `conversation_id` que devolvio: el dedupe (un contacto, un hilo por
 * cuenta) vive en `resolveConversationByPhone`, compartido con el
 * webhook de entrada y la API publica. Si el resolve falla no se
 * manda nada.
 */
export async function startConversation(params: {
  phone: string;
  name?: string | null;
  template: MessageTemplate;
  values: TemplateSendValues;
}): Promise<{ conversationId: string; contactCreated: boolean }> {
  const { phone, name, template, values } = params;

  const resolved = await postJson<ResolveResponse>(
    "/api/inbox/conversations/resolve",
    name ? { phone, name, create: true } : { phone, create: true },
  );

  if (!resolved.conversation_id) {
    throw new Error("No conversation was resolved for this phone number");
  }

  await postJson("/api/whatsapp/send", {
    conversation_id: resolved.conversation_id,
    message_type: "template",
    template_name: template.name,
    template_language: template.language,
    // Mismo par de formas que manda el composer del hilo: la
    // estructurada alimenta el send-builder (header/botones) y la
    // posicional queda de fallback si la fila local no aparece.
    template_message_params: {
      body: values.body,
      headerText: values.headerText,
      buttonParams: values.buttonParams,
    },
    template_params: values.body,
    content_text: renderTemplateBody(template.body_text, values.body),
  });

  return {
    conversationId: resolved.conversation_id,
    contactCreated: resolved.contact_created,
  };
}
