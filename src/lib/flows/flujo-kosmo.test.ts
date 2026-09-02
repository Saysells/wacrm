import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { reachableFromEntry, validateFlowForActivation } from "./validate";

// ============================================================
// El grafo del bot de Kosmo, leído de la migración que lo carga.
//
// La migración no se puede correr desde acá, así que lo que se
// verifica es lo único que puede romperse en silencio: que las
// referencias entre nodos cierren. Un `'positive_next', 'paso_3'`
// donde el nodo se llama `paso3` no lo detecta ni Postgres (es JSONB)
// ni el editor (nadie lo abre): se descubre con un lead real cuando la
// corrida muere con `node_not_found` a mitad del guion.
//
// Se parsea el SQL en vez de duplicar el grafo en TypeScript. Un
// duplicado se desincroniza el día que alguien toca la migración, que
// es justo el día en que el test tendría que avisar.
// ============================================================

const SQL = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/050_flujo_kosmo_primer_contacto.sql",
  ),
  "utf8",
);

/** `(v_flow, 'paso1', 'classify_reply',` → [paso1, classify_reply] */
function parseNodes(): { node_key: string; node_type: string }[] {
  const out: { node_key: string; node_type: string }[] = [];
  const re = /\(v_flow,\s*'([a-z0-9_]+)',\s*'([a-z_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SQL)) !== null) {
    out.push({ node_key: m[1], node_type: m[2] });
  }
  return out;
}

/** Todo `'<campo_de_destino>', '<node_key>'` del archivo. */
function parseTargets(): { field: string; target: string }[] {
  const out: { field: string; target: string }[] = [];
  const re =
    /'(next_node_key|positive_next|negative_next|unknown_next)',\s*'([a-z0-9_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SQL)) !== null) {
    out.push({ field: m[1], target: m[2] });
  }
  return out;
}

const NODES = parseNodes();
const KEYS = new Set(NODES.map((n) => n.node_key));

describe("migración 050 — el grafo del bot", () => {
  it("el parseo encontró los 19 nodos del guion", () => {
    // Si este número cambia sin querer, algo se perdió en un edit.
    expect(NODES).toHaveLength(19);
    expect(new Set(NODES.map((n) => n.node_key)).size).toBe(19);
  });

  it("arranca en 'inicio' y ese nodo existe", () => {
    expect(SQL).toContain("entry_node_id = 'inicio'");
    expect(KEYS.has("inicio")).toBe(true);
  });

  it("toda referencia entre nodos apunta a un nodo que existe", () => {
    const rotas = parseTargets().filter((t) => !KEYS.has(t.target));
    expect(rotas).toEqual([]);
  });

  it("tiene los cuatro pasos y los cuatro traspasos", () => {
    for (const key of [
      "espera",
      "marcar_en_gestion",
      "paso1",
      "paso2",
      "paso3",
      "paso4",
      "traspaso_no_formulario",
      "traspaso_lista",
      "traspaso_horario",
    ]) {
      expect(KEYS.has(key)).toBe(true);
    }
  });

  it("todos los nodos son alcanzables desde el arranque", () => {
    // Con las configs mínimas que el recorrido necesita: lo que importa
    // es la topología, y las aristas ya se extrajeron del SQL.
    const byKey = new Map(NODES.map((n) => [n.node_key, n]));
    const edges = new Map<string, string[]>();

    // Reconstruye las aristas nodo por nodo: se corta el SQL en los
    // tuplos de INSERT y se leen los destinos de cada uno.
    for (const chunk of SQL.split("(v_flow, '").slice(1)) {
      const key = chunk.slice(0, chunk.indexOf("'"));
      if (!byKey.has(key)) continue;
      const targets = [
        ...chunk.matchAll(
          /'(next_node_key|positive_next|negative_next|unknown_next)',\s*'([a-z0-9_]+)'/g,
        ),
      ].map((m) => m[2]);
      edges.set(key, targets);
    }

    const nodes = NODES.map((n) => ({
      node_key: n.node_key,
      node_type: (edges.get(n.node_key)?.length ?? 0) > 0 ? "send_buttons" : "end",
      config:
        (edges.get(n.node_key)?.length ?? 0) > 0
          ? {
              text: "x",
              buttons: (edges.get(n.node_key) ?? []).map((t, i) => ({
                reply_id: `r${i}`,
                title: "x",
                next_node_key: t,
              })),
            }
          : {},
    }));

    const alcanzables = reachableFromEntry("inicio", nodes);
    const huerfanos = NODES.map((n) => n.node_key).filter(
      (k) => !alcanzables.has(k),
    );
    expect(huerfanos).toEqual([]);
  });

  it("el grafo pasa el validador de activación", () => {
    // Se rearma con las mismas aristas: si el validador lo aceptaría,
    // el flujo se puede activar desde el editor sin errores rojos.
    const nodes = NODES.map((n) => {
      const chunk =
        SQL.split("(v_flow, '" + n.node_key + "', ")[1]?.split(
          "(v_flow, '",
        )[0] ?? "";
      const targets = [
        ...chunk.matchAll(
          /'(next_node_key|positive_next|negative_next|unknown_next)',\s*'([a-z0-9_]+)'/g,
        ),
      ];
      const get = (f: string) =>
        targets.find((t) => t[1] === f)?.[2] ?? "";
      if (n.node_type === "classify_reply") {
        return {
          node_key: n.node_key,
          node_type: n.node_type,
          config: {
            prompt_text: "x",
            negative: ["no"],
            positive: ["si"],
            negative_next: get("negative_next"),
            positive_next: get("positive_next"),
            unknown_next: get("unknown_next"),
          },
        };
      }
      if (n.node_type === "wait") {
        return {
          node_key: n.node_key,
          node_type: n.node_type,
          config: { seconds: 25, next_node_key: get("next_node_key") },
        };
      }
      if (n.node_type === "collect_input") {
        return {
          node_key: n.node_key,
          node_type: n.node_type,
          config: {
            prompt_text: "x",
            var_key: "rango_horario",
            next_node_key: get("next_node_key"),
          },
        };
      }
      if (n.node_type === "send_message") {
        return {
          node_key: n.node_key,
          node_type: n.node_type,
          config: { text: "x", next_node_key: get("next_node_key") },
        };
      }
      if (n.node_type === "set_tag") {
        return {
          node_key: n.node_key,
          node_type: n.node_type,
          config: {
            mode: "add",
            tag_id: "00000000-0000-0000-0000-000000000000",
            next_node_key: get("next_node_key"),
          },
        };
      }
      if (n.node_type === "start") {
        return {
          node_key: n.node_key,
          node_type: n.node_type,
          config: { next_node_key: get("next_node_key") },
        };
      }
      return { node_key: n.node_key, node_type: n.node_type, config: {} };
    });

    const issues = validateFlowForActivation(
      {
        name: "Bot de primer contacto",
        trigger_type: "first_inbound_message",
        trigger_config: {},
        entry_node_id: "inicio",
      },
      nodes,
    );
    expect(issues).toEqual([]);
  });
});

describe("migración 050 — los textos del guion", () => {
  it("el paso 4 se sobreescribe el timeout como traspaso", () => {
    // Quien ya dijo que quiere la llamada no es "No responde".
    expect(SQL).toMatch(/'timeout',\s*jsonb_build_object\(/);
    expect(SQL).toContain("'Quiere la llamada, no pasó horario'");
  });

  it("la nota del traspaso final interpola el rango", () => {
    expect(SQL).toContain("Rango: {{vars.rango_horario}}");
  });

  it("los mensajes usan las variables del contacto", () => {
    expect(SQL).toContain("{{contact.nombre_coma}}");
    expect(SQL).toContain("{{contact.coma_nombre}}");
    expect(SQL).toContain("{{contact.tipo_negocio}}");
  });

  it("respeta el formato de párrafos del guion", () => {
    // Apertura con dos puntos y el párrafo pegado (\n), y renglón en
    // blanco (\n\n) entre párrafos.
    expect(SQL).toContain("breve intro de nosotros:\\nKosmo es importador");
    expect(SQL).toContain("armamos juntos el primer pedido.\\n\\nTe consulto");
    expect(SQL).toContain("todos los productos:\\nLos precios están");
  });

  it("no hay ningún UUID pegado a mano", () => {
    expect(SQL).not.toMatch(
      /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/,
    );
  });
});
