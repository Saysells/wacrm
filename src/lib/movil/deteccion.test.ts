import { describe, expect, it } from "vitest";

import { ANCHO_MAXIMO_MOVIL, rutaSegunAncho } from "@/lib/movil/deteccion";

describe("a donde manda la raiz", () => {
  it("un iPhone va a la app movil", () => {
    expect(rutaSegunAncho(390)).toBe("/m"); // iPhone 13 vertical
    expect(rutaSegunAncho(430)).toBe("/m"); // iPhone Pro Max vertical
  });

  it("una ventana de escritorio va al panel", () => {
    expect(rutaSegunAncho(1440)).toBe("/dashboard");
    expect(rutaSegunAncho(1024)).toBe("/dashboard");
  });

  it("el limite es inclusivo", () => {
    expect(rutaSegunAncho(ANCHO_MAXIMO_MOVIL)).toBe("/m");
    expect(rutaSegunAncho(ANCHO_MAXIMO_MOVIL + 1)).toBe("/dashboard");
  });
});
