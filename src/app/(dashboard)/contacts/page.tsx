'use client';

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  Plus,
  Upload,
  Download,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Tag as TagIcon,
  UserRoundPlus,
  IdCard,
  X,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import { MiniAvatar, NameAvatar, UnassignedMark } from '@/components/inbox/avatars';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { useNow } from '@/hooks/use-now';
import { effectivePermission } from '@/lib/auth/permissions';
import {
  contactExclusionList,
  hiddenContactIds,
} from '@/lib/auth/visibility';
import {
  EMPTY_FILTER,
  contactGroup,
  conversationHref,
  conversationsByContact,
  filterKind,
  filterOptions,
  filterTagIds,
  hasGroup,
  isFilterEmpty,
  pruneFilter,
  selectedOtherTags,
  showsEstadoColumn,
  showsFilter,
  showsOrigenColumn,
  toggleGroup,
  toggleTag,
  type ContactConversation,
  type ContactFilter,
} from '@/lib/contacts/contactos';
import { contactOrigin, tagChipLabel } from '@/lib/inbox/ficha';
import { groupColor, relativeTime } from '@/lib/inbox/vistas';
import { tagTint } from '@/lib/inbox/conversation-tags';
import { formatRelative } from '@/lib/inbox/time-text';
import { GatedButton } from '@/components/ui/gated-button';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

const PAGE_SIZE = 25;

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

// ============================================================
// Contactos (rediseño, sesión F1), prototipo `contactos()`: encabezado
// con el contador, barra con el filtro y el buscador, tabla con Nombre,
// Teléfono, Estado, Origen, Setter y Último mensaje; el clic en la fila
// abre la conversación en la Bandeja. Lo que el prototipo no dibuja
// (casillas, borrar varios, menú Más, paginación) se queda con el
// diseño nuevo. La lógica está en `src/lib/contacts/contactos.ts`.
// ============================================================

/** Botón desplegable de la barra (prototipo `.ddb`): 32 px, borde, radio 8. */
const DDB =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-[15px] [&>svg]:text-muted-foreground';

/** Chip de estado (prototipo `.ch`, el mismo de la tercera línea de la lista). */
const CHIP =
  'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-[5px] px-[7px] text-xs font-medium whitespace-nowrap';

/** Celda de encabezado (prototipo `.tbl th`): pegada arriba, 40 px. */
const TH =
  'sticky top-0 z-[1] h-10 border-b border-border bg-card px-3.5 text-left text-[12.5px] font-semibold whitespace-nowrap text-muted-foreground';

/** Celda (prototipo `.tbl td`): 46 px. */
const TD =
  'h-[46px] border-b border-border/60 px-3.5 whitespace-nowrap transition-colors group-hover:bg-hover';

/** Casilla del menú del filtro (prototipo `.cb`): cuadrado de 16 px. */
const CB =
  'grid size-4 shrink-0 place-items-center rounded-[4px] border-[1.5px] border-[#A7B1C0] text-white data-[on=true]:border-primary data-[on=true]:bg-primary';

// `?q=` (rediseño, sesión A): el buscador de la barra superior manda a
// Contactos con la búsqueda aplicada. `useSearchParams` pide un
// Suspense o el build de producción se cae ("missing Suspense with CSR
// bailout"), igual que en Configuración. El `key` por `q` remonta la
// pantalla cuando cambia la búsqueda desde la barra estando ya acá, así
// el estado local arranca de la URL sin un efecto que lo sincronice.
export default function ContactsPage() {
  return (
    <Suspense fallback={null}>
      <ContactsPageFromQuery />
    </Suspense>
  );
}

function ContactsPageFromQuery() {
  const searchParams = useSearchParams();
  const q = searchParams.get('q') ?? '';
  return <ContactsPageInner key={q} initialSearch={q} />;
}

function ContactsPageInner({ initialSearch }: { initialSearch: string }) {
  const t = useTranslations('Contacts.page');
  const tList = useTranslations('Inbox.conversationList');
  const tSide = useTranslations('Inbox.sidebar');
  const router = useRouter();
  const supabase = createClient();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');
  const canExport = useCan('export-contacts');
  const { user, accountRole, permissionOverrides, profileLoading } = useAuth();
  const userId = user?.id ?? null;
  // Setter de cada fila: los nombres del store, ya montado en todo el
  // dashboard (una lectura de `profiles` para toda la app).
  const { memberNames } = useInboxStore();
  const now = useNow();
  // Sin view_all_data efectivo, los contactos con hilo de otro se
  // ocultan (mismo motor que la bandeja; ver visibility.ts).
  const viewsAllData =
    accountRole !== null &&
    effectivePermission(accountRole, permissionOverrides, 'view_all_data');

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [conversations, setConversations] = useState<Map<string, ContactConversation>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  // Filtro (prototipo `S.cFilter`): grupos del embudo y otras etiquetas.
  const [filter, setFilter] = useState<ContactFilter>(EMPTY_FILTER);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection (page-scoped — only the loaded rows are selectable)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Todas las etiquetas de la cuenta (RLS), por id: para pintar las de
  // cada fila y para armar el filtro y las columnas.
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});
  const accountTags = useMemo(() => Object.values(tagsMap), [tagsMap]);
  const options = useMemo(() => filterOptions(accountTags), [accountTags]);
  const hasFilter = showsFilter(options);
  const showEstado = showsEstadoColumn(accountTags);
  const showOrigen = showsOrigenColumn(accountTags);
  // Los ids que van a la RPC: un grupo = todas sus etiquetas de estado.
  const filterIds = useMemo(() => filterTagIds(filter, options), [filter, options]);
  const filterIdsKey = filterIds.join(',');

  // Guards against out-of-order fetch responses: each fetchContacts run
  // claims a sequence number and only the latest is allowed to commit its
  // results. Without this, rapidly toggling tag filters could let a slower
  // earlier request resolve last and render stale rows.
  const fetchSeq = useRef(0);

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
      // Lo marcado que ya no existe (una etiqueta borrada en otro lado)
      // sale del filtro, para que no quede filtrando por algo invisible.
      setFilter((prev) => pruneFilter(prev, filterOptions(Object.values(map))));
    }
  }, [supabase]);

  const fetchContacts = useCallback(async () => {
    // The agent visibility filter below needs the resolved role; the
    // effect refires when profileLoading settles.
    if (profileLoading) return;

    const seq = ++fetchSeq.current;
    setLoading(true);
    // The visible rows are about to change — drop any selection that
    // referred to the old page/search results so the bulk bar can't
    // act on rows the user can no longer see.
    setSelected(new Set());

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = search.trim();
    const tagIds = filterIdsKey ? filterIdsKey.split(',') : [];

    // Quien no tiene view_all_data efectivo no ve contactos cuyo hilo
    // pertenece a otro (la propiedad se deriva de
    // conversations.assigned_agent_id — contacts no tiene asignación).
    // Para el resto queda null y no se filtra nada. Además del filtro
    // de query, el RLS de la migración 040/041 rechaza esas filas.
    let exclusion: string | null = null;
    let hiddenSet: Set<string> | null = null;
    if (!viewsAllData && userId) {
      const { data: assignedRows, error: assignedErr } = await supabase
        .from('conversations')
        .select('contact_id, assigned_agent_id')
        .not('assigned_agent_id', 'is', null)
        .neq('assigned_agent_id', userId);
      if (seq !== fetchSeq.current) return;
      if (assignedErr) {
        toast.error(t('toastFailedLoad'));
        setLoading(false);
        return;
      }
      const hidden = hiddenContactIds(assignedRows ?? [], userId);
      exclusion = contactExclusionList(hidden);
      hiddenSet = new Set(hidden);
    }

    let contactRows: Contact[];
    let count: number;

    if (tagIds.length > 0) {
      // Tag filter active — resolve it server-side (join + distinct +
      // windowed total count + pagination) so a tag covering many
      // contacts can't silently truncate the result or overflow an IN
      // clause. See migration 025_filter_contacts_by_tags.
      const { data, error } = await supabase.rpc('filter_contacts_by_tags', {
        p_tag_ids: tagIds,
        p_search: term || null,
        p_limit: PAGE_SIZE,
        p_offset: from,
      });
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error(t('toastFailedLoad'));
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as { contact: Contact; total_count: number }[];
      contactRows = rows.map((r) => r.contact);
      count = rows.length > 0 ? Number(rows[0].total_count) : 0;
      // The RPC can't take an exclusion list, so the agent filter is
      // applied to the returned page. The total may overcount hidden
      // contacts under a tag filter — acceptable for now (see
      // CLAUDE.md → Roles y permisos → Pendientes).
      if (hiddenSet) {
        contactRows = contactRows.filter((c) => !hiddenSet.has(c.id));
      }
    } else {
      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (exclusion) {
        query = query.not('id', 'in', exclusion);
      }

      if (term) {
        const like = `%${term}%`;
        query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`);
      }

      const { data, count: exactCount, error } = await query;
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error(t('toastFailedLoad'));
        setLoading(false);
        return;
      }
      contactRows = data ?? [];
      count = exactCount ?? 0;
    }

    setTotalCount(count);

    if (contactRows.length === 0) {
      setContacts([]);
      setConversations(new Map());
      setLoading(false);
      return;
    }

    // Las etiquetas y la conversación de los contactos de la página,
    // en la misma corrida y con su número: una consulta por tabla, no
    // una por fila.
    const contactIds = contactRows.map((c) => c.id);
    const [{ data: contactTags }, { data: convRows }] = await Promise.all([
      supabase
        .from('contact_tags')
        .select('contact_id, tag_id')
        .in('contact_id', contactIds),
      supabase
        .from('conversations')
        .select('id, contact_id, status, assigned_agent_id, last_message_at')
        .in('contact_id', contactIds),
    ]);
    if (seq !== fetchSeq.current) return; // superseded by a newer fetch

    const tagsByContact: Record<string, string[]> = {};
    contactTags?.forEach((ct) => {
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(ct.tag_id);
    });

    const enriched: ContactWithTags[] = contactRows.map((c) => ({
      ...c,
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));

    setContacts(enriched);
    setConversations(conversationsByContact((convRows ?? []) as ContactConversation[]));
    setLoading(false);
  }, [supabase, page, search, filterIdsKey, tagsMap, t, profileLoading, viewsAllData, userId]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContacts();
  }, [fetchContacts]);

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string) {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }

  // Prototipo `openContact`: la fila abre su conversación en la
  // Bandeja; sin conversación, la ficha de siempre.
  function openRow(contact: Contact) {
    const href = conversationHref(conversations.get(contact.id));
    if (href) router.push(href);
    else openDetail(contact.id);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error(t('toastFailedDelete'));
    } else {
      toast.success(t('toastDeleted'));
      fetchContacts();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  const allOnPageSelected =
    contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const someOnPageSelected = contacts.some((c) => selected.has(c.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        contacts.forEach((c) => next.delete(c.id));
      } else {
        contacts.forEach((c) => next.add(c.id));
      }
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);

    const { error } = await supabase.from('contacts').delete().in('id', ids);

    if (error) {
      toast.error(t('toastBulkFailedDelete'));
    } else {
      toast.success(t('toastBulkDeleted', { count: ids.length }));
      setSelected(new Set());
      fetchContacts();
    }

    setDeleting(false);
    setBulkDeleteOpen(false);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  // Cada cambio del filtro vuelve a la página 0: el resultado crece o
  // se achica y la página N puede no existir (igual que el buscador).
  function onToggleGroup(group: string) {
    setFilter((prev) => toggleGroup(prev, group));
    setPage(0);
  }

  function onToggleTag(tagId: string) {
    setFilter((prev) => toggleTag(prev, tagId));
    setPage(0);
  }

  function clearFilter() {
    setFilter(EMPTY_FILTER);
    setPage(0);
  }

  const kind = filterKind(filter);
  const filterLabel =
    kind === 'estado'
      ? t('filterKindEstado')
      : kind === 'etiqueta'
        ? t('filterKindTag')
        : t('filterKindBoth');
  // Lo marcado, en el chip: grupos y etiquetas como se rotulan en la ficha.
  const filterSummary = [
    ...filter.groups,
    ...selectedOtherTags(filter, options).map((tag) => chipLabelText(tag)),
  ].join(', ');

  function chipLabelText(tag: Tag): string {
    const label = tagChipLabel(tag);
    if (label.kind === 'plain') return label.name;
    if (label.origin.kind === 'ads') return tSide('tagOriginAds');
    if (label.origin.kind === 'form') return tSide('tagOriginForm');
    return tSide('tagOriginOther', { name: label.origin.name });
  }

  const hasActiveFilters = search.trim().length > 0 || !isFilterEmpty(filter);
  const columnCount = 5 + (showEstado ? 1 : 0) + (showOrigen ? 1 : 0);

  const filterMenu = (
    <DropdownMenuContent align="start" className="w-[270px] max-w-[calc(100vw-24px)]">
      {/* Todo rótulo dentro de su DropdownMenuGroup (base-ui). */}
      {options.groups.length > 0 && (
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('filterHeading')}</DropdownMenuLabel>
          {options.groups.map((group) => {
            const on = hasGroup(filter, group.name);
            return (
              <DropdownMenuCheckboxItem
                key={group.name}
                checked={on}
                onCheckedChange={() => onToggleGroup(group.name)}
                className="pr-4 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden"
              >
                <span aria-hidden="true" data-on={on} className={CB}>
                  {on && <CheckMark />}
                </span>
                <span
                  className={CHIP}
                  style={{ color: group.color, background: tagTint(group.color) }}
                >
                  {group.name}
                </span>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
      )}
      {options.groups.length > 0 && options.others.length > 0 && <DropdownMenuSeparator />}
      {options.others.length > 0 && (
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('filterOthers')}</DropdownMenuLabel>
          {options.others.map((tag) => {
            const on = filter.tagIds.includes(tag.id);
            return (
              <DropdownMenuCheckboxItem
                key={tag.id}
                checked={on}
                onCheckedChange={() => onToggleTag(tag.id)}
                className="pr-4 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden"
              >
                <span aria-hidden="true" data-on={on} className={CB}>
                  {on && <CheckMark />}
                </span>
                <span
                  className={cn(CHIP, 'max-w-[190px] truncate')}
                  style={{ color: tag.color, background: tagTint(tag.color) }}
                  title={chipLabelText(tag)}
                >
                  {chipLabelText(tag)}
                </span>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
      )}
    </DropdownMenuContent>
  );

  return (
    // Ocupa la tarjeta entera (como la Bandeja): el encabezado y la
    // barra quedan fijos y la tabla scrollea sola (prototipo `.tw`).
    <div className="-m-4 flex h-[calc(100%+2rem)] flex-col overflow-hidden sm:-m-6 sm:h-[calc(100%+3rem)]">
      {/* Encabezado (prototipo `.ctop`). */}
      <div className="flex flex-wrap items-center gap-2.5 px-6 pt-5 pb-3.5">
        <h1 className="text-[22px] font-semibold text-foreground">{t('title')}</h1>
        {!loading && (
          <span className="mt-1 ml-1 text-sm tabular-nums text-muted-foreground">{totalCount}</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canEditSettings && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCustomFieldsOpen(true)}
              title={t('customFieldsBtn')}
              aria-label={t('customFieldsBtn')}
            >
              <SlidersHorizontal />
            </Button>
          )}
          <GatedButton
            variant="outline"
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={() => setImportOpen(true)}
          >
            <Upload />
            {t('importBtn')}
          </GatedButton>
          {canExport && (
            // Admin+ only (can_export_contacts) — and the endpoint refuses
            // agents with 403 on its own, so hiding this is UX, not the
            // security boundary.
            <Button
              variant="outline"
              onClick={() => window.location.assign('/api/contacts/export')}
            >
              <Download />
              {t('exportBtn')}
            </Button>
          )}
          <GatedButton
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={openAddForm}
          >
            <UserRoundPlus />
            {t('addContactBtn')}
          </GatedButton>
        </div>
      </div>

      {/* Barra (prototipo `.ctb2`): filtro a la izquierda, buscador a la derecha. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 pb-3.5">
        {hasFilter && (
          <DropdownMenu>
            {/* UN solo disparador, estable: con el menú abierto, marcar la
                primera opción lo convierte de botón en chip (prototipo
                `.ddb` → `.fchip`) sin desmontarlo, así base-ui no pierde
                el ancla ni cierra el menú. La cruz queda afuera. */}
            <div
              className={cn(
                kind === null
                  ? 'contents'
                  : 'flex h-8 min-w-0 items-center overflow-hidden rounded-lg border border-border bg-card text-[13px]',
              )}
            >
              <DropdownMenuTrigger
                className={cn(
                  kind === null
                    ? DDB
                    : 'flex h-full min-w-0 items-center text-left outline-none focus-visible:bg-muted [&>span]:flex [&>span]:h-full [&>span]:items-center [&>span]:gap-1.5 [&>span]:border-r [&>span]:border-border [&>span]:px-2.5',
                )}
              >
                {kind === null ? (
                  <>
                    <Plus />
                    {t('filterByState')}
                  </>
                ) : (
                  <>
                    <span className="text-secondary-foreground [&>svg]:size-3.5 [&>svg]:text-muted-foreground">
                      <TagIcon />
                      {filterLabel}
                    </span>
                    <span className="text-muted-foreground">{t('filterIsAnyOf')}</span>
                    <span className="min-w-0 max-w-[360px] text-foreground hover:bg-muted" title={filterSummary}>
                      <span className="truncate">{filterSummary}</span>
                    </span>
                  </>
                )}
              </DropdownMenuTrigger>
              {kind !== null && (
                <button
                  type="button"
                  onClick={clearFilter}
                  title={t('filterRemove')}
                  aria-label={t('filterRemove')}
                  className="flex h-full items-center px-2.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted [&>svg]:size-3.5"
                >
                  <X />
                </button>
              )}
            </div>
            {filterMenu}
          </DropdownMenu>
        )}
        <label className="ml-auto flex h-8 w-60 max-w-full items-center gap-2 rounded-lg border border-border px-2.5 text-muted-foreground focus-within:border-ring">
          <Search className="size-[15px] shrink-0" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              // Reset pagination when the query changes — the result
              // set shrinks/grows, page N may no longer be valid.
              setPage(0);
            }}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-4 border-b border-border bg-selected px-6 py-1.5">
          <p className="text-sm text-foreground">
            {t('selectedCount', { count: selected.size })}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {t('clearSelection')}
            </Button>
            <GatedButton
              variant="destructive"
              size="sm"
              canAct={canEdit}
              gateReason="delete contacts"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 />
              {t('deleteSelected')}
            </GatedButton>
          </div>
        </div>
      )}

      {/* Tabla (prototipo `.tw` + `.tbl`). */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th className={cn(TH, 'w-10 pr-0')}>
                <Checkbox
                  checked={allOnPageSelected}
                  indeterminate={!allOnPageSelected && someOnPageSelected}
                  onCheckedChange={toggleSelectAll}
                  disabled={contacts.length === 0}
                  aria-label={t('selectAll')}
                />
              </th>
              <th className={TH}>{t('tableColumns.name')}</th>
              <th className={TH}>{t('tableColumns.phone')}</th>
              {showEstado && <th className={TH}>{t('tableColumns.state')}</th>}
              {showOrigen && <th className={TH}>{t('tableColumns.origin')}</th>}
              <th className={TH}>{t('tableColumns.setter')}</th>
              <th className={TH}>{t('tableColumns.lastMessage')}</th>
              <th className={cn(TH, 'w-12')} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columnCount} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">{t('loading')}</p>
                  </div>
                </td>
              </tr>
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="h-20 py-12 text-center">
                  {hasActiveFilters ? (
                    <p className="text-sm text-muted-foreground">{t('noContactsFilter')}</p>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Users className="size-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t('noContactsYet')}</p>
                      <GatedButton
                        canAct={canEdit}
                        gateReason="add or import contacts"
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="mt-2"
                      >
                        <Plus />
                        {t('addFirstContact')}
                      </GatedButton>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              contacts.map((contact) => {
                const name = contact.name?.trim() || '';
                const group = contactGroup(contact.tags);
                const origin = contactOrigin(contact.tags);
                const conv = conversations.get(contact.id);
                const setterName = conv?.assigned_agent_id
                  ? (memberNames.get(conv.assigned_agent_id) ?? '')
                  : null;
                const lastAt = conv?.last_message_at ? new Date(conv.last_message_at).getTime() : NaN;
                return (
                  <tr
                    key={contact.id}
                    onClick={() => openRow(contact)}
                    className="group cursor-pointer"
                  >
                    <td className={cn(TD, 'w-10 pr-0')} onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(contact.id)}
                        onCheckedChange={() => toggleSelect(contact.id)}
                        aria-label={t('selectOne', { name: name || contact.phone })}
                      />
                    </td>
                    <td className={cn(TD, 'font-semibold text-foreground')}>
                      <div className="flex items-center gap-2.5">
                        {contact.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={contact.avatar_url}
                            alt=""
                            className="size-7 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <NameAvatar name={name || contact.phone} size={28} />
                        )}
                        {name || (
                          <span className="font-normal text-muted-foreground italic">{t('unnamed')}</span>
                        )}
                      </div>
                    </td>
                    <td className={cn(TD, 'tabular-nums text-secondary-foreground')}>
                      {contact.phone}
                    </td>
                    {showEstado && (
                      <td className={TD}>
                        {group && (
                          <span
                            className={CHIP}
                            style={{ color: groupColor(group), background: tagTint(groupColor(group)) }}
                          >
                            {group}
                          </span>
                        )}
                      </td>
                    )}
                    {showOrigen && (
                      <td className={cn(TD, 'text-secondary-foreground')}>
                        {origin
                          ? origin.kind === 'ads'
                            ? t('originAds')
                            : origin.kind === 'form'
                              ? t('originForm')
                              : origin.name
                          : ''}
                      </td>
                    )}
                    <td className={TD}>
                      {conv &&
                        (setterName === null ? (
                          <div className="flex items-center gap-[7px]">
                            <UnassignedMark label={t('unassigned')} />
                            <span className="text-muted-foreground">{t('unassigned')}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-[7px]">
                            <MiniAvatar name={setterName || '?'} />
                            <span className="truncate text-foreground">{setterName}</span>
                          </div>
                        ))}
                    </td>
                    <td className={cn(TD, 'tabular-nums text-secondary-foreground')}>
                      {Number.isNaN(lastAt) ? '' : formatRelative(relativeTime(lastAt, now), tList)}
                    </td>
                    <td className={cn(TD, 'w-12 pl-0')} onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                              title={t('moreActions')}
                              aria-label={t('moreActions')}
                            />
                          }
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openDetail(contact.id)}>
                            <IdCard className="size-4" />
                            {t('viewAction')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditForm(contact)}>
                            <Pencil className="size-4" />
                            {t('editAction')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => confirmDelete(contact)}>
                            <Trash2 className="size-4" />
                            {t('deleteAction')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-6 py-2">
          <p className="text-xs text-muted-foreground">
            {t('showingPagination', {
              start: page * PAGE_SIZE + 1,
              end: Math.min((page + 1) * PAGE_SIZE, totalCount),
              total: totalCount
            })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
              aria-label={t('prevPage')}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="px-2 text-xs text-muted-foreground">
              {t('pageCount', { page: page + 1, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              aria-label={t('nextPage')}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
        }}
        onViewExisting={(id) => {
          setFormOpen(false);
          openDetail(id);
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        onUpdated={fetchContacts}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchContacts}
      />

      {/* Custom Fields Manager (admin+) */}
      {canEditSettings && (
        <CustomFieldsManager
          open={customFieldsOpen}
          onOpenChange={setCustomFieldsOpen}
        />
      )}

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteContactTitle')}</DialogTitle>
            <DialogDescription>
              {t('deleteContactDesc', { name: deleteTarget?.name || deleteTarget?.phone || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteBulkTitle')}</DialogTitle>
            <DialogDescription>
              {t('deleteBulkDesc', { count: selected.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Tilde de la casilla del filtro (prototipo `.cb.on:after`). */
function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
