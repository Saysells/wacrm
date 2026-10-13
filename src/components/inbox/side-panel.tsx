"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpRight,
  Calendar,
  CalendarClock,
  CalendarX,
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  FilePen,
  Mail,
  Phone,
  Plus,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useInboxStore } from "@/hooks/use-inbox-store";
import { useCloser } from "@/hooks/use-closer";
import { useSaysellsSelector } from "@/hooks/use-saysells-selector";
import { usePresence } from "@/hooks/use-presence";
import { PresenceDot } from "@/components/presence/presence-dot";
import { presenceLabel } from "@/lib/presence";
import { canEditSettings, canSendMessages } from "@/lib/auth/roles";
import { DEFAULT_TAG_COLOR, PRESET_COLORS } from "@/lib/contacts/tag-colors";
import { findEstadoTag, sortByFunnel } from "@/lib/contacts/tag-groups";
import {
  attachTag,
  createAndAttachTag,
  detachTag,
  groupAssignableTags,
  TagCreateError,
} from "@/lib/inbox/contact-tags";
import { requestFromAction, requestFromEstado, type ScheduleRequest } from "@/lib/inbox/agendar";
import {
  CALL_OUTCOMES,
  PROPOSALS_URL,
  callDayHeading,
  callStatus,
  outcomeTag,
  showsCallCard,
  type CallOutcome,
} from "@/lib/inbox/closer";
import { loadContactFormValues, type ContactFieldValue } from "@/lib/inbox/contact-form-values";
import {
  contactOrigin,
  hasEmail,
  nonEstadoTags,
  tagChipLabel,
  upcomingCalls,
} from "@/lib/inbox/ficha";
import type { InboxConversation } from "@/lib/inbox/inbox-conversation";
import type { SideTab } from "@/lib/inbox/side-panel";
import { firstNameOf } from "@/lib/inbox/thread";
import {
  avatarColors,
  durationParts,
  estadoGroupOf,
  groupColor,
  hasScheduling,
  hhmm,
  initialsOf,
  pastWhen,
  scheduledCall,
  shortWhen,
  type ScheduledCall,
} from "@/lib/inbox/vistas";
import { formatDuration, formatPastWhen, formatShortWhen } from "@/lib/inbox/time-text";
import { tagTint } from "@/lib/inbox/conversation-tags";
import { cn } from "@/lib/utils";
import type { Contact, ContactNote, Deal, Tag } from "@/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// ============================================================
// Panel lateral de la Bandeja (rediseño, sesión D), prototipo `side()`:
// 330 px a la derecha del hilo con cuatro pestañas que elige el riel
// (`side-rail.tsx`): Ficha, Llamadas, Notas y Propuestas.
//
// La ficha lee el contacto de la FILA DEL STORE (`useInboxStore`), no
// de una consulta propia: la fila ya trae las etiquetas y la fecha de
// la llamada, y es la misma que pintan la lista, los contadores de la
// barra, la pestaña Llamadas y el encabezado del hilo. Después de
// escribir (etiqueta, estado, fecha), la ficha copia el resultado al
// store (`patchContact`) y relee la fila (`hydrate`): la base sigue
// siendo la fuente de verdad, y todo lo demás se actualiza sin
// recargar y sin esperar al realtime. Lo que cambia desde el CRM llega
// por el canal del store (contact_tags y contacts).
//
// Las escrituras son las de siempre: etiquetas por
// `/api/contacts/[id]/tags` (attachTag / detachTag), asignación con el
// UPDATE de `conversations.assigned_agent_id` que hacía "Asignar a…"
// del menú "Más", notas con el alta de la página. Un estado con fecha
// (y Agendar / Cambiar de la fila Llamada) no escribe acá: pide a la
// página que abra el modal "Agendar llamada" (`onSchedule`), que guarda
// primero la fecha y después la etiqueta.
// ============================================================

type Translator = ReturnType<typeof useTranslations>;

/** Botón redondo de 40 px del prototipo (`.ib`). */
const ICON_BUTTON =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-secondary-foreground transition-colors outline-none hover:bg-hover-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&_svg]:size-5";

/** Fila de un grupo (prototipo `.gr`). */
const ROW =
  "flex w-full items-center gap-2.5 border-b border-border/70 px-3.5 py-2.5 text-left text-[13.5px] text-foreground last:border-b-0";
const ROW_KEY = "w-[108px] shrink-0 text-secondary-foreground";
const ROW_VALUE = "flex min-w-0 flex-1 items-center gap-1.5 truncate";

/** Chip de estado o etiqueta (prototipo `.ch`): rectángulo de 5 px. */
const CHIP =
  "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-[5px] px-[7px] text-xs font-medium whitespace-nowrap [&>svg]:size-[13px] [&>svg]:shrink-0";

/** Acción rápida de la ficha (prototipo `.qa button`). */
const QUICK_ACTION =
  "flex flex-col items-center gap-[5px] text-[11.5px] text-secondary-foreground outline-none [&>i]:grid [&>i]:size-10 [&>i]:place-items-center [&>i]:rounded-full [&>i]:bg-selected [&>i]:text-primary [&>i>svg]:size-[17px] hover:[&>i]:bg-selected-strong focus-visible:[&>i]:ring-2 focus-visible:[&>i]:ring-ring";


/** Resultado registrado en esta conversación (vive hasta cambiar de hilo). */
interface RegisteredOutcome {
  conversationId: string;
  /** La llamada tal como estaba al registrar: la etiqueta de fecha ya no existe. */
  call: ScheduledCall;
  tag: Tag;
}

function Group({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-[14px] bg-muted", className)}>
      {title && (
        <div className="px-3.5 pt-2.5 pb-0.5 text-[12.5px] font-semibold text-muted-foreground">
          {title}
        </div>
      )}
      {children}
    </section>
  );
}

/** Avatar chico de 22 px con iniciales (prototipo `mini()`). */
function MiniAvatar({ name }: { name: string }) {
  const [bg, ink] = avatarColors(name || "?");
  return (
    <span
      aria-hidden="true"
      className="grid size-[22px] shrink-0 place-items-center rounded-full text-[8px] font-semibold"
      style={{ background: bg, color: ink }}
    >
      {initialsOf(name || "?")}
    </span>
  );
}

/** Círculo punteado de "Sin tomar" (prototipo `FREE`). */
function FreeAvatar() {
  return (
    <span
      aria-hidden="true"
      className="grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-[#9AA6B8] text-[#7A8699]"
    >
      <User className="size-3" />
    </span>
  );
}

export interface SidePanelProps {
  tab: SideTab;
  onClose: () => void;
  /** La fila del store de la conversación abierta (contacto con etiquetas y fecha), o null. */
  conversation: InboxConversation | null;
  /** Notas del contacto abierto, de la más vieja a la más nueva (las carga la página). */
  notes: ContactNote[];
  /** El alta de `contact_notes` de la página; devuelve si quedó guardada. */
  onSaveNote: (text: string) => Promise<boolean>;
  /** Avisa a la página que la asignación cambió (ya escrita en la base). */
  onAssignChange: (conversationId: string, agentId: string | null) => void;
  /** Pestaña Llamadas: abrir esa conversación. */
  onOpenConversation: (conversation: InboxConversation) => void;
  /** Abrir el modal "Agendar llamada" con ese pedido (fila Llamada, estados con fecha). */
  onSchedule: (request: ScheduleRequest) => void;
  now: number;
}

export function SidePanel({
  tab,
  onClose,
  conversation,
  notes,
  onSaveNote,
  onAssignChange,
  onOpenConversation,
  onSchedule,
  now,
}: SidePanelProps) {
  const t = useTranslations("Inbox.sidebar");
  const tList = useTranslations("Inbox.conversationList");
  const store = useInboxStore();

  // Tarjeta de la llamada (sesión E, prototipo `callc`): closer con la
  // llamada abierta suya o sin closer. Después de registrar un
  // resultado la etiqueta de fecha desaparece (la base saca la anterior),
  // así que la versión hecha se guarda acá hasta cambiar de conversación;
  // al recargar vuelve la ficha común, porque el resultado no tiene
  // dónde guardarse en la llamada.
  const { closer } = useCloser();
  const [registered, setRegistered] = useState<RegisteredOutcome | null>(null);
  const outcome = registered && registered.conversationId === conversation?.id ? registered : null;
  const call = conversation ? scheduledCall(conversation) : null;
  const callCard = outcome !== null || showsCallCard(closer, call);

  const title =
    tab === "calls"
      ? t("tabCalls")
      : tab === "notes"
        ? t("tabNotes")
        : tab === "props"
          ? t("tabProposals")
          : callCard
            ? t("tabCall")
            : t("tabFicha");

  return (
    <div className="flex h-full w-[330px] shrink-0 flex-col border-l border-border bg-card">
      {/* Encabezado (prototipo `.sh`): 60 px, título y cruz. */}
      <div className="flex h-[60px] shrink-0 items-center pr-3 pl-5">
        <h3 className="text-[17px] font-semibold text-foreground">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closePanel")}
          title={t("closePanel")}
          className={cn(ICON_BUTTON, "ml-auto")}
        >
          <X />
        </button>
      </div>

      {/* Cuerpo (prototipo `.sb`): scrollea; grupos separados por 12 px. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
        {tab === "calls" ? (
          <CallsTab
            conversations={store.conversations}
            activeId={conversation?.id ?? null}
            onOpen={onOpenConversation}
            now={now}
            t={t}
            tList={tList}
          />
        ) : tab === "props" ? (
          <ProposalsTab conversation={conversation} t={t} />
        ) : !conversation || !conversation.contact ? (
          <p className="px-3 py-12 text-center text-sm text-muted-foreground">
            {t("selectConversation")}
          </p>
        ) : tab === "notes" ? (
          <NotesGroup
            notes={notes}
            onSaveNote={onSaveNote}
            memberNames={store.memberNames}
            now={now}
            t={t}
            tList={tList}
          />
        ) : (
          <Ficha
            key={conversation.id}
            conversation={conversation}
            contact={conversation.contact}
            notes={notes}
            onSaveNote={onSaveNote}
            onAssignChange={onAssignChange}
            onSchedule={onSchedule}
            callCard={callCard}
            outcome={outcome}
            onOutcome={(tag, registeredCall) =>
              setRegistered({ conversationId: conversation.id, call: registeredCall, tag })
            }
            now={now}
            t={t}
            tList={tList}
          />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Ficha
// ------------------------------------------------------------

interface FichaProps {
  conversation: InboxConversation;
  contact: Contact;
  notes: ContactNote[];
  onSaveNote: (text: string) => Promise<boolean>;
  onAssignChange: (conversationId: string, agentId: string | null) => void;
  onSchedule: (request: ScheduleRequest) => void;
  /** Arriba va la tarjeta de la llamada (closer) en vez de la identidad. */
  callCard: boolean;
  /** Resultado ya registrado en esta conversación: la tarjeta va en su versión hecha. */
  outcome: RegisteredOutcome | null;
  onOutcome: (tag: Tag, call: ScheduledCall) => void;
  now: number;
  t: Translator;
  tList: Translator;
}

function Ficha({
  conversation,
  contact,
  notes,
  onSaveNote,
  onAssignChange,
  onSchedule,
  callCard,
  outcome,
  onOutcome,
  now,
  t,
  tList,
}: FichaProps) {
  const contactId = contact.id;
  // Los nombres de los colores ya viven en Configuración → Campos y
  // etiquetas; se reusan en vez de duplicar los ocho en tres idiomas.
  const tColors = useTranslations("Settings.tagsAndFields");
  const { user, accountId, accountRole } = useAuth();
  const store = useInboxStore();
  const { patchContact, addTag, hydrate } = store;
  const accountTags = store.tags;
  const { getPresence, getRow, now: presenceNow } = usePresence();
  const tThread = useTranslations("Inbox.messageThread");
  const saysells = useSaysellsSelector();

  // Poner/sacar etiquetas y asignar escriben con rol agent+ (la API de
  // etiquetas y el RLS de conversations). Un viewer ve la ficha y no
  // ve los controles, en vez de recibir un 403 al tocarlos.
  const canEdit = accountRole ? canSendMessages(accountRole) : false;
  // Crear una etiqueta es otra cosa: la RLS de `tags` pide admin+.
  const canCreateTags = accountRole ? canEditSettings(accountRole) : false;

  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [formValues, setFormValues] = useState<ContactFieldValue[]>([]);
  const [busy, setBusy] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState<string>(DEFAULT_TAG_COLOR);
  const [creatingTag, setCreatingTag] = useState(false);

  // Oportunidades y respuestas del formulario: lo único que la fila del
  // store no trae. Una lectura por contacto.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const [dealsRes, formRows] = await Promise.all([
        supabase
          .from("deals")
          .select("*, stage:pipeline_stages(*)")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false }),
        // El loader devuelve [] ante un error: la sección se oculta sola.
        loadContactFormValues(supabase, contactId),
      ]);
      if (cancelled) return;
      if (dealsRes.data) setDeals(dealsRes.data as Deal[]);
      setFormValues(formRows);
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const contactTags = useMemo(() => contact.tags ?? [], [contact.tags]);
  const estado = findEstadoTag(contactTags);
  const otherTags = nonEstadoTags(contactTags);
  const origin = contactOrigin(contactTags);
  const call = scheduledCall(conversation);
  const scheduling = hasScheduling(accountTags);
  const estadoOptions = useMemo(
    () => sortByFunnel(accountTags.filter((tag) => tag.grupo === "estado")),
    [accountTags],
  );
  const assignable = useMemo(
    () => groupAssignableTags(accountTags, contactTags).otras,
    [accountTags, contactTags],
  );
  const members = useMemo(
    () => [...store.memberNames.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [store.memberNames],
  );

  const displayName = contact.name || contact.phone;
  const firstName = firstNameOf(contact.name, contact.phone);
  const [avatarBg, avatarInk] = avatarColors(displayName);
  const assignedId = conversation.assigned_agent_id ?? null;
  const setterName = assignedId ? (store.memberNames.get(assignedId) ?? "") : null;

  /** Copia al store lo que la ficha escribió y relee la fila de la base. */
  const syncContact = useCallback(
    async (changes: Partial<Contact>) => {
      patchContact(contactId, changes);
      await hydrate(conversation.id);
    },
    [patchContact, hydrate, contactId, conversation.id],
  );

  const failToast = useCallback(
    (key: "tagUpdateFailed" | "assignFailed" | "outcomeFailed", err: unknown) => {
      const reason = err instanceof Error ? err.message : "";
      toast.error(reason ? `${t(key)}: ${reason}` : t(key));
    },
    [t],
  );

  const handleCopyPhone = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(contact.phone);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  }, [contact.phone, t]);

  const handleSetEstado = useCallback(
    async (tag: Tag) => {
      if (tag.id === estado?.id && !tag.requiere_fecha) return;
      // Etiqueta que pide fecha: no se aplica acá. Abre el modal de
      // agendar ("Agendado a X" con X marcado; "Agendada" / "Reagendado"
      // fijas; el estado actual abre Reagendar) y la etiqueta se aplica
      // allá, DESPUÉS de guardar la fecha.
      if (tag.requiere_fecha) {
        onSchedule(requestFromEstado(tag, estado, call));
        return;
      }
      setBusy(true);
      try {
        // attachTag persiste primero y recién después devuelve la lista
        // nueva; withTagAttached ya sacó el estado anterior (espejo del
        // trigger trg_single_etapa_tag). La base sigue siendo la verdad:
        // se relee.
        const attached = await attachTag(contactId, tag, contactTags);
        await syncContact({ tags: attached });
      } catch (err) {
        failToast("tagUpdateFailed", err);
      } finally {
        setBusy(false);
      }
    },
    [contactId, contactTags, estado, call, onSchedule, syncContact, failToast],
  );

  const handleAttachTag = useCallback(
    async (tag: Tag) => {
      setBusy(true);
      try {
        const attached = await attachTag(contactId, tag, contactTags);
        setTagPickerOpen(false);
        await syncContact({ tags: attached });
      } catch (err) {
        failToast("tagUpdateFailed", err);
      } finally {
        setBusy(false);
      }
    },
    [contactId, contactTags, syncContact, failToast],
  );

  const handleDetachTag = useCallback(
    async (tagId: string) => {
      setBusy(true);
      try {
        const attached = await detachTag(contactId, tagId, contactTags);
        await syncContact({ tags: attached });
      } catch (err) {
        failToast("tagUpdateFailed", err);
      } finally {
        setBusy(false);
      }
    },
    [contactId, contactTags, syncContact, failToast],
  );

  const handleCreateTag = useCallback(async () => {
    if (!accountId || !user) return;
    if (!newTagName.trim()) {
      toast.error(t("tagNameRequired"));
      return;
    }
    setCreatingTag(true);
    try {
      // Un solo paso: la fila queda en `tags` y la etiqueta aplicada al
      // contacto, por el mismo camino que usar una ya existente.
      const created = await createAndAttachTag({
        db: createClient(),
        accountId,
        userId: user.id,
        contactId,
        name: newTagName,
        color: newTagColor,
        accountTags,
        attached: contactTags,
      });
      addTag(created.tag);
      setNewTagName("");
      setNewTagColor(DEFAULT_TAG_COLOR);
      setTagPickerOpen(false);
      toast.success(t("tagCreated"));
      await syncContact({ tags: created.attached });
    } catch (err) {
      if (err instanceof TagCreateError) {
        if (err.code === "duplicate_name") toast.error(t("tagNameExists"));
        else if (err.code === "empty_name") toast.error(t("tagNameRequired"));
        else {
          // attach_failed: la fila YA existe en `tags`; entra al catálogo
          // igual para no perderla hasta el próximo fetch.
          if (err.tag) addTag(err.tag);
          toast.error(`${t("tagUpdateFailed")}: ${err.message}`);
        }
      } else {
        const reason = err instanceof Error ? err.message : "";
        toast.error(reason ? `${t("tagCreateFailed")}: ${reason}` : t("tagCreateFailed"));
      }
    } finally {
      setCreatingTag(false);
    }
  }, [accountId, user, newTagName, newTagColor, accountTags, contactTags, contactId, addTag, syncContact, t]);

  // Setter: el mismo UPDATE de `conversations.assigned_agent_id` que
  // hacía "Asignar a…" en el menú "Más" del hilo.
  const handleAssign = useCallback(
    async (agentId: string | null) => {
      if (agentId === assignedId) return;
      setBusy(true);
      try {
        const supabase = createClient();
        const { error } = await supabase
          .from("conversations")
          .update({ assigned_agent_id: agentId })
          .eq("id", conversation.id);
        if (error) throw new Error(error.message);
        onAssignChange(conversation.id, agentId);
      } catch (err) {
        failToast("assignFailed", err);
      } finally {
        setBusy(false);
      }
    },
    [assignedId, conversation.id, onAssignChange, failToast],
  );

  // Resultado de la llamada (prototipo `outcome()`): la etiqueta de
  // estado con ese nombre por `attachTag`, el camino de siempre; la base
  // saca la de fecha y el puente avisa al CRM. Propuesta además abre
  // propuestas.saysells.com en otra pestaña para el equipo de Saysells
  // (antes de esperar la red: el navegador bloquea pestañas tardías).
  const handleOutcome = useCallback(
    async (kind: CallOutcome) => {
      const tag = outcomeTag(accountTags, kind);
      if (!tag || !call) return;
      if (kind === "propuesta" && saysells.visible) {
        window.open(PROPOSALS_URL, "_blank", "noopener,noreferrer");
      }
      setBusy(true);
      try {
        const attached = await attachTag(contactId, tag, contactTags);
        onOutcome(tag, call);
        toast.success(t("outcomeRegistered", { outcome: tag.name }));
        await syncContact({ tags: attached });
      } catch (err) {
        failToast("outcomeFailed", err);
      } finally {
        setBusy(false);
      }
    },
    [accountTags, call, saysells.visible, contactId, contactTags, onOutcome, syncContact, failToast, t],
  );

  const createdAt = new Date(conversation.created_at).getTime();
  const showTagsGroup = otherTags.length > 0 || (canEdit && assignable.length > 0);

  // Tarjeta de la llamada (prototipo `.callc`): el día, la hora con "en
  // X" / "ya pasó" (o el resultado), nombre y empresa. Debajo, los
  // cuatro botones; solo los que tienen etiqueta en la cuenta.
  const cardCall = outcome?.call ?? call;
  const callCardNode = (() => {
    if (!callCard || !cardCall) return null;
    const heading = callDayHeading(cardCall.at, now);
    const weekdays = tThread("weekdaysLong").split(",");
    const months = tThread("months").split(",");
    const date = tThread("dayDate", {
      weekday: weekdays[heading.weekday] ?? "",
      day: heading.day,
      month: months[heading.month] ?? "",
    });
    const dayText =
      heading.relative === "today"
        ? tList("callDayToday", { date })
        : heading.relative === "tomorrow"
          ? tList("callDayTomorrow", { date })
          : heading.relative === "yesterday"
            ? tList("callDayYesterday", { date })
            : date.charAt(0).toUpperCase() + date.slice(1);
    const status = callStatus(cardCall.at, now);
    const suffix = outcome
      ? outcome.tag.name
      : status.kind === "past"
        ? t("callCardPast")
        : t("callCardIn", {
            duration: formatDuration(durationParts(cardCall.at - now), tList),
          });
    const outcomes = CALL_OUTCOMES.map((kind) => ({ kind, tag: outcomeTag(accountTags, kind) }));
    return (
      <>
        <div
          className={cn(
            "rounded-[14px] p-3.5",
            outcome ? "bg-muted text-foreground" : "bg-primary text-primary-foreground",
          )}
        >
          <div className={cn("flex items-center gap-1.5 text-[12.5px]", outcome ? "text-muted-foreground" : "opacity-75")}>
            <CalendarClock className="size-3.5 shrink-0" />
            {dayText}
          </div>
          <b className="mt-1 block text-xl font-semibold tabular-nums">
            {hhmm(cardCall.at)} · {suffix}
          </b>
          <div className={cn("mt-0.5 text-[13px]", outcome ? "text-secondary-foreground" : "opacity-85")}>
            {contact.company ? `${displayName} · ${contact.company}` : displayName}
          </div>
        </div>
        {!outcome && canEdit && (
          <div>
            <div className="mx-0.5 mb-2 text-[12.5px] font-semibold text-muted-foreground">
              {t("afterCall")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {outcomes[0].tag && (
                <OutcomeButton
                  label={outcomes[0].tag.name}
                  icon={<CircleCheck className="text-success" />}
                  disabled={busy}
                  onClick={() => void handleOutcome("realizada")}
                />
              )}
              <OutcomeButton
                label={t("outcomeReschedule")}
                icon={<CalendarClock className="text-warning" />}
                disabled={busy}
                onClick={() => onSchedule(requestFromAction(call))}
              />
              {outcomes[1].tag && (
                <OutcomeButton
                  label={outcomes[1].tag.name}
                  icon={<CalendarX className="text-danger" />}
                  disabled={busy}
                  onClick={() => void handleOutcome("no_se_presento")}
                />
              )}
              {outcomes[2].tag && (
                <OutcomeButton
                  label={outcomes[2].tag.name}
                  icon={<FilePen className="text-secondary-foreground" />}
                  disabled={busy}
                  onClick={() => void handleOutcome("propuesta")}
                />
              )}
            </div>
          </div>
        )}
      </>
    );
  })();

  return (
    <>
      {callCardNode ?? (
      /* Identidad (prototipo `.idt`): avatar de 72, nombre, empresa. */
      <div className="flex flex-col items-center px-1 pt-1 pb-0.5 text-center">
        <span
          aria-hidden="true"
          className="grid size-[72px] place-items-center overflow-hidden rounded-full text-[26px] font-semibold"
          style={{ background: avatarBg, color: avatarInk }}
        >
          {contact.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={contact.avatar_url} alt="" className="size-full object-cover" />
          ) : (
            initialsOf(displayName)
          )}
        </span>
        <b className="mt-2.5 max-w-full truncate text-lg font-semibold text-foreground">{displayName}</b>
        <span className="mt-px max-w-full truncate text-[13px] text-muted-foreground">
          {contact.company || t("noCompany")}
        </span>

        {/* Acciones rápidas (prototipo `.qa`). */}
        <div className="mt-3 flex justify-center gap-[18px]">
          <a href={`tel:${contact.phone}`} className={QUICK_ACTION}>
            <i>
              <Phone />
            </i>
            {t("call")}
          </a>
          <button type="button" onClick={() => void handleCopyPhone()} className={QUICK_ACTION}>
            <i>{copied ? <Check /> : <Copy />}</i>
            {copied ? t("copied") : t("copy")}
          </button>
          {hasEmail(contact.email) ? (
            <a href={`mailto:${contact.email}`} className={QUICK_ACTION}>
              <i>
                <Mail />
              </i>
              {t("email")}
            </a>
          ) : (
            <button
              type="button"
              disabled
              title={t("noEmail")}
              aria-label={`${t("email")}: ${t("noEmail")}`}
              className={cn(QUICK_ACTION, "cursor-not-allowed opacity-50")}
            >
              <i>
                <Mail />
              </i>
              {t("email")}
            </button>
          )}
        </div>
      </div>
      )}

      {/* Embudo: estado, setter y llamada. */}
      <Group title={t("funnel")}>
        {estadoOptions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={!canEdit || busy}
              className={cn(ROW, "transition-colors outline-none focus-visible:bg-hover", canEdit && "hover:bg-hover")}
            >
              <span className={ROW_KEY}>{t("estado")}</span>
              <span className={ROW_VALUE}>
                {estado ? (
                  <span
                    className={CHIP}
                    style={{
                      color: groupColor(estadoGroupOf(estado)),
                      background: tagTint(groupColor(estadoGroupOf(estado))),
                    }}
                  >
                    {estado.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t("noEstado")}</span>
                )}
              </span>
              {canEdit && <ChevronDown className="ml-auto size-[15px] shrink-0 text-muted-foreground" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[260px]">
              {/* DropdownMenuGroup es OBLIGATORIO alrededor de cada
                  DropdownMenuLabel (Menu.GroupLabel de base-ui, #336). */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  {firstName ? t("estadoOf", { name: firstName }) : t("estado")}
                </DropdownMenuLabel>
                {estadoOptions.map((tag) => {
                  const selected = tag.id === estado?.id;
                  return (
                    <DropdownMenuItem
                      key={tag.id}
                      onClick={() => void handleSetEstado(tag)}
                      className={cn(selected && "bg-selected")}
                    >
                      <span
                        aria-hidden="true"
                        className="size-[11px] shrink-0 rounded-[3px]"
                        style={{ background: groupColor(estadoGroupOf(tag)) }}
                      />
                      <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                      {tag.requiere_fecha && (
                        <Calendar
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-label={t("needsDate")}
                        />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!canEdit || busy}
            className={cn(ROW, "transition-colors outline-none focus-visible:bg-hover", canEdit && "hover:bg-hover")}
          >
            <span className={ROW_KEY}>{t("setter")}</span>
            <span className={ROW_VALUE}>
              {setterName === null ? (
                <>
                  <FreeAvatar />
                  <span className="text-muted-foreground">{t("unassigned")}</span>
                </>
              ) : (
                <>
                  <MiniAvatar name={setterName} />
                  <span className="truncate">{setterName}</span>
                </>
              )}
            </span>
            {canEdit && <ChevronDown className="ml-auto size-[15px] shrink-0 text-muted-foreground" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[240px]">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("assignTo")}</DropdownMenuLabel>
              {members.length === 0 ? (
                <DropdownMenuItem disabled>{t("noTeammates")}</DropdownMenuItem>
              ) : (
                members.map(([memberId, name]) => {
                  const selected = memberId === assignedId;
                  const presence = getPresence(memberId);
                  return (
                    <DropdownMenuItem
                      key={memberId}
                      onClick={() => void handleAssign(memberId)}
                      className={cn(selected && "bg-selected")}
                    >
                      <MiniAvatar name={name} />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <PresenceDot
                        status={presence}
                        label={presenceLabel(presence, getRow(memberId)?.last_seen_at ?? null, presenceNow)}
                      />
                      {memberId === user?.id && (
                        <span className="text-xs text-muted-foreground">{t("me")}</span>
                      )}
                      {selected && <Check className="size-4 text-muted-foreground" />}
                    </DropdownMenuItem>
                  );
                })
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void handleAssign(null)}
              className={cn(assignedId === null && "bg-selected")}
            >
              <FreeAvatar />
              {t("unassigned")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Llamada: solo si la cuenta tiene etiquetas de estado con fecha. */}
        {scheduling && (
          <div className={ROW}>
            <span className={ROW_KEY}>{t("callRow")}</span>
            {call ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 leading-tight">
                {call.closer && <MiniAvatar name={call.closer} />}
                <span className="min-w-0">
                  {call.closer && <span className="block truncate">{call.closer}</span>}
                  <span className={cn("block text-xs text-muted-foreground", !call.closer && "text-[13.5px] text-foreground")}>
                    {formatShortWhen(shortWhen(call.at, now), tList)}
                  </span>
                </span>
              </span>
            ) : (
              <span className={cn(ROW_VALUE, "text-muted-foreground")}>{t("callNone")}</span>
            )}
            {canEdit && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onSchedule(requestFromAction(call))}
                className="ml-auto shrink-0 font-semibold text-primary outline-none hover:underline focus-visible:underline disabled:opacity-50"
              >
                {call ? t("reschedule") : t("schedule")}
              </button>
            )}
          </div>
        )}
      </Group>

      {/* Etiquetas (prototipo `.tg2`): las que no son de estado, con la
          cruz para sacarlas, y "Agregar" con las que faltan. */}
      {showTagsGroup && (
        <Group title={t("tags")}>
          <div className="flex flex-wrap gap-1.5 px-3.5 pt-2 pb-3">
            {otherTags.map((tag) => {
              const label = tagChipLabel(tag);
              const text =
                label.kind === "plain"
                  ? label.name
                  : label.origin.kind === "ads"
                    ? t("tagOriginAds")
                    : label.origin.kind === "form"
                      ? t("tagOriginForm")
                      : t("tagOriginOther", { name: label.origin.name });
              return (
                <span
                  key={tag.id}
                  className={cn(CHIP, "border border-border bg-card pr-1 text-secondary-foreground")}
                  title={tag.name}
                >
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: tag.color }}
                  />
                  <span className="max-w-[160px] truncate">{text}</span>
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={t("removeTag")}
                      title={t("removeTag")}
                      disabled={busy}
                      onClick={() => void handleDetachTag(tag.id)}
                      className="grid place-items-center rounded-sm opacity-70 transition-opacity hover:opacity-100 disabled:opacity-30"
                    >
                      <X className="size-[13px]" />
                    </button>
                  ) : (
                    <span className="w-1" />
                  )}
                </span>
              );
            })}
            {canEdit && (
              <Popover open={tagPickerOpen} onOpenChange={setTagPickerOpen}>
                <PopoverTrigger className="inline-flex h-[22px] items-center gap-1 rounded-[5px] border border-dashed border-[#B7C1CE] px-1.5 text-[12.5px] text-secondary-foreground transition-colors outline-none hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  <Plus className="size-[13px]" />
                  {t("addTagShort")}
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-0">
                  {assignable.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                      {t("noTagsAvailable")}
                    </p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto py-1">
                      <p className="px-3 pt-1.5 pb-1 text-[12.5px] font-semibold text-muted-foreground">
                        {t("addTag")}
                      </p>
                      {assignable.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          disabled={busy}
                          onClick={() => void handleAttachTag(tag)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-popover-foreground transition-colors hover:bg-hover disabled:opacity-50"
                        >
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="truncate">{tag.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Crear una etiqueta sin cortar el hilo: queda aplicada
                      al contacto en el mismo paso. Solo admin+ (RLS). */}
                  {canCreateTags && (
                    <div className="space-y-2 border-t border-border p-2.5">
                      <p className="text-[12.5px] font-semibold text-muted-foreground">{t("createTag")}</p>
                      <Input
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleCreateTag();
                        }}
                        placeholder={t("createTagPlaceholder")}
                        disabled={creatingTag}
                        maxLength={40}
                        className="h-8 text-xs"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_COLORS.map((color) => (
                          <button
                            key={color.value}
                            type="button"
                            onClick={() => setNewTagColor(color.value)}
                            aria-label={tColors("useColor", {
                              color: tColors(`colors.${color.name}` as Parameters<typeof tColors>[0]),
                            })}
                            aria-pressed={newTagColor === color.value}
                            className={cn(
                              "size-5 rounded-md transition-transform hover:scale-110",
                              newTagColor === color.value && "outline-2 outline-offset-2 outline-primary",
                            )}
                            style={{ backgroundColor: color.value }}
                          />
                        ))}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-full text-xs"
                        disabled={creatingTag || !newTagName.trim()}
                        onClick={() => void handleCreateTag()}
                      >
                        <Plus />
                        {t("createTagAction")}
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            )}
          </div>
        </Group>
      )}

      {/* Origen: "Llegó por" solo con etiqueta de origen; "Primer
          mensaje" es conversations.created_at. */}
      <Group title={t("origin")}>
        {origin && (
          <div className={ROW}>
            <span className={ROW_KEY}>{t("arrivedBy")}</span>
            <span className={ROW_VALUE}>
              {origin.kind === "ads" ? t("originAds") : origin.kind === "form" ? t("originForm") : origin.name}
            </span>
          </div>
        )}
        <div className={ROW}>
          <span className={ROW_KEY}>{t("firstMessage")}</span>
          <span className={cn(ROW_VALUE, "tabular-nums")}>
            {Number.isNaN(createdAt) ? "" : formatPastWhen(pastWhen(createdAt, now), tList)}
          </span>
        </div>
      </Group>

      {/* Datos del formulario: solo lectura (se editan en Contactos). */}
      {formValues.length > 0 && (
        <Group title={t("formData")}>
          {formValues.map((field) => (
            <div key={field.fieldId} className={cn(ROW, "items-start")}>
              <span className={cn(ROW_KEY, "break-words")}>{field.name}</span>
              <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{field.value}</span>
            </div>
          ))}
        </Group>
      )}

      {/* Oportunidades. */}
      <Group title={t("deals")}>
        {deals.length === 0 ? (
          <p className="px-3.5 pt-1 pb-2.5 text-[13.5px] text-muted-foreground">{t("noDeals")}</p>
        ) : (
          deals.map((deal) => (
            <div key={deal.id} className={ROW}>
              <span className="min-w-0 flex-1 truncate font-medium">{deal.title}</span>
              <span className="shrink-0 text-secondary-foreground tabular-nums">
                {deal.currency ?? "$"}
                {deal.value.toLocaleString()}
              </span>
              {deal.stage && (
                <span
                  className={CHIP}
                  style={{ backgroundColor: tagTint(deal.stage.color), color: deal.stage.color }}
                >
                  {deal.stage.name}
                </span>
              )}
            </div>
          ))
        )}
      </Group>

      <NotesGroup
        notes={notes}
        onSaveNote={onSaveNote}
        memberNames={store.memberNames}
        now={now}
        t={t}
        tList={tList}
      />

    </>
  );
}

/** Botón de resultado de la llamada (prototipo `.oc`). */
function OutcomeButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-[13.5px] font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&>svg]:size-[17px] [&>svg]:shrink-0"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

// ------------------------------------------------------------
// Notas (grupo de la ficha y pestaña Notas)
// ------------------------------------------------------------

interface NotesGroupProps {
  notes: ContactNote[];
  onSaveNote: (text: string) => Promise<boolean>;
  memberNames: ReadonlyMap<string, string>;
  now: number;
  t: Translator;
  tList: Translator;
}

function NotesGroup({ notes, onSaveNote, memberNames, now, t, tList }: NotesGroupProps) {
  const { accountRole } = useAuth();
  // RLS de contact_notes: agent+. El viewer ve las notas y no el cuadro.
  const canWrite = accountRole ? canSendMessages(accountRole) : false;
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      if (await onSaveNote(trimmed)) setText("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Group title={t("notes")}>
      {notes.length === 0 && (
        <p className="px-3.5 pt-1 pb-2.5 text-[13.5px] text-muted-foreground">{t("noNotes")}</p>
      )}
      {notes.map((note) => {
        const at = new Date(note.created_at).getTime();
        const author = memberNames.get(note.user_id);
        // Las notas son pasado: "hoy 16:00", "ayer 10:00", "12 oct, 17:30" (sesión F1).
        const when = Number.isNaN(at) ? "" : formatPastWhen(pastWhen(at, now), tList);
        return (
          <div
            key={note.id}
            className="border-b border-border/70 px-3.5 pt-2 pb-2.5 text-[13.5px] leading-[1.45] break-words whitespace-pre-wrap text-foreground last:border-b-0"
          >
            {note.note_text}
            <small className="mt-0.5 block text-xs text-muted-foreground">
              {author ? t("noteMeta", { author, when }) : when}
            </small>
          </div>
        );
      })}
      {canWrite && (
        <form onSubmit={(e) => void submit(e)} className="m-2.5 flex gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("addNotePlaceholder")}
            autoComplete="off"
            disabled={saving}
            aria-label={t("addNote")}
            className="h-[34px] min-w-0 flex-1 rounded-[10px] border border-border bg-card px-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
          />
          <Button type="submit" size="sm" aria-label={t("addNote")} disabled={saving || !text.trim()}>
            <Plus />
          </Button>
        </form>
      )}
    </Group>
  );
}

// ------------------------------------------------------------
// Llamadas
// ------------------------------------------------------------

interface CallsTabProps {
  conversations: InboxConversation[];
  activeId: string | null;
  onOpen: (conversation: InboxConversation) => void;
  now: number;
  t: Translator;
  tList: Translator;
}

function CallsTab({ conversations, activeId, onOpen, now, t, tList }: CallsTabProps) {
  const calls = useMemo(() => upcomingCalls(conversations), [conversations]);
  return (
    <>
      <Group>
        {calls.length === 0 ? (
          <p className="px-3.5 py-2.5 text-[13.5px] text-muted-foreground">{t("callsEmpty")}</p>
        ) : (
          calls.map(({ conversation, call }) => {
            const name = conversation.contact?.name || conversation.contact?.phone || "";
            const when = formatShortWhen(shortWhen(call.at, now), tList);
            const active = conversation.id === activeId;
            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onOpen(conversation)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 border-b border-border/70 px-3.5 py-2.5 text-left text-[13.5px] text-foreground transition-colors outline-none last:border-b-0 hover:bg-hover focus-visible:bg-hover",
                  active && "bg-selected hover:bg-selected",
                )}
              >
                <span className="w-12 shrink-0 font-semibold tabular-nums">{hhmm(call.at)}</span>
                <span className="min-w-0">
                  <b className="block truncate font-semibold">{name}</b>
                  <small className="block text-xs text-muted-foreground">
                    {call.closer ? t("callWith", { when, closer: call.closer }) : when}
                  </small>
                </span>
              </button>
            );
          })
        )}
      </Group>
      <p className="px-1 text-[12.5px] text-muted-foreground">{t("callsFooter")}</p>
    </>
  );
}

// ------------------------------------------------------------
// Propuestas
// ------------------------------------------------------------

function ProposalsTab({ conversation, t }: { conversation: InboxConversation | null; t: Translator }) {
  const firstName = firstNameOf(conversation?.contact?.name, conversation?.contact?.phone);
  return (
    <div className="px-2 py-7 text-center text-sm leading-normal text-muted-foreground">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-selected text-primary">
        <FilePen className="size-[26px]" strokeWidth={1.8} />
      </div>
      <b className="mt-3 mb-1 block text-base font-semibold text-foreground">
        {firstName ? t("proposalsOf", { name: firstName }) : t("proposalsOfContact")}
      </b>
      {t("proposalsBody")}
      <div className="mt-3.5">
        <Button
          variant="outline"
          size="sm"
          render={<a href={PROPOSALS_URL} target="_blank" rel="noopener noreferrer" />}
        >
          <ArrowUpRight />
          {t("openProposals")}
        </Button>
      </div>
    </div>
  );
}
