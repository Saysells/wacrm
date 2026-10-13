"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNow } from "@/hooks/use-now";
import { monthGrid } from "@/lib/inbox/agendar";
import {
  formatIsoDay,
  initialMonth,
  parseIsoDay,
  sameIsoDay,
  shiftMonthOf,
  toIsoDay,
  todayIsoDay,
} from "@/lib/dates/iso-day";
import { cn } from "@/lib/utils";

// ============================================================
// Selector de fecha propio (rediseño, sesión F2). Regla del sistema:
// nunca el `<input type="date">` nativo. Es el calendario de "Agendar
// llamada" (prototipo `.cal`) en un popover: disparador con el alto de un
// campo (40 px), mes con flechas, letras de los días y la grilla con el
// lunes primero (`monthGrid`). El valor viaja como `YYYY-MM-DD`, que es
// como lo guarda la base. Los textos salen de `Inbox.schedule` e
// `Inbox.messageThread` (los mismos del modal de Agendar) y de `Common`.
// ============================================================

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const NAV_BUTTON =
  "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground [&>svg]:size-4";

export function DatePicker({
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
  id,
}: {
  /** `YYYY-MM-DD` o vacío. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const t = useTranslations("Inbox.schedule");
  const tThread = useTranslations("Inbox.messageThread");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const months = tThread("months").split(",");
  const letters = t("weekdayLetters").split(",");

  // El reloj compartido (`useNow`, un tic por minuto): nada de leer la
  // hora durante el render.
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => initialMonth(value, now));

  const selected = parseIsoDay(value);
  const today = todayIsoDay(now);
  const grid = monthGrid(view.year, view.month);

  const cells = [
    ...Array.from({ length: grid.offset }, (_, i) => <span key={`pad-${i}`} />),
    ...Array.from({ length: grid.days }, (_, i) => {
      const day = { year: view.year, month: view.month, day: i + 1 };
      const isSelected = sameIsoDay(day, selected);
      const isToday = sameIsoDay(day, today);
      return (
        <button
          key={toIsoDay(day)}
          type="button"
          onClick={() => {
            onChange(toIsoDay(day));
            setOpen(false);
          }}
          aria-pressed={isSelected}
          className={cn(
            "grid h-8 place-items-center rounded-lg text-[13px] tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isSelected
              ? "bg-primary font-semibold text-primary-foreground"
              : "text-foreground hover:bg-hover",
            isToday && !isSelected && "font-semibold text-primary",
          )}
        >
          {i + 1}
        </button>
      );
    }),
  ];

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setView(initialMonth(value, now));
        setOpen(next);
      }}
    >
      <PopoverTrigger
        id={id}
        disabled={disabled}
        className={cn(
          "flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm text-foreground transition-colors outline-none hover:border-[#CDD5DF] focus-visible:border-[#9FB6CF] data-popup-open:border-[#9FB6CF] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn("flex-1 truncate", !selected && "text-muted-foreground")}>
          {selected ? formatIsoDay(value, locale) : (placeholder ?? tCommon("pickDate"))}
        </span>
        {selected && !disabled && (
          <span
            role="button"
            tabIndex={0}
            aria-label={tCommon("clearDate")}
            title={tCommon("clearDate")}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onChange("");
              }
            }}
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <X className="size-3.5" />
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[272px] p-3">
        <div className="mb-1.5 flex items-center gap-1 text-sm font-semibold text-foreground">
          <span className="flex-1 px-1">
            {t("monthTitle", { month: capitalize(months[view.month] ?? ""), year: view.year })}
          </span>
          <button
            type="button"
            onClick={() => setView((v) => shiftMonthOf(v, -1))}
            aria-label={t("prevMonth")}
            title={t("prevMonth")}
            className={NAV_BUTTON}
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            onClick={() => setView((v) => shiftMonthOf(v, 1))}
            aria-label={t("nextMonth")}
            title={t("nextMonth")}
            className={NAV_BUTTON}
          >
            <ChevronRight />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {letters.map((letter, i) => (
            <div
              key={`${letter}-${i}`}
              className="h-6 text-[11.5px] leading-6 font-semibold text-muted-foreground"
            >
              {letter}
            </div>
          ))}
          {cells}
        </div>
      </PopoverContent>
    </Popover>
  );
}
