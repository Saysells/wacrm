import { describe, expect, it } from "vitest";

import {
  isArgentineNationalNumber,
  normalizeArgentinePhone,
} from "./normalize-ar";

// Todos los números de estos tests son inventados con la forma real
// (área + abonado del largo correcto). Nunca se usa uno del export.
const AMBA = "5491155501234"; // 11 5550-1234
const CORDOBA = "5493515551234"; // 351 555-1234
const RIO_GALLEGOS = "5492966551234"; // 2966 55-1234

describe("normalizeArgentinePhone", () => {
  it("le inserta el 9 a un +54 sin 9 (la forma que manda el formulario)", () => {
    expect(normalizeArgentinePhone("+54 11 5550-1234")).toBe(AMBA);
    expect(normalizeArgentinePhone("+541155501234")).toBe(AMBA);
    expect(normalizeArgentinePhone("541155501234")).toBe(AMBA);
  });

  it("deja igual un +549 que ya está canónico", () => {
    expect(normalizeArgentinePhone("+549 11 5550-1234")).toBe(AMBA);
    expect(normalizeArgentinePhone(AMBA)).toBe(AMBA);
  });

  it("saca el 0 de larga distancia y el 15 del formato doméstico", () => {
    expect(normalizeArgentinePhone("011 15-5550-1234")).toBe(AMBA);
    expect(normalizeArgentinePhone("01115 5550 1234")).toBe(AMBA);
  });

  it("saca el 15 aunque venga con código de país", () => {
    expect(normalizeArgentinePhone("+54 11 15-5550-1234")).toBe(AMBA);
    expect(normalizeArgentinePhone("+54 9 11 15 5550 1234")).toBe(AMBA);
  });

  it("resuelve áreas de 3 y 4 dígitos, con y sin 15", () => {
    expect(normalizeArgentinePhone("+54 351 555-1234")).toBe(CORDOBA);
    expect(normalizeArgentinePhone("0351 15-555-1234")).toBe(CORDOBA);
    expect(normalizeArgentinePhone("+54 2966 55-1234")).toBe(RIO_GALLEGOS);
    expect(normalizeArgentinePhone("02966 15-55-1234")).toBe(RIO_GALLEGOS);
  });

  it("no toca números que no son argentinos", () => {
    // Estados Unidos y Lituania (el país del upstream): pasan enteros,
    // solo se les sacan los separadores.
    expect(normalizeArgentinePhone("+1 415 555 0123")).toBe("14155550123");
    expect(normalizeArgentinePhone("+370 63949836")).toBe("37063949836");
    expect(normalizeArgentinePhone("+55 11 91234-5678")).toBe("5511912345678");
  });

  it("no confunde un doméstico de otro país con un argentino", () => {
    // Un móvil coreano son 10 dígitos después del 0, igual que un
    // nacional argentino — pero empieza con 10, no con 11/2/3.
    expect(normalizeArgentinePhone("010 1234 5678")).toBe("01012345678");
  });

  it("devuelve los dígitos tal cual cuando no entiende la forma", () => {
    expect(normalizeArgentinePhone("")).toBe("");
    expect(normalizeArgentinePhone("no es un teléfono")).toBe("");
    expect(normalizeArgentinePhone("54123")).toBe("54123");
    // 54 + 9 dígitos: le falta uno para ser un nacional válido.
    expect(normalizeArgentinePhone("+54 11 555-0123")).toBe("54115550123");
  });

  it("es idempotente: normalizar dos veces da lo mismo", () => {
    const once = normalizeArgentinePhone("+54 11 5550-1234");
    expect(normalizeArgentinePhone(once)).toBe(once);
  });
});

describe("el lead del formulario y el mensaje entrante son un solo contacto", () => {
  it("un contacto creado con +5411… matchea el wa_id 549… de WhatsApp", () => {
    // Lo que carga el formulario de Tally (468 de 522 envíos vienen así).
    const desdeElFormulario = normalizeArgentinePhone("+5411 5550-1234");
    // Lo que entrega Meta en `contacts[].wa_id` cuando el lead escribe.
    const desdeWhatsApp = normalizeArgentinePhone("5491155501234");

    expect(desdeElFormulario).toBe(desdeWhatsApp);
    expect(desdeElFormulario).toBe(AMBA);
  });
});

describe("isArgentineNationalNumber", () => {
  it("acepta los tres largos de área", () => {
    expect(isArgentineNationalNumber("1155501234")).toBe(true);
    expect(isArgentineNationalNumber("3515551234")).toBe(true);
    expect(isArgentineNationalNumber("2966551234")).toBe(true);
  });

  it("rechaza largos y prefijos que no son argentinos", () => {
    expect(isArgentineNationalNumber("115550123")).toBe(false);
    expect(isArgentineNationalNumber("11555012345")).toBe(false);
    expect(isArgentineNationalNumber("1012345678")).toBe(false);
    expect(isArgentineNationalNumber("4155550123")).toBe(false);
  });
});
