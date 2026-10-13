import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// ============================================================
// Encabezado de pantalla (rediseño, sesión F2), prototipo `.ctop`:
// título de 22 px semibold, al lado el contador o un dato corto en
// gris, las acciones a la derecha (la principal en navy) y, si hace
// falta, una línea gris corta debajo (la nota de `config()`).
//
// Salió del encabezado que Contactos y Notificaciones armaban cada uno
// en la F1; desde la F2 lo usan todas las pantallas. Dos modos:
// - `padded`: la pantalla ocupa la tarjeta entera (Bandeja, Contactos,
//   Notificaciones) y el encabezado pone su propio padding `20 24 14`.
// - sin `padded`: la pantalla vive adentro del padding de la tarjeta
//   (`main` con `p-4 sm:p-6`) y el encabezado no suma margen.
// ============================================================

export function PageHeader({
  title,
  meta,
  actions,
  note,
  back,
  padded = false,
  border = false,
  className,
}: {
  title: ReactNode;
  /** Contador o dato corto al lado del título (prototipo `.ctop .cn`). */
  meta?: ReactNode;
  /** Acciones a la derecha; la principal va en navy (`Button` default). */
  actions?: ReactNode;
  /** Línea gris corta debajo del título. */
  note?: ReactNode;
  /** Botón de volver, a la izquierda del título. */
  back?: ReactNode;
  padded?: boolean;
  /** Línea divisoria debajo (cuando no hay barra de filtros que la ponga). */
  border?: boolean;
  className?: string;
}) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        padded && "px-6 pt-5 pb-3.5",
        border && "border-b border-border",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        {back}
        <h1 className="text-[22px] font-semibold leading-tight text-foreground">{title}</h1>
        {meta != null && meta !== "" && (
          <span className="mt-1 ml-1 flex items-center gap-2 text-sm tabular-nums text-muted-foreground">
            {meta}
          </span>
        )}
        {actions && (
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {note && <p className="mt-1.5 max-w-[72ch] text-sm text-muted-foreground">{note}</p>}
    </div>
  );
}
