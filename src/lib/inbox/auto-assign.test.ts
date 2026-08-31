import { describe, expect, it } from "vitest";

import { resolveAutoAssignee } from "./auto-assign";

describe("resolveAutoAssignee", () => {
  it("assigns an unowned conversation to the replying agent", () => {
    expect(
      resolveAutoAssignee({
        role: "agent",
        assignedAgentId: null,
        userId: "agent-1",
      }),
    ).toBe("agent-1");
  });

  it("never reassigns a conversation that already has an owner", () => {
    expect(
      resolveAutoAssignee({
        role: "agent",
        assignedAgentId: "agent-2",
        userId: "agent-1",
      }),
    ).toBeNull();
  });

  it("is a no-op when the thread is already the sender's", () => {
    expect(
      resolveAutoAssignee({
        role: "agent",
        assignedAgentId: "agent-1",
        userId: "agent-1",
      }),
    ).toBeNull();
  });

  it.each(["owner", "admin", "viewer"] as const)(
    "does not claim threads for the %s role",
    (role) => {
      expect(
        resolveAutoAssignee({
          role,
          assignedAgentId: null,
          userId: "user-1",
        }),
      ).toBeNull();
    },
  );
});
