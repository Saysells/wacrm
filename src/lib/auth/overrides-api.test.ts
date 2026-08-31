import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  nextOverrideValue,
  saveMemberPermissionOverride,
} from "./overrides-api";

describe("nextOverrideValue", () => {
  it("invierte el valor EFECTIVO, no el override crudo", () => {
    // Agent sin override: nav_dashboard efectivo false → tocar = true.
    expect(nextOverrideValue("agent", {}, "nav_dashboard")).toBe(true);
    // Agent con override true: efectivo true → tocar = false.
    expect(
      nextOverrideValue("agent", { nav_dashboard: true }, "nav_dashboard"),
    ).toBe(false);
    // Admin por default ve todo: tocar view_all_data = false.
    expect(nextOverrideValue("admin", {}, "view_all_data")).toBe(false);
    expect(
      nextOverrideValue("admin", { view_all_data: false }, "view_all_data"),
    ).toBe(true);
  });
});

describe("saveMemberPermissionOverride", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHea la clave y el valor correctos al endpoint del miembro", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await saveMemberPermissionOverride("user-7", "nav_dashboard", true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/account/members/user-7/permissions");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      key: "nav_dashboard",
      value: true,
    });
  });

  it("value null viaja tal cual (borra el override)", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await saveMemberPermissionOverride("user-7", "view_all_data", null);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      key: "view_all_data",
      value: null,
    });
  });

  it("propaga el mensaje de error del servidor", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Unknown permission key: nav_inbox" }),
    });

    await expect(
      saveMemberPermissionOverride("user-7", "nav_dashboard", true),
    ).rejects.toThrow("Unknown permission key: nav_inbox");
  });
});
