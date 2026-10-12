"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"

// Modal del rediseno (sesion A), prototipo `.veil` / `.modal` / `.mh`
// / `.mf`. Dos reglas del sistema de diseno de Saysells viven aca y en
// ningun otro lado:
//
//   1. La cruz de cierre es visible, arriba a la derecha (40 px,
//      redonda). `showCloseButton` sigue existiendo para quien quiera
//      poner la suya, pero por defecto esta.
//   2. El clic afuera NO cierra: `disablePointerDismissal` va en true
//      por defecto en el Root, y el velo, al recibir el clic, sacude el
//      modal (`.modal-shake`, en globals.css) para avisar que la
//      salida es la cruz o Escape. Escape sigue cerrando, como en el
//      prototipo.
//
// Todos los modales de la app pasan por `DialogContent`, asi que todos
// heredan las dos cosas sin tocar cada pantalla.

/** Sacude el elemento: saca y vuelve a poner la clase para reiniciar la animacion. */
function shake(el: HTMLElement | null) {
  if (!el) return
  el.classList.remove("modal-shake")
  // Forzar reflow para que el navegador tome la animacion de nuevo.
  void el.offsetWidth
  el.classList.add("modal-shake")
}

function Dialog({
  disablePointerDismissal = true,
  ...props
}: DialogPrimitive.Root.Props) {
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      disablePointerDismissal={disablePointerDismissal}
      {...props}
    />
  )
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-[rgba(15,23,42,0.34)] duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onAnimationEnd,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const popupRef = React.useRef<HTMLDivElement>(null)
  return (
    <DialogPortal>
      <DialogOverlay onPointerDown={() => shake(popupRef.current)} />
      <DialogPrimitive.Popup
        ref={popupRef}
        data-slot="dialog-content"
        onAnimationEnd={(e) => {
          if (e.animationName === "modal-shake") {
            e.currentTarget.classList.remove("modal-shake")
          }
          onAnimationEnd?.(e)
        }}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100vh-40px)] w-full max-w-[calc(100vw-40px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-[20px] bg-card p-6 text-sm text-card-foreground shadow-menu duration-100 outline-none sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="size-5" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-10", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-6 -mb-6 flex flex-col-reverse gap-2 rounded-b-[20px] border-t border-border bg-muted px-6 py-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close
          className="inline-flex h-[38px] items-center justify-center rounded-lg border border-border bg-card px-3.5 text-sm font-semibold text-foreground hover:bg-muted"
        >
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-[21px] leading-tight font-semibold text-foreground",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-[13.5px] text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
