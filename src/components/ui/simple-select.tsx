"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ============================================================
// Select plano del sistema (rediseño, sesión F2): reemplaza los
// `<select>` nativos de los formularios por el Select de base-ui con una
// lista de opciones `{ value, label, group? }`. base-ui no acepta "" como
// valor de una opción, así que una opción con `value: ""` (el típico
// "Elegí…") viaja como un centinela y vuelve a "" en `onChange`. Todo
// `SelectLabel` va adentro de un `SelectGroup`, como pide base-ui.
// ============================================================

export interface SimpleSelectOption {
  value: string;
  label: string;
  /** Rótulo del grupo; las opciones con el mismo grupo van juntas. */
  group?: string;
  disabled?: boolean;
}

const EMPTY = "__empty__";

export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  className,
  size = "default",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SimpleSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
}) {
  const encode = (v: string) => (v === "" ? EMPTY : v);
  const current = options.find((o) => o.value === value);
  const groups: { name: string | undefined; items: SimpleSelectOption[] }[] = [];
  for (const o of options) {
    const last = groups[groups.length - 1];
    if (last && last.name === o.group) last.items.push(o);
    else groups.push({ name: o.group, items: [o] });
  }
  return (
    <Select
      value={current ? encode(current.value) : null}
      onValueChange={(v) => {
        if (v === null) return;
        onChange(v === EMPTY ? "" : String(v));
      }}
      disabled={disabled}
    >
      <SelectTrigger size={size} className={cn("w-full", className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder}>{current ? current.label : null}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {groups.map((g, i) =>
          g.name ? (
            <SelectGroup key={`${g.name}-${i}`}>
              <SelectLabel>{g.name}</SelectLabel>
              {g.items.map((o) => (
                <SelectItem key={o.value || EMPTY} value={encode(o.value)} disabled={o.disabled}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : (
            g.items.map((o) => (
              <SelectItem key={o.value || EMPTY} value={encode(o.value)} disabled={o.disabled}>
                {o.label}
              </SelectItem>
            ))
          ),
        )}
      </SelectContent>
    </Select>
  );
}
