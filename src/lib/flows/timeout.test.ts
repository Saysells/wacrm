import { describe, expect, it } from "vitest";

import { resolveTimeout, selectExpiredRuns } from "./timeout";
import { DEFAULT_FALLBACK_POLICY, type FlowFallbackPolicy } from "./types";

const POLICY: FlowFallbackPolicy = {
  ...DEFAULT_FALLBACK_POLICY,
  on_timeout_hours: 24,
  on_timeout: { action: "tag_and_end", tag_id: "tag-no-responde" },
};

const AHORA = new Date("2026-09-02T12:00:00Z");

/** Una fecha `horas` antes de AHORA. */
function haceHoras(horas: number): string {
  return new Date(AHORA.getTime() - horas * 3600_000).toISOString();
}

describe("resolveTimeout", () => {
  it("sin sobreescritura rige la política", () => {
    expect(resolveTimeout(POLICY, null)).toEqual({
      hours: 24,
      action: "tag_and_end",
      tag_id: "tag-no-responde",
      source: "policy",
    });
  });

  it("el nodo puede cambiar la acción entera", () => {
    // El paso 4 del bot: quien ya dijo que sí y no mandó el horario no
    // es "No responde", es un traspaso.
    expect(
      resolveTimeout(POLICY, {
        timeout: {
          hours: 24,
          action: "handoff",
          note: "Quiere la llamada, no pasó horario",
        },
      }),
    ).toEqual({
      hours: 24,
      action: "handoff",
      tag_id: "tag-no-responde",
      note: "Quiere la llamada, no pasó horario",
      source: "node",
    });
  });

  it("el nodo puede cambiar solo las horas y heredar la acción", () => {
    expect(resolveTimeout(POLICY, { timeout: { hours: 2 } })).toMatchObject({
      hours: 2,
      action: "tag_and_end",
      tag_id: "tag-no-responde",
    });
  });

  it("horas inválidas caen a las de la política", () => {
    expect(resolveTimeout(POLICY, { timeout: { hours: 0 } }).hours).toBe(24);
    expect(resolveTimeout(POLICY, { timeout: { hours: -3 } }).hours).toBe(24);
  });

  it("un timeout que no es un objeto se ignora", () => {
    expect(resolveTimeout(POLICY, { timeout: "24h" as never }).source).toBe(
      "policy",
    );
  });
});

describe("selectExpiredRuns", () => {
  const base = { policy: POLICY };

  it("no barre una corrida que se movió hace menos del cutoff", () => {
    expect(
      selectExpiredRuns(
        [{ id: "r1", last_advanced_at: haceHoras(23.9), ...base }],
        AHORA,
      ),
    ).toEqual([]);
  });

  it("barre la que pasó el cutoff, con la acción resuelta", () => {
    const out = selectExpiredRuns(
      [{ id: "r1", last_advanced_at: haceHoras(25), ...base }],
      AHORA,
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("r1");
    expect(out[0].age_hours).toBe(25);
    expect(out[0].timeout.action).toBe("tag_and_end");
    expect(out[0].timeout.tag_id).toBe("tag-no-responde");
  });

  it("mide desde el último avance, no desde el arranque", () => {
    // La corrida puede llevar días abierta; lo que vence es el silencio.
    expect(
      selectExpiredRuns(
        [{ id: "r1", last_advanced_at: haceHoras(1), ...base }],
        AHORA,
      ),
    ).toEqual([]);
  });

  it("respeta la sobreescritura del nodo para decidir si venció", () => {
    const rows = [
      {
        id: "corto",
        last_advanced_at: haceHoras(3),
        policy: POLICY,
        nodeConfig: { timeout: { hours: 2 } },
      },
      {
        id: "largo",
        last_advanced_at: haceHoras(3),
        policy: POLICY,
        nodeConfig: null,
      },
    ];
    expect(selectExpiredRuns(rows, AHORA).map((d) => d.id)).toEqual(["corto"]);
  });

  it("una corrida vencida en un nodo de traspaso sale con esa acción", () => {
    const out = selectExpiredRuns(
      [
        {
          id: "paso4",
          last_advanced_at: haceHoras(30),
          policy: POLICY,
          nodeConfig: {
            timeout: { action: "handoff", note: "no pasó horario" },
          },
        },
      ],
      AHORA,
    );
    expect(out[0].timeout).toMatchObject({
      action: "handoff",
      note: "no pasó horario",
      source: "node",
    });
  });

  it("una fecha ilegible no se barre", () => {
    // Cerrar corridas vivas por un dato roto es peor que dejar una
    // zombi para la pasada siguiente.
    expect(
      selectExpiredRuns([{ id: "r1", last_advanced_at: "nunca", ...base }], AHORA),
    ).toEqual([]);
  });

  it("devuelve varias de una pasada", () => {
    const out = selectExpiredRuns(
      [
        { id: "a", last_advanced_at: haceHoras(48), ...base },
        { id: "b", last_advanced_at: haceHoras(2), ...base },
        { id: "c", last_advanced_at: haceHoras(24), ...base },
      ],
      AHORA,
    );
    expect(out.map((d) => d.id)).toEqual(["a", "c"]);
  });
});

describe("resolveTimeout — la acción goto", () => {
  const politica = {
    on_unknown_reply: "reprompt" as const,
    max_reprompts: 1,
    on_timeout_hours: 24,
    on_timeout: { action: "tag_and_end" as const, tag_id: "tag-no-responde" },
    on_exhaust: "handoff" as const,
  };

  it("el nodo puede convertir su timeout en un salto", () => {
    expect(
      resolveTimeout(politica, {
        timeout: { hours: 24, action: "goto", next_node_key: "seguimiento" },
      }),
    ).toMatchObject({
      hours: 24,
      action: "goto",
      next_node_key: "seguimiento",
      source: "node",
    });
  });

  it("un goto sin destino se cae a la acción de la política", () => {
    expect(
      resolveTimeout(politica, { timeout: { hours: 2, action: "goto" } }),
    ).toMatchObject({ hours: 2, action: "tag_and_end", tag_id: "tag-no-responde" });
  });

  it("el nodo que solo acorta las horas hereda el destino de la política", () => {
    const conGoto = {
      ...politica,
      on_timeout: { action: "goto" as const, next_node_key: "seguimiento" },
    };
    expect(
      resolveTimeout(conGoto, { timeout: { hours: 3 } }),
    ).toMatchObject({ hours: 3, action: "goto", next_node_key: "seguimiento" });
  });
});
