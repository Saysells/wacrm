import { describe, expect, it } from "vitest";

import {
  NEGOCIO_POR_DEFECTO,
  buildContactVars,
  primerNombre,
} from "./contact-vars";
import { hasContactVars, interpolate } from "./interpolate";

describe("primerNombre", () => {
  it("toma la primera palabra del nombre", () => {
    expect(primerNombre("Juan Pérez")).toBe("Juan");
    expect(primerNombre("  Ana   María  Gómez ")).toBe("Ana");
  });

  it("un nombre de una sola palabra sale entero", () => {
    expect(primerNombre("Elian")).toBe("Elian");
  });

  it("sin nombre devuelve vacío", () => {
    expect(primerNombre(null)).toBe("");
    expect(primerNombre(undefined)).toBe("");
    expect(primerNombre("   ")).toBe("");
  });

  it("un contacto que se llama como su teléfono no tiene nombre", () => {
    // Es como los deja el webhook de Meta cuando no hay perfil.
    expect(primerNombre("5491122334455")).toBe("");
    expect(primerNombre("+54 9 11 2233-4455")).toBe("");
  });

  it("un nombre con números adentro sigue siendo un nombre", () => {
    expect(primerNombre("Kiosco 24hs")).toBe("Kiosco");
  });
});

describe("buildContactVars", () => {
  it("arma las tres variables con los datos completos", () => {
    const v = buildContactVars({
      name: "Juan Pérez",
      customValues: { tipo_negocio: "Local de celular" },
    });
    expect(v.nombre).toBe("Juan");
    expect(v.nombre_coma).toBe(" Juan,");
    expect(v.tipo_negocio).toBe("local de celular");
  });

  it("sin nombre, la coma se queda", () => {
    // "Hola{{contact.nombre_coma}} te escribe Kosmo." tiene que salir
    // "Hola, te escribe Kosmo." y no "Hola te escribe Kosmo.".
    const v = buildContactVars({ name: null, customValues: {} });
    expect(v.nombre).toBe("");
    expect(v.nombre_coma).toBe(",");
  });

  it("sin tipo de negocio usa el genérico", () => {
    const v = buildContactVars({ name: "Ana", customValues: {} });
    expect(v.tipo_negocio).toBe(NEGOCIO_POR_DEFECTO);
  });

  it("un tipo de negocio en blanco cuenta como ausente", () => {
    const v = buildContactVars({
      name: "Ana",
      customValues: { tipo_negocio: "   " },
    });
    expect(v.tipo_negocio).toBe(NEGOCIO_POR_DEFECTO);
  });

  it("expone también el resto de los campos del formulario", () => {
    const v = buildContactVars({
      name: "Ana",
      customValues: { provincia: "Córdoba", volumen_restock: "" },
    });
    expect(v.provincia).toBe("Córdoba");
    // Un campo vacío no se expone: interpola igual a cadena vacía.
    expect(v.volumen_restock).toBeUndefined();
  });

  it("las tres derivadas le ganan a un campo que se llame igual", () => {
    const v = buildContactVars({
      name: "Ana",
      customValues: { nombre: "OTRA COSA", tipo_negocio: "Kiosco" },
    });
    expect(v.nombre).toBe("Ana");
    expect(v.tipo_negocio).toBe("kiosco");
  });
});

describe("interpolate con contacto", () => {
  const conNombre = buildContactVars({
    name: "Juan Pérez",
    customValues: { tipo_negocio: "Local de celular" },
  });
  const sinNada = buildContactVars({ name: null, customValues: {} });

  const APERTURA =
    "Hola{{contact.nombre_coma}} te escribe Kosmo. " +
    "Recibimos tu formulario por venta mayorista para {{contact.tipo_negocio}}.";

  it("el mensaje de apertura queda bien con los datos", () => {
    expect(interpolate(APERTURA, { vars: {}, contact: conNombre })).toBe(
      "Hola Juan, te escribe Kosmo. Recibimos tu formulario por venta " +
        "mayorista para local de celular.",
    );
  });

  it("y también sin ninguno de los dos datos", () => {
    expect(interpolate(APERTURA, { vars: {}, contact: sinNada })).toBe(
      "Hola, te escribe Kosmo. Recibimos tu formulario por venta " +
        "mayorista para tu negocio.",
    );
  });

  it("sigue interpolando las vars de la corrida", () => {
    expect(
      interpolate("Rango: {{vars.rango_horario}} — {{contact.nombre}}", {
        vars: { rango_horario: "de 10 a 12" },
        contact: conNombre,
      }),
    ).toBe("Rango: de 10 a 12 — Juan");
  });

  it("sin contacto resuelto, las de contacto quedan vacías", () => {
    expect(interpolate("Hola {{contact.nombre}}!", { vars: {} })).toBe(
      "Hola !",
    );
  });

  it("una variable de contacto que no existe queda vacía", () => {
    expect(
      interpolate("{{contact.no_existe}}", { vars: {}, contact: conNombre }),
    ).toBe("");
  });
});

describe("hasContactVars", () => {
  it("detecta si hace falta leer el contacto", () => {
    expect(hasContactVars("Hola {{contact.nombre}}")).toBe(true);
    expect(hasContactVars("Hola {{vars.x}}")).toBe(false);
    expect(hasContactVars("")).toBe(false);
    expect(hasContactVars(null)).toBe(false);
  });
});
