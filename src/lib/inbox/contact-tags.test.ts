import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Tag } from "@/types";
import {
  assignableTags,
  attachTag,
  createAndAttachTag,
  detachTag,
  TagCreateError,
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

// ------------------------------------------------------------
// Crear una etiqueta sin salir de la Bandeja. Insert directo a
// `tags` (RLS admin+, sin API route) — el mismo patron que
// tag-manager.tsx — y aplicada al contacto en el mismo paso, por el
// mismo camino que attachTag.
// ------------------------------------------------------------
interface InsertScript {
  row?: Tag;
  error?: { message: string } | null;
}

function makeDb(script: InsertScript) {
  const inserted: Record<string, unknown>[] = [];
  const tables: string[] = [];

  const builder = {
    insert: (values: Record<string, unknown>) => {
      inserted.push(values);
      return builder;
    },
    select: () => builder,
    single: () =>
      Promise.resolve(
        script.error
          ? { data: null, error: script.error }
          : { data: script.row ?? null, error: null },
      ),
  };

  const db = {
    from: (table: string) => {
      tables.push(table);
      return builder;
    },
  } as unknown as SupabaseClient;

  return { db, inserted, tables };
}

describe("createAndAttachTag", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const base = {
    accountId: "account-1",
    userId: "user-1",
    contactId: "contact-9",
    color: "#10b981",
  };

  it("persiste en tags, la aplica al contacto y la suma al catalogo sin recargar", async () => {
    const created = tag("t9", "Interesado");
    const { db, inserted, tables } = makeDb({ row: created });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    const result = await createAndAttachTag({
      ...base,
      db,
      name: "  Interesado  ",
      accountTags: [tag("t1", "VIP")],
      attached: [tag("t1", "VIP")],
    });

    // 1. La fila queda en `tags` con account_id + user_id + name + color.
    expect(tables).toEqual(["tags"]);
    expect(inserted).toEqual([
      {
        account_id: "account-1",
        user_id: "user-1",
        name: "Interesado",
        color: "#10b981",
      },
    ]);

    // 2. Se asocia por el MISMO camino que attachTag.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/contacts/contact-9/tags");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ tag_id: "t9" });

    // 3. Pastilla puesta y catalogo actualizado en memoria (por nombre,
    //    igual que el orden con el que el sidebar los trae).
    expect(result.tag).toEqual(created);
    expect(result.attached.map((t) => t.id)).toEqual(["t1", "t9"]);
    expect(result.accountTags.map((t) => t.name)).toEqual([
      "Interesado",
      "VIP",
    ]);
  });

  it("un nombre vacio no inserta nada ni toca la red", async () => {
    const { db, inserted } = makeDb({});

    await expect(
      createAndAttachTag({
        ...base,
        db,
        name: "   ",
        accountTags: [],
        attached: [],
      }),
    ).rejects.toMatchObject({ code: "empty_name" });

    expect(inserted).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un nombre que ya existe en la cuenta no crea una segunda fila", async () => {
    const { db, inserted } = makeDb({});

    // Mismo nombre con otra capitalizacion y espacios: sigue siendo el
    // mismo para la persona que lo escribe.
    const err = await createAndAttachTag({
      ...base,
      db,
      name: " vip ",
      accountTags: [tag("t1", "VIP")],
      attached: [],
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TagCreateError);
    expect(err).toMatchObject({ code: "duplicate_name" });
    expect(inserted).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propaga el error del insert sin tocar la red", async () => {
    const { db } = makeDb({ error: { message: "new row violates RLS" } });

    await expect(
      createAndAttachTag({
        ...base,
        db,
        name: "Interesado",
        accountTags: [],
        attached: [],
      }),
    ).rejects.toThrow("new row violates RLS");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si falla la asociacion devuelve la etiqueta creada para no perderla del catalogo", async () => {
    const created = tag("t9", "Interesado");
    const { db } = makeDb({ row: created });
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Contact not found" }),
    });

    const err = (await createAndAttachTag({
      ...base,
      db,
      name: "Interesado",
      accountTags: [],
      attached: [],
    }).catch((e: unknown) => e)) as TagCreateError;

    expect(err).toBeInstanceOf(TagCreateError);
    expect(err.code).toBe("attach_failed");
    // La fila ya existe en `tags`: el caller la suma igual al catalogo.
    expect(err.tag).toEqual(created);
  });
});
