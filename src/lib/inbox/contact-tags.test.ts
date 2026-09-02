import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Tag } from "@/types";
import {
  assignableTags,
  attachTag,
  createAndAttachTag,
  detachTag,
  groupAssignableTags,
  orderAttachedTags,
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
    grupo: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

/** Etiqueta de grupo 'estado' (las 13 del embudo del setter). */
function estado(id: string, name: string): Tag {
  return { ...tag(id, name), grupo: "estado" };
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

describe("groupAssignableTags", () => {
  it("separa estado de otras: estado en orden de embudo, otras alfabeticas", () => {
    // Catalogo desordenado a proposito (la base lo trae por nombre).
    const all = [
      tag("o2", "VIP"),
      estado("e-perdido", "Perdido"),
      estado("e-nuevo", "Nuevo"),
      tag("o1", "Frio"),
      estado("e-gestion", "En gestión"),
      estado("e-paola", "Agendado a Paola"),
      tag("origen", "origen_form"),
    ];

    const groups = groupAssignableTags(all, [estado("e-gestion", "En gestión")]);

    // La que ya tiene no se ofrece; el resto sigue el embudo, no el abc
    // ("Agendado a Paola" iria primera alfabeticamente).
    expect(groups.estado.map((t) => t.name)).toEqual([
      "Nuevo",
      "Agendado a Paola",
      "Perdido",
    ]);
    expect(groups.otras.map((t) => t.name)).toEqual([
      "Frio",
      "origen_form",
      "VIP",
    ]);
  });

  it("una de estado con nombre fuera del embudo va al final", () => {
    const all = [
      estado("e-x", "Zzz inventada"),
      estado("e-ganada", "Ganada"),
      estado("e-aaa", "Aaa inventada"),
    ];

    expect(groupAssignableTags(all, []).estado.map((t) => t.name)).toEqual([
      "Ganada",
      "Aaa inventada",
      "Zzz inventada",
    ]);
  });

  it("los dos grupos vacios cuando el contacto ya tiene todo", () => {
    const all = [estado("e1", "Nuevo"), tag("o1", "VIP")];

    expect(groupAssignableTags(all, all)).toEqual({ estado: [], otras: [] });
  });
});

describe("orderAttachedTags", () => {
  it("pone la etiqueta de estado primera y deja las demas como vienen", () => {
    const attached = [
      tag("o2", "VIP"),
      tag("o1", "Frio"),
      estado("e1", "Propuesta"),
    ];

    expect(orderAttachedTags(attached).map((t) => t.id)).toEqual([
      "e1",
      "o2",
      "o1",
    ]);
  });

  it("sin etiqueta de estado devuelve la lista tal cual", () => {
    const attached = [tag("o2", "VIP"), tag("o1", "Frio")];

    expect(orderAttachedTags(attached)).toEqual(attached);
  });
});

describe("withTagAttached / withTagDetached", () => {
  it("al poner una etiqueta de estado saca la de estado anterior al instante", () => {
    // Espejo de lo que hace el trigger en la base, para que la ficha no
    // muestre dos estados hasta que vuelva la relectura.
    const attached = [estado("e1", "Nuevo"), tag("o1", "VIP")];

    expect(
      withTagAttached(attached, estado("e2", "En gestión")).map((t) => t.id),
    ).toEqual(["o1", "e2"]);
  });

  it("una etiqueta comun no toca la de estado", () => {
    const attached = [estado("e1", "Nuevo")];

    expect(withTagAttached(attached, tag("o1", "VIP")).map((t) => t.id)).toEqual(
      ["e1", "o1"],
    );
  });

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
