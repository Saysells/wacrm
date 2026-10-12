"use client";

import { useState, useCallback, useMemo } from "react";
import { matchesContactFilters } from "@/lib/inbox/conversations";
import type { InboxConversation } from "@/lib/inbox/inbox-conversation";
import { filterConversations, NO_LIST_FILTERS, type ListSelection } from "@/lib/inbox/vistas";
import {
  splitConversationTags,
  tagTint,
  visibleChips,
} from "@/lib/inbox/conversation-tags";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { ChevronDown, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

// Rediseño, sesión B (bloque 1): la lista ya no carga nada. Recibe la
// lista entera del store compartido y la selección (vista, grupo,
// búsqueda) que la página leyó de la URL; filtra con la misma lógica
// pura que usan los contadores de la barra lateral.
interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: InboxConversation[];
  loading: boolean;
  /** Etiquetas de la cuenta, para el filtro. */
  tags: Tag[];
  selection: Omit<ListSelection, "filters">;
  now: number;
  userId: string | null;
  onTakeNext: () => void;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};



type InboxFilter = ConversationStatus | "all" | "unread";

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations: allConversations,
  loading,
  tags,
  selection,
  now,
  userId,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  const conversations = useMemo(
    () =>
      filterConversations(
        allConversations,
        { ...selection, filters: NO_LIST_FILTERS },
        { userId, now },
      ),
    [allConversations, selection, userId, now],
  );
  // Con la barra lateral plegada sobran ~180px en la fila: la lista se
  // queda con una parte y con eso entran las etiquetas enteras. Abierta
  // no hay ancho y las secundarias se resumen en puntitos.
  const { collapsed: sidebarCollapsed } = useSidebarCollapsed();
  
  const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = useMemo(() => [
    { label: t("filterAll"), value: "all" },
    { label: t("filterUnread"), value: "unread" },
    { label: t("filterOpen"), value: "open" },
    { label: t("filterPending"), value: "pending" },
    { label: t("filterClosed"), value: "closed" },
  ], [t]);

  const [filter, setFilter] = useState<InboxFilter>("all");
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    return result;
  }, [conversations, filter, selectedTagIds, selectedCompany]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters = selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar — 384px con la barra lateral
    // plegada, que es el ancho que necesitan los chips de etiqueta.
    <div
      className={cn(
        "flex h-full w-full flex-col border-r border-border bg-card",
        sidebarCollapsed ? "lg:w-96" : "lg:w-80",
      )}
    >
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                {activeFilter?.label ?? t("filterAll")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedTagIds.length > 0
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("tags")}
                {selectedTagIds.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-sm text-popover-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? t("company")}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {t("allCompanies")}
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? t("tags")}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("clearAll")}
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                showTagChips={sidebarCollapsed}
                t={t}
              />
            ))}
          </div>
        )}
      </ScrollArea>

    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  /**
   * Con la barra lateral plegada la fila tiene ancho para pintar las
   * etiquetas secundarias como chips con su nombre; sin plegar, apenas
   * para un puntito por etiqueta.
   */
  showTagChips: boolean;
  t: ReturnType<typeof useTranslations>;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  showTagChips,
  t,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const initials = displayName.charAt(0).toUpperCase();
  // Etiquetas del contacto: la principal (la de estado, o la primera
  // sin grupo si no tiene estado) se ve siempre entera; las que alguien
  // puso a mano son chips o puntitos segun el ancho. Las del bot
  // ('origen', 'senal') no entran en la lista — eso lo decide
  // splitConversationTags. `contact.tags` viene hidratado por
  // CONVERSATION_SELECT, asi que esto no cuesta una consulta.
  const { principal, secundarias } = splitConversationTags(contact?.tags);
  const { chips, extra } = visibleChips(secundarias);

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
        isActive && "border-l-2 border-primary bg-muted/70"
      )}
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {displayName}
            </span>
            {principal && (
              // Chip chico y acotado (max-w) para que el nombre no
              // desaparezca en pantallas angostas.
              <span
                className="max-w-24 shrink-0 truncate rounded-full px-1.5 py-px text-[9px] font-semibold leading-4 text-white"
                style={{ backgroundColor: principal.color }}
                title={principal.name}
              >
                {principal.name}
              </span>
            )}
            {!showTagChips && secundarias.length > 0 && (
              // Barra abierta: no hay ancho para los nombres, asi que
              // cada etiqueta sin grupo es un punto de 8px de su color.
              // Sin tope, pero acotados en ancho: del sexto en adelante
              // bajan a un segundo renglon en vez de comerse el nombre
              // del contacto, que es lo que se busca al mirar la lista.
              <span className="flex max-w-24 shrink-0 flex-wrap items-center gap-1">
                {secundarias.map((tag) => (
                  <span
                    key={tag.id}
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                    title={tag.name}
                    aria-label={tag.name}
                  />
                ))}
              </span>
            )}
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.last_message_text || t("noMessagesYet")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>

        {/* Barra plegada: las secundarias van enteras, en su propio
            renglon. Abajo del preview y no al lado del nombre para no
            comerse el nombre cuando el contacto tiene varias. El
            renglon solo existe si hay etiquetas, asi que las filas sin
            etiqueta miden lo mismo que siempre. */}
        {showTagChips && secundarias.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {chips.map((tag) => (
              <span
                key={tag.id}
                className="max-w-32 truncate rounded-full px-1.5 py-px text-[9px] font-medium leading-4"
                style={{
                  backgroundColor: tagTint(tag.color),
                  color: tag.color,
                }}
                title={tag.name}
              >
                {tag.name}
              </span>
            ))}
            {extra > 0 && (
              <span
                className="rounded-full bg-muted px-1.5 py-px text-[9px] font-medium leading-4 text-muted-foreground"
                title={secundarias
                  .slice(chips.length)
                  .map((tag) => tag.name)
                  .join(", ")}
              >
                +{extra}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
