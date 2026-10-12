"use client";

import { useEffect, useState } from "react";

/**
 * Reloj que avanza solo, una vez por `intervalMs` (por defecto cada
 * minuto). Las horas relativas y la ventana de 24 h de la lista se
 * calculan contra este valor, así se actualizan sin recargar y sin
 * un temporizador por fila. El valor inicial se fija al montar; en el
 * servidor no hay reloj (se renderiza el mismo instante que el cliente
 * tomará al hidratar, sin desajuste visible).
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
