import { describe, expect, it } from "vitest";

import { isTypingTarget, neighborId, shortcutFor, SHORTCUT_HELP } from "./shortcuts";

const free = { typing: false, overlayOpen: false, modifier: false, canAct: true };

describe("shortcutFor", () => {
  it("mapea cada tecla a su acción, sin importar mayúsculas", () => {
    expect(shortcutFor("j", free)).toBe("next");
    expect(shortcutFor("K", free)).toBe("prev");
    expect(shortcutFor("a", free)).toBe("take");
    expect(shortcutFor("L", free)).toBe("schedule");
    expect(shortcutFor("e", free)).toBe("close");
    expect(shortcutFor("n", free)).toBe("note");
    expect(shortcutFor("/", free)).toBe("slash");
    expect(shortcutFor("?", free)).toBe("help");
    expect(shortcutFor("x", free)).toBeNull();
    expect(shortcutFor("Enter", free)).toBeNull();
  });

  it("el viewer solo se mueve y pide la ayuda", () => {
    const viewer = { ...free, canAct: false };
    expect(shortcutFor("j", viewer)).toBe("next");
    expect(shortcutFor("k", viewer)).toBe("prev");
    expect(shortcutFor("?", viewer)).toBe("help");
    for (const key of ["a", "l", "e", "n", "/"]) expect(shortcutFor(key, viewer)).toBeNull();
  });

  it("nada mientras se escribe, con algo abierto o con modificador", () => {
    expect(shortcutFor("j", { ...free, typing: true })).toBeNull();
    expect(shortcutFor("?", { ...free, overlayOpen: true })).toBeNull();
    expect(shortcutFor("e", { ...free, modifier: true })).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("input, textarea, select o contenteditable", () => {
    expect(isTypingTarget("INPUT", false)).toBe(true);
    expect(isTypingTarget("textarea", false)).toBe(true);
    expect(isTypingTarget("SELECT", false)).toBe(true);
    expect(isTypingTarget("DIV", true)).toBe(true);
    expect(isTypingTarget("DIV", false)).toBe(false);
    expect(isTypingTarget("BUTTON", false)).toBe(false);
    expect(isTypingTarget(null, false)).toBe(false);
  });
});

describe("neighborId", () => {
  const ids = ["a", "b", "c"];
  it("siguiente y anterior, quedándose en los bordes", () => {
    expect(neighborId(ids, "a", 1)).toBe("b");
    expect(neighborId(ids, "b", -1)).toBe("a");
    expect(neighborId(ids, "c", 1)).toBeNull();
    expect(neighborId(ids, "a", -1)).toBeNull();
  });
  it("sin abierta o con una fuera de la lista va a la primera; lista vacía, nada", () => {
    expect(neighborId(ids, null, 1)).toBe("a");
    expect(neighborId(ids, null, -1)).toBe("a");
    expect(neighborId(ids, "zzz", 1)).toBe("a");
    expect(neighborId([], null, 1)).toBeNull();
  });
});

describe("SHORTCUT_HELP", () => {
  it("lista las nueve filas del prototipo en orden", () => {
    expect(SHORTCUT_HELP.map((r) => r.keys)).toEqual(["J", "K", "A", "L", "E", "/", "N", "Esc", "?"]);
  });
});
