"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

// Tabla del rediseño (sesión F2), prototipo `.tbl`: 13.5 px; encabezado
// pegado arriba de 40 px, 12.5 px semibold gris sobre la tarjeta; celdas
// de 46 px con línea fina y hover gris en la fila. Contactos la estrenó
// en la F1 con estas mismas clases (`tableHeadClass`, `tableCellClass`,
// exportadas para las tablas que se arman a mano).

export const tableHeadClass =
  "sticky top-0 z-[1] h-10 border-b border-border bg-card px-3.5 text-left align-middle text-[12.5px] font-semibold whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0"

export const tableCellClass =
  "h-[46px] border-b border-border/60 px-3.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom border-collapse text-[13.5px]", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "transition-colors hover:[&>td]:bg-hover has-aria-expanded:[&>td]:bg-hover data-[state=selected]:[&>td]:bg-selected",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(tableHeadClass, className)}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(tableCellClass, "transition-colors", className)}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
