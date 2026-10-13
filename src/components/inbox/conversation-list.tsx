"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  CalendarCheck,
  CalendarClock,
  CircleAlert,
  Clock,
  Filter,
  Hourglass,
  Inbox,
  Lock,
  MessagesSquare,
  Search,
  User,
  UserRoundCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Conversation, Tag } from "@/types";
import type { InboxConversation } from "@/lib/inbox/inbox-conversation";
import {
  avatarColors,
  conversationGroup,
  durationParts,
  groupColor,
  hhmm,
  initialsOf,
  isClosed,
  listsCalls,
  relativeTime,
  scheduledCall,
  shortWhen,
  showsClosedWindow,
  showsTakeNext,
  splitUnread,
  splitsUnread,
  unassignedOldestFirst,
  windowState,
  type ListFilters,
  type ListSelection,
  type ScheduledCall,
} from "@/lib/inbox/vistas";
import { callDayHeading, callStatus, groupByDay } from "@/lib/inbox/closer";
import {
  splitConversationTags,
  tagTint,
  visibleChips,
} from "@/lib/inbox/conversation-tags";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { formatDuration, formatRelative, formatShortWhen } from "@/lib/inbox/time-text";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ============================================================
// Lista de conversaciones de la Bandeja de escritorio (rediseño,
// sesión B, bloque 2). Prototipo: `list()`, `row()`, `.lh`, `.take`,
// `.sec`, `.row`, `.ch`, `.who`, `.free`, `.empty`.
//
// No carga nada ni filtra: recibe la lista YA filtrada y ordenada por
// la página (`filterConversations`, la misma lógica pura que usan los
// contadores de la barra lateral) más la lista entera del store, para
// las opciones de los filtros y los vacíos. Desde la sesión E los
// filtros del desplegable "Filtros" (conversación abierta o pendiente,
// etiquetas, empresa; no están en el prototipo y se conservan para no
// perder funciones) viven en la página: la misma lista filtrada es la
// que recorren J y K. En Mis llamadas (closer) las filas son las de
// `callRow()` del prototipo, agrupadas por día.
// ============================================================

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  /** La lista ya filtrada y ordenada por la página. */
  conversations: InboxConversation[];
  /** Toda la lista del store: opciones de los filtros y vacíos. */
  allConversations: InboxConversation[];
  filters: ListFilters;
  onFiltersChange: (updater: (prev: ListFilters) => ListFilters) => void;
  loading: boolean;
  /** Etiquetas de la cuenta, para el filtro. */
  tags: Tag[];
  /** Nombre por `user_id` para el setter de cada fila. */
  memberNames: ReadonlyMap<string, string>;
  selection: Omit<ListSelection, "filters">;
  /** Reloj por minuto: horas relativas y ventana se calculan contra él. */
  now: number;
  /** Tomar siguiente (solo se muestra en Para mí). Null si no puede tomar. */
  onTakeNext: (() => void) | null;
}

type Translator = ReturnType<typeof useTranslations>;

const VISTA_TITLE_KEY: Record<ListSelection["vista"], string> = {
  "mis-llamadas": "vistaMisLlamadas",
  "para-mi": "vistaParaMi",
  "sin-tomar": "vistaSinTomar",
  agendadas: "vistaAgendadas",
  "por-vencer": "vistaPorVencer",
  todas: "vistaTodas",
  cerradas: "vistaCerradas",
};

/** Chip de la tercera línea (prototipo `.ch`): rectángulo de 5 px, 22 px de alto. */
const CHIP =
  "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-[5px] px-[7px] text-xs font-medium whitespace-nowrap [&>svg]:size-[13px] [&>svg]:shrink-0";

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  allConversations,
  filters,
  onFiltersChange: setFilters,
  loading,
  tags,
  memberNames,
  selection,
  now,
  onTakeNext,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  const tSidebar = useTranslations("Sidebar");
  const tThread = useTranslations("Inbox.messageThread");
  // Con la barra lateral plegada sobran ~170 px en la fila y las
  // etiquetas secundarias entran enteras; abierta, son puntitos.
  const { collapsed: sidebarCollapsed } = useSidebarCollapsed();

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of allConversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allConversations]);

  const toggleTag = useCallback(
    (id: string) => {
      setFilters((prev) => ({
        ...prev,
        tagIds: prev.tagIds.includes(id)
          ? prev.tagIds.filter((x) => x !== id)
          : [...prev.tagIds, id],
      }));
    },
    [setFilters],
  );

  const activeFilterCount =
    (filters.status ? 1 : 0) + filters.tagIds.length + (filters.company ? 1 : 0);

  const title = selection.query.trim()
    ? t("titleResults")
    : (selection.embudo ?? tSidebar(VISTA_TITLE_KEY[selection.vista]));

  // Aviso "N consultas sin tomar" (prototipo `.take`), solo en Para mí.
  const unassigned = useMemo(
    () => (showsTakeNext(selection) ? unassignedOldestFirst(allConversations) : []),
    [selection, allConversations],
  );

  const sections = splitsUnread(selection) ? splitUnread(conversations) : null;

  // Mis llamadas (prototipo `list()` con `S.view=='calls'`): por hora y
  // agrupadas por día. La lista ya viene ordenada por hora de llamada.
  const callsView = listsCalls(selection);
  const callGroups = useMemo(() => {
    if (!callsView) return null;
    const items: { conversation: InboxConversation; call: ScheduledCall }[] = [];
    for (const conversation of conversations) {
      const call = scheduledCall(conversation);
      if (call) items.push({ conversation, call });
    }
    return groupByDay(items, (item) => item.call.at);
  }, [callsView, conversations]);

  const emptyKind: "unassigned" | "calls" | "inbox" | "search" | "view" | null =
    conversations.length > 0
      ? null
      : selection.query.trim()
        ? "search"
        : callsView
          ? "calls"
          : allConversations.length === 0
            ? "inbox"
            : selection.vista === "sin-tomar" && !selection.embudo
              ? "unassigned"
              : "view";

  const formatCallDay = (day: number): string => {
    const heading = callDayHeading(day, now);
    const weekdays = tThread("weekdaysLong").split(",");
    const months = tThread("months").split(",");
    const date = tThread("dayDate", {
      weekday: weekdays[heading.weekday] ?? "",
      day: heading.day,
      month: months[heading.month] ?? "",
    });
    if (heading.relative === "today") return t("callDayToday", { date });
    if (heading.relative === "tomorrow") return t("callDayTomorrow", { date });
    if (heading.relative === "yesterday") return t("callDayYesterday", { date });
    return date.charAt(0).toUpperCase() + date.slice(1);
  };

  const renderRow = (conv: InboxConversation) => (
    <ConversationRow
      key={conv.id}
      conversation={conv}
      isActive={conv.id === activeConversationId}
      onSelect={onSelect}
      now={now}
      setterName={conv.assigned_agent_id ? (memberNames.get(conv.assigned_agent_id) ?? "") : null}
      showTagChips={sidebarCollapsed}
      t={t}
    />
  );

  return (
    // Prototipo `.card`: la lista mide 350 px en escritorio; en mobile
    // ocupa todo el ancho cuando es el único panel visible.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-[350px]">
      {/* Encabezado (prototipo `.lh`): título, cantidad y Filtros. */}
      <div className="flex h-[60px] shrink-0 items-center gap-2 pr-3 pl-5">
        <h2 className="truncate text-[19px] font-semibold text-foreground">{title}</h2>
        <span className="mt-[3px] shrink-0 text-[13px] tabular-nums text-muted-foreground">
          {callsView
            ? t("callsToDo", { count: conversations.length })
            : t("conversationCount", { count: conversations.length })}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("filters")}
            title={t("filters")}
            className={cn(
              "ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted",
              activeFilterCount > 0 && "border-primary text-primary",
            )}
          >
            <Filter className="size-[15px] text-muted-foreground" />
            <span className="hidden sm:inline">{t("filters")}</span>
            {activeFilterCount > 0 && (
              <span className="rounded-[5px] bg-selected-strong px-1 text-[11px] font-semibold tabular-nums text-primary">
                {activeFilterCount}
              </span>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {/* Todo rótulo va adentro de su grupo: base-ui tira error si
                un DropdownMenuLabel queda suelto (issue #336). */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("filterStatus")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={filters.status ?? "any"}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    status: value === "open" || value === "pending" ? value : null,
                  }))
                }
              >
                <DropdownMenuRadioItem value="any">{t("filterStatusAny")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="open">{t("filterOpen")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="pending">{t("filterPending")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            {tags.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{t("tags")}</DropdownMenuLabel>
                  <div className="max-h-56 overflow-y-auto">
                    {tags.map((tag) => (
                      <DropdownMenuCheckboxItem
                        key={tag.id}
                        checked={filters.tagIds.includes(tag.id)}
                        onCheckedChange={() => toggleTag(tag.id)}
                        closeOnClick={false}
                      >
                        <span
                          className="size-[11px] shrink-0 rounded-[3px]"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="truncate">{tag.name}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </div>
                </DropdownMenuGroup>
              </>
            )}
            {companies.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{t("company")}</DropdownMenuLabel>
                  <div className="max-h-56 overflow-y-auto">
                    <DropdownMenuRadioGroup
                      value={filters.company ?? ""}
                      onValueChange={(value) =>
                        setFilters((prev) => ({ ...prev, company: value ? value : null }))
                      }
                    >
                      <DropdownMenuRadioItem value="">{t("allCompanies")}</DropdownMenuRadioItem>
                      {companies.map((co) => (
                        <DropdownMenuRadioItem key={co} value={co}>
                          <span className="truncate">{co}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </div>
                </DropdownMenuGroup>
              </>
            )}
            {activeFilterCount > 0 && (
              <>
                <DropdownMenuSeparator />
                <button
                  type="button"
                  onClick={() => setFilters(() => ({ status: null, tagIds: [], company: null }))}
                  className="flex w-full items-center gap-2 px-4 py-[9px] text-left text-[13px] font-semibold text-primary hover:bg-hover"
                >
                  {t("clearAll")}
                </button>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* "N consultas sin tomar" (prototipo `.take`). */}
      {onTakeNext && unassigned.length > 0 && (
        <div className="mx-4 mb-2 flex shrink-0 items-center gap-3 rounded-xl bg-[color-mix(in_srgb,var(--pending)_10%,transparent)] py-2.5 pr-3 pl-3.5 text-pending">
          <UserRoundCheck className="size-[18px] shrink-0" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[13.5px] font-semibold">
              {t("takeNextTitle", { count: unassigned.length })}
            </b>
            <span className="block truncate text-xs">
              {t("takeNextOldest", {
                when: formatRelative(relativeTime(new Date(unassigned[0].created_at).getTime(), now), t),
              })}
            </span>
          </div>
          <button
            type="button"
            onClick={onTakeNext}
            className="inline-flex h-[34px] shrink-0 items-center rounded-lg bg-unread px-3 text-[13px] font-semibold text-white transition-colors hover:bg-pending"
          >
            {t("takeNext")}
          </button>
        </div>
      )}

      {/* `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : emptyKind ? (
          <EmptyState kind={emptyKind} query={selection.query} t={t} />
        ) : callGroups ? (
          <div className="flex flex-col pb-3">
            {callGroups.map((group) => (
              <div key={group.day}>
                <SectionHeader label={formatCallDay(group.day)} count={group.items.length} />
                {group.items.map(({ conversation, call }) => (
                  <CallRow
                    key={conversation.id}
                    conversation={conversation}
                    call={call}
                    isActive={conversation.id === activeConversationId}
                    onSelect={onSelect}
                    now={now}
                    setterName={
                      conversation.assigned_agent_id
                        ? (memberNames.get(conversation.assigned_agent_id) ?? "")
                        : null
                    }
                    t={t}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : sections ? (
          <div className="flex flex-col pb-3">
            {sections.unread.length > 0 && (
              <>
                <SectionHeader label={t("sectionUnread")} count={sections.unread.length} />
                {sections.unread.map(renderRow)}
              </>
            )}
            {sections.read.length > 0 && (
              <>
                <SectionHeader
                  label={sections.unread.length > 0 ? t("sectionRead") : t("sectionConversations")}
                  count={sections.read.length}
                  className={sections.unread.length > 0 ? "mt-1.5" : undefined}
                />
                {sections.read.map(renderRow)}
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col pt-1 pb-3">{conversations.map(renderRow)}</div>
        )}
      </ScrollArea>
    </div>
  );
}

/** Prototipo `.sec`: rótulo de sección con su cantidad. */
function SectionHeader({ label, count, className }: { label: string; count: number; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-5 pt-2.5 pb-1.5 text-[12.5px] font-semibold text-muted-foreground",
        className,
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{count}</span>
    </div>
  );
}

function EmptyState({
  kind,
  query,
  t,
}: {
  kind: "unassigned" | "calls" | "inbox" | "search" | "view";
  query: string;
  t: Translator;
}) {
  const Icon =
    kind === "unassigned"
      ? UserRoundCheck
      : kind === "calls"
        ? CalendarCheck
        : kind === "inbox"
          ? MessagesSquare
          : kind === "search"
            ? Search
            : Inbox;
  const title =
    kind === "unassigned"
      ? t("emptyUnassignedTitle")
      : kind === "calls"
        ? t("emptyCallsTitle")
        : kind === "inbox"
          ? t("emptyInboxTitle")
          : kind === "search"
            ? t("emptySearchTitle")
            : t("emptyViewTitle");
  const body =
    kind === "unassigned"
      ? t("emptyUnassignedBody")
      : kind === "calls"
        ? t("emptyCallsBody")
        : kind === "inbox"
          ? t("emptyInboxBody")
          : kind === "search"
            ? t("emptySearchBody", { query: query.trim() })
            : t("emptyViewBody");
  return (
    <div className="px-7 py-12 text-center text-sm leading-relaxed text-muted-foreground">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-selected text-primary">
        <Icon className="size-[26px]" strokeWidth={1.8} />
      </div>
      <b className="mt-3 mb-1 block text-base font-semibold text-foreground">{title}</b>
      {body}
    </div>
  );
}

// ------------------------------------------------------------
// Textos de tiempo: la lógica pura devuelve descriptores, acá se
// traducen (es y en).
// ------------------------------------------------------------

// ------------------------------------------------------------
// Fila (prototipo `row()`): tres líneas.
// ------------------------------------------------------------

interface ConversationRowProps {
  conversation: InboxConversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  now: number;
  /** Nombre del setter, "" si no se conoce, null si está sin tomar. */
  setterName: string | null;
  /** Barra lateral plegada: las etiquetas secundarias entran como chips; si no, puntitos. */
  showTagChips: boolean;
  t: Translator;
}

function ConversationRow({
  conversation: conv,
  isActive,
  onSelect,
  now,
  setterName,
  showTagChips,
  t,
}: ConversationRowProps) {
  const contact = conv.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const [avatarBg, avatarInk] = avatarColors(displayName);
  const unread = conv.unread_count > 0;

  const activity = new Date(conv.last_message_at ?? conv.created_at).getTime();
  const when = Number.isNaN(activity) ? "" : formatRelative(relativeTime(activity, now), t);

  // Vista previa con "Vos:" / "Bot:" si el último mensaje es saliente.
  const prefix =
    conv.last_sender_type === "agent"
      ? t("previewYou")
      : conv.last_sender_type === "bot"
        ? t("previewBot")
        : null;
  const preview = conv.last_message_text?.replace(/\s+/g, " ").trim();

  // Tercera línea: estado, llamada, ventana, setter y etiquetas.
  const group = conversationGroup(conv);
  const call = scheduledCall(conv);
  const windowChip = (() => {
    if (isClosed(conv)) return null;
    const w = windowState(conv.last_customer_message_at, now);
    if (w.kind === "expiring") {
      return (
        <span className={cn(CHIP, "bg-warning-soft text-warning")}>
          <Hourglass />
          {t("windowExpiring", { duration: formatDuration(durationParts(w.remainingMs), t) })}
        </span>
      );
    }
    if (w.kind === "closed" && showsClosedWindow(conv)) {
      return (
        <span className={cn(CHIP, "border border-border bg-card text-sidebar-foreground")}>
          <Lock />
          {t("windowClosed")}
        </span>
      );
    }
    return null;
  })();

  // Etiquetas secundarias (las puestas a mano): chips o puntitos según el
  // ancho; la de estado ya va como grupo del embudo.
  const { secundarias } = splitConversationTags(contact?.tags);
  const { chips, extra } = visibleChips(secundarias);

  const handleClick = useCallback(() => {
    onSelect(conv);
  }, [onSelect, conv]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "mx-2 flex w-[calc(100%-16px)] gap-3 rounded-xl px-3.5 py-[11px] text-left transition-colors hover:bg-hover",
        isActive && "bg-selected hover:bg-selected",
      )}
    >
      {/* Avatar (prototipo `av(name, 42)`). */}
      <span
        aria-hidden="true"
        className="grid size-[42px] shrink-0 place-items-center overflow-hidden rounded-full text-[15px] font-semibold"
        style={{ background: avatarBg, color: avatarInk }}
      >
        {contact?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={contact.avatar_url} alt="" className="size-full object-cover" />
        ) : (
          initialsOf(displayName)
        )}
      </span>

      <div className="min-w-0 flex-1">
        {/* Línea 1: nombre y hora relativa. */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[15px] text-foreground",
              unread ? "font-bold" : "font-medium",
            )}
          >
            {displayName}
          </span>
          <span
            className={cn(
              "shrink-0 text-[12.5px] tabular-nums",
              unread ? "font-semibold text-primary" : "text-muted-foreground",
            )}
          >
            {when}
          </span>
        </div>

        {/* Línea 2: vista previa y no leídos. */}
        <div className="mt-0.5 flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13.5px]",
              unread ? "text-foreground" : "text-sidebar-foreground",
            )}
          >
            {preview ? (
              <>
                {prefix && <b className="font-medium text-muted-foreground">{prefix} </b>}
                {preview}
              </>
            ) : (
              <span className="text-muted-foreground">{t("noMessagesYet")}</span>
            )}
          </span>
          {unread && (
            <span
              aria-label={t("unreadCount", { count: conv.unread_count })}
              className="grid h-5 min-w-5 shrink-0 place-items-center rounded-[5px] bg-unread px-1.5 text-xs font-bold tabular-nums text-white"
            >
              {conv.unread_count}
            </span>
          )}
        </div>

        {/* Línea 3: estado, llamada, ventana, setter y etiquetas. */}
        <div className="mt-[7px] flex flex-wrap items-center gap-1.5">
          {group && (
            <span
              className={CHIP}
              style={{ color: groupColor(group), background: tagTint(groupColor(group)) }}
            >
              {group}
            </span>
          )}
          {call && (
            <span className={cn(CHIP, "bg-selected-strong text-primary")}>
              <CalendarClock />
              {call.closer
                ? t("callChip", { closer: call.closer, when: formatShortWhen(shortWhen(call.at, now), t) })
                : formatShortWhen(shortWhen(call.at, now), t)}
            </span>
          )}
          {windowChip}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {setterName === null ? (
              <span
                title={t("unassigned")}
                aria-label={t("unassigned")}
                className="grid size-[22px] place-items-center rounded-full border-[1.5px] border-dashed border-[#9AA6B8] text-[#7A8699]"
              >
                <User className="size-3" />
              </span>
            ) : (
              <span
                title={t("setter", { name: setterName })}
                aria-label={t("setter", { name: setterName })}
                className="grid size-[22px] place-items-center rounded-full text-[8px] font-semibold"
                style={{
                  background: avatarColors(setterName || "?")[0],
                  color: avatarColors(setterName || "?")[1],
                }}
              >
                {initialsOf(setterName || "?")}
              </span>
            )}
          </span>
          {/* Etiquetas secundarias al final de la línea. */}
          {secundarias.length > 0 &&
            (showTagChips ? (
              <>
                {chips.map((tag) => (
                  <span
                    key={tag.id}
                    className={cn(CHIP, "max-w-32 truncate")}
                    style={{ backgroundColor: tagTint(tag.color), color: tag.color }}
                    title={tag.name}
                  >
                    {tag.name}
                  </span>
                ))}
                {extra > 0 && (
                  <span
                    className={cn(CHIP, "bg-neutral-soft text-neutral")}
                    title={secundarias.slice(chips.length).map((tag) => tag.name).join(", ")}
                  >
                    +{extra}
                  </span>
                )}
              </>
            ) : (
              <span className="flex max-w-24 shrink-0 flex-wrap items-center gap-1">
                {secundarias.map((tag) => (
                  <span
                    key={tag.id}
                    className="size-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                    title={tag.name}
                    aria-label={tag.name}
                  />
                ))}
              </span>
            ))}
        </div>
      </div>
    </button>
  );
}

// ------------------------------------------------------------
// Fila de Mis llamadas (prototipo `callRow()`): hora, avatar, nombre,
// "empresa o teléfono · setter <nombre>" y el estado de la llamada.
// ------------------------------------------------------------

interface CallRowProps {
  conversation: InboxConversation;
  call: ScheduledCall;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  now: number;
  /** Nombre del setter, "" si no se conoce, null si está sin tomar. */
  setterName: string | null;
  t: Translator;
}

function CallRow({ conversation: conv, call, isActive, onSelect, now, setterName, t }: CallRowProps) {
  const contact = conv.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const [avatarBg, avatarInk] = avatarColors(displayName);
  const where = contact?.company?.trim() || contact?.phone || "";
  const status = callStatus(call.at, now);

  const handleClick = useCallback(() => {
    onSelect(conv);
  }, [onSelect, conv]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "mx-2 flex w-[calc(100%-16px)] items-center gap-3 rounded-xl px-3.5 py-[11px] text-left transition-colors hover:bg-hover",
        isActive && "bg-selected hover:bg-selected",
      )}
    >
      <span className="w-[50px] shrink-0 text-base font-semibold tabular-nums text-foreground">
        {hhmm(call.at)}
      </span>
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full text-[14px] font-semibold"
        style={{ background: avatarBg, color: avatarInk }}
      >
        {contact?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={contact.avatar_url} alt="" className="size-full object-cover" />
        ) : (
          initialsOf(displayName)
        )}
      </span>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-foreground">{displayName}</span>
        <span className="mt-0.5 block truncate text-[13.5px] text-sidebar-foreground">
          {setterName === null
            ? t("callRowUnassigned", { where })
            : t("callRowSetter", { where, setter: setterName || t("unknown") })}
        </span>
        <div className="mt-[7px] flex flex-wrap items-center gap-1.5">
          {status.kind === "past" ? (
            <span className={cn(CHIP, "bg-warning-soft text-warning")}>
              <CircleAlert />
              {t("callNoResult")}
            </span>
          ) : status.kind === "soon" ? (
            <span className={cn(CHIP, "bg-selected-strong text-primary")}>
              <Clock />
              {t("callIn", { duration: formatDuration(durationParts(status.inMs), t) })}
            </span>
          ) : (
            <span className={cn(CHIP, "border border-border bg-card text-sidebar-foreground")}>
              <CalendarClock />
              {t("callScheduled")}
            </span>
          )}
          {/* Sin closer: "Agendada" / "Reagendado" no dicen de quién es la llamada. */}
          {call.closer === null && (
            <span className={cn(CHIP, "bg-neutral-soft text-neutral")}>{t("callNoCloser")}</span>
          )}
        </div>
      </div>
    </button>
  );
}
