"use client";

import { useEffect, useState } from "react";

import {
  SELECTOR_HIDDEN,
  type SelectorResult,
} from "@/lib/saysells/selector";

// Trae una vez por montaje lo que `GET /api/saysells/selector` dice que
// ve esta persona. Arranca oculto, que es el estado seguro: la barra
// muestra solo el nombre de la Bandeja hasta que la ruta confirme que
// hay selector. Ante cualquier error queda oculto, nunca rompe la barra.
export function useSaysellsSelector(): SelectorResult {
  const [result, setResult] = useState<SelectorResult>(SELECTOR_HIDDEN);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/saysells/selector", {
      signal: controller.signal,
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) return SELECTOR_HIDDEN;
        const body = (await res.json()) as Partial<SelectorResult>;
        if (!body || body.visible !== true || !Array.isArray(body.bandejas)) {
          return SELECTOR_HIDDEN;
        }
        return { visible: true, bandejas: body.bandejas } as SelectorResult;
      })
      .catch(() => SELECTOR_HIDDEN)
      .then((next) => {
        if (!controller.signal.aborted) setResult(next);
      });
    return () => controller.abort();
  }, []);

  return result;
}
