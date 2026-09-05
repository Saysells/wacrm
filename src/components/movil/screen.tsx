"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { IconBack } from "@/components/movil/icons";

/**
 * Una pantalla movil: barra superior fija + contenido scrolleable.
 * Espeja `<section class="screen">` de la maqueta. Con el router de
 * Next solo existe una a la vez, asi que no hace falta el juego de
 * `display:none` que usaba el prototipo de un solo archivo.
 */
export function MobileScreen({
  title,
  onBack,
  actions,
  head,
  children,
  scroll = true,
}: {
  title?: string;
  /** Si va, la barra muestra la flecha de volver. */
  onBack?: () => void;
  /** Botones al final de la barra superior. */
  actions?: ReactNode;
  /** Reemplaza el titulo por contenido propio (el encabezado del chat). */
  head?: ReactNode;
  children: ReactNode;
  /**
   * false cuando la pantalla arma su propio scroll (el chat, que tiene
   * `.m-msgs` scrolleable y un composer fijo abajo).
   */
  scroll?: boolean;
}) {
  return (
    <section className="m-screen">
      <div className="m-topbar">
        <div className="m-topbar-in">
          {onBack ? (
            <button type="button" className="m-ibtn" onClick={onBack} aria-label="Volver">
              <IconBack />
            </button>
          ) : null}
          {head ?? <h1>{title}</h1>}
          {actions}
        </div>
      </div>
      {scroll ? <div className="m-content pad-tab">{children}</div> : children}
    </section>
  );
}

/**
 * Las cuatro pantallas que esta sesion no construye. Llevan su entrada
 * en el tabbar y su titulo, y dicen que todavia no estan — nunca un 404
 * ni una pantalla en blanco.
 */
export function PantallaPendiente({
  title,
  detalle,
}: {
  title: string;
  detalle: string;
}) {
  return (
    <MobileScreen title={title}>
      <div className="m-empty">
        <b>{title} todavia no esta en el telefono</b>
        {detalle}
      </div>
    </MobileScreen>
  );
}

/** Volver con el historial del navegador, como el `back()` de la maqueta. */
export function useVolver(fallback = "/m") {
  const router = useRouter();
  return () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallback);
  };
}
