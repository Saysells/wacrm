// ============================================================
// Payloads de ejemplo de Tally — SOLO para los tests.
//
// Viven en un archivo aparte (y no adentro de un `.test.ts`) porque
// los usan dos suites: la del mapeo puro y la de la ruta. Importar
// un archivo de test desde otro haría correr sus casos dos veces.
//
// Los teléfonos son inventados, con la forma real del export: código
// de país y SIN el 9, que es como llegan 468 de los 522 envíos.
// ============================================================

import type { TallyPayload } from "./payload";

export const TELEFONO_DEL_FORMULARIO = "+5411 5550-1234";
/** El mismo teléfono como lo entrega Meta en `contacts[].wa_id`. */
export const WA_ID_ENTRANTE = "5491155501234";

/** Versión actual del formulario (export del 01/09/2026). */
export function payloadVersionNueva(responseId = "resp-nuevo-1"): TallyPayload {
  return {
    eventType: "FORM_RESPONSE",
    data: {
      responseId,
      createdAt: "2026-09-01T12:00:00.000Z",
      fields: [
        { key: "question_1", label: "Nombre", type: "INPUT_TEXT", value: "Ana" },
        {
          key: "question_2",
          label: "Apellido",
          type: "INPUT_TEXT",
          value: "Gómez",
        },
        {
          key: "question_3",
          label: "WhatsApp",
          type: "INPUT_PHONE_NUMBER",
          value: TELEFONO_DEL_FORMULARIO,
        },
        {
          key: "question_4",
          label: "Email",
          type: "INPUT_EMAIL",
          value: "ana@ejemplo.com",
        },
        {
          key: "question_5",
          label: "¿Vendés por tienda online?",
          type: "MULTIPLE_CHOICE",
          // Opción múltiple: el value es el ID, el texto vive en options.
          value: ["opt-si"],
          options: [
            { id: "opt-si", text: "Sí" },
            { id: "opt-no", text: "No" },
          ],
        },
        {
          key: "question_6",
          label: "¿Qué volumen invertís en restock por mes?",
          type: "MULTIPLE_CHOICE",
          value: "opt-medio",
          options: [
            { id: "opt-bajo", text: "Menos de $500.000" },
            { id: "opt-medio", text: "Entre $500.000 y $2.000.000" },
          ],
        },
        {
          key: "question_7",
          label: "¿En qué provincia estás?",
          type: "DROPDOWN",
          value: "opt-caba",
          options: [{ id: "opt-caba", text: "CABA" }],
        },
        {
          key: "question_8",
          label: "¿Qué tipo de negocio tenés?",
          type: "DROPDOWN",
          value: "opt-local",
          options: [{ id: "opt-local", text: "Local a la calle" }],
        },
        {
          key: "question_9",
          label: "utm_source",
          type: "HIDDEN_FIELDS",
          value: "facebook",
        },
        {
          key: "question_10",
          label: "utm_medium",
          type: "HIDDEN_FIELDS",
          value: "paid",
        },
        {
          key: "question_11",
          label: "utm_campaign",
          type: "HIDDEN_FIELDS",
          value: "restock-septiembre",
        },
        {
          key: "question_12",
          label: "utm_content",
          type: "HIDDEN_FIELDS",
          value: "video-a",
        },
      ],
    },
  };
}

/** Versión vieja del formulario (julio 2026): dos labels distintos. */
export function payloadVersionVieja(responseId = "resp-viejo-1"): TallyPayload {
  return {
    eventType: "FORM_RESPONSE",
    data: {
      responseId,
      createdAt: "2026-07-15T09:30:00.000Z",
      fields: [
        { label: "Nombre", value: "Carlos" },
        { label: "Apellido", value: "Ruiz" },
        { label: "WhatsApp", value: "+54 351 555-1234" },
        { label: "Email", value: "carlos@ejemplo.com" },
        { label: "Nombre de tu tienda", value: "Distribuidora Ruiz" },
        {
          label: "Contanos brevemente de tu local",
          value: "Local a la calle en el centro, vendemos indumentaria.",
        },
        { label: "utm_source", value: "instagram" },
      ],
    },
  };
}
