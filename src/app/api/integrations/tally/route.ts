// ============================================================
// POST /api/integrations/tally — el formulario de Kosmo entra a la
// Bandeja.
//
// El embudo: anuncio en Meta → kosmo.click → formulario de Tally →
// página de gracias con un botón de WhatsApp → el lead escribe al
// número de Kosmo. Este receptor hace que, cuando escribe, la ficha
// del contacto YA tenga sus respuestas; y si nunca escribe, que el
// contacto exista igual, etiquetado `origen_form`, para escribirle
// después con una plantilla.
//
// Lo que une las dos puntas es el teléfono normalizado
// (`normalizeArgentinePhone`): el formulario manda "+5411…" y Meta
// entrega el wa_id como "549…". Sin eso serían dos contactos.
//
// Seguridad: se verifica la firma de Tally sobre el CUERPO CRUDO
// antes de mirar nada del contenido. Sin firma válida no se procesa
// ni se crea nada — 401 y listo.
//
// Códigos:
//   401  firma ausente o inválida
//   400  no es JSON, o el sobre no trae data.responseId
//   422  el envío no trae un teléfono usable (no se crea nada)
//   200  procesado, o duplicado (reintento de Tally), o un eventType
//        que no nos interesa
// ============================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import {
  ingestTallySubmission,
  resolveTallyTarget,
  TallyIngestError,
} from "@/lib/integrations/tally/ingest";
import {
  mapTallySubmission,
  TallyPayloadError,
  type TallyPayload,
} from "@/lib/integrations/tally/payload";
import { verifyTallySignature } from "@/lib/integrations/tally/signature";

// Mismo acceso que el webhook de Meta: cliente admin del servidor.
// Perezoso para no romper el build cuando faltan las variables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

// Se loguea UN payload crudo por proceso, y solo con la variable de
// debug puesta: alcanza para confirmar el formato contra un envío
// real sin dejar los datos de todos los leads en los logs. Apagala
// apenas verificaste.
let loggedRawPayload = false;
function debugLogRawPayload(rawBody: string): void {
  if (loggedRawPayload) return;
  if (process.env.TALLY_DEBUG_PAYLOAD !== "1") return;
  loggedRawPayload = true;
  console.log("[tally] primer payload crudo recibido:", rawBody);
}

export async function POST(request: Request) {
  // El cuerpo crudo, tal cual llegó: la firma se calcula sobre estos
  // bytes. Reserializar el JSON cambia el orden de las claves y los
  // espacios, y la firma no da nunca.
  const rawBody = await request.text();

  if (!verifyTallySignature(rawBody, request.headers.get("tally-signature"))) {
    console.warn("[tally] firma inválida o ausente — entrega rechazada");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  debugLogRawPayload(rawBody);

  let payload: TallyPayload;
  try {
    payload = JSON.parse(rawBody) as TallyPayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Tally puede mandar otros eventos por el mismo webhook. Se
  // contestan 200 para que no los reintente eternamente.
  if (payload?.eventType && payload.eventType !== "FORM_RESPONSE") {
    return NextResponse.json({ ok: true, ignored: payload.eventType });
  }

  try {
    const submission = mapTallySubmission(payload);
    const target = await resolveTallyTarget(supabaseAdmin());
    const result = await ingestTallySubmission(
      supabaseAdmin(),
      target,
      submission,
    );

    return NextResponse.json({
      ok: true,
      outcome: result.outcome,
      contact_id: result.contactId,
    });
  } catch (error) {
    if (error instanceof TallyPayloadError) {
      // 422 sin teléfono: se loguea el responseId (no el payload) para
      // poder ir a buscar ese envío a Tally a mano.
      console.warn("[tally] envío descartado:", error.message);
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof TallyIngestError) {
      console.error("[tally] no se pudo procesar el envío:", error.message);
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[tally] error inesperado:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
