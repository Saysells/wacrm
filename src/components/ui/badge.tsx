import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Insignia / chip de estado del rediseno (sesion A). Regla del sistema
// de diseno de Saysells: estados y etiquetas van en RECTANGULOS de 5 px
// de radio, nunca en pastillas. Medidas del prototipo `.ch`: 22 px de
// alto, 7 px de padding, 12 px medium. Cada variante es texto oscuro
// sobre el tono suave del mismo color (`--*-soft`), como en el
// prototipo; `default` es navy pleno y `outline` blanco con borde.
const badgeVariants = cva(
  "group/badge inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-[5px] border border-transparent px-[7px] text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-[13px]!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary-hover",
        secondary:
          "bg-neutral-soft text-neutral [a]:hover:bg-selected",
        selected: "bg-selected-strong text-primary",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
        info: "bg-info-soft text-info",
        pending: "bg-pending text-pending-foreground",
        destructive:
          "bg-danger-soft text-danger focus-visible:ring-danger/20 [a]:hover:bg-danger/20",
        outline:
          "border-border bg-card text-foreground [a]:hover:bg-muted",
        ghost:
          "hover:bg-muted hover:text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
