// ============================================================
// Firma del webhook de Tally.
//
// Tally manda `Tally-Signature: <base64>` = base64(HMAC-SHA256(
// signing secret, CUERPO CRUDO)). El cuerpo crudo importa: si se
// parsea el JSON y se vuelve a serializar, el orden de las claves y
// los espacios cambian y la firma no da nunca.
//
// Contrato igual al de Meta (webhook-signature.ts): sin
// TALLY_SIGNING_SECRET se falla cerrado. Una ruta pública que crea
// contactos sin verificar firma es un formulario de spam abierto.
// ============================================================

import crypto from "node:crypto";

export function verifyTallySignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.TALLY_SIGNING_SECRET;
  if (!secret) {
    console.error(
      "[tally] TALLY_SIGNING_SECRET no está configurado — se rechaza la " +
        "entrega. Cargá la variable (Tally → Integrations → Webhooks → " +
        "Signing secret) para habilitar la verificación.",
    );
    return false;
  }

  if (!signatureHeader) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  // timingSafeEqual explota si los largos difieren.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
