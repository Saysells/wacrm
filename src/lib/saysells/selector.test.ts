import { describe, expect, it } from "vitest";

import {
  BANDEJA_COLORS,
  bandejaColor,
  bandejaInitials,
  hostOf,
  isCurrentBandeja,
  parseBandejas,
  parseEquipo,
  resolveSelector,
} from "./selector";

describe("parseBandejas", () => {
  it("parsea nombre y URL, y una URL vacia queda como proximamente", () => {
    expect(
      parseBandejas("Saysells ARG|https://wpp.saysells.com,LaudoPet|"),
    ).toEqual([
      { nombre: "Saysells ARG", url: "https://wpp.saysells.com", dominio: "wpp.saysells.com" },
      { nombre: "LaudoPet", url: null, dominio: null },
    ]);
  });

  it("tolera espacios de borde y una entrada sin pipe", () => {
    expect(parseBandejas("  Kosmo | https://kosmo.wpp.saysells.com/ , Star Energy ")).toEqual([
      { nombre: "Kosmo", url: "https://kosmo.wpp.saysells.com", dominio: "kosmo.wpp.saysells.com" },
      { nombre: "Star Energy", url: null, dominio: null },
    ]);
  });

  it("descarta entradas sin nombre y trata una URL rota como vacia", () => {
    expect(parseBandejas("|https://x.com,,Rota|wpp.saysells.com")).toEqual([
      { nombre: "Rota", url: null, dominio: null },
    ]);
  });

  it("devuelve vacio sin variable", () => {
    expect(parseBandejas(undefined)).toEqual([]);
    expect(parseBandejas("")).toEqual([]);
  });
});

describe("parseEquipo", () => {
  it("normaliza a minuscula, saca espacios y duplicados", () => {
    expect(parseEquipo(" Emi@Saysells.com , emi@saysells.com,,eze@saysells.com ")).toEqual([
      "emi@saysells.com",
      "eze@saysells.com",
    ]);
  });

  it("devuelve vacio sin variable", () => {
    expect(parseEquipo(null)).toEqual([]);
  });
});

describe("resolveSelector", () => {
  const bandejasRaw = "Saysells ARG|https://wpp.saysells.com,LaudoPet|";
  const equipoRaw = "emi@saysells.com,eze@saysells.com";

  it("es visible para alguien del equipo, con la lista completa", () => {
    const r = resolveSelector({ email: "Emi@saysells.com", bandejasRaw, equipoRaw });
    expect(r.visible).toBe(true);
    expect(r.bandejas.map((b) => b.nombre)).toEqual(["Saysells ARG", "LaudoPet"]);
  });

  it("se oculta y no devuelve bandejas si el mail no esta en la lista", () => {
    expect(resolveSelector({ email: "otro@cliente.com", bandejasRaw, equipoRaw })).toEqual({
      visible: false,
      bandejas: [],
    });
  });

  it("se oculta si falta cualquiera de las dos variables, o el mail", () => {
    expect(resolveSelector({ email: "emi@saysells.com", bandejasRaw: undefined, equipoRaw })).toEqual({
      visible: false,
      bandejas: [],
    });
    expect(resolveSelector({ email: "emi@saysells.com", bandejasRaw, equipoRaw: "" })).toEqual({
      visible: false,
      bandejas: [],
    });
    expect(resolveSelector({ email: null, bandejasRaw, equipoRaw })).toEqual({
      visible: false,
      bandejas: [],
    });
  });
});

describe("hostOf / isCurrentBandeja", () => {
  it("saca el host en minuscula y rechaza lo que no es una URL absoluta", () => {
    expect(hostOf("https://USA.wpp.saysells.com/inbox")).toBe("usa.wpp.saysells.com");
    expect(hostOf("wpp.saysells.com")).toBeNull();
    expect(hostOf("javascript:alert(1)")).toBeNull();
    expect(hostOf("")).toBeNull();
  });

  it("marca la bandeja cuyo dominio es el host actual", () => {
    const [arg, lp] = parseBandejas("Saysells ARG|https://wpp.saysells.com,LaudoPet|");
    expect(isCurrentBandeja(arg, "wpp.saysells.com")).toBe(true);
    expect(isCurrentBandeja(arg, "WPP.saysells.com")).toBe(true);
    expect(isCurrentBandeja(arg, "usa.wpp.saysells.com")).toBe(false);
    expect(isCurrentBandeja(lp, "wpp.saysells.com")).toBe(false);
  });
});

describe("bandejaInitials / bandejaColor", () => {
  it("usa una letra para un nombre y dos para dos palabras", () => {
    expect(bandejaInitials("Kosmo")).toBe("K");
    expect(bandejaInitials("Saysells ARG")).toBe("SA");
    expect(bandejaInitials("  star   energy ")).toBe("SE");
    expect(bandejaInitials("")).toBe("?");
  });

  it("elige siempre el mismo color de la paleta para el mismo nombre", () => {
    expect(bandejaColor("Kosmo")).toBe(bandejaColor("kosmo"));
    expect(BANDEJA_COLORS).toContain(bandejaColor("Saysells USA"));
  });
});
