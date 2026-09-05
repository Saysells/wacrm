"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { IconClose } from "@/components/movil/icons";

/**
 * La hoja de abajo de la maqueta (`.sheet` + `.backdrop`).
 *
 * Sigue montada cuando esta cerrada: la clase `.on` maneja el
 * `transform` Y la `visibility`, que es lo que impide que el borde
 * superior asome por debajo del indicador de inicio. Desmontarla
 * mataria la animacion de salida y volveria a traer ese defecto.
 */
export function MobileSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // `onClose` llega casi siempre como una flecha inline, asi que su
  // identidad cambia en cada render. Si el efecto dependiera de ella,
  // empujaria una entrada de historial por render mientras la hoja
  // esta abierta y volver atras haria falta veinte veces. Va por ref y
  // el efecto depende solo de `open`.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Volver atras cierra la hoja en vez de salir de la pantalla, que es
  // lo que espera cualquiera con el gesto de borde del iPhone.
  useEffect(() => {
    if (!open) return;
    const onPop = () => onCloseRef.current();
    window.history.pushState({ sheet: true }, "");
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Si la hoja se cerro por el boton, hay que consumir la entrada
      // que se empujo al abrir; si se cerro por popstate, ya no esta.
      if (window.history.state?.sheet) window.history.back();
    };
  }, [open]);

  return (
    <>
      <div
        className={`m-backdrop${open ? " on" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`m-sheet${open ? " on" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!open}
      >
        <div className="m-sheet-h">
          <h2>{title}</h2>
          <button type="button" className="m-ibtn" onClick={onClose} aria-label="Cerrar">
            <IconClose />
          </button>
        </div>
        <div className="m-sheet-body">{children}</div>
      </div>
    </>
  );
}
