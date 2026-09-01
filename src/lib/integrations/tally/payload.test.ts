import { describe, expect, it } from "vitest";

import {
  payloadVersionNueva,
  payloadVersionVieja,
  WA_ID_ENTRANTE,
} from "./payload-fixtures";
import {
  fieldValueToText,
  mapTallySubmission,
  normalizeLabel,
  TallyPayloadError,
} from "./payload";

describe("normalizeLabel", () => {
  it("saca acentos, signos y mayúsculas", () => {
    expect(normalizeLabel("¿Qué tipo de negocio tenés?")).toBe(
      "que tipo de negocio tenes",
    );
    expect(normalizeLabel("utm_source")).toBe("utm source");
    expect(normalizeLabel("  Nombre  ")).toBe("nombre");
  });
});

describe("fieldValueToText", () => {
  it("resuelve un id de opción a su texto", () => {
    expect(
      fieldValueToText({
        value: "opt-1",
        options: [{ id: "opt-1", text: "Local a la calle" }],
      }),
    ).toBe("Local a la calle");
  });

  it("junta las opciones múltiples con coma", () => {
    expect(
      fieldValueToText({
        value: ["a", "b"],
        options: [
          { id: "a", text: "Mayorista" },
          { id: "b", text: "Minorista" },
        ],
      }),
    ).toBe("Mayorista, Minorista");
  });

  it("deja pasar el texto libre y descarta lo que no sabe mapear", () => {
    expect(fieldValueToText({ value: "texto libre" })).toBe("texto libre");
    expect(fieldValueToText({ value: true })).toBe("Sí");
    expect(fieldValueToText({ value: null })).toBe("");
    expect(fieldValueToText({ value: { url: "x" } })).toBe("");
  });
});

describe("mapTallySubmission — versión nueva del formulario", () => {
  it("arma el contacto y los campos personalizados", () => {
    const mapped = mapTallySubmission(payloadVersionNueva());

    expect(mapped.responseId).toBe("resp-nuevo-1");
    expect(mapped.name).toBe("Ana Gómez");
    expect(mapped.email).toBe("ana@ejemplo.com");
    expect(mapped.company).toBeNull();
    // El teléfono sale ya normalizado a la forma de WhatsApp.
    expect(mapped.phone).toBe(WA_ID_ENTRANTE);

    expect(mapped.customValues).toEqual({
      tienda_online: "Sí",
      volumen_restock: "Entre $500.000 y $2.000.000",
      provincia: "CABA",
      tipo_negocio: "Local a la calle",
      utm_source: "facebook",
      utm_medium: "paid",
      utm_campaign: "restock-septiembre",
      utm_content: "video-a",
      tally_response_id: "resp-nuevo-1",
      tally_submitted_at: "2026-09-01T12:00:00.000Z",
    });
  });
});

describe("mapTallySubmission — versión vieja del formulario", () => {
  it("mapea los labels de julio al mismo destino", () => {
    const mapped = mapTallySubmission(payloadVersionVieja());

    expect(mapped.name).toBe("Carlos Ruiz");
    expect(mapped.phone).toBe("5493515551234");
    // "Nombre de tu tienda" va a contacts.company, no a un campo
    // personalizado.
    expect(mapped.company).toBe("Distribuidora Ruiz");
    expect(mapped.customValues.descripcion_local).toBe(
      "Local a la calle en el centro, vendemos indumentaria.",
    );
    expect(mapped.customValues.utm_source).toBe("instagram");
    expect(mapped.customValues.tally_response_id).toBe("resp-viejo-1");
  });
});

describe("mapTallySubmission — dos campos con label 'Nombre'", () => {
  // Caso real del formulario de Kosmo: la pregunta del CUIT/DNI también
  // se llama "Nombre" (en el export CSV aparece como "Nombre (2)").
  // Sin esto el contacto quedaba con nombre "43228684".
  it("el primero es la persona y el segundo va a cuit_dni", () => {
    const payload = payloadVersionNueva();
    payload.data!.fields = payload.data!.fields!.map((f) =>
      f.label === "Nombre" ? { ...f, value: "Nadia" } : f,
    ).filter((f) => f.label !== "Apellido");
    // El segundo "Nombre" viene DESPUÉS del email, como en el formulario.
    payload.data!.fields.push({
      key: "question_13",
      label: "Nombre",
      type: "INPUT_TEXT",
      value: "43228684",
    });

    const mapped = mapTallySubmission(payload);

    expect(mapped.name).toBe("Nadia");
    expect(mapped.customValues.cuit_dni).toBe("43228684");
  });

  it("un CUIT con guiones también cae en cuit_dni", () => {
    const payload = payloadVersionNueva();
    payload.data!.fields!.push({ label: "Nombre", value: "20-12345678-9" });

    const mapped = mapTallySubmission(payload);

    expect(mapped.name).toBe("Ana Gómez");
    expect(mapped.customValues.cuit_dni).toBe("20-12345678-9");
  });
});

describe("mapTallySubmission — un solo 'Nombre' con solo dígitos", () => {
  // Guarda: si lo que iría a contacts.name son solo dígitos, guiones o
  // espacios, no es un nombre. No se usa como tal (el contacto conserva
  // el que tenga) y se guarda como cuit_dni.
  it("no se usa como nombre y se guarda como cuit_dni", () => {
    const payload = payloadVersionNueva();
    payload.data!.fields = payload.data!.fields!
      .map((f) => (f.label === "Nombre" ? { ...f, value: "23245158009" } : f))
      .filter((f) => f.label !== "Apellido");

    const mapped = mapTallySubmission(payload);

    expect(mapped.name).toBeNull();
    expect(mapped.customValues.cuit_dni).toBe("23245158009");
  });

  it("mismo criterio para 'Apellido'", () => {
    const payload = payloadVersionNueva();
    payload.data!.fields = payload.data!.fields!.map((f) =>
      f.label === "Apellido" ? { ...f, value: "20 12345678 9" } : f,
    );

    const mapped = mapTallySubmission(payload);

    expect(mapped.name).toBe("Ana");
    expect(mapped.customValues.cuit_dni).toBe("20 12345678 9");
  });

  it("un DNI con puntos tampoco es nombre", () => {
    const payload = payloadVersionNueva();
    payload.data!.fields = payload.data!.fields!
      .map((f) => (f.label === "Nombre" ? { ...f, value: "43.228.684" } : f))
      .filter((f) => f.label !== "Apellido");

    const mapped = mapTallySubmission(payload);

    expect(mapped.name).toBeNull();
    expect(mapped.customValues.cuit_dni).toBe("43.228.684");
  });

  it("un nombre con dígitos adentro sigue siendo nombre", () => {
    const payload = payloadVersionNueva();
    payload.data!.fields = payload.data!.fields!.map((f) =>
      f.label === "Nombre" ? { ...f, value: "Local 3 Hermanos" } : f,
    );

    const mapped = mapTallySubmission(payload);

    expect(mapped.name).toBe("Local 3 Hermanos Gómez");
    expect(mapped.customValues.cuit_dni).toBeUndefined();
  });

  it("sin CUIT/DNI en el envío, cuit_dni no se escribe", () => {
    expect(mapTallySubmission(payloadVersionNueva()).customValues.cuit_dni).toBeUndefined();
  });
});

describe("mapTallySubmission — bordes", () => {
  it("ignora una pregunta que no está mapeada", () => {
    const payload = payloadVersionNueva();
    payload.data!.fields!.push({ label: "Pregunta nueva sin mapear", value: "x" });

    const mapped = mapTallySubmission(payload);
    expect(Object.values(mapped.customValues)).not.toContain("x");
  });

  it("sin teléfono usable → 422 y no devuelve nada para escribir", () => {
    const payload = payloadVersionNueva();
    payload.data!.fields = payload.data!.fields!.filter(
      (f) => f.label !== "WhatsApp",
    );

    expect(() => mapTallySubmission(payload)).toThrowError(TallyPayloadError);
    try {
      mapTallySubmission(payload);
    } catch (err) {
      expect((err as TallyPayloadError).status).toBe(422);
    }
  });

  it("sin responseId → 400 (no habría idempotencia posible)", () => {
    const payload = payloadVersionNueva();
    payload.data!.responseId = "";

    try {
      mapTallySubmission(payload);
      expect.unreachable();
    } catch (err) {
      expect((err as TallyPayloadError).status).toBe(400);
    }
  });

  it("un teléfono que no se puede usar cae en 422, no en un contacto roto", () => {
    const payload = payloadVersionNueva();
    payload.data!.fields = payload.data!.fields!.map((f) =>
      f.label === "WhatsApp" ? { ...f, value: "123" } : f,
    );

    try {
      mapTallySubmission(payload);
      expect.unreachable();
    } catch (err) {
      expect((err as TallyPayloadError).status).toBe(422);
    }
  });
});
