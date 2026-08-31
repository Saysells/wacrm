import { describe, expect, it } from "vitest";

import {
  canSeeConversation,
  contactExclusionList,
  conversationVisibilityFilter,
  hiddenContactIds,
} from "./visibility";

describe("conversationVisibilityFilter", () => {
  it("restricts agents to unassigned threads and their own", () => {
    expect(conversationVisibilityFilter("agent", "agent-1")).toBe(
      "assigned_agent_id.is.null,assigned_agent_id.eq.agent-1",
    );
  });

  it.each(["owner", "admin", "viewer"] as const)(
    "leaves the %s query unfiltered",
    (role) => {
      expect(conversationVisibilityFilter(role, "user-1")).toBeNull();
    },
  );
});

describe("canSeeConversation", () => {
  it("lets an agent see unassigned threads and their own", () => {
    expect(canSeeConversation("agent", "agent-1", null)).toBe(true);
    expect(canSeeConversation("agent", "agent-1", undefined)).toBe(true);
    expect(canSeeConversation("agent", "agent-1", "agent-1")).toBe(true);
  });

  it("hides another agent's thread from an agent", () => {
    expect(canSeeConversation("agent", "agent-1", "agent-2")).toBe(false);
  });

  it.each(["owner", "admin", "viewer"] as const)(
    "shows everything to the %s role",
    (role) => {
      expect(canSeeConversation(role, "user-1", "agent-2")).toBe(true);
    },
  );
});

describe("hiddenContactIds", () => {
  it("hides contacts whose thread belongs to another agent", () => {
    const rows = [
      { contact_id: "c-unassigned", assigned_agent_id: null },
      { contact_id: "c-mine", assigned_agent_id: "agent-1" },
      { contact_id: "c-theirs", assigned_agent_id: "agent-2" },
    ];
    expect(hiddenContactIds(rows, "agent-1")).toEqual(["c-theirs"]);
  });

  it("hides nothing when every thread is unassigned or the agent's", () => {
    const rows = [
      { contact_id: "c1", assigned_agent_id: null },
      { contact_id: "c2", assigned_agent_id: "agent-1" },
    ];
    expect(hiddenContactIds(rows, "agent-1")).toEqual([]);
  });
});

describe("contactExclusionList", () => {
  it("formats ids for a PostgREST not-in filter", () => {
    expect(contactExclusionList(["a", "b"])).toBe("(a,b)");
  });

  it("returns null when there is nothing to exclude", () => {
    expect(contactExclusionList([])).toBeNull();
  });
});
