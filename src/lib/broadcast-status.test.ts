import { describe, expect, it } from "vitest";
import {
  broadcastStatusConfig,
  getBroadcastStatus,
  getRecipientStatus,
  recipientStatusConfig,
} from "./broadcast-status";

describe("getBroadcastStatus", () => {
  it("returns the matching config for known statuses", () => {
    expect(getBroadcastStatus("sending")).toBe(broadcastStatusConfig.sending);
    expect(getBroadcastStatus("sent")).toBe(broadcastStatusConfig.sent);
    expect(getBroadcastStatus("failed")).toBe(broadcastStatusConfig.failed);
  });

  it("flags `sending` as a live/pulsing state", () => {
    expect(getBroadcastStatus("sending").pulse).toBe(true);
    expect(getBroadcastStatus("sent").pulse).toBeFalsy();
  });

  it("falls back to draft on an unknown status string", () => {
    expect(getBroadcastStatus("not-a-real-status")).toBe(
      broadcastStatusConfig.draft,
    );
    expect(getBroadcastStatus("")).toBe(broadcastStatusConfig.draft);
  });

  it("cada estado mapea a una variante del Badge del sistema (sesión F2)", () => {
    const allowed = ["secondary", "info", "warning", "success", "danger", "selected"];
    for (const v of Object.values(broadcastStatusConfig)) {
      expect(allowed).toContain(v.variant);
    }
    // El naranja (`pending`) es solo para lo que espera respuesta.
    expect(Object.values(broadcastStatusConfig).map((v) => v.variant)).not.toContain("pending");
    expect(broadcastStatusConfig.sending.pulse).toBe(true);
  });
});

describe("getRecipientStatus", () => {
  it("returns the matching config for known statuses", () => {
    expect(getRecipientStatus("delivered")).toBe(
      recipientStatusConfig.delivered,
    );
    expect(getRecipientStatus("read")).toBe(recipientStatusConfig.read);
  });

  it("falls back to pending on an unknown status string", () => {
    expect(getRecipientStatus("???")).toBe(recipientStatusConfig.pending);
  });
});
