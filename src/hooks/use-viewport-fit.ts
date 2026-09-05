"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * El alto real de la app en iOS, y el arreglo del teclado.
 *
 * En Safari de iPhone hay tres mentiras que hay que desarmar juntas, y
 * las tres aparecieron en el iPhone 13 con el que se probo la maqueta:
 *
 *  1. `100vh` vale la altura de la pantalla CON la barra de direcciones
 *     retraida, asi que la app queda mas alta que el hueco visible y el
 *     composer del chat termina abajo del borde. El fallback del CSS es
 *     `100dvh`, que si sigue a la barra, pero tampoco alcanza porque:
 *  2. cuando aparece el teclado, iOS NO achica el layout viewport. Lo
 *     que hace es DESPLAZAR toda la pagina hacia arriba, y el unico que
 *     se entera es `window.visualViewport`. Sin escucharlo, el input
 *     queda tapado por el teclado y la app se ve corrida.
 *  3. despues de ese desplazamiento la pagina queda scrolleada, y como
 *     el shell es `position:fixed` no hay forma de volver sola: hay que
 *     pedir el `window.scrollTo(0, 0)` a mano.
 *
 * Entonces: se escucha `visualViewport` (resize Y scroll — al abrir el
 * teclado iOS dispara los dos, y a veces solo el segundo), se escribe la
 * altura visible en `--m-vh` sobre el propio shell, y se fuerza el
 * scroll a cero. El valor se escribe imperativamente para no re-renderar
 * el arbol en cada evento; `height` se devuelve aparte, redondeado y solo
 * cuando cambia de verdad, para que el chat pueda volver al ultimo
 * mensaje cuando el teclado se abre.
 */
export function useViewportFit(
  ref: RefObject<HTMLElement | null>,
): { height: number | null } {
  const [height, setHeight] = useState<number | null>(null);
  // Espejo sincronico del ultimo alto aplicado: los eventos de
  // visualViewport llegan de a decenas y la mayoria no cambia nada.
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;

    const fit = () => {
      const h = Math.round(vv ? vv.height : window.innerHeight);
      const el = ref.current;
      if (el) el.style.setProperty("--m-vh", `${h}px`);
      // Siempre, aunque el alto no haya cambiado: el desplazamiento de
      // iOS puede ocurrir sin que cambie la altura (por ejemplo al
      // pasar de un input a otro con el teclado ya abierto).
      window.scrollTo(0, 0);
      if (lastRef.current !== h) {
        lastRef.current = h;
        setHeight(h);
      }
    };

    fit();

    if (vv) {
      vv.addEventListener("resize", fit);
      vv.addEventListener("scroll", fit);
    }
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);

    return () => {
      if (vv) {
        vv.removeEventListener("resize", fit);
        vv.removeEventListener("scroll", fit);
      }
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [ref]);

  return { height };
}

/**
 * El re-`fit` que hay que pedir al enfocar un input. El teclado de iOS
 * tarda en aparecer y el evento de `visualViewport` puede llegar antes
 * de que termine la animacion, asi que se vuelve a medir dos veces —
 * los mismos 250 y 600 ms que la maqueta.
 */
export function refitAfterFocus(): void {
  const fire = () => window.dispatchEvent(new Event("resize"));
  setTimeout(fire, 250);
  setTimeout(fire, 600);
}
