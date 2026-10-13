import { describe, expect, it } from "vitest";

import {
  BANDEJA_COLORS,
  bandejaColor,
  bandejaInitials,
  displayNumberFrom,
  groupBandejas,
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
      { nombre: "Saysells ARG", url: "https://wpp.saysells.com", dominio: "wpp.saysells.com", grupo: null },
      { nombre: "LaudoPet", url: null, dominio: null, grupo: null },
    ]);
  });

  it("tolera espacios de borde y una entrada sin pipe", () => {
    expect(parseBandejas("  Kosmo | https://kosmo.wpp.saysells.com/ , Star Energy ")).toEqual([
      { nombre: "Kosmo", url: "https://kosmo.wpp.saysells.com", dominio: "kosmo.wpp.saysells.com", grupo: null },
      { nombre: "Star Energy", url: null, dominio: null, grupo: null },
    ]);
  });

  it("descarta entradas sin nombre y trata una URL rota como vacia", () => {
    expect(parseBandejas("|https://x.com,,Rota|wpp.saysells.com")).toEqual([
      { nombre: "Rota", url: null, dominio: null, grupo: null },
    ]);
  });

  it("lee el tercer campo como grupo (sesión F1), opcional", () => {
    expect(parseBandejas("Saysells ARG|https://wpp.saysells.com| Saysells ,Kosmo||Clientes,LaudoPet|")).toEqual([
      { nombre: "Saysells ARG", url: "https://wpp.saysells.com", dominio: "wpp.saysells.com", grupo: "Saysells" },
      { nombre: "Kosmo", url: null, dominio: null, grupo: "Clientes" },
      { nombre: "LaudoPet", url: null, dominio: null, grupo: null },
    ]);
  });
});

describe("groupBandejas", () => {
  it("sin grupos, un solo bloque sin rótulo (el menú de hoy)", () => {
    const list = parseBandejas("A|https://a.com,B|");
    expect(groupBandejas(list)).toEqual([{ grupo: null, bandejas: list }]);
    expect(groupBandejas([])).toEqual([{ grupo: null, bandejas: [] }]);
  });

  it("agrupa en orden de aparición, sin distinguir mayúsculas, y las sin grupo al final", () => {
    const list = parseBandejas(
      "Saysells ARG|https://a.com|Saysells,Kosmo|https://k.com|Clientes,Saysells USA|https://u.com|saysells,LaudoPet||Clientes,Suelta|",
    );
    const groups = groupBandejas(list);
    expect(groups.map((g) => g.grupo)).toEqual(["Saysells", "Clientes", null]);
    expect(groups[0].bandejas.map((b) => b.nombre)).toEqual(["Saysells ARG", "Saysells USA"]);
    expect(groups[1].bandejas.map((b) => b.nombre)).toEqual(["Kosmo", "LaudoPet"]);
    expect(groups[2].bandejas.map((b) => b.nombre)).toEqual(["Suelta"]);
  });

  it("con todas agrupadas no agrega el bloque vacío", () => {
    const groups = groupBandejas(parseBandejas("A|https://a.com|X,B||X"));
    expect(groups.map((g) => g.grupo)).toEqual(["X"]);
  });
});

describe("displayNumberFrom", () => {
  it("devuelve el número solo con connected: true y display_phone_number", () => {
    expect(displayNumberFrom({ connected: true, phone_info: { display_phone_number: " +1 555 010 0000 " } })).toBe(
      "+1 555 010 0000",
    );
  });

  it("devuelve null si no está conectado, falta el número o el cuerpo es raro", () => {
    expect(displayNumberFrom({ connected: false, reason: "no_config" })).toBeNull();
    expect(displayNumberFrom({ connected: true, phone_info: { verified_name: "X" } })).toBeNull();
    expect(displayNumberFrom({ connected: true, phone_info: { display_phone_number: "" } })).toBeNull();
    expect(displayNumberFrom(null)).toBeNull();
    expect(displayNumberFrom("texto")).toBeNull();
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
