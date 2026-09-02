import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { reachableFromEntry, validateFlowForActivation } from "./validate";

// ============================================================
// El seguimiento del catálogo (migración 053), leído del SQL.
//
// Mismo criterio que `flujo-kosmo.test.ts`: la migración no se puede
// correr desde acá, así que lo que se verifica es lo único que puede
// romperse en silencio — que las referencias entre nodos cierren. Un
// `'next_node_key', 'sequimiento'` no lo detecta ni Postgres (es
// JSONB) ni el editor: se descubriría 24 horas después de un lead
// real, cuando la corrida avanza a un nodo que no existe.
//
// El grafo se arma con las tres migraciones que lo definen, en orden:
// la 050 lo carga, la 052 le saca el nodo `espera` y la 053 le cuelga
// el seguimiento. Es el estado que va a tener la base.
// ============================================================

function sql(archivo: string): string {
  return readFileSync(
    join(process.cwd(), "supabase/migrations", archivo),
    "utf8",
  );
}

const SQL_050 = sql("050_flujo_kosmo_primer_contacto.sql");
const SQL_052 = sql("052_bot_sin_espera.sql");
const SQL_053 = sql("053_seguimiento_catalogo.sql");

interface ParsedNode {
  node_key: string;
  node_type: string;
  /** Trozo de SQL del tuple, para leerle los destinos. */
  chunk: string;
}

/** `(v_flow, 'paso1', 'classify_reply', ...` → un nodo con su trozo. */
function parseNodes(source: string): ParsedNode[] {
  const out: ParsedNode[] = [];
  for (const chunk of source.split("(v_flow, '").slice(1)) {
    const m = /^([a-z0-9_]+)',\s*'([a-z_]+)'/.exec(chunk);
    if (!m) continue;
    out.push({ node_key: m[1], node_type: m[2], chunk });
  }
  return out;
}

/** El destino de un campo dentro del trozo de un nodo. */
function target(chunk: string, field: string): string {
  const m = new RegExp(`'${field}',\\s*'([a-z0-9_]+)'`).exec(chunk);
  return m?.[1] ?? "";
}

/** `{ hours, action, next_node_key }` del `timeout` de un nodo. */
function timeoutOf(chunk: string): Record<string, string> | null {
  const m = /'timeout',\s*jsonb_build_object\(([\s\S]*?)\n\s*\)/.exec(chunk);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const [, k, v] of m[1].matchAll(/'(\w+)',\s*'?([^,'\n]+)'?/g)) {
    out[k] = v.trim();
  }
  return out;
}

// ---- el grafo que va a quedar en la base -------------------------
const NODOS = new Map<string, ParsedNode>();
for (const n of parseNodes(SQL_050)) NODOS.set(n.node_key, n);
// La 052 saca el `espera` y manda el arranque directo a la etiqueta.
NODOS.delete("espera");
for (const n of parseNodes(SQL_053)) NODOS.set(n.node_key, n);

const KEYS = new Set(NODOS.keys());
const nodo = (key: string) => {
  const n = NODOS.get(key);
  if (!n) throw new Error(`falta el nodo ${key}`);
  return n;
};

describe("migración 053 — la rama de la lista", () => {
  it("el traspaso de la lista sigue al cierre en vez de terminar", () => {
    // Se parcha el nodo que cargó la 050, así que el destino no está
    // en un tuple sino en el UPDATE.
    expect(SQL_053).toContain(
      "jsonb_build_object('next_node_key', 'lista_cierre')",
    );
    // Y conserva lo suyo: la nota y la asignación las pone la 050 y
    // esta migración no las toca.
    expect(nodo("traspaso_lista").chunk).toContain(
      "Pidió la lista, no quiere llamada",
    );
    expect(nodo("traspaso_lista").chunk).toContain("'assign_to', v_matias");
  });

  it("suma los cuatro nodos del seguimiento", () => {
    expect(parseNodes(SQL_053).map((n) => [n.node_key, n.node_type])).toEqual([
      ["lista_cierre", "classify_reply"],
      ["fin_lista", "end"],
      ["seguimiento", "classify_reply"],
      ["traspaso_no_quiere", "handoff"],
    ]);
  });

  it("cualquier respuesta al cierre termina la corrida", () => {
    // Si contestó, hay conversación, y donde hay conversación el bot
    // se corre: las tres salidas van al mismo `end`.
    const c = nodo("lista_cierre").chunk;
    for (const field of ["positive_next", "negative_next", "unknown_next"]) {
      expect(target(c, field)).toBe("fin_lista");
    }
    expect(nodo("fin_lista").node_type).toBe("end");
  });

  it("el silencio del cierre salta al seguimiento a las 24 horas", () => {
    expect(timeoutOf(nodo("lista_cierre").chunk)).toEqual({
      hours: "24",
      action: "goto",
      next_node_key: "seguimiento",
    });
  });

  it("el seguimiento manda al rango horario o al traspaso", () => {
    const c = nodo("seguimiento").chunk;
    expect(target(c, "positive_next")).toBe("paso4");
    expect(target(c, "negative_next")).toBe("traspaso_no_quiere");
    expect(target(c, "unknown_next")).toBe("traspaso_no_quiere");
  });

  it("el silencio del seguimiento es un traspaso, no un No responde", () => {
    // Esta persona ya recibió el catálogo y su conversación es de
    // Matías: la política de la cuenta ("No responde") diría otra cosa
    // y estaría mal.
    expect(timeoutOf(nodo("seguimiento").chunk)).toMatchObject({
      hours: "24",
      action: "handoff",
    });
    expect(SQL_053).toContain("No respondió al seguimiento del catálogo");
  });

  it("el traspaso de quien no quiere la llamada es terminal", () => {
    const c = nodo("traspaso_no_quiere").chunk;
    expect(c).toContain("Vio el catálogo, no quiere llamada");
    expect(c).toContain("'assign_to', v_matias");
    expect(target(c, "next_node_key")).toBe("");
  });

  it("el texto del seguimiento está en el registro del guion", () => {
    expect(SQL_053).toContain("{{contact.nombre_coma}} ¿pudiste ver el catálogo?");
    // Voseo: "pudiste", no "has podido".
    expect(nodo("seguimiento").chunk).not.toContain("has podido");
  });

  it("no hay ningún UUID pegado a mano", () => {
    expect(SQL_053).not.toMatch(
      /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/,
    );
    // La cuenta sale del perfil y el flujo de su nombre.
    expect(SQL_053).toContain("lower(p.email) = 'saysellsmatias@gmail.com'");
    expect(SQL_053).toContain("name = c_nombre");
  });
});

describe("migración 053 — el grafo completo (050 + 052 + 053)", () => {
  // Configs mínimas por tipo, con las aristas leídas del SQL: lo que
  // importa es la topología.
  function nodosParaValidar() {
    return [...NODOS.values()].map((n) => {
      const t = (f: string) => target(n.chunk, f);
      const timeout = timeoutOf(n.chunk);
      const conTimeout = (cfg: Record<string, unknown>) =>
        timeout?.action === "goto"
          ? {
              ...cfg,
              timeout: {
                action: "goto",
                next_node_key: timeout.next_node_key,
              },
            }
          : cfg;
      switch (n.node_type) {
        case "classify_reply":
          return {
            node_key: n.node_key,
            node_type: n.node_type,
            config: conTimeout({
              prompt_text: "x",
              negative: ["no"],
              positive: ["si"],
              negative_next: t("negative_next"),
              positive_next: t("positive_next"),
              unknown_next: t("unknown_next"),
              ...(n.chunk.includes("'extra', jsonb_build_object")
                ? {
                    extra: {
                      keywords: ["lista"],
                      next_node_key: /'extra', jsonb_build_object\([\s\S]*?'next_node_key',\s*'([a-z0-9_]+)'/.exec(
                        n.chunk,
                      )?.[1],
                    },
                  }
                : {}),
            }),
          };
        case "collect_input":
          return {
            node_key: n.node_key,
            node_type: n.node_type,
            config: {
              prompt_text: "x",
              var_key: "rango_horario",
              next_node_key: t("next_node_key"),
            },
          };
        case "send_message":
          return {
            node_key: n.node_key,
            node_type: n.node_type,
            config: { text: "x", next_node_key: t("next_node_key") },
          };
        case "set_tag":
          return {
            node_key: n.node_key,
            node_type: n.node_type,
            config: {
              mode: "add",
              tag_id: "00000000-0000-0000-0000-000000000000",
              next_node_key: t("next_node_key"),
            },
          };
        case "start":
          return {
            node_key: n.node_key,
            node_type: n.node_type,
            // La 052 lo reapunta a la etiqueta.
            config: { next_node_key: "marcar_en_gestion" },
          };
        case "handoff":
          return {
            node_key: n.node_key,
            node_type: n.node_type,
            config:
              // El único traspaso que sigue el guion es el de la lista,
              // y su destino lo pone el UPDATE de la 053.
              n.node_key === "traspaso_lista"
                ? { note: "x", next_node_key: "lista_cierre" }
                : { note: "x" },
          };
        default:
          return { node_key: n.node_key, node_type: n.node_type, config: {} };
      }
    });
  }

  it("la 052 sacó el nodo espera y reapuntó el arranque", () => {
    expect(SQL_052).toContain("'\"marcar_en_gestion\"'");
    expect(KEYS.has("espera")).toBe(false);
  });

  it("toda referencia apunta a un nodo que existe", () => {
    const rotas: string[] = [];
    for (const n of NODOS.values()) {
      // `inicio` todavía apunta al `espera` en el SQL de la 050; la
      // 052 lo reapunta con un UPDATE y ese caso lo cubre su propio
      // test.
      if (n.node_key === "inicio") continue;
      for (const [, , destino] of n.chunk.matchAll(
        /'(next_node_key|positive_next|negative_next|unknown_next)',\s*'([a-z0-9_]+)'/g,
      )) {
        if (!KEYS.has(destino)) rotas.push(`${n.node_key} → ${destino}`);
      }
    }
    expect(rotas).toEqual([]);
  });

  it("todos los nodos son alcanzables desde el arranque", () => {
    // `seguimiento` solo se alcanza por el timeout `goto`, que es una
    // arista igual aunque la recorra el cron y no el cliente.
    const alcanzables = reachableFromEntry("inicio", nodosParaValidar());
    expect(
      [...KEYS].filter((k) => !alcanzables.has(k)),
    ).toEqual([]);
  });

  it("el grafo pasa el validador de activación", () => {
    expect(
      validateFlowForActivation(
        {
          name: "Bot de primer contacto",
          trigger_type: "first_inbound_message",
          trigger_config: {},
          entry_node_id: "inicio",
        },
        nodosParaValidar(),
      ),
    ).toEqual([]);
  });
});
