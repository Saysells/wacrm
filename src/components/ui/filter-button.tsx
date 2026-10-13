import * as React from "react";

import { cn } from "@/lib/utils";

// ============================================================
// Botón desplegable de barra (rediseño, sesión F2), prototipo `.ddb`:
// 32 px, borde `--line`, radio 8, 13 px, ícono de 15 px gris. Es el
// disparador de los filtros estilo Attio (Contactos lo estrenó en la
// F1; desde la F2 lo usan Embudos, Difusiones y las demás barras).
// `ddbClassName` queda exportado para los casos en que el disparador
// lo renderiza base-ui (`DropdownMenuTrigger`, `SelectTrigger`).
// ============================================================

export const ddbClassName =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&>svg]:size-[15px] [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

export function FilterButton({ className, type = "button", ...props }: React.ComponentProps<"button">) {
  return <button type={type} data-slot="filter-button" className={cn(ddbClassName, className)} {...props} />;
}
