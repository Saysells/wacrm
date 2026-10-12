import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIDE_TAB,
  PANEL_OPEN_MIN_WIDTH,
  defaultPanelOpen,
  effectiveSideTab,
  isSideTab,
  tabAfterOpeningConversation,
  togglePanelTab,
  visibleSideTabs,
} from "./side-panel";

describe("defaultPanelOpen", () => {
  it("arranca abierto desde 1380 px y cerrado abajo, como el prototipo", () => {
    expect(defaultPanelOpen(PANEL_OPEN_MIN_WIDTH)).toBe(true);
    expect(defaultPanelOpen(1920)).toBe(true);
    expect(defaultPanelOpen(PANEL_OPEN_MIN_WIDTH - 1)).toBe(false);
    expect(defaultPanelOpen(1180)).toBe(false);
  });
});

describe("togglePanelTab", () => {
  it("tocar la pestaña activa cierra el panel", () => {
    expect(togglePanelTab({ open: true, tab: "ficha" }, "ficha")).toEqual({
      open: false,
      tab: "ficha",
    });
  });

  it("tocar otra pestaña abre el panel en esa pestaña", () => {
    expect(togglePanelTab({ open: true, tab: "ficha" }, "calls")).toEqual({
      open: true,
      tab: "calls",
    });
  });

  it("con el panel cerrado, cualquier pestaña lo abre (también la que quedó guardada)", () => {
    expect(togglePanelTab({ open: false, tab: "notes" }, "notes")).toEqual({
      open: true,
      tab: "notes",
    });
  });
});

describe("tabAfterOpeningConversation", () => {
  it("Llamadas y Propuestas pasan a Ficha al abrir una conversación", () => {
    expect(tabAfterOpeningConversation("calls")).toBe("ficha");
    expect(tabAfterOpeningConversation("props")).toBe("ficha");
  });

  it("Ficha y Notas se conservan", () => {
    expect(tabAfterOpeningConversation("ficha")).toBe("ficha");
    expect(tabAfterOpeningConversation("notes")).toBe("notes");
  });
});

describe("visibleSideTabs / effectiveSideTab", () => {
  it("sin etiquetas con fecha no hay Llamadas; sin equipo Saysells no hay Propuestas", () => {
    expect(visibleSideTabs({ scheduling: false, saysells: false })).toEqual(["ficha", "notes"]);
    expect(visibleSideTabs({ scheduling: true, saysells: false })).toEqual([
      "ficha",
      "calls",
      "notes",
    ]);
    expect(visibleSideTabs({ scheduling: true, saysells: true })).toEqual([
      "ficha",
      "calls",
      "notes",
      "props",
    ]);
  });

  it("una pestaña guardada que ya no está disponible cae en la ficha", () => {
    expect(effectiveSideTab("calls", { scheduling: false, saysells: true })).toBe(DEFAULT_SIDE_TAB);
    expect(effectiveSideTab("props", { scheduling: true, saysells: false })).toBe(DEFAULT_SIDE_TAB);
    expect(effectiveSideTab("notes", { scheduling: false, saysells: false })).toBe("notes");
  });

  it("isSideTab reconoce solo las cuatro pestañas", () => {
    expect(isSideTab("ficha")).toBe(true);
    expect(isSideTab("props")).toBe(true);
    expect(isSideTab("agenda")).toBe(false);
    expect(isSideTab(null)).toBe(false);
  });
});
