import { describe, expect, it } from "vitest";

import {
  classifyReply,
  containsPhrase,
  normalizeReply,
  tokenizeReply,
} from "./classify";

// ============================================================
// Las tres listas del guion de Kosmo, copiadas tal cual de
// ~/Downloads/bot-primer-contacto-kosmo.md. Los casos de abajo son
// respuestas reales de leads; si el clasificador las manda a otra
// rama, el bot contesta cualquier cosa.
// ============================================================

const NEGATIVE = [
  "no",
  "nono",
  "nop",
  "nah",
  "negativo",
  "no puedo",
  "no me sirve",
  "no gracias",
  "no fui yo",
  "equivocado",
  "ahora no",
  "por ahora no",
  "todavia no",
  "despues",
  "mas adelante",
  "otro momento",
  "no me interesa",
];

const POSITIVE = [
  "si",
  "sisi",
  "sii",
  "sip",
  "dale",
  "ok",
  "oka",
  "okey",
  "claro",
  "obvio",
  "exacto",
  "correcto",
  "asi es",
  "perfecto",
  "buenisimo",
  "genial",
  "de una",
  "me sirve",
  "va",
  "bueno",
  "listo",
  "joya",
];

/** "Prefiere lista / no llamada" — la rama `extra`. */
const LISTA = [
  "catalogo",
  "lista",
  "precios",
  "por aca",
  "por escrito",
  "no puedo llamar",
  "llamada no",
  "sin llamada",
  "mejor por chat",
  "mandame",
];

const LISTS = { negative: NEGATIVE, positive: POSITIVE };

describe("normalizeReply", () => {
  it("baja a minúsculas, saca acentos y signos, y colapsa espacios", () => {
    expect(normalizeReply("  ¿Así   es?? ")).toBe("asi es");
    expect(normalizeReply("Sí, dale!")).toBe("si dale");
  });

  it("trata la ñ como n, igual de los dos lados de la comparación", () => {
    expect(normalizeReply("Mañana")).toBe("manana");
  });

  it("conserva los dígitos", () => {
    expect(normalizeReply("de 10 a 15hs")).toBe("de 10 a 15hs");
  });

  it("un texto sin letras queda vacío", () => {
    expect(tokenizeReply("👍 !!! ")).toEqual([]);
  });
});

describe("containsPhrase", () => {
  it("matchea palabra completa, no subcadena", () => {
    expect(containsPhrase(tokenizeReply("nono"), "no")).toBe(false);
    expect(containsPhrase(tokenizeReply("sino"), "no")).toBe(false);
    expect(containsPhrase(tokenizeReply("sino"), "si")).toBe(false);
    expect(containsPhrase(tokenizeReply("hola no gracias"), "no")).toBe(true);
  });

  it("matchea una frase solo si los tokens están contiguos", () => {
    expect(containsPhrase(tokenizeReply("ahora no puedo"), "no puedo")).toBe(
      true,
    );
    expect(
      containsPhrase(tokenizeReply("no se si puedo"), "no puedo"),
    ).toBe(false);
  });
});

describe("classifyReply — ejemplos reales del guion", () => {
  it('"Así es" es positivo (frase de dos palabras)', () => {
    expect(classifyReply("Así es", LISTS)).toBe("positive");
  });

  it('"Hola si" es positivo aunque el sí no venga solo', () => {
    expect(classifyReply("Hola si", LISTS)).toBe("positive");
  });

  it('"Sisi" es positivo', () => {
    expect(classifyReply("Sisi", LISTS)).toBe("positive");
  });

  it('"Hola buenas tardes Sisi quería saber…" es positivo', () => {
    expect(
      classifyReply("Hola buenas tardes Sisi quería saber cómo comprar", LISTS),
    ).toBe("positive");
  });

  it("el caso de Elian cae en la rama de la lista, no en el no", () => {
    // Trae un negativo ("nono", "no puedo") Y un pedido de catálogo.
    // El extra se evalúa primero justamente por esto.
    expect(
      classifyReply(
        "Nono nunca compré, la llamada durante el día no puedo, mejor por catálogo",
        { ...LISTS, extra: LISTA },
      ),
    ).toBe("extra");
  });

  it("ese mismo texto, sin rama extra, es negativo (nunca positivo)", () => {
    expect(
      classifyReply(
        "Nono nunca compré, la llamada durante el día no puedo, mejor por catálogo",
        LISTS,
      ),
    ).toBe("negative");
  });
});

describe("classifyReply — orden y bordes", () => {
  it("el negativo le gana al positivo cuando aparecen los dos", () => {
    // "dale" está en positivo; "no me sirve" en negativo.
    expect(classifyReply("Dale pero no me sirve", LISTS)).toBe("negative");
  });

  it('"no fui yo" es negativo (paso 1: no llenó el formulario)', () => {
    expect(classifyReply("No fui yo, número equivocado", LISTS)).toBe(
      "negative",
    );
  });

  it("un texto que no está en ninguna lista es desconocido", () => {
    expect(classifyReply("cuánto sale el envío a Salta", LISTS)).toBe(
      "unknown",
    );
  });

  it("un texto vacío o solo emojis es desconocido", () => {
    expect(classifyReply("", LISTS)).toBe("unknown");
    expect(classifyReply("👍", LISTS)).toBe("unknown");
  });

  it("sin listas configuradas todo es desconocido", () => {
    expect(classifyReply("si", {})).toBe("unknown");
  });
});
