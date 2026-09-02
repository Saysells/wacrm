import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// El nodo `handoff` con `next_node_key`: traspasa y sigue.
//
// Lo que hay que ver acá es que los efectos visibles del traspaso
// (asignación, conversación pendiente, evento) son los mismos con la
// clave y sin ella, y que lo único que cambia es si la corrida muere.
// El traspaso que sigue existe para el seguimiento del catálogo: la
// conversación ya es de Matías, pero si nadie dice nada el bot
// todavía tiene algo que preguntar.
// ============================================================

const h = vi.hoisted(() => ({
  state: {
    activeRuns: [] as unknown[],
    nodes: [] as unknown[],
    inserted: [] as { table: string; row: Record<string, unknown> }[],
    updated: [] as { table: string; row: Record<string, unknown> }[],
  },
}));

vi.mock("./admin-client", () => {
  function rows(table: string): unknown[] {
    if (table === "flow_runs") return h.state.activeRuns;
    if (table === "flow_nodes") return h.state.nodes;
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
        return b;
      },
      maybeSingle: async () => ({ data: rows(table)[0] ?? null, error: null }),
      single: async () => ({ data: rows(table)[0] ?? null, error: null }),
      then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: rows(table), error: null }),
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

import { resumeFlowRun } from "./engine";

function node(
  node_key: string,
  node_type: string,
  config: Record<string, unknown>,
) {
  return { id: node_key, flow_id: "flow-1", node_key, node_type, config };
}

const NODES = [
  node("espera", "wait", { seconds: 1, next_node_key: "traspaso_lista" }),
  // El traspaso que sigue el guion.
  node("traspaso_lista", "handoff", {
    note: "Pidió la lista, no quiere llamada",
    assign_to: "matias-1",
    next_node_key: "lista_cierre",
  }),
  node("lista_cierre", "classify_reply", {
    prompt_text: "Cualquier duda o consulta me avisás.",
    negative: ["no"],
    positive: ["si"],
    negative_next: "fin_lista",
    positive_next: "fin_lista",
    unknown_next: "fin_lista",
  }),
  node("fin_lista", "end", {}),
  // El traspaso de siempre, terminal.
  node("traspaso_final", "handoff", {
    note: "Vio el catálogo, no quiere llamada",
    assign_to: "matias-1",
  }),
];

function parkedRun(node_key: string) {
  return {
    id: "run-1",
    flow_id: "flow-1",
    account_id: "acct-1",
    user_id: "u-1",
    contact_id: "ct-1",
    conversation_id: "cv-1",
    status: "active",
    current_node_key: node_key,
    vars: {},
    reprompt_count: 0,
    last_advanced_at: "2026-09-02T00:00:00Z",
  };
}

function updatesTo(table: string) {
  return h.state.updated.filter((u) => u.table === table).map((u) => u.row);
}

function events() {
  return h.state.inserted
    .filter((i) => i.table === "flow_run_events")
    .map((i) => i.row);
}

/** Llega al traspaso desde el `wait` que lo precede. */
function correrHasta(destino: string) {
  h.state.activeRuns = [parkedRun("espera")];
  return resumeFlowRun({
    runId: "run-1",
    waitNodeKey: "espera",
    resumeNodeKey: destino,
  });
}

beforeEach(() => {
  h.state.activeRuns = [];
  h.state.nodes = NODES;
  h.state.inserted = [];
  h.state.updated = [];
  engineSendText.mockClear();
});

describe("handoff con next_node_key", () => {
  it("traspasa igual: asigna la conversación y la deja pendiente", async () => {
    await correrHasta("traspaso_lista");

    expect(updatesTo("conversations")[0]).toMatchObject({
      status: "pending",
      assigned_agent_id: "matias-1",
    });
  });

  it("registra el evento de traspaso con la nota", async () => {
    await correrHasta("traspaso_lista");

    const handoff = events().find((e) => e.event_type === "handoff");
    expect(handoff?.payload).toMatchObject({
      note: "Pidió la lista, no quiere llamada",
      assigned_to: "matias-1",
      next_node_key: "lista_cierre",
    });
  });

  it("deja la corrida viva y sigue al nodo indicado", async () => {
    const result = await correrHasta("traspaso_lista");

    expect(result.outcome).toBe("advanced");
    // Ninguna escritura la cierra.
    expect(
      updatesTo("flow_runs").filter((r) => "ended_at" in r),
    ).toEqual([]);
    // Y el nodo siguiente preguntó lo suyo.
    expect(engineSendText).toHaveBeenCalledTimes(1);
    expect(
      updatesTo("flow_runs").map((r) => r.current_node_key),
    ).toContain("lista_cierre");
  });
});

describe("handoff sin next_node_key", () => {
  it("sigue cerrando la corrida como siempre", async () => {
    const result = await correrHasta("traspaso_final");

    expect(result.outcome).toBe("handed_off");
    expect(updatesTo("flow_runs")[0]).toMatchObject({
      status: "handed_off",
      end_reason: "handoff_node",
    });
    expect(engineSendText).not.toHaveBeenCalled();
  });

  it("registra el evento igual, con next_node_key en null", async () => {
    await correrHasta("traspaso_final");

    const handoff = events().find((e) => e.event_type === "handoff");
    expect(handoff?.payload).toMatchObject({
      note: "Vio el catálogo, no quiere llamada",
      assigned_to: "matias-1",
      next_node_key: null,
    });
  });
});
