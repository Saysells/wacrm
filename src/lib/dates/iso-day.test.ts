import { describe, expect, it } from "vitest";

import {
  formatIsoDay,
  initialMonth,
  parseIsoDay,
  sameIsoDay,
  shiftMonthOf,
  toIsoDay,
  todayIsoDay,
} from "./iso-day";

describe("parseIsoDay / toIsoDay", () => {
  it("parsea y vuelve a serializar sin perder nada", () => {
    expect(parseIsoDay("2026-10-13")).toEqual({ year: 2026, month: 9, day: 13 });
    expect(toIsoDay({ year: 2026, month: 0, day: 5 })).toBe("2026-01-05");
    expect(toIsoDay(parseIsoDay("2026-12-31")!)).toBe("2026-12-31");
  });

  it("rechaza lo que no es un día ISO válido", () => {
    expect(parseIsoDay("")).toBeNull();
    expect(parseIsoDay(null)).toBeNull();
    expect(parseIsoDay("13/10/2026")).toBeNull();
    expect(parseIsoDay("2026-13-01")).toBeNull();
    expect(parseIsoDay("2026-02-30")).toBeNull();
    expect(parseIsoDay("2026-10-13T00:00:00Z")).toBeNull();
  });
});

describe("initialMonth", () => {
  const now = new Date(2026, 9, 13).getTime();
  it("abre en el mes del valor", () => {
    expect(initialMonth("2027-03-02", now)).toEqual({ year: 2027, month: 2 });
  });
  it("sin valor abre en el mes de hoy", () => {
    expect(initialMonth("", now)).toEqual({ year: 2026, month: 9 });
    expect(todayIsoDay(now)).toEqual({ year: 2026, month: 9, day: 13 });
  });
});

describe("shiftMonthOf", () => {
  it("cruza el año en las dos direcciones", () => {
    expect(shiftMonthOf({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonthOf({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
  });
});

describe("sameIsoDay", () => {
  it("compara los tres campos y tolera null", () => {
    const a = { year: 2026, month: 9, day: 13 };
    expect(sameIsoDay(a, { ...a })).toBe(true);
    expect(sameIsoDay(a, { ...a, day: 14 })).toBe(false);
    expect(sameIsoDay(a, null)).toBe(false);
    expect(sameIsoDay(null, null)).toBe(false);
  });
});

describe("formatIsoDay", () => {
  it("formatea en el idioma pedido y devuelve vacío si no hay valor", () => {
    expect(formatIsoDay("2026-10-13", "en-US")).toBe("Oct 13, 2026");
    expect(formatIsoDay("", "es-AR")).toBe("");
  });
});
