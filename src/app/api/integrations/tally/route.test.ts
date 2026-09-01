import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

// ------------------------------------------------------------
// Supabase falso en memoria. Soporta exactamente lo que usan el
// receptor y los helpers compartidos que reusa (findOrCreateContact,
// addContactTagAndDispatch): eq / ilike / like / limit / maybeSingle /
// single / insert / upsert / update, y el builder es awaitable.
//
// La gracia de que sea un store de verdad (y no un stub de respuestas
// scripteadas) es que el replay y el match del wa_id se verifican
// contra las filas que el propio receptor dejó escritas.
// ------------------------------------------------------------
type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(),
}));

vi.mock("@/lib/automations/engine", () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}));

const store: Record<string, Row[]> = {};
let idCounter = 0;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => fakeDb(),
}));

function matches(row: Row, filters: [string, string, unknown][]): boolean {
  return filters.every(([op, col, value]) => {
    const actual = row[col];
    if (op === "eq") return actual === value;
    if (op === "ilike") {
      return String(actual ?? "").toLowerCase() === String(value).toLowerCase();
    }
    if (op === "like") {
      const pattern = String(value);
      if (pattern.startsWith("%")) {
        return String(actual ?? "").endsWith(pattern.slice(1));
      }
      return String(actual ?? "") === pattern;
    }
    return true;
  });
}

function fakeDb() {
  return {
    from(table: string) {
      store[table] ??= [];
      const filters: [string, string, unknown][] = [];
      let op: "select" | "insert" | "upsert" | "update" = "select";
      let payload: Row[] = [];
      let patch: Row = {};
      let onConflict: string[] = [];
      let take: number | null = null;

      function resolve(): Promise<{ data: Row[] | null; error: null }> {
        const rows = store[table];
        if (op === "insert") {
          const inserted = payload.map((r) => ({ id: `${table}-${++idCounter}`, ...r }));
          rows.push(...inserted);
          return Promise.resolve({ data: inserted, error: null });
        }
        if (op === "upsert") {
          const written: Row[] = [];
          for (const r of payload) {
            const existing = rows.find((row) =>
              onConflict.every((col) => row[col] === r[col]),
            );
            if (existing) {
              Object.assign(existing, r);
              written.push(existing);
            } else {
              const created = { id: `${table}-${++idCounter}`, ...r };
              rows.push(created);
              written.push(created);
            }
          }
          return Promise.resolve({ data: written, error: null });
        }
        if (op === "update") {
          const hit = rows.filter((r) => matches(r, filters));
          hit.forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ data: hit, error: null });
        }
        const found = rows.filter((r) => matches(r, filters));
        return Promise.resolve({
          data: take === null ? found : found.slice(0, take),
          error: null,
        });
      }

      const builder = {
        select: () => builder,
        insert: (rows: Row | Row[]) => {
          op = "insert";
          payload = Array.isArray(rows) ? rows : [rows];
          return builder;
        },
        upsert: (rows: Row | Row[], options?: { onConflict?: string }) => {
          op = "upsert";
          payload = Array.isArray(rows) ? rows : [rows];
          onConflict = (options?.onConflict ?? "id").split(",").map((c) => c.trim());
          return builder;
        },
        update: (values: Row) => {
          op = "update";
          patch = values;
          return builder;
        },
        eq: (col: string, value: unknown) => {
          filters.push(["eq", col, value]);
          return builder;
        },
        ilike: (col: string, value: unknown) => {
          filters.push(["ilike", col, value]);
          return builder;
        },
        like: (col: string, value: unknown) => {
          filters.push(["like", col, value]);
          return builder;
        },
        order: () => builder,
        // Terminal en todos nuestros caminos.
        limit: (n: number) => {
          take = n;
          return resolve();
        },
        maybeSingle: async () => {
          const { data } = await resolve();
          return { data: data && data.length > 0 ? data[0] : null, error: null };
        },
        single: async () => {
          const { data } = await resolve();
          return data && data.length > 0
            ? { data: data[0], error: null }
            : { data: null, error: { code: "PGRST116", message: "no rows" } };
        },
        then: (
          onFulfilled: (v: { data: Row[] | null; error: null }) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => resolve().then(onFulfilled, onRejected),
      };

      return builder;
    },
  };
}

import { findExistingContact } from "@/lib/contacts/dedupe";
import { normalizeArgentinePhone } from "@/lib/phone/normalize-ar";
import {
  payloadVersionNueva,
  payloadVersionVieja,
  WA_ID_ENTRANTE,
} from "@/lib/integrations/tally/payload-fixtures";
import { POST } from "./route";

const SECRET = "test-tally-signing-secret";
const ACCOUNT = "acc-1";
const OWNER = "user-1";

function sign(rawBody: string): string {
  return crypto.createHmac("sha256", SECRET).update(rawBody, "utf8").digest("base64");
}

function request(payload: unknown, signature?: string | null) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const value = signature === undefined ? sign(body) : signature;
  if (value !== null) headers["Tally-Signature"] = value;
  return new Request("http://localhost/api/integrations/tally", {
    method: "POST",
    headers,
    body,
  });
}

function rows(table: string): Row[] {
  return store[table] ?? [];
}

/** Los valores del contacto, indexados por nombre de campo. */
function customValuesOf(contactId: string): Record<string, string> {
  const byId = new Map(rows("custom_fields").map((f) => [f.id, f.field_name as string]));
  const out: Record<string, string> = {};
  for (const v of rows("contact_custom_values")) {
    if (v.contact_id !== contactId) continue;
    out[byId.get(v.custom_field_id) as string] = v.value as string;
  }
  return out;
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  idCounter = 0;
  h.runAutomationsForTrigger.mockReset();
  vi.stubEnv("TALLY_SIGNING_SECRET", SECRET);
  vi.stubEnv("TALLY_ACCOUNT_ID", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
  // La cuenta destino se resuelve igual que en el webhook de Meta:
  // por la fila de whatsapp_config (acá hay una sola).
  store.whatsapp_config = [
    { id: "cfg-1", account_id: ACCOUNT, user_id: OWNER, phone_number_id: "pn-1" },
  ];
});

describe("POST /api/integrations/tally — firma", () => {
  it("sin firma → 401 y no escribe nada", async () => {
    const response = await POST(request(payloadVersionNueva(), null));

    expect(response.status).toBe(401);
    expect(rows("contacts")).toHaveLength(0);
  });

  it("firma inválida → 401 y no escribe nada", async () => {
    const response = await POST(request(payloadVersionNueva(), "firma-trucha"));

    expect(response.status).toBe(401);
    expect(rows("contacts")).toHaveLength(0);
    expect(rows("contact_custom_values")).toHaveLength(0);
  });

  it("la firma se calcula sobre el cuerpo crudo, no sobre el JSON reserializado", async () => {
    // Mismo objeto, otro orden de claves y con espacios: la firma de
    // esta serialización no puede validar la otra.
    const payload = payloadVersionNueva();
    const otraSerializacion = JSON.stringify(payload, null, 2);

    const response = await POST(request(payload, sign(otraSerializacion)));
    expect(response.status).toBe(401);
  });
});

describe("POST /api/integrations/tally — versión nueva del formulario", () => {
  it("crea el contacto con sus respuestas y la etiqueta de origen", async () => {
    const response = await POST(request(payloadVersionNueva()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome).toBe("created");

    const contact = rows("contacts")[0];
    expect(contact.account_id).toBe(ACCOUNT);
    expect(contact.user_id).toBe(OWNER);
    // Guardado en la forma canónica de WhatsApp, no como vino.
    expect(contact.phone).toBe(WA_ID_ENTRANTE);
    expect(contact.name).toBe("Ana Gómez");
    expect(contact.email).toBe("ana@ejemplo.com");

    expect(customValuesOf(contact.id as string)).toEqual({
      tienda_online: "Sí",
      volumen_restock: "Entre $500.000 y $2.000.000",
      provincia: "CABA",
      tipo_negocio: "Local a la calle",
      utm_source: "facebook",
      utm_medium: "paid",
      utm_campaign: "restock-septiembre",
      utm_content: "video-a",
      tally_response_id: "resp-nuevo-1",
      tally_submitted_at: "2026-09-01T12:00:00.000Z",
    });

    // Etiqueta creada y aplicada por el camino compartido, que además
    // dispara las automatizaciones de tag_added.
    const tag = rows("tags")[0];
    expect(tag.name).toBe("origen_form");
    expect(tag.account_id).toBe(ACCOUNT);
    expect(rows("contact_tags")).toHaveLength(1);
    expect(rows("contact_tags")[0]).toMatchObject({
      contact_id: contact.id,
      tag_id: tag.id,
    });
    expect(h.runAutomationsForTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: "tag_added", accountId: ACCOUNT }),
    );
  });
});

describe("POST /api/integrations/tally — versión vieja del formulario", () => {
  it("mapea los labels de julio y usa 'Nombre de tu tienda' como empresa", async () => {
    const response = await POST(request(payloadVersionVieja()));
    expect(response.status).toBe(200);

    const contact = rows("contacts")[0];
    expect(contact.name).toBe("Carlos Ruiz");
    expect(contact.company).toBe("Distribuidora Ruiz");
    expect(contact.phone).toBe("5493515551234");

    const values = customValuesOf(contact.id as string);
    expect(values.descripcion_local).toBe(
      "Local a la calle en el centro, vendemos indumentaria.",
    );
    expect(values.utm_source).toBe("instagram");
    expect(rows("contact_tags")).toHaveLength(1);
  });
});

describe("POST /api/integrations/tally — idempotencia", () => {
  it("el mismo responseId dos veces no duplica ni cambia nada", async () => {
    await POST(request(payloadVersionNueva()));
    const despuesDelPrimero = JSON.stringify(store);

    const response = await POST(request(payloadVersionNueva()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome).toBe("duplicate");
    expect(rows("contacts")).toHaveLength(1);
    expect(rows("contact_tags")).toHaveLength(1);
    expect(JSON.stringify(store)).toBe(despuesDelPrimero);
    // El reintento de Tally no vuelve a disparar las automatizaciones.
    expect(h.runAutomationsForTrigger).toHaveBeenCalledTimes(1);
  });

  it("un envío NUEVO del mismo teléfono actualiza el contacto, no lo duplica", async () => {
    await POST(request(payloadVersionNueva("resp-1")));

    const segundo = payloadVersionNueva("resp-2");
    segundo.data!.fields = segundo.data!.fields!.map((f) =>
      f.label === "¿En qué provincia estás?"
        ? { ...f, value: "opt-bsas", options: [{ id: "opt-bsas", text: "Buenos Aires" }] }
        : f,
    );

    const response = await POST(request(segundo));
    const body = await response.json();

    expect(body.outcome).toBe("updated");
    expect(rows("contacts")).toHaveLength(1);
    // La respuesta corregida pisa la anterior (unique contacto+campo).
    const values = customValuesOf(rows("contacts")[0].id as string);
    expect(values.provincia).toBe("Buenos Aires");
    expect(values.tally_response_id).toBe("resp-2");
    // Y no se crea un segundo campo personalizado con el mismo nombre.
    expect(rows("custom_fields").filter((f) => f.field_name === "provincia")).toHaveLength(1);
  });
});

describe("POST /api/integrations/tally — envíos que no se pueden usar", () => {
  it("sin teléfono → 422 y no se crea ningún contacto", async () => {
    const payload = payloadVersionNueva();
    payload.data!.fields = payload.data!.fields!.filter((f) => f.label !== "WhatsApp");

    const response = await POST(request(payload));

    expect(response.status).toBe(422);
    expect(rows("contacts")).toHaveLength(0);
    expect(rows("custom_fields")).toHaveLength(0);
    expect(rows("contact_tags")).toHaveLength(0);
  });

  it("un eventType que no es FORM_RESPONSE se contesta 200 y se ignora", async () => {
    const response = await POST(
      request({ eventType: "FORM_CREATED", data: { responseId: "x" } }),
    );

    expect(response.status).toBe(200);
    expect(rows("contacts")).toHaveLength(0);
  });
});

describe("el lead del formulario y su mensaje entrante son un solo contacto", () => {
  it("el contacto cargado con +5411… lo encuentra el wa_id 549… del webhook", async () => {
    await POST(request(payloadVersionNueva()));
    const creado = rows("contacts")[0];

    // Lo que hace el webhook de Meta cuando el lead finalmente escribe:
    // normaliza el wa_id y busca contacto con el helper compartido.
    const desdeElWebhook = await findExistingContact(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeDb() as any,
      ACCOUNT,
      normalizeArgentinePhone(WA_ID_ENTRANTE),
    );

    expect(desdeElWebhook).not.toBeNull();
    expect(desdeElWebhook!.id).toBe(creado.id);
  });
});
