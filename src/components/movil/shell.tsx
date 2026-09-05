"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AuthProvider } from "@/hooks/use-auth";
import { useViewportFit } from "@/hooks/use-viewport-fit";
import { showsTabBar } from "@/lib/movil/rutas";
import { TabBar } from "@/components/movil/tabbar";
import { ToastProvider } from "@/components/movil/toast";

/**
 * El contenedor de toda la app movil.
 *
 * Monta el AuthProvider por su cuenta — el de escritorio vive dentro de
 * DashboardShell, que trae sidebar, header y el layout de tres columnas,
 * justo lo que aca no va. Comparten el hook y el cliente de Supabase, no
 * el chrome.
 *
 * Las dos cosas del iPhone que resuelve, ambas verificadas en el
 * telefono real durante la maqueta:
 *
 *  - El alto: `useViewportFit` escribe `--m-vh` desde
 *    `window.visualViewport` y fuerza `scrollTo(0,0)`. El CSS cae a
 *    `100dvh` (jamas 100vh) mientras no haya medido.
 *  - El rebote: `body.m-root` es `position:fixed; overflow:hidden`, y
 *    el `touchmove` que no nace adentro de un contenedor scrolleable se
 *    cancela. Sin eso, arrastrar sobre el encabezado despega la app y
 *    deja ver el fondo del navegador.
 */
export function MobileShell({
  children,
  className,
}: {
  children: ReactNode;
  /** Clase de la fuente (next/font) que aporta el layout. */
  className?: string;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();
  useViewportFit(shellRef);

  // La clase va y viene con el montaje: si alguien navega de /m a una
  // pantalla de escritorio en la misma sesion de cliente, el body no se
  // queda fijo.
  useEffect(() => {
    document.body.classList.add("m-root");
    return () => document.body.classList.remove("m-root");
  }, []);

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest?.(".m-content, .m-msgs, .m-sheet-body, textarea")) {
        e.preventDefault();
      }
    };
    // `passive: false` es obligatorio: sin eso el navegador ignora el
    // preventDefault y el rebote vuelve.
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => document.removeEventListener("touchmove", onTouchMove);
  }, []);

  return (
    <AuthProvider>
      <ToastProvider>
        <div className={`m-app${className ? ` ${className}` : ""}`} ref={shellRef}>
          {children}
          {showsTabBar(pathname) ? <TabBar /> : null}
        </div>
      </ToastProvider>
    </AuthProvider>
  );
}
