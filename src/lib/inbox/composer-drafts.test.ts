import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendDraft,
  getNoteDraft,
  getReplyDraft,
  prefillReplyDraft,
  resetDraftsForTests,
  setNoteDraft,
  setReplyDraft,
  subscribeReplyDraft,
} from "./composer-drafts";

beforeEach(() => {
  resetDraftsForTests();
});

describe("appendDraft", () => {
  it("con el cuadro vacío (o solo espacios) queda el texto nuevo solo", () => {
    expect(appendDraft("", "¡Listo!")).toBe("¡Listo!");
    expect(appendDraft("   \n", "¡Listo!")).toBe("¡Listo!");
  });

  it("con un borrador, el texto nuevo va abajo en su propia línea", () => {
    expect(appendDraft("Hola Juan, ", "¡Listo!")).toBe("Hola Juan,\n¡Listo!");
    expect(appendDraft("Hola\n\n", "¡Listo!")).toBe("Hola\n¡Listo!");
  });
});

describe("borradores por conversación", () => {
  it("responder y nota viven separados y por conversación", () => {
    setReplyDraft("c1", "hola");
    setNoteDraft("c1", "nota");
    expect(getReplyDraft("c1")).toBe("hola");
    expect(getNoteDraft("c1")).toBe("nota");
    expect(getReplyDraft("c2")).toBe("");
    expect(getNoteDraft("c2")).toBe("");
  });

  it("prefillReplyDraft agrega al borrador y avisa solo al cuadro de ESA conversación", () => {
    const c1 = vi.fn();
    const c2 = vi.fn();
    subscribeReplyDraft("c1", c1);
    subscribeReplyDraft("c2", c2);
    setReplyDraft("c1", "Hola Juan");

    const next = prefillReplyDraft("c1", "¡Listo Juan! Te agendé…");

    expect(next).toBe("Hola Juan\n¡Listo Juan! Te agendé…");
    expect(getReplyDraft("c1")).toBe(next);
    expect(c1).toHaveBeenCalledWith(next);
    expect(c2).not.toHaveBeenCalled();
  });

  it("sin cuadro montado el borrador queda guardado igual, para cuando se abra", () => {
    prefillReplyDraft("c9", "texto");
    expect(getReplyDraft("c9")).toBe("texto");
  });

  it("desuscribirse deja de avisar", () => {
    const l = vi.fn();
    const off = subscribeReplyDraft("c1", l);
    off();
    prefillReplyDraft("c1", "x");
    expect(l).not.toHaveBeenCalled();
  });
});
