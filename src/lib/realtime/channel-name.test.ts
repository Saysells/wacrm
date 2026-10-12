import { describe, expect, it } from "vitest";

import { uniqueChannelName } from "./channel-name";

describe("uniqueChannelName", () => {
  it("dos instancias nunca piden el mismo nombre de canal", () => {
    const a = uniqueChannelName("notifications-unread-count");
    const b = uniqueChannelName("notifications-unread-count");
    expect(a).not.toBe(b);
    expect(a.startsWith("notifications-unread-count:")).toBe(true);
    expect(b.startsWith("notifications-unread-count:")).toBe(true);
  });

  it("no repite ni con muchas instancias ni entre prefijos", () => {
    const names = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      names.add(uniqueChannelName(i % 2 ? "total-unread" : "notifications-unread-count"));
    }
    expect(names.size).toBe(1000);
  });
});
