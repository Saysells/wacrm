import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// ============================================================
// Vacío (rediseño, sesión F2), prototipo `.empty`: ícono en un cuadro
// celeste de 56 px (radio 16), título de 16 px semibold y texto gris de
// 14 px, centrado, sin el recuadro punteado de antes. `action` va
// debajo del texto (un botón, normalmente `outline`).
// ============================================================

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Menos aire arriba y abajo, para vacíos dentro de una tarjeta chica. */
  compact?: boolean;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-5 py-7" : "px-7 py-12",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-14 shrink-0 place-items-center rounded-2xl bg-selected text-primary"
      >
        <Icon className="size-[26px]" />
      </span>
      <p className="mt-3 text-base font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
