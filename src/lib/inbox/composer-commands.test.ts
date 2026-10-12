import { beforeEach, describe, expect, it } from "vitest";

import {
  resetComposerCommandsForTests,
  sendComposerCommand,
  subscribeComposerCommands,
} from "./composer-commands";

describe("composer-commands", () => {
  beforeEach(() => resetComposerCommandsForTests());

  it("la orden llega solo al cuadro de esa conversación", () => {
    const got: string[] = [];
    subscribeComposerCommands("c1", (cmd) => got.push(`c1:${cmd}`));
    subscribeComposerCommands("c2", (cmd) => got.push(`c2:${cmd}`));
    expect(sendComposerCommand("c1", "note")).toBe(true);
    expect(got).toEqual(["c1:note"]);
  });

  it("sin cuadro montado la orden se pierde y avisa", () => {
    expect(sendComposerCommand("nadie", "slash")).toBe(false);
    const off = subscribeComposerCommands("c1", () => {});
    off();
    expect(sendComposerCommand("c1", "slash")).toBe(false);
  });
});
