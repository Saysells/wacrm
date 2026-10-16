"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarCheck, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import {
  SLOTS,
  applySchedule,
  busySlots,
  callsNextWeek,
  canSaveDraft,
  chosenTime,
  closersOf,
  daysWithCalls,
  initialScheduleDraft,
  isPastDay,
  isPastSlot,
  monthGrid,
  resolveScheduleTag,
  shiftMonth,
  startOfDay,
  toggleDay,
  type ScheduleRequest,
} from "@/lib/inbox/agendar";
import { prefillReplyDraft } from "@/lib/inbox/composer-drafts";
import type { InboxConversation } from "@/lib/inbox/inbox-conversation";
import { firstNameOf } from "@/lib/inbox/thread";
import { avatarColors, initialsOf, scheduledCall, windowState } from "@/lib/inbox/vistas";
import { findEstadoTag } from "@/lib/contacts/tag-groups";
import { cn } from "@/lib/utils";
import type { Tag } from "@/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// ============================================================
// Modal "Agendar llamada" (rediseño, sesión D), prototipo
// `drawSchedule()` / `saveSchedule()`: 780 px, a la izquierda los
// closers ("N llamadas en los próximos 7 días") y la casilla "Preparar
// mensaje de confirmación" (desmarcada; marcada muestra el mensaje y lo
// deja escrito en el cuadro al guardar); a la derecha el calendario
// propio (mes, flechas, días pasados apagados, hoy marcado, punto en los
// días con llamadas del closer) y los horarios de 09:00 a 12:30 y 14:00
// a 18:30 cada 30 min, con los ocupados y los pasados deshabilitados;
// abajo el resumen, Cancelar y "Agendar" (o "Reagendar"). Nunca el
// datepicker nativo.
//
// Día y horario son OPCIONALES al agendar (16/10/2026): sin ellos se
// aplica solo la etiqueta. Volver a tocar el día elegido lo destilda.
//
// La lógica (qué etiqueta se aplica, ocupados, calendario) es la de
// `agendar.ts`, pura y con pruebas; acá solo se pinta y se llama a
// `applySchedule`: PRIMERO la fecha, DESPUÉS la etiqueta.
// ============================================================

export interface ScheduledResult {
  conversationId: string;
  contactId: string;
  /** Null si se agendó sin fecha: `fecha_llamada` no se tocó. */
  fechaLlamada: string | null;
  attached: Tag[];
}

export interface ScheduleCallDialogProps {
  /** Qué se pidió abrir; null cierra el modal. */
  request: ScheduleRequest | null;
  onClose: () => void;
  /** La fila viva del store de la conversación abierta. */
  conversation: InboxConversation | null;
  /** Todas las del store: los ocupados y los puntos salen de acá. */
  conversations: InboxConversation[];
  accountTags: Tag[];
  now: number;
  onScheduled: (result: ScheduledResult) => void;
}

/** Botón redondo de 30 px del calendario (prototipo `.calh .ib`). */
const CAL_BUTTON =
  "inline-flex size-[30px] items-center justify-center rounded-full text-secondary-foreground transition-colors outline-none hover:bg-hover-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4";

const LABEL = "text-[12.5px] font-semibold text-muted-foreground";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ScheduleCallDialog({
  request,
  onClose,
  conversation,
  conversations,
  accountTags,
  now,
  onScheduled,
}: ScheduleCallDialogProps) {
  const open = request !== null && conversation !== null && !!conversation.contact;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex w-[780px] max-w-[calc(100vw-40px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[780px]">
        {open && request && conversation && conversation.contact && (
          <ScheduleForm
            key={`${conversation.id}:${request.mode}:${request.presetCloser ?? ""}:${request.fixedTag?.id ?? ""}`}
            request={request}
            conversation={conversation}
            contact={conversation.contact}
            conversations={conversations}
            accountTags={accountTags}
            now={now}
            onClose={onClose}
            onScheduled={onScheduled}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ScheduleFormProps {
  request: ScheduleRequest;
  conversation: InboxConversation;
  contact: NonNullable<InboxConversation["contact"]>;
  conversations: InboxConversation[];
  accountTags: Tag[];
  now: number;
  onClose: () => void;
  onScheduled: (result: ScheduledResult) => void;
}

function ScheduleForm({
  request,
  conversation,
  contact,
  conversations,
  accountTags,
  now,
  onClose,
  onScheduled,
}: ScheduleFormProps) {
  const t = useTranslations("Inbox.schedule");
  const tThread = useTranslations("Inbox.messageThread");
  const weekdays = tThread("weekdaysLong").split(",");
  const months = tThread("months").split(",");
  const letters = t("weekdayLetters").split(",");

  const currentCall = scheduledCall(conversation);
  const currentEstado = findEstadoTag(contact.tags);
  const closers = useMemo(() => closersOf(accountTags), [accountTags]);
  // Sin lista de closers: la cuenta no tiene ninguno, o se eligió
  // "Agendada" / "Reagendado" en Estado (la etiqueta ya está fija).
  const showClosers = closers.length > 0 && !request.fixedTag;

  const [draft, setDraft] = useState(() => initialScheduleDraft(currentCall, now));
  const [closer, setCloser] = useState<string | null>(() => {
    if (!showClosers) return null;
    const preset = request.presetCloser ?? currentCall?.closer ?? null;
    if (preset && closers.some((c) => c.name.toLocaleLowerCase() === preset.toLocaleLowerCase())) {
      return closers.find((c) => c.name.toLocaleLowerCase() === preset.toLocaleLowerCase())!.name;
    }
    // Reagendar sin closer actual ("Agendada"): nadie marcado.
    return request.mode === "re" ? null : closers[0].name;
  });
  // "Preparar mensaje de confirmación": desmarcada por defecto (16/10/2026).
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  // La casilla del mensaje solo tiene sentido con la ventana abierta o
  // por vencer (cerrada, lo único que sale es una plantilla) y con un
  // día y horario elegidos (sin fecha no hay mensaje que armar).
  const win = windowState(conversation.last_customer_message_at, now);
  const windowAllows = win.kind === "open" || win.kind === "expiring";

  const grid = monthGrid(draft.year, draft.month);
  const today = startOfDay(now);
  const dots = useMemo(
    () => daysWithCalls(conversations, closer, draft.year, draft.month, conversation.id),
    [conversations, closer, draft.year, draft.month, conversation.id],
  );
  const busy = useMemo(
    () => (draft.day === null ? new Set<string>() : busySlots(conversations, closer, draft.day, conversation.id)),
    [conversations, closer, draft.day, conversation.id],
  );
  const when = chosenTime(draft);
  const whenDate = when === null ? null : new Date(when);
  const canPrefill = windowAllows && when !== null;
  const canSave = canSaveDraft(draft, request.mode);

  const firstName = firstNameOf(contact.name, contact.phone);
  const displayName = contact.name || contact.phone;
  const isRe = request.mode === "re";

  const messageText = (() => {
    if (!whenDate || !draft.slot) return "";
    const args = {
      name: firstName,
      closer: closer ?? "",
      weekday: weekdays[whenDate.getDay()] ?? "",
      day: whenDate.getDate(),
      time: draft.slot,
    };
    if (closer) return firstName ? t("msgWithCloser", args) : t("msgWithCloserNoName", args);
    return firstName ? t("msgNoCloser", args) : t("msgNoCloserNoName", args);
  })();

  const handleSave = async () => {
    if (!canSave || saving) return;
    const tag = resolveScheduleTag({
      mode: request.mode,
      accountTags,
      currentEstado,
      currentCloser: currentCall?.closer ?? null,
      chosenCloser: closer,
      fixedTag: request.fixedTag,
    });
    if (!tag) {
      toast.error(t("noSchedulingTags"));
      return;
    }
    setSaving(true);
    try {
      const result = await applySchedule({
        db: createClient(),
        contactId: contact.id,
        tag,
        fecha: when === null ? null : new Date(when),
        attached: contact.tags ?? [],
      });
      if (confirm && canPrefill && messageText) {
        // Queda escrito en Responder de esta conversación, sin enviarse;
        // el cuadro pasa a esa pestaña y pone el foco al final.
        prefillReplyDraft(conversation.id, messageText);
      }
      if (when === null) {
        toast.success(
          closer ? t("toastScheduledNoDate", { closer }) : t("toastScheduledNoDateNoCloser"),
        );
      } else {
        const d = new Date(when);
        const args = {
          closer: closer ?? "",
          weekday: weekdays[d.getDay()] ?? "",
          day: d.getDate(),
          time: draft.slot ?? "",
        };
        toast.success(
          closer
            ? t(isRe ? "toastRescheduled" : "toastScheduled", args)
            : t(isRe ? "toastRescheduledNoCloser" : "toastScheduledNoCloser", args),
        );
      }
      onScheduled({
        conversationId: conversation.id,
        contactId: contact.id,
        fechaLlamada: result.fechaLlamada,
        attached: result.attached,
      });
      onClose();
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      toast.error(reason ? `${t("failed")}: ${reason}` : t("failed"));
    } finally {
      setSaving(false);
    }
  };

  const cells: React.ReactNode[] = [];
  for (let k = 0; k < grid.offset; k++) {
    cells.push(<div key={`pad-${k}`} aria-hidden="true" />);
  }
  for (let d = 1; d <= grid.days; d++) {
    const dayStart = new Date(draft.year, draft.month, d).getTime();
    const past = isPastDay(dayStart, now);
    const isToday = dayStart === today;
    const selected = draft.day === dayStart;
    const has = dots.has(d);
    cells.push(
      <button
        key={d}
        type="button"
        disabled={past || saving}
        onClick={() => setDraft((prev) => toggleDay(prev, dayStart))}
        aria-pressed={selected}
        aria-label={`${d}${isToday ? ` · ${t("today")}` : ""}${has ? ` · ${t("hasCalls")}` : ""}`}
        className={cn(
          "relative h-9 rounded-[10px] text-[13.5px] tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
          past ? "cursor-default text-[#B8C0CC]" : "text-foreground hover:bg-hover",
          isToday && !selected && "font-semibold shadow-[inset_0_0_0_1.5px_var(--ring)]",
          selected && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
        )}
      >
        {d}
        {has && !past && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full",
              selected ? "bg-primary-foreground" : "bg-pending",
            )}
          />
        )}
      </button>,
    );
  }

  const selectedDay = draft.day === null ? null : new Date(draft.day);

  return (
    <>
      {/* Encabezado (prototipo `.mh`). La cruz la pone DialogContent. */}
      <div className="flex items-start px-[26px] pt-[22px] pb-2.5 pr-16">
        <div className="min-w-0">
          <DialogTitle>{isRe ? t("titleRe") : t("titleNew")}</DialogTitle>
          <DialogDescription className="truncate">
            {contact.company ? `${displayName} · ${contact.company}` : displayName}
          </DialogDescription>
        </div>
      </div>

      {/* Cuerpo (prototipo `.mb`): 250 px + 1fr. */}
      <div className="grid gap-6 overflow-y-auto px-[26px] pt-2.5 pb-[18px] sm:grid-cols-[250px_1fr]">
        <div>
          {showClosers && (
            <>
              <div className={cn(LABEL, "mb-2")}>{t("closer")}</div>
              {closers.map((c) => {
                const on = closer !== null && c.name.toLocaleLowerCase() === closer.toLocaleLowerCase();
                const [bg, ink] = avatarColors(c.name);
                const count = callsNextWeek(conversations, c.name, now);
                return (
                  <button
                    key={c.tag.id}
                    type="button"
                    disabled={saving}
                    onClick={() => setCloser(c.name)}
                    aria-pressed={on}
                    className={cn(
                      "mb-2 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-primary bg-selected" : "border-border hover:border-[#B9C4D2]",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold"
                      style={{ background: bg, color: ink }}
                    >
                      {initialsOf(c.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm font-semibold text-foreground">{c.name}</b>
                      <span className="block text-xs text-muted-foreground">
                        {t("closerCalls", { count })}
                      </span>
                    </span>
                    {on ? (
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-[13px]" strokeWidth={2.6} />
                      </span>
                    ) : (
                      <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-[1.5px] border-[#B9C2CF]" />
                    )}
                  </button>
                );
              })}
            </>
          )}

          {/* Mensaje de confirmación: casilla desmarcada; marcada, se
              muestra el texto y al guardar queda en el cuadro. Deshabilitada
              sin ventana para escribir o sin día y horario. */}
          <label
            className={cn(
              "flex items-start gap-2 text-[13px] text-secondary-foreground",
              showClosers && "mt-[18px]",
              !canPrefill && "opacity-60",
            )}
            title={
              canPrefill
                ? undefined
                : !windowAllows
                  ? win.kind === "none"
                    ? t("composerNone")
                    : t("composerBlocked")
                  : t("prepareMessageNoDate")
            }
          >
            <Checkbox
              checked={confirm && canPrefill}
              disabled={!canPrefill || saving}
              onCheckedChange={(checked) => setConfirm(checked === true)}
              className="mt-0.5 size-[18px] rounded-[5px]"
            />
            <span>
              {t("prepareMessage")}
              {!canPrefill && (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {!windowAllows
                    ? win.kind === "none"
                      ? t("composerNone")
                      : t("composerBlocked")
                    : t("prepareMessageNoDate")}
                </span>
              )}
            </span>
          </label>
          {confirm && canPrefill && messageText && (
            <>
              <div className={cn(LABEL, "mt-3 mb-2")}>
                {firstName ? t("messageFor", { name: firstName }) : t("messageForContact")}
              </div>
              <div className="rounded-xl bg-muted px-3 py-2.5 text-[13px] leading-[1.45] text-secondary-foreground">
                {`“${messageText}”`}
              </div>
            </>
          )}
        </div>

        <div>
          {/* Calendario propio (prototipo `.calh` / `.cal`). */}
          <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {t("monthTitle", { month: capitalize(months[draft.month] ?? ""), year: draft.year })}
            <span className="ml-auto" />
            <button
              type="button"
              onClick={() => setDraft((prev) => shiftMonth(prev, -1))}
              aria-label={t("prevMonth")}
              title={t("prevMonth")}
              className={CAL_BUTTON}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              onClick={() => setDraft((prev) => shiftMonth(prev, 1))}
              aria-label={t("nextMonth")}
              title={t("nextMonth")}
              className={CAL_BUTTON}
            >
              <ChevronRight />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {letters.map((letter, i) => (
              <div key={`${letter}-${i}`} className="h-6 text-[11.5px] leading-6 font-semibold text-muted-foreground">
                {letter}
              </div>
            ))}
            {cells}
          </div>

          <div className={cn(LABEL, "mt-3.5 mb-2")}>
            {selectedDay
              ? t("slotsTitleDay", {
                  weekday: weekdays[selectedDay.getDay()] ?? "",
                  day: selectedDay.getDate(),
                })
              : t("slotsTitle")}
          </div>
          {draft.day !== null ? (
            <div className="grid grid-cols-4 gap-1.5">
              {SLOTS.map((slot) => {
                const occupied = busy.has(slot);
                const past = isPastSlot(draft.day as number, slot, now);
                const on = draft.slot === slot;
                return (
                  <button
                    key={slot}
                    type="button"
                    disabled={occupied || past || saving}
                    onClick={() => setDraft((prev) => ({ ...prev, slot }))}
                    aria-pressed={on}
                    title={occupied ? t("busy") : past ? t("past") : undefined}
                    className={cn(
                      "grid h-[34px] place-items-center rounded-[9px] border text-[13px] font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : occupied
                          ? "cursor-not-allowed border-[#E8EBF0] bg-[repeating-linear-gradient(135deg,#F1F3F6_0_6px,#E8EBF0_6px_12px)] text-[#9AA4B2] line-through"
                          : past
                            ? "cursor-not-allowed border-border/70 text-[#C0C7D2]"
                            : "border-border text-foreground hover:border-ring",
                    )}
                  >
                    {slot}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {closer ? t("pickDay", { closer }) : t("pickDayNoCloser")}
            </p>
          )}
        </div>
      </div>

      {/* Pie (prototipo `.mf`): resumen, Cancelar y la acción. */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted px-[26px] py-3.5">
        <div className="flex min-w-0 items-center gap-2.5 text-sm">
          <CalendarCheck className="size-[18px] shrink-0 text-primary" />
          <div className="min-w-0">
            {whenDate && draft.slot ? (
              <>
                <b className="block font-semibold text-foreground">
                  {capitalize(
                    t("summaryWhen", {
                      weekday: weekdays[whenDate.getDay()] ?? "",
                      day: whenDate.getDate(),
                      month: months[whenDate.getMonth()] ?? "",
                      time: draft.slot,
                    }),
                  )}
                </b>
                {closer && (
                  <small className="block text-[12.5px] text-muted-foreground">
                    {t("summaryWith", { closer })}
                  </small>
                )}
              </>
            ) : draft.day !== null ? (
              <>
                <b className="block font-semibold text-foreground">{t("summaryIncomplete")}</b>
                <small className="block text-[12.5px] text-muted-foreground">
                  {isRe ? t("summaryNoDateRe") : t("summaryIncompleteHint")}
                </small>
              </>
            ) : (
              <>
                <b className="block font-semibold text-foreground">
                  {t("summaryEmpty")}
                  {closer && !isRe ? ` · ${t("summaryWith", { closer })}` : ""}
                </b>
                <small className="block text-[12.5px] text-muted-foreground">
                  {isRe ? t("summaryNoDateRe") : t("summaryNoDate")}
                </small>
              </>
            )}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave || saving}>
            {isRe ? t("confirmRe") : t("confirmNew")}
          </Button>
        </div>
      </div>
    </>
  );
}
