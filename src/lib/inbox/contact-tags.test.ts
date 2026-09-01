import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Tag } from "@/types";
import {
  assignableTags,
  attachTag,
  detachTag,
  withTagAttached,
  withTagDetached,
} from "./contact-tags";

function tag(id: string, name = id): Tag {
  return {
    id,
    user_id: "user-1",
    name,
    color: "#22c55e",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("assignableTags", () => {
  it("ofrece solo las etiquetas de la cuenta que el contacto todavia no tiene", () => {
    const all = [tag("t1", "VIP"), tag("t2", "Frio"), tag("t3", "Caliente")];

    expect(assignableTags(all, [tag("t2")]).map((t) => t.id)).toEqual([
      "t1",
      "t3",
    ]);
  });

  it("devuelve vacio cuando el contacto ya tiene todas", () => {
    const all = [tag("t1"), tag("t2")];

    expect(assignableTags(all, [tag("t1"), tag("t2")])).toEqual([]);
  });
});

describe("withTagAttached / withTagDetached", () => {
  it("agrega la pastilla al final y nunca duplica", () => {
    const attached = [tag("t1")];

    expect(withTagAttached(attached, tag("t2")).map((t) => t.id)).toEqual([
      "t1",
      "t2",
    ]);
    expect(withTagAttached(attached, tag("t1")).map((t) => t.id)).toEqual([
      "t1",
    ]);
  });

  it("saca la pastilla por tag id", () => {
    expect(
      withTagDetached([tag("t1"), tag("t2")], "t1").map((t) => t.id),
    ).toEqual(["t2"]);
  });
});

describe("attachTag", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persiste en contact_tags y devuelve la pastilla ya visible", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    const next = await attachTag("contact-9", tag("t2", "VIP"), [tag("t1")]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/contacts/contact-9/tags");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ tag_id: "t2" });
    // Sin recargar: la lista que el sidebar pinta ya trae la etiqueta.
    expect(next.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("no toca la lista si el endpoint falla", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Tag not found" }),
    });

    await expect(
      attachTag("contact-9", tag("t2"), [tag("t1")]),
    ).rejects.toThrow("Tag not found");
  });
});

describe("detachTag", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("borra la fila de contact_tags y saca la pastilla", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    const next = await detachTag("contact-9", "t1", [tag("t1"), tag("t2")]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/contacts/contact-9/tags");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ tag_id: "t1" });
    expect(next.map((t) => t.id)).toEqual(["t2"]);
  });

  it("propaga el error del servidor y deja la lista intacta", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Contact not found" }),
    });

    await expect(detachTag("contact-9", "t1", [tag("t1")])).rejects.toThrow(
      "Contact not found",
    );
  });
});
