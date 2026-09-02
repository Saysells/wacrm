import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// La acción del timeout, aplicada de verdad.
//
// `timeout.test.ts` cubre qué corridas vencieron y con qué acción;
// acá se verifica lo que efectivamente se escribe: el estado final de
// la corrida, la etiqueta al contacto y la conversación pendiente.
// ============================================================

const h = vi.hoisted(() => ({
  state: {
    run: null as Record<string, unknown> | null,
    /** Nodos del flujo, para el avance del `goto`. */
    nodes: [] as unknown[],
    /** Filas que la UPDATE con precondición devuelve. Vacío = perdí la carrera. */
    claimReturns: [{ id: "run-1" }] as unknown[],
    inserted: [] as { table: string; row: Record<string, unknown> }[],
    updated: [] as { table: string; row: Record<string, unknown> }[],
    taggedWith: [] as string[],
  },
}));

vi.mock("./admin-client", () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      is: () => b,
      in: () => b,
      filter: () => b,
      order: () => b,
      limit: () => b,
      update: (row: Record<string, unknown>) => {
        h.state.updated.push({ table, row });
        return b;
      },
      insert: (row: Record<string, unknown>) => {
        h.state.inserted.push({ table, row });
        return b;
      },
      maybeSingle: async () => ({
        data: table === "flow_runs" ? h.state.run : null,
        error: null,
      }),
      then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
        resolve({
          // La UPDATE de claim sobre flow_runs es la única que mira el
          // resultado; para el resto da igual, salvo los nodos que el
          // `goto` necesita para seguir.
          data:
            table === "flow_runs"
              ? h.state.claimReturns
              : table === "flow_nodes"
                ? h.state.nodes
                : [],
          error: null,
        }),
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

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "wamid.1" })),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "wamid.2" })),
  engineSendInteractiveButtons: vi.fn(async () => ({
    whatsapp_message_id: "wamid.3",
  })),
  engineSendInteractiveList: vi.fn(async () => ({
    whatsapp_message_id: "wamid.4",
  })),
}));

vi.mock("@/lib/contacts/tag-events", () => ({
  addContactTagAndDispatch: vi.fn(async (input: { tagId: string }) => {
    h.state.taggedWith.push(input.tagId);
    return { added: true, dispatched: true };
  }),
}));

vi.mock("@/lib/contacts/tag-write", () => ({
  removeContactTag: vi.fn(async () => {}),
}));

import { applyFlowTimeout } from "./engine";
import type { ResolvedTimeout } from "./timeout";

function activeRun(extra: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    flow_id: "flow-1",
    account_id: "acct-1",
    user_id: "u-1",
    contact_id: "ct-1",
    conversation_id: "cv-1",
    status: "active",
    current_node_key: "paso4",
    vars: { rango_horario: "de 10 a 12" },
    reprompt_count: 0,
    last_advanced_at: "2026-09-01T00:00:00Z",
    ...extra,
  };
}

const TAG_AND_END: ResolvedTimeout = {
  hours: 24,
  action: "tag_and_end",
  tag_id: "tag-no-responde",
  source: "policy",
};

const HANDOFF: ResolvedTimeout = {
  hours: 24,
  action: "handoff",
  note: "Quiere la llamada. Rango: {{vars.rango_horario}}",
  source: "node",
};

/** Nodos del seguimiento: el `goto` cae en `seguimiento`, que pregunta. */
const NODOS = [
  {
    id: "seguimiento",
    flow_id: "flow-1",
    node_key: "seguimiento",
    node_type: "classify_reply",
    config: {
      prompt_text: "¿Pudiste ver el catálogo?",
      negative: ["no"],
      positive: ["si"],
      negative_next: "traspaso_no_quiere",
      positive_next: "paso4",
      unknown_next: "traspaso_no_quiere",
    },
  },
  {
    id: "paso4",
    flow_id: "flow-1",
    node_key: "paso4",
    node_type: "end",
    config: {},
  },
  {
    id: "traspaso_no_quiere",
    flow_id: "flow-1",
    node_key: "traspaso_no_quiere",
    node_type: "end",
    config: {},
  },
];

const GOTO: ResolvedTimeout = {
  hours: 24,
  action: "goto",
  next_node_key: "seguimiento",
  source: "node",
};

function updatesTo(table: string) {
  return h.state.updated.filter((u) => u.table === table).map((u) => u.row);
}

function events() {
  return h.state.inserted
    .filter((i) => i.table === "flow_run_events")
    .map((i) => i.row);
}

beforeEach(() => {
  h.state.run = activeRun();
  h.state.nodes = NODOS;
  h.state.claimReturns = [{ id: "run-1" }];
  h.state.inserted = [];
  h.state.updated = [];
  h.state.taggedWith = [];
});

describe("applyFlowTimeout — tag_and_end", () => {
  it("cierra la corrida y le pone la etiqueta al contacto", async () => {
    const result = await applyFlowTimeout({
      runId: "run-1",
      timeout: TAG_AND_END,
      ageHours: 25,
    });

    expect(result).toEqual({ applied: true, action: "tag_and_end" });
    expect(updatesTo("flow_runs")[0]).toMatchObject({
      status: "timed_out",
      end_reason: "timeout_tag_and_end",
    });
    expect(h.state.taggedWith).toEqual(["tag-no-responde"]);
    // No es un traspaso: la conversación no se toca.
    expect(updatesTo("conversations")).toEqual([]);
  });

  it("sin etiqueta configurada solo cierra la corrida", async () => {
    const result = await applyFlowTimeout({
      runId: "run-1",
      timeout: { ...TAG_AND_END, tag_id: undefined },
      ageHours: 25,
    });

    expect(result.applied).toBe(true);
    expect(h.state.taggedWith).toEqual([]);
  });

  it("deja el evento de timeout con la edad y el origen", async () => {
    await applyFlowTimeout({
      runId: "run-1",
      timeout: TAG_AND_END,
      ageHours: 25.4,
    });

    const timeout = events().find((e) => e.event_type === "timeout");
    expect(timeout?.payload).toMatchObject({
      action: "tag_and_end",
      source: "policy",
      age_hours: 25.4,
      tag_id: "tag-no-responde",
    });
  });
});

describe("applyFlowTimeout — handoff", () => {
  it("deja la conversación pendiente y la corrida traspasada", async () => {
    const result = await applyFlowTimeout({
      runId: "run-1",
      timeout: HANDOFF,
      ageHours: 25,
    });

    expect(result).toEqual({ applied: true, action: "handoff" });
    expect(updatesTo("flow_runs")[0]).toMatchObject({
      status: "handed_off",
      end_reason: "timeout_handoff",
    });
    expect(updatesTo("conversations")[0]).toMatchObject({ status: "pending" });
    expect(h.state.taggedWith).toEqual([]);
  });

  it("la nota del traspaso llega con las variables reemplazadas", async () => {
    await applyFlowTimeout({ runId: "run-1", timeout: HANDOFF, ageHours: 25 });

    const handoff = events().find((e) => e.event_type === "handoff");
    expect((handoff?.payload as Record<string, unknown>).note).toBe(
      "Quiere la llamada. Rango: de 10 a 12",
    );
  });
});

describe("applyFlowTimeout — corridas que ya no aplican", () => {
  it("no toca una corrida que ya terminó", async () => {
    h.state.run = activeRun({ status: "handed_off" });

    const result = await applyFlowTimeout({
      runId: "run-1",
      timeout: TAG_AND_END,
      ageHours: 99,
    });

    expect(result).toEqual({ applied: false, reason: "run_not_active" });
    expect(updatesTo("flow_runs")).toEqual([]);
    expect(h.state.taggedWith).toEqual([]);
  });

  it("no etiqueta si otra pasada del cron le ganó la corrida", async () => {
    // La UPDATE con precondición status='active' no afecta filas.
    h.state.claimReturns = [];

    const result = await applyFlowTimeout({
      runId: "run-1",
      timeout: TAG_AND_END,
      ageHours: 25,
    });

    expect(result).toEqual({ applied: false, reason: "lost_race" });
    expect(h.state.taggedWith).toEqual([]);
    expect(events()).toEqual([]);
  });

  it("una corrida que no existe no rompe el barrido", async () => {
    h.state.run = null;

    expect(
      await applyFlowTimeout({
        runId: "run-1",
        timeout: TAG_AND_END,
        ageHours: 25,
      }),
    ).toEqual({ applied: false, reason: "run_not_found" });
  });
});

describe("applyFlowTimeout — goto", () => {
  it("mueve el puntero al nodo indicado y no cierra la corrida", async () => {
    const result = await applyFlowTimeout({
      runId: "run-1",
      timeout: GOTO,
      ageHours: 24.2,
    });

    expect(result).toEqual({ applied: true, action: "goto" });
    const runs = updatesTo("flow_runs");
    expect(runs[0]).toMatchObject({ current_node_key: "seguimiento" });
    // Ninguna escritura la termina.
    expect(runs.filter((r) => "ended_at" in r)).toEqual([]);
    expect(h.state.taggedWith).toEqual([]);
    // No es un traspaso: la conversación no se toca.
    expect(updatesTo("conversations")).toEqual([]);
  });

  it("deja el evento de timeout con el destino", async () => {
    await applyFlowTimeout({ runId: "run-1", timeout: GOTO, ageHours: 24.2 });

    const timeout = events().find((e) => e.event_type === "timeout");
    expect(timeout?.payload).toMatchObject({
      action: "goto",
      source: "node",
      age_hours: 24.2,
      next_node_key: "seguimiento",
    });
  });

  it("no avanza dos veces si otra pasada del cron le ganó la corrida", async () => {
    h.state.claimReturns = [];

    const result = await applyFlowTimeout({
      runId: "run-1",
      timeout: GOTO,
      ageHours: 24.2,
    });

    expect(result).toEqual({ applied: false, reason: "lost_race" });
    expect(events()).toEqual([]);
  });

  it("no sale el seguimiento si el agente contestó dentro de las 24 h", async () => {
    // send-message.ts deja en `paused_by_agent` toda corrida activa
    // del contacto cuando un agente manda un mensaje. Que Matías
    // conteste es, entonces, lo que apaga el seguimiento — y es lo
    // buscado: si ya hay conversación, el bot se corre.
    h.state.run = activeRun({
      status: "paused_by_agent",
      end_reason: "agent_replied",
    });

    const result = await applyFlowTimeout({
      runId: "run-1",
      timeout: GOTO,
      ageHours: 26,
    });

    expect(result).toEqual({ applied: false, reason: "run_not_active" });
    expect(updatesTo("flow_runs")).toEqual([]);
    expect(events()).toEqual([]);
  });
});
