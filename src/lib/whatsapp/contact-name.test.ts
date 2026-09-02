import { describe, expect, it } from "vitest";

import { isPlaceholderName, nameToFillIn } from "./contact-name";

const TEL = "5491133334444";

describe("isPlaceholderName", () => {
  it("vacío o solo espacios es relleno", () => {
    expect(isPlaceholderName(null, [TEL])).toBe(true);
    expect(isPlaceholderName("", [TEL])).toBe(true);
    expect(isPlaceholderName("   ", [TEL])).toBe(true);
  });

  it("el teléfono como nombre es relleno, escrito como venga", () => {
    expect(isPlaceholderName(TEL, [TEL])).toBe(true);
    expect(isPlaceholderName("+54 9 11 3333-4444", [TEL])).toBe(true);
    // El de la fila y el del mensaje pueden diferir en formato.
    expect(isPlaceholderName("1133334444", [null, TEL])).toBe(true);
  });

  it("un nombre con letras nunca es relleno, aunque tenga dígitos", () => {
    expect(isPlaceholderName("Local 4 · 11 3333-4444", [TEL])).toBe(false);
    expect(isPlaceholderName("EmilianoTESTING", [TEL])).toBe(false);
  });

  it("un número que no es el del contacto no es relleno", () => {
    expect(isPlaceholderName("1234", [TEL])).toBe(false);
  });
});

describe("nameToFillIn", () => {
  it("no pisa el nombre del formulario con el perfil de WhatsApp", () => {
    // El caso de producción: Tally trajo EmilianoTESTING, el perfil
    // de WhatsApp dice Emi.
    expect(
      nameToFillIn({
        existingName: "EmilianoTESTING",
        existingPhone: TEL,
        incomingPhone: TEL,
        incomingName: "Emi",
      }),
    ).toBeNull();
  });

  it("completa el nombre cuando el contacto no tiene ninguno", () => {
    expect(
      nameToFillIn({
        existingName: null,
        existingPhone: TEL,
        incomingPhone: TEL,
        incomingName: "Emi",
      }),
    ).toBe("Emi");
  });

  it("completa el nombre cuando el que hay es el teléfono", () => {
    expect(
      nameToFillIn({
        existingName: TEL,
        existingPhone: TEL,
        incomingPhone: TEL,
        incomingName: "Family Store Phone",
      }),
    ).toBe("Family Store Phone");
  });

  it("no escribe si el mensaje no trae nombre", () => {
    expect(
      nameToFillIn({
        existingName: TEL,
        existingPhone: TEL,
        incomingPhone: TEL,
        incomingName: "   ",
      }),
    ).toBeNull();
  });

  it("no escribe si el nombre entrante ya es el guardado", () => {
    expect(
      nameToFillIn({
        existingName: "Emi",
        existingPhone: TEL,
        incomingPhone: TEL,
        incomingName: "Emi",
      }),
    ).toBeNull();
  });

  it("un perfil que se llama como el teléfono no completa nada", () => {
    expect(
      nameToFillIn({
        existingName: "",
        existingPhone: TEL,
        incomingPhone: TEL,
        incomingName: TEL,
      }),
    ).toBeNull();
  });
});
