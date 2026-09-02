'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings, canSendMessages } from '@/lib/auth/roles';
import { DEFAULT_TAG_COLOR, PRESET_COLORS } from '@/lib/contacts/tag-colors';
import { isEstadoTag } from '@/lib/contacts/tag-groups';
import {
  loadContactFormValues,
  type ContactFieldValue,
} from '@/lib/inbox/contact-form-values';
import {
  attachTag,
  createAndAttachTag,
  detachTag,
  groupAssignableTags,
  orderAttachedTags,
  TagCreateError,
} from '@/lib/inbox/contact-tags';
import { cn } from '@/lib/utils';
import type { Contact, Deal, ContactNote, Tag } from '@/types';
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  X,
  ClipboardList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

interface ContactSidebarProps {
  contact: Contact | null;
  /**
   * Se llama cada vez que la ficha relee las etiquetas del contacto
   * desde la base (al abrirlo y despues de agregar, sacar o crear).
   * La lista de conversaciones pinta el estado del contacto con lo
   * que trajo su propio fetch; sin este aviso el chip quedaria viejo
   * hasta la proxima recarga. Debe ser estable (useCallback).
   */
  onTagsChange?: (contactId: string, tags: Tag[]) => void;
}

export function ContactSidebar({ contact, onTagsChange }: ContactSidebarProps) {
  const tSidebar = useTranslations('Inbox.sidebar');
  const tThread = useTranslations('Inbox.messageThread');
  // Los nombres de los colores ya viven en Configuracion → Campos y
  // etiquetas; se reusan en vez de duplicar los ocho en tres idiomas.
  const tColors = useTranslations('Settings.tagsAndFields');

  const { user, accountId, accountRole } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  // Las pastillas se identifican por `tag.id` — la unique
  // (contact_id, tag_id) hace que no pueda haber dos filas para el
  // mismo par, asi que no hace falta arrastrar el id de contact_tags.
  const [tags, setTags] = useState<Tag[]>([]);
  // Catalogo de la cuenta, para el popover "+ Agregar etiqueta".
  const [accountTags, setAccountTags] = useState<Tag[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagBusyId, setTagBusyId] = useState<string | null>(null);
  // Mini-formulario de creacion dentro del mismo popover.
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState<string>(DEFAULT_TAG_COLOR);
  const [creatingTag, setCreatingTag] = useState(false);
  // Respuestas del formulario (campos personalizados). Solo lectura:
  // editarlas sigue siendo cosa de Contactos → Editar contacto.
  const [formValues, setFormValues] = useState<ContactFieldValue[]>([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // Poner/sacar etiquetas escribe contact_tags via
  // /api/contacts/[id]/tags, que pide rol agent+. Un viewer no ve el
  // control en vez de recibir un 403 al tocarlo.
  const canEditTags = accountRole ? canSendMessages(accountRole) : false;
  // Crear una etiqueta es otra cosa que aplicarla: la RLS de `tags`
  // (tags_insert, migracion 017) pide admin+, el mismo alcance que
  // canEditSettings — que ya nombra las etiquetas. Un agent puede
  // aplicar las que existen pero no inventar una nueva.
  const canCreateTags = accountRole ? canEditSettings(accountRole) : false;

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, contact tags and the account tag catalogue
    // (the picker below offers whatever the contact doesn't have yet).
    const [dealsRes, notesRes, tagsRes, accountTagsRes, formValuesRows] =
      await Promise.all([
        supabase
          .from('deals')
          .select('*, stage:pipeline_stages(*)')
          .eq('contact_id', contact.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('contact_notes')
          .select('*')
          .eq('contact_id', contact.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('contact_tags')
          .select('id, tag_id, tags(*)')
          .eq('contact_id', contact.id),
        supabase.from('tags').select('*').order('name'),
        // Las respuestas del formulario: el loader devuelve [] ante un
        // error, así que la sección se oculta sola en vez de romper.
        loadContactFormValues(supabase, contact.id),
      ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ct.tags as Tag);
      setTags(mapped);
      onTagsChange?.(contact.id, mapped);
    }
    if (accountTagsRes.data) setAccountTags(accountTagsRes.data as Tag[]);
    setFormValues(formValuesRows);
  }, [contact, onTagsChange]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  // Etiquetas de la cuenta que este contacto todavia no tiene, en los
  // dos grupos del popover: estado (orden de embudo) y otras
  // (alfabetico). Si no queda ninguna, el popover lo dice.
  const availableTags = useMemo(
    () => groupAssignableTags(accountTags, tags),
    [accountTags, tags]
  );
  const noTagsAvailable =
    availableTags.estado.length === 0 && availableTags.otras.length === 0;
  // La de estado primera: es lo que el setter mira de un vistazo.
  const orderedTags = useMemo(() => orderAttachedTags(tags), [tags]);
  const hasEstado = tags.some(isEstadoTag);

  const handleAttachTag = useCallback(
    async (tag: Tag) => {
      if (!contact) return;
      setTagBusyId(tag.id);
      try {
        // attachTag persiste primero y recien despues devuelve la
        // lista nueva: si el POST falla, la pastilla no aparece.
        setTags(await attachTag(contact.id, tag, tags));
        setTagPickerOpen(false);
        // withTagAttached ya saco de la lista local el estado anterior
        // (espejo del trigger trg_single_etapa_tag, que lo borra en la
        // base). La base sigue siendo la fuente de verdad: se relee.
        await fetchContactData();
      } catch (err) {
        const reason = err instanceof Error ? err.message : '';
        toast.error(
          reason
            ? `${tSidebar('tagUpdateFailed')}: ${reason}`
            : tSidebar('tagUpdateFailed')
        );
      } finally {
        setTagBusyId(null);
      }
    },
    [contact, tags, tSidebar, fetchContactData]
  );

  const handleDetachTag = useCallback(
    async (tagId: string) => {
      if (!contact) return;
      setTagBusyId(tagId);
      try {
        setTags(await detachTag(contact.id, tagId, tags));
        // Mismo motivo que en handleAttachTag: la base es la fuente
        // de verdad de que etiquetas quedaron.
        await fetchContactData();
      } catch (err) {
        const reason = err instanceof Error ? err.message : '';
        toast.error(
          reason
            ? `${tSidebar('tagUpdateFailed')}: ${reason}`
            : tSidebar('tagUpdateFailed')
        );
      } finally {
        setTagBusyId(null);
      }
    },
    [contact, tags, tSidebar, fetchContactData]
  );

  const handleCreateTag = useCallback(async () => {
    if (!contact || !accountId || !user) return;
    if (!newTagName.trim()) {
      toast.error(tSidebar('tagNameRequired'));
      return;
    }
    setCreatingTag(true);
    try {
      // Un solo paso: la fila queda en `tags` y la etiqueta queda
      // aplicada al contacto abierto, por el mismo camino que usar
      // una ya existente.
      const created = await createAndAttachTag({
        db: createClient(),
        accountId,
        userId: user.id,
        contactId: contact.id,
        name: newTagName,
        color: newTagColor,
        accountTags,
        attached: tags,
      });
      setTags(created.attached);
      // En memoria: el proximo contacto ya la ve en el catalogo sin
      // recargar la pagina.
      setAccountTags(created.accountTags);
      setNewTagName('');
      setNewTagColor(DEFAULT_TAG_COLOR);
      setTagPickerOpen(false);
      toast.success(tSidebar('tagCreated'));
      // Aplicar sale por attachTag: si la nueva es de estado, el
      // trigger ya saco la anterior en la base. Se relee igual que
      // en handleAttachTag.
      await fetchContactData();
    } catch (err) {
      if (err instanceof TagCreateError) {
        if (err.code === 'duplicate_name') {
          toast.error(tSidebar('tagNameExists'));
        } else if (err.code === 'empty_name') {
          toast.error(tSidebar('tagNameRequired'));
        } else {
          // attach_failed: la fila YA existe en `tags`, asi que entra
          // al catalogo igual para no perderla hasta el proximo fetch.
          if (err.tag) {
            const tag = err.tag;
            setAccountTags((prev) =>
              prev.some((t) => t.id === tag.id)
                ? prev
                : [...prev, tag].sort((a, b) => a.name.localeCompare(b.name))
            );
          }
          toast.error(`${tSidebar('tagUpdateFailed')}: ${err.message}`);
        }
      } else {
        const reason = err instanceof Error ? err.message : '';
        toast.error(
          reason
            ? `${tSidebar('tagCreateFailed')}: ${reason}`
            : tSidebar('tagCreateFailed')
        );
      }
    } finally {
      setCreatingTag(false);
    }
  }, [
    contact,
    accountId,
    user,
    newTagName,
    newTagColor,
    accountTags,
    tags,
    tSidebar,
    fetchContactData,
  ]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote('');
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  // Una fila del popover; la misma para los dos grupos.
  const renderTagOption = (tag: Tag) => (
    <button
      key={tag.id}
      type="button"
      disabled={tagBusyId === tag.id}
      onClick={() => handleAttachTag(tag)}
      className="text-popover-foreground hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-50"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: tag.color }}
      />
      <span className="truncate">{tag.name}</span>
    </button>
  );

  if (!contact) {
    return (
      <div className="border-border bg-card flex h-full w-70 items-center justify-center border-l">
        <p className="text-muted-foreground text-sm">
          {tThread('selectConversation')}
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="border-border bg-card flex h-full w-70 flex-col border-l">
      {/* `min-h-0` es imprescindible: un hijo flex arranca con
          min-height:auto, asi que sin el este ScrollArea crece hasta el
          alto del contenido (etiquetas, campos del formulario...), se
          pasa del panel y el overflow-hidden del padre lo recorta sin
          barra: oportunidades y notas quedan inaccesibles. Mismo caso
          que la lista de conversaciones (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="bg-muted text-foreground flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="text-foreground mt-3 text-sm font-semibold">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-muted-foreground text-xs">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
            >
              <Phone className="text-muted-foreground h-4 w-4" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="text-primary h-3 w-3" />
              ) : (
                <Copy className="text-muted-foreground h-3 w-3" />
              )}
            </button>

            {contact.email && (
              <div className="text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <Mail className="text-muted-foreground h-4 w-4" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Tags */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <TagIcon className="h-3 w-3" />
              {tSidebar('tags')}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {/* Sin estado: el hueco se ve, asi el setter sabe que
                  todavia no lo marco. */}
              {!hasEstado && (
                <span className="border-border text-muted-foreground inline-flex items-center gap-1.5 rounded-full border border-dashed py-1 pr-2.5 pl-1 text-xs">
                  <span className="bg-muted rounded-full px-1.5 py-px text-[9px] font-medium tracking-wider uppercase">
                    {tSidebar('estado')}
                  </span>
                  {tSidebar('noEstado')}
                </span>
              )}
              {orderedTags.map((tag) =>
                isEstadoTag(tag) ? (
                  // Estado: pastilla llena, mas grande y con rotulo. Sin X
                  // a proposito — el estado se cambia eligiendo otro en el
                  // popover (la base saca el anterior); dejar a un
                  // contacto sin estado se hace desde Contactos.
                  <span
                    key={tag.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-xs font-semibold text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    <span className="rounded-full bg-white/25 px-1.5 py-px text-[9px] font-medium tracking-wider uppercase">
                      {tSidebar('estado')}
                    </span>
                    <span className="truncate">{tag.name}</span>
                  </span>
                ) : (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                    {canEditTags && (
                      <button
                        type="button"
                        aria-label={tSidebar('removeTag')}
                        title={tSidebar('removeTag')}
                        disabled={tagBusyId === tag.id}
                        onClick={() => handleDetachTag(tag.id)}
                        className="rounded-full opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </span>
                )
              )}

              {canEditTags && (
                <Popover open={tagPickerOpen} onOpenChange={setTagPickerOpen}>
                  <PopoverTrigger className="border-border text-muted-foreground hover:border-primary/40 hover:text-foreground inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[10px] font-medium transition-colors">
                    <Plus className="h-2.5 w-2.5" />
                    {tSidebar('addTag')}
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 p-0">
                    {noTagsAvailable ? (
                      <p className="text-muted-foreground px-3 py-4 text-center text-xs">
                        {tSidebar('noTagsAvailable')}
                      </p>
                    ) : (
                      <div className="max-h-64 overflow-y-auto py-1">
                        {/* Estado primero, en orden de embudo: es lo que el
                            setter toca todo el dia. Elegir uno reemplaza
                            al anterior (trigger en la base). */}
                        {availableTags.estado.length > 0 && (
                          <>
                            <p className="text-muted-foreground px-3 pt-1.5 pb-1 text-[10px] font-medium tracking-wider uppercase">
                              {tSidebar('estado')}
                            </p>
                            {availableTags.estado.map(renderTagOption)}
                          </>
                        )}
                        {availableTags.otras.length > 0 && (
                          <>
                            <p
                              className={cn(
                                'text-muted-foreground px-3 pt-1.5 pb-1 text-[10px] font-medium tracking-wider uppercase',
                                availableTags.estado.length > 0 &&
                                  'border-border mt-1 border-t pt-2'
                              )}
                            >
                              {tSidebar('otherTags')}
                            </p>
                            {availableTags.otras.map(renderTagOption)}
                          </>
                        )}
                      </div>
                    )}

                    {/* Crear una etiqueta sin cortar el hilo: queda
                        aplicada al contacto en el mismo paso. */}
                    {canCreateTags && (
                      <div className="border-border space-y-2 border-t p-2.5">
                        <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
                          {tSidebar('createTag')}
                        </p>
                        <Input
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreateTag();
                          }}
                          placeholder={tSidebar('createTagPlaceholder')}
                          disabled={creatingTag}
                          maxLength={40}
                          className="border-border bg-muted text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          {PRESET_COLORS.map((color) => (
                            <button
                              key={color.value}
                              type="button"
                              onClick={() => setNewTagColor(color.value)}
                              aria-label={tColors('useColor', {
                                color: tColors(
                                  `colors.${color.name}` as Parameters<
                                    typeof tColors
                                  >[0]
                                ),
                              })}
                              aria-pressed={newTagColor === color.value}
                              className={cn(
                                'size-5 rounded-md transition-transform hover:scale-110',
                                newTagColor === color.value &&
                                  'outline-primary outline outline-2 outline-offset-2'
                              )}
                              style={{ backgroundColor: color.value }}
                            />
                          ))}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-border text-popover-foreground hover:bg-muted h-7 w-full text-xs"
                          disabled={creatingTag || !newTagName.trim()}
                          onClick={handleCreateTag}
                        >
                          <Plus className="h-3 w-3" />
                          {tSidebar('createTagAction')}
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Datos del formulario — las respuestas que dejó el lead en
              el formulario (campos personalizados). Solo lectura: se
              editan en Contactos → Editar contacto, y no hace falta un
              segundo camino a la misma tabla. La sección entera se
              oculta cuando el contacto no tiene ninguno cargado. */}
          {formValues.length > 0 && (
            <>
              <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
                <ClipboardList className="h-3 w-3" />
                {tSidebar('formData')}
              </div>
              <dl className="mt-2 space-y-2">
                {formValues.map((field) => (
                  <div
                    key={field.fieldId}
                    className="bg-muted rounded-lg px-3 py-2"
                  >
                    <dt className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
                      {field.name}
                    </dt>
                    <dd className="text-foreground mt-0.5 text-xs break-words whitespace-pre-wrap">
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Divider */}
              <div className="border-border my-4 border-t" />
            </>
          )}

          {/* Active Deals */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <DollarSign className="h-3 w-3" />
              {tSidebar('deals')}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noDeals')}
                </p>
              ) : (
                deals.map((deal) => (
                  <div key={deal.id} className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-foreground text-sm font-medium">
                      {deal.title}
                    </p>
                    <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
                      <span>
                        {deal.currency ?? '$'}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Notes */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <StickyNote className="h-3 w-3" />
              {tSidebar('notes')}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar('addNotePlaceholder')}
                  rows={2}
                  className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-lg border px-3 py-2 text-xs outline-none"
                />
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 h-auto px-2"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                      {note.note_text}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {format(new Date(note.created_at), 'MMM d, yyyy HH:mm')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
