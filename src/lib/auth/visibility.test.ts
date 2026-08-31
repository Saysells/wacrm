import { describe, expect, it } from "vitest";

import {
  canSeeConversation,
  contactExclusionList,
  conversationVisibilityFilter,
  hiddenContactIds,
} from "./visibility";

describe("conversationVisibilityFilter", () => {
  it("restringe a un agent (sin view_all_data) a hilos sin asignar o propios", () => {
    expect(conversationVisibilityFilter("agent", {}, "agent-1")).toBe(
      "assigned_agent_id.is.null,assigned_agent_id.eq.agent-1",
    );
  });

  it.each(["owner", "admin", "viewer"] as const)(
    "no filtra a %s sin overrides",
    (role) => {
      expect(conversationVisibilityFilter(role, {}, "user-1")).toBeNull();
    },
  );

  it("un admin con view_all_data:false queda filtrado como un agent", () => {
    expect(
      conversationVisibilityFilter("admin", { view_all_data: false }, "adm-1"),
    ).toBe("assigned_agent_id.is.null,assigned_agent_id.eq.adm-1");
  });

  it("un agent con view_all_data:true ve todo (sin filtro)", () => {
    expect(
      conversationVisibilityFilter("agent", { view_all_data: true }, "a-1"),
    ).toBeNull();
  });

  it("rol null no filtra (los callers esperan a profileLoading)", () => {
    expect(conversationVisibilityFilter(null, {}, "u-1")).toBeNull();
  });
});

describe("canSeeConversation", () => {
  it("un agent ve hilos sin asignar y propios", () => {
    expect(canSeeConversation("agent", {}, "agent-1", null)).toBe(true);
    expect(canSeeConversation("agent", {}, "agent-1", undefined)).toBe(true);
    expect(canSeeConversation("agent", {}, "agent-1", "agent-1")).toBe(true);
  });

  it("un agent no ve el hilo de otro", () => {
    expect(canSeeConversation("agent", {}, "agent-1", "agent-2")).toBe(false);
  });

  it("un admin con view_all_data:false tampoco ve el hilo de otro", () => {
    expect(
      canSeeConversation("admin", { view_all_data: false }, "adm-1", "agent-2"),
    ).toBe(false);
    expect(
      canSeeConversation("admin", { view_all_data: false }, "adm-1", null),
    ).toBe(true);
  });

  it("un agent con view_all_data:true ve todo", () => {
    expect(
      canSeeConversation("agent", { view_all_data: true }, "a-1", "agent-2"),
    ).toBe(true);
  });

  it.each(["owner", "admin", "viewer"] as const)(
    "%s sin overrides ve todo",
    (role) => {
      expect(canSeeConversation(role, {}, "user-1", "agent-2")).toBe(true);
    },
  );

  it("falla abierto con rol null (la query filtrada es la autoridad)", () => {
    expect(canSeeConversation(null, {}, "u-1", "agent-2")).toBe(true);
  });
});

describe("hiddenContactIds", () => {
  it("oculta contactos cuyo hilo pertenece a otro", () => {
    const rows = [
      { contact_id: "c-unassigned", assigned_agent_id: null },
      { contact_id: "c-mine", assigned_agent_id: "agent-1" },
      { contact_id: "c-theirs", assigned_agent_id: "agent-2" },
    ];
    expect(hiddenContactIds(rows, "agent-1")).toEqual(["c-theirs"]);
  });

  it("no oculta nada cuando todo es propio o está sin asignar", () => {
    const rows = [
      { contact_id: "c1", assigned_agent_id: null },
      { contact_id: "c2", assigned_agent_id: "agent-1" },
    ];
    expect(hiddenContactIds(rows, "agent-1")).toEqual([]);
  });
});

describe("contactExclusionList", () => {
  it("formatea ids para un not-in de PostgREST", () => {
    expect(contactExclusionList(["a", "b"])).toBe("(a,b)");
  });

  it("devuelve null cuando no hay nada que excluir", () => {
    expect(contactExclusionList([])).toBeNull();
  });
});
