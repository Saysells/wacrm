import { describe, expect, it } from "vitest";

import { beginLoad, createLoadSequence, shouldApply } from "./load-sequence";

/**
 * Simula el efecto de carga del store: cada corrida pide y, al volver,
 * aplica solo si su pedido sigue siendo el último.
 */
function simulate(runs: Array<{ name: string; resolvesAfter: string[] }>) {
  const seq = createLoadSequence();
  const ids = new Map<string, number>();
  const applied: string[] = [];
  // Todas las corridas arrancan en orden; después vuelven en el orden
  // que dice `resolvesAfter` (la última entrada es la que vuelve).
  for (const run of runs) ids.set(run.name, beginLoad(seq));
  const order = [...runs].sort((a, b) => a.resolvesAfter.length - b.resolvesAfter.length);
  for (const run of order) {
    if (shouldApply(seq, ids.get(run.name)!)) applied.push(run.name);
  }
  return applied;
}

describe("load-sequence", () => {
  it("dos pedidos: el primero vuelve después de que arrancó el segundo y gana el segundo", () => {
    expect(
      simulate([
        { name: "primero", resolvesAfter: [] },
        { name: "segundo", resolvesAfter: ["primero"] },
      ]),
    ).toEqual(["segundo"]);
  });

  it("un pedido reemplazado con otro en vuelo no deja la lista sin cargar", () => {
    // El escenario del arranque: el perfil cambia mientras la primera
    // consulta está en vuelo. La corrida nueva pide igual (no hay guard
    // de "una en vuelo"), así que siempre hay una respuesta que aplica.
    const seq = createLoadSequence();
    const first = beginLoad(seq);
    const second = beginLoad(seq); // la corrida nueva arranca con la primera en vuelo
    expect(shouldApply(seq, first)).toBe(false); // la primera se descarta…
    expect(shouldApply(seq, second)).toBe(true); // …porque la segunda la reemplaza y aplica
  });

  it("un solo pedido se aplica, y el último de una ráfaga también", () => {
    const seq = createLoadSequence();
    const only = beginLoad(seq);
    expect(shouldApply(seq, only)).toBe(true);
    const burst = [beginLoad(seq), beginLoad(seq), beginLoad(seq)];
    expect(burst.map((id) => shouldApply(seq, id))).toEqual([false, false, true]);
  });
});
