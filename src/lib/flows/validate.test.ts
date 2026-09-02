import { describe, it, expect } from "vitest";
import { validateFlowForActivation, reachableFromEntry } from "./validate";

const validFlow = {
  name: "Welcome",
  trigger_type: "keyword" as const,
  trigger_config: { keywords: ["support"] },
  entry_node_id: "start",
};

const validNodes = [
  { node_key: "start", node_type: "start", config: { next_node_key: "menu" } },
  {
    node_key: "menu",
    node_type: "send_buttons",
    config: {
      text: "How can we help?",
      buttons: [
        { reply_id: "a", title: "A", next_node_key: "ho" },
        { reply_id: "b", title: "B", next_node_key: "ho" },
      ],
    },
  },
  { node_key: "ho", node_type: "handoff", config: {} },
];

describe("validateFlowForActivation — happy path", () => {
  it("produces no issues on a well-formed flow", () => {
    expect(validateFlowForActivation(validFlow, validNodes)).toEqual([]);
  });
});

describe("validateFlowForActivation — flow-level", () => {
  it("flags empty name", () => {
    expect(
      validateFlowForActivation({ ...validFlow, name: "" }, validNodes),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "flow", field: "name" }),
      ]),
    );
  });

  it("flags whitespace-only name", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, name: "   " },
      validNodes,
    );
    expect(issues.some((i) => i.field === "name")).toBe(true);
  });

  it("flags missing entry_node_id", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: null },
      validNodes,
    );
    expect(issues.some((i) => i.field === "entry_node_id")).toBe(true);
  });

  it("flags entry_node_id that doesn't exist in nodes", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "ghost" },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.field === "entry_node_id" &&
          i.message.includes('"ghost"'),
      ),
    ).toBe(true);
  });

  it("flags empty node list", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: null },
      [],
    );
    expect(
      issues.some((i) => i.message.includes("at least one node")),
    ).toBe(true);
  });

  it("flags duplicate node_key", () => {
    const dupes = [
      { node_key: "a", node_type: "start", config: { next_node_key: "b" } },
      { node_key: "a", node_type: "end", config: {} },
      { node_key: "b", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "a" },
      dupes,
    );
    expect(
      issues.some(
        (i) =>
          i.message.includes("Duplicate node_key") &&
          i.node_key === "a",
      ),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — trigger", () => {
  it("flags keyword trigger with no keywords", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_config: { keywords: [] },
      },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.scope === "trigger" &&
          i.message.includes("at least one keyword"),
      ),
    ).toBe(true);
  });

  it("flags keyword trigger missing keywords field entirely", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, trigger_config: {} },
      validNodes,
    );
    expect(issues.some((i) => i.scope === "trigger")).toBe(true);
  });

  it("warns when keywords contain blanks", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_config: { keywords: ["support", "", " "] },
      },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.scope === "trigger" &&
          i.severity === "warning" &&
          i.message.includes("blank"),
      ),
    ).toBe(true);
  });

  it("first_inbound_message trigger needs no config", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_type: "first_inbound_message",
        trigger_config: {},
      },
      validNodes,
    );
    expect(issues.filter((i) => i.scope === "trigger")).toEqual([]);
  });
});

describe("validateFlowForActivation — nodes", () => {
  it("flags send_buttons without text", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          buttons: [{ reply_id: "x", title: "X", next_node_key: "h" }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.node_key === "b" && i.field === "text"),
    ).toBe(true);
  });

  it("flags send_buttons with zero buttons", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: { text: "Hi", buttons: [] },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons" &&
          i.message.includes("at least one"),
      ),
    ).toBe(true);
  });

  it("flags send_buttons with more than 3 buttons (Meta limit)", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: "1", next_node_key: "h" },
            { reply_id: "2", title: "2", next_node_key: "h" },
            { reply_id: "3", title: "3", next_node_key: "h" },
            { reply_id: "4", title: "4", next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons" &&
          i.message.includes("at most 3"),
      ),
    ).toBe(true);
  });

  it("flags button title over 20 chars", () => {
    const longTitle = "x".repeat(21);
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: longTitle, next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons.0.title" &&
          i.message.includes("over 20"),
      ),
    ).toBe(true);
  });

  it("flags button pointing at non-existent next node", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: "Go", next_node_key: "ghost" },
          ],
        },
      },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.field === "buttons.0.next_node_key" &&
          i.message.includes("ghost"),
      ),
    ).toBe(true);
  });

  it("flags duplicate button reply_ids", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "x", title: "X1", next_node_key: "h" },
            { reply_id: "x", title: "X2", next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("Duplicate button reply id")),
    ).toBe(true);
  });

  it("flags send_list with more than 10 rows total", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      reply_id: `r${i}`,
      title: `Row ${i}`,
      next_node_key: "h",
    }));
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "l" } },
      {
        node_key: "l",
        node_type: "send_list",
        config: {
          text: "Pick",
          button_label: "Pick",
          sections: [{ rows: eleven }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "l" &&
          i.field === "sections" &&
          i.message.includes("at most 10"),
      ),
    ).toBe(true);
  });

  it("flags list row title over 24 chars", () => {
    const longTitle = "x".repeat(25);
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "l" } },
      {
        node_key: "l",
        node_type: "send_list",
        config: {
          text: "Pick",
          button_label: "Pick",
          sections: [
            {
              rows: [
                {
                  reply_id: "x",
                  title: longTitle,
                  next_node_key: "h",
                },
              ],
            },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("exceeds 24 chars")),
    ).toBe(true);
  });

  it("warns about unreachable nodes", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "h" } },
      { node_key: "h", node_type: "handoff", config: {} },
      // Orphaned — nothing points at it.
      { node_key: "orphan", node_type: "end", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "orphan" &&
          i.severity === "warning" &&
          i.message.includes("unreachable"),
      ),
    ).toBe(true);
  });

  it("doesn't crash on unknown node_type — flags it", () => {
    const nodes = [
      { node_key: "s", node_type: "wibble", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("Unknown node type")),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — send_media", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (mediaConfig: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "m" } },
    { node_key: "m", node_type: "send_media", config: mediaConfig },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated send_media node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "document",
        media_url: "https://cdn.example/invoice.pdf",
        caption: "Your invoice",
        filename: "invoice.pdf",
        next_node_key: "h",
      }),
    );
    expect(issues).toEqual([]);
  });

  it("flags missing media_url", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "",
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "media_url"),
    ).toBe(true);
  });

  it("flags missing media_type", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_url: "https://cdn.example/x.png",
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "media_type"),
    ).toBe(true);
  });

  it("flags next_node_key pointing at a non-existent node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        next_node_key: "ghost",
      }),
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "m" &&
          i.field === "next_node_key" &&
          i.message.includes("ghost"),
      ),
    ).toBe(true);
  });

  it("flags caption exceeding 1024 chars", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        caption: "x".repeat(1025),
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "caption"),
    ).toBe(true);
  });

  it("contributes its next_node_key to reachability", () => {
    const set = reachableFromEntry(
      "s",
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        next_node_key: "h",
      }),
    );
    expect(set).toEqual(new Set(["s", "m", "h"]));
  });
});

describe("reachableFromEntry", () => {
  it("walks the graph from the entry", () => {
    const set = reachableFromEntry("start", validNodes);
    expect(set.has("start")).toBe(true);
    expect(set.has("menu")).toBe(true);
    expect(set.has("ho")).toBe(true);
  });

  it("returns the entry alone when no edges lead out", () => {
    const set = reachableFromEntry("only", [
      { node_key: "only", node_type: "handoff", config: {} },
    ]);
    expect(set).toEqual(new Set(["only"]));
  });

  it("survives a cycle (visited guard)", () => {
    const nodes = [
      { node_key: "a", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Loop",
          buttons: [{ reply_id: "x", title: "Back", next_node_key: "a" }],
        },
      },
    ];
    const set = reachableFromEntry("a", nodes);
    expect(set).toEqual(new Set(["a", "b"]));
  });
});

// ============================================================
// wait / classify_reply — el motor los entiende, pero si el
// validador no, el flujo no se puede activar desde el editor.
// ============================================================

const KOSMO_FLOW = {
  name: "Primer contacto",
  trigger_type: "first_inbound_message" as const,
  trigger_config: {},
  entry_node_id: "inicio",
};

function kosmoNodes(overrides: {
  wait?: Record<string, unknown>;
  classify?: Record<string, unknown>;
} = {}): Array<{
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}> {
  return [
    { node_key: "inicio", node_type: "start", config: { next_node_key: "espera" } },
    {
      node_key: "espera",
      node_type: "wait",
      config: { seconds: 25, next_node_key: "paso1", ...overrides.wait },
    },
    {
      node_key: "paso1",
      node_type: "classify_reply",
      config: {
        prompt_text: "¿Estoy en lo correcto?",
        negative: ["no"],
        positive: ["si"],
        negative_next: "traspaso",
        positive_next: "fin",
        unknown_next: "fin",
        ...overrides.classify,
      },
    },
    { node_key: "traspaso", node_type: "handoff", config: {} },
    { node_key: "fin", node_type: "end", config: {} },
  ];
}

describe("validateFlowForActivation — wait", () => {
  it("acepta un flujo con wait y classify_reply bien armados", () => {
    expect(validateFlowForActivation(KOSMO_FLOW, kosmoNodes())).toEqual([]);
  });

  it("rechaza una espera sin segundos o de cero", () => {
    const issues = validateFlowForActivation(
      KOSMO_FLOW,
      kosmoNodes({ wait: { seconds: 0 } }),
    );
    expect(issues.some((i) => i.field === "seconds")).toBe(true);
  });

  it("rechaza una espera de más de una hora", () => {
    const issues = validateFlowForActivation(
      KOSMO_FLOW,
      kosmoNodes({ wait: { seconds: 7200 } }),
    );
    expect(issues.some((i) => i.field === "seconds")).toBe(true);
  });

  it("rechaza una espera que apunta a un nodo que no existe", () => {
    const issues = validateFlowForActivation(
      KOSMO_FLOW,
      kosmoNodes({ wait: { next_node_key: "fantasma" } }),
    );
    expect(issues.some((i) => i.field === "next_node_key")).toBe(true);
  });
});

describe("validateFlowForActivation — classify_reply", () => {
  it("exige las tres salidas: el desconocido no cae en el fallback", () => {
    const issues = validateFlowForActivation(
      KOSMO_FLOW,
      kosmoNodes({ classify: { unknown_next: "" } }),
    );
    expect(issues.some((i) => i.field === "unknown_next")).toBe(true);
  });

  it("exige al menos una palabra en cada lista", () => {
    const issues = validateFlowForActivation(
      KOSMO_FLOW,
      kosmoNodes({ classify: { positive: [] } }),
    );
    expect(issues.some((i) => i.field === "positive")).toBe(true);
  });

  it("una rama extra a medias es un error, no se ignora", () => {
    const issues = validateFlowForActivation(
      KOSMO_FLOW,
      kosmoNodes({
        classify: { extra: { keywords: ["catalogo"], next_node_key: "" } },
      }),
    );
    expect(issues.some((i) => i.field === "extra.next_node_key")).toBe(true);
  });

  it("cuenta las ramas como aristas: un nodo colgado de una rama es alcanzable", () => {
    const nodes = kosmoNodes({
      classify: { unknown_next: "repregunta" },
    }).concat([
      {
        node_key: "repregunta",
        node_type: "send_message",
        config: { text: "¿Sí o no?", next_node_key: "fin" },
      },
    ]);
    const issues = validateFlowForActivation(KOSMO_FLOW, nodes);
    expect(issues).toEqual([]);
  });
});

describe("validateFlowForActivation — handoff que sigue el guion", () => {
  const conNext = [
    { node_key: "start", node_type: "start", config: { next_node_key: "ho" } },
    {
      node_key: "ho",
      node_type: "handoff",
      config: { note: "x", next_node_key: "cierre" },
    },
    { node_key: "cierre", node_type: "end", config: {} },
  ];

  it("acepta un traspaso que apunta a un nodo existente", () => {
    expect(
      validateFlowForActivation(
        { ...validFlow, entry_node_id: "start" },
        conNext,
      ),
    ).toEqual([]);
  });

  it("rechaza un traspaso que apunta a un nodo que no existe", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "start" },
      [
        conNext[0],
        {
          node_key: "ho",
          node_type: "handoff",
          config: { next_node_key: "cierrre" },
        },
        conNext[2],
      ],
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "ho" &&
          i.severity === "error" &&
          i.field === "next_node_key",
      ),
    ).toBe(true);
  });

  it("lo que cuelga de un traspaso es alcanzable", () => {
    expect([...reachableFromEntry("start", conNext)].sort()).toEqual([
      "cierre",
      "ho",
      "start",
    ]);
  });

  it("un traspaso terminal sigue sin aristas salientes", () => {
    expect([...reachableFromEntry("start", [
      conNext[0],
      { node_key: "ho", node_type: "handoff", config: { note: "x" } },
      conNext[2],
    ])].sort()).toEqual(["ho", "start"]);
  });
});

describe("validateFlowForActivation — timeout goto", () => {
  const conGoto = (destino: string) => [
    { node_key: "start", node_type: "start", config: { next_node_key: "espera" } },
    {
      node_key: "espera",
      node_type: "classify_reply",
      config: {
        prompt_text: "x",
        negative: ["no"],
        positive: ["si"],
        negative_next: "fin",
        positive_next: "fin",
        unknown_next: "fin",
        timeout: { hours: 24, action: "goto", next_node_key: destino },
      },
    },
    { node_key: "fin", node_type: "end", config: {} },
    { node_key: "seguimiento", node_type: "end", config: {} },
  ];

  it("acepta un salto a un nodo que existe", () => {
    expect(
      validateFlowForActivation(
        { ...validFlow, entry_node_id: "start" },
        conGoto("seguimiento"),
      ),
    ).toEqual([]);
  });

  it("rechaza un salto a un nodo que no existe", () => {
    // Sin esto, la corrida avanza a la nada 24 horas después, cuando
    // ya nadie está mirando.
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "start" },
      conGoto("sequimiento").slice(0, 3),
    );
    expect(
      issues.some(
        (i) => i.severity === "error" && i.field === "timeout.next_node_key",
      ),
    ).toBe(true);
  });

  it("lo que cuelga de un timeout goto no es inalcanzable", () => {
    // Es una arista igual, solo que la recorre el cron.
    expect([...reachableFromEntry("start", conGoto("seguimiento"))]).toContain(
      "seguimiento",
    );
  });
});
