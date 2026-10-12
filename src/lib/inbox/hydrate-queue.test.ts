import { describe, expect, it } from "vitest";

import { createHydrateQueue, finishHydrate, isHydrating, requestHydrate } from "./hydrate-queue";

/**
 * Simula el store: la base tiene un valor que cambia; cada relectura
 * devuelve el valor que la base tiene al momento de LEER. Los pedidos
 * llegan como "write:<valor>" (cambia la base y pide releer) o
 * "finish" (termina la lectura en curso). Devuelve el valor aplicado
 * al final y cuántas lecturas corrieron.
 */
function simulate(events: string[]) {
  const queue = createHydrateQueue();
  let db = "inicial";
  let applied = "inicial";
  let reads = 0;
  let readAt = ""; // valor que la lectura en curso va a devolver
  const read = () => {
    reads += 1;
    readAt = db;
  };
  for (const ev of events) {
    if (ev.startsWith("write:")) {
      db = ev.slice("write:".length);
      if (requestHydrate(queue, "c1") === "run") read();
    } else if (ev === "finish") {
      applied = readAt;
      if (finishHydrate(queue, "c1") === "rerun") read();
    }
  }
  return { applied, reads, running: isHydrating(queue, "c1") };
}

describe("hydrate-queue", () => {
  it("una relectura sola corre y queda libre al terminar", () => {
    expect(simulate(["write:a", "finish"])).toEqual({ applied: "a", reads: 1, running: false });
  });

  it("dos cambios seguidos: la segunda relectura no se pierde y gana lo último", () => {
    // El caso de la etiqueta: se saca y se vuelve a poner mientras la
    // primera relectura está en vuelo. Antes, la segunda se descartaba
    // y quedaba aplicado "a" (el estado del medio).
    expect(simulate(["write:a", "write:b", "finish", "finish"])).toEqual({
      applied: "b",
      reads: 2,
      running: false,
    });
  });

  it("muchos pedidos durante una lectura corren UNA sola más, con lo último", () => {
    expect(simulate(["write:a", "write:b", "write:c", "write:d", "finish", "finish"])).toEqual({
      applied: "d",
      reads: 2,
      running: false,
    });
  });

  it("un pedido durante la relectura extra vuelve a encolar una más", () => {
    expect(simulate(["write:a", "write:b", "finish", "write:c", "finish", "finish"])).toEqual({
      applied: "c",
      reads: 3,
      running: false,
    });
  });

  it("cada conversación tiene su propia cola", () => {
    const queue = createHydrateQueue();
    expect(requestHydrate(queue, "c1")).toBe("run");
    expect(requestHydrate(queue, "c2")).toBe("run");
    expect(requestHydrate(queue, "c1")).toBe("queued");
    expect(finishHydrate(queue, "c2")).toBe("idle");
    expect(isHydrating(queue, "c2")).toBe(false);
    expect(finishHydrate(queue, "c1")).toBe("rerun");
    expect(isHydrating(queue, "c1")).toBe(true);
    expect(finishHydrate(queue, "c1")).toBe("idle");
    expect(isHydrating(queue, "c1")).toBe(false);
  });
});
