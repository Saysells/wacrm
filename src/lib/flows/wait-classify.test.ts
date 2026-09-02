import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Los dos nodos nuevos, contra un Supabase falso.
//
// La lógica de clasificación tiene sus propias pruebas puras en
// classify.test.ts; acá se verifica lo que solo se ve corriendo el
// motor: que `wait` encole en vez de dormir el proceso, que
// `classify_reply` salga por la rama que le toca, y que la nota del
// traspaso llegue con las variables reemplazadas.
// ============================================================

const h = vi.hoisted(() => ({
  state: {
    activeRuns: [] as unknown[],
    flows: [] as unknown[],
    nodes: [] as unknown[],
    inserted: [] as { table: string; row: Record<string, unknown> }[],
    updated: [] as { table: string; row: Record<string, unknown> }[],
    insertedRun: null as Record<string, unknown> | null,
    contacts: [] as unknown[],
    customFields: [] as unknown[],
    customValues: [] as unknown[],
  },
}));

vi.mock("./admin-client", () => {
  function rows(table: string): unknown[] {
    if (table === "flow_runs") return h.state.activeRuns;
    if (table === "flows") return h.state.flows;
    if (table === "flow_nodes") return h.state.nodes;
    if (table === "contacts") return h.state.contacts;
    if (table === "custom_fields") return h.state.customFields;
    if (table === "contact_custom_values") return h.state.customValues;
    return [];
  }

  function builder(table: string) {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      is: () => b,
      in: () => b,
      filter: () => b,
      order: () => b,
      limit: () => b,
      lte: () => b,
      update: (row: Record<string, unknown>) => {
        h.state.updated.push({ table, row });
        return b;
      },
      insert: (row: Record<string, unknown>) => {
        h.state.inserted.push({ table, row });
        if (table === "flow_runs") {
          h.state.insertedRun = {
            id: "run-1",
            vars: {},
            reprompt_count: 0,
            ...row,
          };
        }
        return b;
      },
      maybeSingle: async () => ({
        data:
          table === "flow_runs"
            ? (h.state.insertedRun ?? rows(table)[0] ?? null)
            : (rows(table)[0] ?? null),
        error: null,
      }),
      single: async () => ({ data: rows(table)[0] ?? null, error: null }),
      then: (
        resolve: (r: { data: unknown[]; error: null; count: number }) => unknown,
      ) => resolve({ data: rows(table), error: null, count: 0 }),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => builder(t),
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

const engineSendText = vi.fn(async () => ({ whatsapp_message_id: "wamid.1" }));

vi.mock("./meta-send", () => ({
  engineSendText: (...a: unknown[]) =>
    (engineSendText as unknown as (...x: unknown[]) => unknown)(...a),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "wamid.2" })),
  engineSendInteractiveButtons: vi.fn(async () => ({
    whatsapp_message_id: "wamid.3",
  })),
  engineSendInteractiveList: vi.fn(async () => ({
    whatsapp_message_id: "wamid.4",
  })),
}));

import {
  dispatchInboundToFlows,
  entryTriggerTexts,
  resumeFlowRun,
} from "./engine";
import type { ParsedInbound } from "./types";

const FLOW = {
  id: "flow-1",
  account_id: "acct-1",
  user_id: "u-1",
  status: "active",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "inicio",
  fallback_policy: {
    on_unknown_reply: "reprompt",
    max_reprompts: 1,
    on_timeout_hours: 24,
    on_exhaust: "handoff",
  },
  created_at: "2026-01-01T00:00:00Z",
};

function node(
  node_key: string,
  node_type: string,
  config: Record<string, unknown>,
) {
  return { id: node_key, flow_id: "flow-1", node_key, node_type, config };
}

const NODES = [
  node("inicio", "start", { next_node_key: "espera" }),
  node("espera", "wait", { seconds: 25, next_node_key: "paso1" }),
  node("paso1", "classify_reply", {
    prompt_text: "Hola, ¿estoy en lo correcto?",
    negative: ["no", "no fui yo", "equivocado"],
    positive: ["si", "sisi", "asi es", "dale"],
    extra: { keywords: ["catalogo", "lista"], next_node_key: "lista" },
    negative_next: "traspaso_no",
    positive_next: "fin_ok",
    unknown_next: "repregunta",
    var_key: "respuesta_paso1",
  }),
  node("repregunta", "classify_reply", {
    prompt_text: "Perdón, ¿sí o no?",
    negative: ["no"],
    positive: ["si"],
    negative_next: "traspaso_no",
    positive_next: "fin_ok",
    unknown_next: "traspaso_no",
  }),
  node("lista", "end", {}),
  node("fin_ok", "end", {}),
  node("traspaso_no", "handoff", {
    note: "Dijo: {{vars.respuesta_paso1}}",
    assign_to: "agente-1",
  }),
];

/** Corrida estacionada en `node_key`, lista para recibir una respuesta. */
function parkedRun(node_key: string, vars: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    flow_id: "flow-1",
    account_id: "acct-1",
    user_id: "u-1",
    contact_id: "ct-1",
    conversation_id: "cv-1",
    status: "active",
    current_node_key: node_key,
    vars,
    reprompt_count: 0,
    last_advanced_at: "2026-01-01T00:00:00Z",
  };
}

function dispatch(message: ParsedInbound, isFirst = false) {
  return dispatchInboundToFlows({
    accountId: "acct-1",
    userId: "u-1",
    contactId: "ct-1",
    conversationId: "cv-1",
    message,
    isFirstInboundMessage: isFirst,
  });
}

function text(t: string): ParsedInbound {
  return { kind: "text", text: t, meta_message_id: "m1" };
}

function insertedInto(table: string) {
  return h.state.inserted.filter((i) => i.table === table).map((i) => i.row);
}

function updatesTo(table: string) {
  return h.state.updated.filter((u) => u.table === table).map((u) => u.row);
}

/** Los node_key que el motor fue marcando como nodo actual. */
function pointerMoves() {
  return updatesTo("flow_runs")
    .filter((r) => typeof r.current_node_key === "string")
    .map((r) => r.current_node_key);
}

beforeEach(() => {
  h.state.activeRuns = [];
  h.state.flows = [];
  h.state.nodes = NODES;
  h.state.inserted = [];
  h.state.updated = [];
  h.state.insertedRun = null;
  h.state.contacts = [];
  h.state.customFields = [];
  h.state.customValues = [];
  engineSendText.mockClear();
});

describe("nodo wait", () => {
  it("encola la reanudación y no manda nada todavía", async () => {
    h.state.flows = [FLOW];

    await dispatch(text("Hola! Quiero ver el catálogo"), true);

    const queued = insertedInto("flow_pending_resumes");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      flow_run_id: "run-1",
      account_id: "acct-1",
      node_key: "espera",
      resume_node_key: "paso1",
    });
    // El mensaje del paso 1 sale recién cuando venza la espera.
    expect(engineSendText).not.toHaveBeenCalled();
  });

  it("programa la reanudación para dentro de los segundos configurados", async () => {
    h.state.flows = [FLOW];
    const antes = Date.now();

    await dispatch(text("Hola"), true);

    const runAt = new Date(
      insertedInto("flow_pending_resumes")[0].run_at as string,
    ).getTime();
    expect(runAt - antes).toBeGreaterThanOrEqual(25_000);
    expect(runAt - antes).toBeLessThan(30_000);
  });

  it("deja la corrida parada en el wait, no en el nodo siguiente", async () => {
    h.state.flows = [FLOW];
    await dispatch(text("Hola"), true);
    expect(pointerMoves()).toEqual(["espera"]);
  });

  it("un mensaje que llega durante la espera no dispara repregunta", async () => {
    h.state.activeRuns = [parkedRun("espera")];

    const result = await dispatch(text("hola? están?"));

    // Consumido (la conversación es del flujo) pero sin fallback: no
    // hubo pregunta que repreguntar.
    expect(result.consumed).toBe(true);
    expect(engineSendText).not.toHaveBeenCalled();
    expect(
      updatesTo("flow_runs").some((r) => "reprompt_count" in r),
    ).toBe(false);
  });
});

describe("resumeFlowRun", () => {
  it("sigue desde el nodo indicado cuando la corrida sigue en el wait", async () => {
    h.state.activeRuns = [parkedRun("espera")];
    h.state.insertedRun = parkedRun("espera");

    const result = await resumeFlowRun({
      runId: "run-1",
      waitNodeKey: "espera",
      resumeNodeKey: "paso1",
    });

    expect(result.resumed).toBe(true);
    // Ahora sí sale el mensaje del paso 1.
    expect(engineSendText).toHaveBeenCalledTimes(1);
  });

  it("no reanuda si la corrida ya se movió de ese wait", async () => {
    h.state.insertedRun = parkedRun("paso1");

    const result = await resumeFlowRun({
      runId: "run-1",
      waitNodeKey: "espera",
      resumeNodeKey: "paso1",
    });

    expect(result).toEqual({ resumed: false, reason: "already_moved" });
    expect(engineSendText).not.toHaveBeenCalled();
  });

  it("no reanuda una corrida que ya terminó", async () => {
    h.state.insertedRun = { ...parkedRun("espera"), status: "handed_off" };

    const result = await resumeFlowRun({
      runId: "run-1",
      waitNodeKey: "espera",
      resumeNodeKey: "paso1",
    });

    expect(result).toEqual({ resumed: false, reason: "run_not_active" });
    expect(engineSendText).not.toHaveBeenCalled();
  });
});

describe("nodo classify_reply", () => {
  beforeEach(() => {
    h.state.activeRuns = [parkedRun("paso1")];
    h.state.flows = [FLOW];
  });

  it("un sí sale por la rama positiva", async () => {
    await dispatch(text("Así es"));
    expect(pointerMoves()).toEqual([]); // fin_ok es terminal
    expect(
      updatesTo("flow_runs").some((r) => r.end_reason === "end_node"),
    ).toBe(true);
  });

  it("un no sale por la rama negativa y traspasa", async () => {
    const result = await dispatch(text("No fui yo, equivocado"));
    expect(result.outcome).toBe("handed_off");
  });

  it("la rama extra le gana al negativo", async () => {
    // "Nono … no puedo … mejor por catálogo" trae las dos cosas.
    await dispatch(
      text("Nono nunca compré, llamada no puedo, mejor por catálogo"),
    );
    const events = insertedInto("flow_run_events");
    const clasificado = events.find(
      (e) =>
        (e.payload as Record<string, unknown> | undefined)?.classified_as !==
        undefined,
    );
    expect((clasificado?.payload as Record<string, unknown>).classified_as).toBe(
      "extra",
    );
  });

  it("lo que no entiende va a la repregunta, no al fallback", async () => {
    await dispatch(text("cuánto sale el envío a Salta"));
    // La repregunta es otro classify_reply con prompt: se envía.
    expect(engineSendText).toHaveBeenCalledTimes(1);
    expect(pointerMoves()).toEqual(["repregunta"]);
  });

  it("guarda el texto CRUDO del cliente en vars", async () => {
    await dispatch(text("Así es!! 😀"));
    const varsUpdate = updatesTo("flow_runs").find((r) => "vars" in r);
    expect(varsUpdate?.vars).toEqual({ respuesta_paso1: "Así es!! 😀" });
  });

  it("clasifica también el rótulo de un botón", async () => {
    const result = await dispatch({
      kind: "interactive_reply",
      reply_id: "btn_1",
      reply_title: "Sí, dale",
      meta_message_id: "m1",
    });
    expect(result.outcome).toBe("completed");
  });
});

describe("interpolación", () => {
  it("la nota del handoff reemplaza las variables", async () => {
    h.state.activeRuns = [parkedRun("paso1")];
    h.state.flows = [FLOW];

    await dispatch(text("no fui yo"));

    const handoff = insertedInto("flow_run_events").find(
      (e) => e.event_type === "handoff",
    );
    expect((handoff?.payload as Record<string, unknown>).note).toBe(
      "Dijo: no fui yo",
    );
  });
});

// ============================================================
// Variables del contacto en un mensaje real del motor.
// ============================================================

const SALUDO_NODES = [
  node("inicio", "start", { next_node_key: "saludo" }),
  node("saludo", "send_message", {
    text:
      "Hola{{contact.nombre_coma}} te escribe Kosmo por tema venta " +
      "mayorista para {{contact.tipo_negocio}}.",
    next_node_key: "fin",
  }),
  node("fin", "end", {}),
];

function sentText(): string {
  const call = engineSendText.mock.calls[0] as unknown as [
    { text: string },
  ];
  return call[0].text;
}

describe("variables del contacto en el motor", () => {
  beforeEach(() => {
    h.state.flows = [{ ...FLOW, entry_node_id: "inicio" }];
    h.state.nodes = SALUDO_NODES;
  });

  it("usa el nombre y el rubro que dejó el formulario", async () => {
    h.state.contacts = [{ name: "Juan Pérez" }];
    h.state.customFields = [{ id: "cf-1", field_name: "tipo_negocio" }];
    h.state.customValues = [
      { custom_field_id: "cf-1", value: "Local de celular" },
    ];

    await dispatch(text("Hola"), true);

    expect(sentText()).toBe(
      "Hola Juan, te escribe Kosmo por tema venta mayorista para " +
        "local de celular.",
    );
  });

  it("sin nombre ni rubro el mensaje sigue leyéndose bien", async () => {
    // Contacto creado por el webhook: se llama como su teléfono y no
    // pasó por el formulario.
    h.state.contacts = [{ name: "5491122334455" }];

    await dispatch(text("Hola"), true);

    expect(sentText()).toBe(
      "Hola, te escribe Kosmo por tema venta mayorista para tu negocio.",
    );
  });
});

// ============================================================
// Archivos en medio del guion.
// ============================================================

describe("mensaje con archivo durante una corrida", () => {
  beforeEach(() => {
    h.state.activeRuns = [parkedRun("paso1")];
    h.state.flows = [FLOW];
  });

  it("traspasa con la nota 'Mandó un archivo'", async () => {
    const result = await dispatch({
      kind: "media",
      media_kind: "image",
      meta_message_id: "m1",
    });

    expect(result.outcome).toBe("handed_off");
    const handoff = insertedInto("flow_run_events").find(
      (e) => e.event_type === "handoff",
    );
    expect(handoff?.payload).toMatchObject({
      reason: "media_received",
      media_kind: "image",
      note: "Mandó un archivo",
    });
    expect(updatesTo("conversations")[0]).toMatchObject({ status: "pending" });
  });

  it("no repregunta ni intenta clasificar el archivo", async () => {
    await dispatch({
      kind: "media",
      media_kind: "audio",
      meta_message_id: "m1",
    });
    expect(engineSendText).not.toHaveBeenCalled();
  });

  it("un archivo no dispara un flujo por palabra clave", () => {
    expect(
      entryTriggerTexts({
        kind: "media",
        media_kind: "document",
        meta_message_id: "m1",
      }),
    ).toEqual([]);
  });
});
