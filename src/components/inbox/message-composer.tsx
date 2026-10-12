"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  KeyboardEvent,
} from "react";
import {
  SendHorizontal,
  FileText,
  Paperclip,
  Image as ImageIcon,
  Video,
  Mic,
  Square,
  X,
  Loader2,
  Sparkles,
  MessageSquareDashed,
  MessageSquareText,
  Hourglass,
  Lock,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";
import { ReplyQuote } from "./reply-quote";
import { useTranslations } from "next-intl";
import {
  InteractiveBuilder,
  blankButtonsPayload,
} from "@/components/interactive/interactive-builder";
import { validateInteractivePayload } from "@/lib/whatsapp/interactive";
import type { InteractiveMessagePayload, MessageTemplate, QuickReply } from "@/types";
import {
  collectVariableSlots,
  renderBodyPreview,
  useApprovedTemplates,
  type TemplateSendValues,
} from "./template-picker";
import { durationParts, hhmm, type DurationParts, type WindowState } from "@/lib/inbox/vistas";
import { firstNameOf } from "@/lib/inbox/thread";
import {
  clampSelection,
  filterQuickReplies,
  moveSelection,
  slashQuery,
} from "@/lib/inbox/quick-replies";

// ============================================================
// Cuadro de mensaje de la Bandeja (rediseño, sesión C).
//
// Prototipo `composer()`: pestañas "Responder" / "Nota interna" con el
// indicador vivo de la ventana de 24 h a la derecha; el cuadro que
// crece con el texto; la barra (adjuntar, grabar, respuestas rápidas,
// plantillas, interactivo, "Sugerir respuesta", la ayuda y enviar); el
// aviso amarillo con menos de 2 h; y, con la ventana cerrada o sin
// respuesta del cliente, el panel de plantillas en lugar del cuadro.
//
// La lógica no cambió: el envío de texto, archivos, audios,
// interactivos y plantillas sale por los mismos callbacks del hilo; la
// IA es `/api/ai/draft`; las respuestas rápidas son las de
// `/api/quick-replies` (ahora con "/" al principio del cuadro en vez
// de un diálogo); la nota interna es el alta de `contact_notes` que ya
// hacía la ficha, delegada al hilo (`onSaveNote`).
// ============================================================

/** Media content types an agent can send from the composer. */
export type ComposerMediaKind = "image" | "video" | "document" | "audio";

/** Supabase Storage bucket holding agent-sent chat attachments (migration 023). */
export const CHAT_MEDIA_BUCKET = "chat-media";

/** Meta caps media captions at 1024 chars. Enforced here and in the send route. */
export const MEDIA_CAPTION_MAX = 1024;

/** Hard cap on a single voice recording so it can't blow the upload/
 *  transcode limits — auto-stops the recorder when reached. */
const MAX_RECORDING_SECONDS = 5 * 60;

/** El cuadro crece con el texto entre estas dos alturas (prototipo: 46 px). */
const TEXTAREA_MIN_PX = 46;
const TEXTAREA_MAX_PX = 180;

export interface SendMediaPayload {
  kind: ComposerMediaKind;
  /** Public chat-media URL Meta fetches at send time. */
  mediaUrl: string;
  /** Storage object path — lets the caller GC the object if the send fails. */
  path: string;
  /** Optional caption (image/video/document only). */
  caption?: string;
  /** Original file name — surfaced to the recipient for documents. */
  filename?: string;
  replyToId?: string;
}

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

// Mirrors the chat-media bucket's allowed_mime_types (migration 023) for
// the file picker so unsupported files are rejected before upload rather
// than failing with a confusing Storage error. Audio has no picker — it's
// captured via the recorder.
const PICKER_ACCEPT: Record<"image" | "video" | "document", string> = {
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/3gpp",
  document:
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain",
};

interface MediaDraft {
  kind: ComposerMediaKind;
  mediaUrl: string;
  /** Storage path — used to GC the object if the draft is discarded. */
  path: string;
  filename: string;
  caption: string;
}

type ComposerTab = "reply" | "note";

interface MessageComposerProps {
  conversationId: string;
  /** Nombre y teléfono del contacto: el saludo del texto de ayuda y los títulos del panel de plantillas. */
  contactName?: string | null;
  contactPhone?: string | null;
  /**
   * Ventana de 24 h del hilo (`windowState`, la regla de la lista), o
   * null mientras los mensajes de esta conversación no terminaron de
   * cargar: en ese caso el cuadro no decide entre texto y plantillas.
   */
  windowState: WindowState | null;
  onSend: (text: string, replyToId?: string) => void;
  onSendMedia: (payload: SendMediaPayload) => void;
  onSendInteractive: (payload: InteractiveMessagePayload, replyToId?: string) => void;
  /** Envío de plantilla desde el panel inline (ventana cerrada o sin respuesta). */
  onSendTemplate: (template: MessageTemplate, values: TemplateSendValues) => void;
  /** Abre el diálogo de plantillas de siempre (con la ventana abierta). */
  onOpenTemplates: () => void;
  /** Guarda una nota interna; devuelve si quedó guardada. */
  onSaveNote: (text: string) => Promise<boolean>;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}

type Translator = ReturnType<typeof useTranslations>;

function formatDuration(d: DurationParts, t: Translator): string {
  if (d.hours > 0 && d.minutes > 0) return t("durationHm", { h: d.hours, m: d.minutes });
  if (d.hours > 0) return t("durationH", { h: d.hours });
  return t("durationM", { m: d.minutes });
}

function formatRecording(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Worker that encodes mic input to Ogg/Opus entirely in the browser
 *  (vendored from opus-recorder into /public). Recording client-side in a
 *  Meta-accepted format means no server ffmpeg / transcode step. */
const OPUS_ENCODER_PATH = "/opus/encoderWorker.min.js";

/**
 * Borradores por conversación (prototipo `S.draft[c.id]`). El cuadro se
 * monta con `key` por conversación, así que al volver a un hilo el
 * texto se recupera de acá; y si la ventana se cierra con un borrador
 * escrito, el texto sigue en el estado del componente (el textarea se
 * desmonta, el componente no).
 */
const replyDrafts = new Map<string, string>();
const noteDrafts = new Map<string, string>();

/** Botón redondo de 34 px de la barra del cuadro (prototipo `.ctb .ib`). */
const BAR_BUTTON_CLASS =
  "inline-flex size-[34px] shrink-0 items-center justify-center rounded-full text-secondary-foreground transition-colors hover:bg-hover-strong hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[18px]";

export function MessageComposer({
  conversationId,
  contactName,
  contactPhone,
  windowState,
  onSend,
  onSendMedia,
  onSendInteractive,
  onSendTemplate,
  onOpenTemplates,
  onSaveNote,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const t = useTranslations("Inbox.composer");

  const [tab, setTab] = useState<ComposerTab>("reply");
  const [text, setTextState] = useState(() => replyDrafts.get(conversationId) ?? "");
  const [noteText, setNoteTextState] = useState(() => noteDrafts.get(conversationId) ?? "");
  const [sending, setSending] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setText = useCallback(
    (value: string) => {
      replyDrafts.set(conversationId, value);
      setTextState(value);
    },
    [conversationId],
  );
  const setNoteText = useCallback(
    (value: string) => {
      noteDrafts.set(conversationId, value);
      setNoteTextState(value);
    },
    [conversationId],
  );

  // Interactive-message builder dialog.
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const [interactivePayload, setInteractivePayload] =
    useState<InteractiveMessagePayload>(blankButtonsPayload);
  const [savingQuickReply, setSavingQuickReply] = useState(false);
  // Modal "Guardar como respuesta rápida" (reemplaza al window.prompt).
  const [quickReplyNameOpen, setQuickReplyNameOpen] = useState(false);
  const [quickReplyName, setQuickReplyName] = useState("");

  // Respuestas rápidas: se piden una vez, la primera vez que se escribe
  // "/", y quedan en memoria mientras el cuadro viva.
  const [quickReplies, setQuickReplies] = useState<QuickReply[] | null>(null);
  const quickRepliesFetchRef = useRef(false);
  const [qrIndex, setQrIndex] = useState(0);
  const [qrDismissed, setQrDismissed] = useState(false);

  // Media attachment state. `draft` holds an uploaded-but-not-yet-sent
  // attachment; `busy` covers the upload/transcode window.
  const [draft, setDraft] = useState<MediaDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Mirror of `draft` for the unmount cleanup, which can't read render
  // state. Kept in sync below so navigating away with a staged-but-unsent
  // attachment GCs the orphaned object.
  const draftRef = useRef<MediaDraft | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Best-effort GC of a staged object the user never sent. Fire-and-forget.
  const removeStaged = useCallback((path: string | undefined) => {
    if (!path) return;
    void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
  }, []);

  // Voice recording state. The recorder encodes Ogg/Opus in-browser
  // (opus-recorder) so there's no server-side transcode.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<import("opus-recorder").default | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Viewers (read-only role) can browse the inbox but never send — nor
  // write notes (RLS de contact_notes: agent+). For solo users this is
  // always true — single-owner accounts pass every capability.
  const canSend = useCan("send-messages");
  const readOnly = !canSend;

  // Ventana: cerrada o sin respuesta del cliente ⇒ solo plantillas.
  const windowBlocked =
    windowState !== null && (windowState.kind === "closed" || windowState.kind === "none");
  const showTemplatePanel = tab === "reply" && windowBlocked;
  // Media (like free-form text) is only allowed inside the 24h window.
  const inputsDisabled = readOnly || windowBlocked;

  const firstName = firstNameOf(contactName, contactPhone);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Tear down any live recording + timer on unmount so a mid-record
  // navigation doesn't leak the mic, and GC a staged-but-unsent
  // attachment so it doesn't orphan in the bucket.
  useEffect(() => {
    return () => {
      clearTimer();
      cancelledRef.current = true;
      // stop() releases the mic stream + audio context inside opus-recorder.
      void recorderRef.current?.stop().catch(() => {});
      removeStaged(draftRef.current?.path);
    };
  }, [clearTimer, removeStaged]);

  // El cuadro crece con el texto (prototipo: arranca en 46 px) hasta un
  // tope y después scrollea.
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_PX), TEXTAREA_MAX_PX)}px`;
  }, []);

  // Recalcular al cambiar de pestaña o al volver del panel de plantillas:
  // el textarea se vuelve a montar con el borrador guardado.
  useEffect(() => {
    adjustHeight();
  }, [adjustHeight, tab, showTemplatePanel, text, noteText]);

  const focusEnd = useCallback(() => {
    requestAnimationFrame(() => {
      adjustHeight();
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }, [adjustHeight]);

  // ---- Respuestas rápidas con "/" --------------------------------------

  const slash = tab === "reply" && !readOnly ? slashQuery(text) : null;
  const qrOpen = slash !== null && !qrDismissed;

  useEffect(() => {
    if (!qrOpen || quickRepliesFetchRef.current) return;
    quickRepliesFetchRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/quick-replies", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        setQuickReplies(res.ok ? ((data.quick_replies as QuickReply[]) ?? []) : []);
      } catch {
        setQuickReplies([]);
      }
    })();
  }, [qrOpen]);

  const qrItems = useMemo(
    () => (quickReplies && slash !== null ? filterQuickReplies(quickReplies, slash) : []),
    [quickReplies, slash],
  );
  const qrSelected = clampSelection(qrIndex, qrItems.length);

  const openInteractiveBuilder = useCallback(
    (seed?: InteractiveMessagePayload) => {
      setInteractivePayload(seed ?? blankButtonsPayload());
      setInteractiveOpen(true);
    },
    [],
  );

  // A picked quick reply: text replaces the "/búsqueda" del cuadro;
  // interactive opens the builder pre-filled so the agent can tweak
  // before sending.
  const handlePickQuickReply = useCallback(
    (qr: QuickReply) => {
      setQrIndex(0);
      if (qr.kind === "interactive" && qr.interactive_payload) {
        setText("");
        openInteractiveBuilder(qr.interactive_payload);
        return;
      }
      setText(qr.content_text ?? "");
      focusEnd();
    },
    [openInteractiveBuilder, setText, focusEnd],
  );

  /** El botón de la barra: pone "/" y abre el panel. */
  const insertSlash = useCallback(() => {
    setQrDismissed(false);
    setQrIndex(0);
    setText("/");
    focusEnd();
  }, [setText, focusEnd]);

  // ---- Envío ----------------------------------------------------------

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || inputsDisabled) return;

    setSending(true);
    try {
      onSend(trimmed, replyTo?.id);
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = `${TEXTAREA_MIN_PX}px`;
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, inputsDisabled, onSend, replyTo?.id, setText]);

  const handleSaveNote = useCallback(async () => {
    const trimmed = noteText.trim();
    if (!trimmed || savingNote || readOnly) return;
    setSavingNote(true);
    try {
      const ok = await onSaveNote(trimmed);
      if (ok) {
        setNoteText("");
        if (textareaRef.current) {
          textareaRef.current.style.height = `${TEXTAREA_MIN_PX}px`;
        }
      }
    } finally {
      setSavingNote(false);
    }
  }, [noteText, savingNote, readOnly, onSaveNote, setNoteText]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (qrOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setQrIndex((i) => moveSelection(clampSelection(i, qrItems.length), 1, qrItems.length));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setQrIndex((i) => moveSelection(clampSelection(i, qrItems.length), -1, qrItems.length));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setQrDismissed(true);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const pick = qrItems[qrSelected];
          if (pick) handlePickQuickReply(pick);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (tab === "note") void handleSaveNote();
        else void handleSend();
      }
    },
    [qrOpen, qrItems, qrSelected, handlePickQuickReply, tab, handleSaveNote, handleSend],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (tab === "note") {
        setNoteText(e.target.value);
      } else {
        setText(e.target.value);
        setQrDismissed(false);
        setQrIndex(0);
      }
      adjustHeight();
    },
    [tab, setText, setNoteText, adjustHeight],
  );

  // Ask the AI assistant for a suggested reply and drop it into the
  // composer for the agent to edit + send. Read-only server-side —
  // nothing is sent until the agent hits Send.
  const handleDraft = useCallback(async () => {
    if (drafting || inputsDisabled) return;
    setDrafting(true);
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "ai_not_configured") {
          toast.error(t("aiNotConfigured"));
        } else {
          toast.error(data.error ?? t("aiDraftFailed"));
        }
        return;
      }
      const draftText = typeof data.draft === "string" ? data.draft.trim() : "";
      if (!draftText) {
        toast.error(t("aiEmpty"));
        return;
      }
      setText(draftText);
      // Let the textarea grow to fit and drop the cursor at the end so
      // the agent can tweak immediately.
      focusEnd();
    } catch {
      toast.error(t("aiUnreachable"));
    } finally {
      setDrafting(false);
    }
  }, [drafting, inputsDisabled, conversationId, setText, focusEnd, t]);

  // ---- Interactive message + quick replies --------------------------

  const sendInteractive = useCallback(() => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onSendInteractive(interactivePayload, replyTo?.id);
    setInteractiveOpen(false);
    onClearReply?.();
  }, [interactivePayload, onSendInteractive, replyTo?.id, onClearReply]);

  // Paso 1: validar y pedir el nombre en un modal del sistema de diseño.
  const askQuickReplyName = useCallback(() => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setQuickReplyName("");
    setQuickReplyNameOpen(true);
  }, [interactivePayload]);

  // Paso 2: persist the current builder payload as a reusable interactive snippet.
  const saveAsQuickReply = useCallback(async () => {
    const title = quickReplyName.trim();
    if (!title || savingQuickReply) return;
    setSavingQuickReply(true);
    try {
      const res = await fetch("/api/quick-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          kind: "interactive",
          interactive_payload: interactivePayload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("quickReplySaveError"));
        return;
      }
      // El catálogo en memoria se entera sin volver a pedir.
      setQuickReplies((prev) => (prev ? [data as QuickReply, ...prev] : prev));
      setQuickReplyNameOpen(false);
      toast.success(t("quickReplySaved"));
    } catch {
      toast.error(t("quickReplySaveError"));
    } finally {
      setSavingQuickReply(false);
    }
  }, [quickReplyName, savingQuickReply, interactivePayload, t]);

  // Upload a captured file to chat-media and stage it as a draft.
  const stageUpload = useCallback(
    async (kind: ComposerMediaKind, file: File) => {
      // Per-kind ceiling mirrors Meta's caps (image 5 MB, etc.) so we
      // reject before upload rather than orphaning an object that Meta
      // would then refuse at send.
      const max = MEDIA_MAX_BYTES_BY_KIND[kind];
      if (file.size > max) {
        toast.error(
          t("fileTooLarge", {
            size: (file.size / 1024 / 1024).toFixed(1),
            max: Math.round(max / 1024 / 1024),
          }),
        );
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
        // Replacing an existing draft? GC the previous object first.
        removeStaged(draftRef.current?.path);
        setDraft({ kind, mediaUrl: publicUrl, path, filename: file.name, caption: "" });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("uploadFailed"));
      } finally {
        setBusy(false);
      }
    },
    [removeStaged, t],
  );

  const handlePicked = useCallback(
    (kind: "image" | "video" | "document", file: File | undefined) => {
      if (file) void stageUpload(kind, file);
    },
    [stageUpload],
  );

  // ---- Voice recording (client-side Ogg/Opus, no server transcode) ---

  // The encoded Ogg/Opus file from opus-recorder → upload as an audio
  // draft. WhatsApp renders Ogg/Opus as a playable voice note.
  const finalizeRecording = useCallback(
    async (bytes: Uint8Array) => {
      // Uint8Array is a valid BlobPart at runtime; the cast sidesteps the
      // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
      const file = new File([bytes as unknown as BlobPart], `voice-${Date.now()}.ogg`, {
        type: "audio/ogg",
      });
      if (file.size === 0) return; // cancelled / empty take
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
        toast.error(t("recordingTooLong"));
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
        removeStaged(draftRef.current?.path);
        setDraft({ kind: "audio", mediaUrl: publicUrl, path, filename: file.name, caption: "" });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("uploadFailed"));
      } finally {
        setBusy(false);
      }
    },
    [removeStaged, t],
  );

  const startRecording = useCallback(async () => {
    if (inputsDisabled || busy || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      toast.error(t("recordingUnsupported"));
      return;
    }
    try {
      // Lazy-load the encoder (≈400 KB worker) only when the user records,
      // keeping it out of the main bundle.
      const { default: Recorder } = await import("opus-recorder");
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048, // VOIP — tuned for speech
        encoderSampleRate: 48000,
        streamPages: false, // one callback with the complete file on stop
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (cancelledRef.current) return;
        void finalizeRecording(bytes);
      };
      recorderRef.current = recorder;
      await recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      toast.error(t("micDenied"));
    }
  }, [inputsDisabled, busy, recording, finalizeRecording, t]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  // Auto-stop at the cap so a forgotten recording can't blow the
  // upload size limit.
  useEffect(() => {
    if (recording && recordSeconds >= MAX_RECORDING_SECONDS) {
      stopRecording();
    }
  }, [recording, recordSeconds, stopRecording]);

  // ---- Draft send / discard -----------------------------------------

  const sendDraft = useCallback(() => {
    if (!draft || busy) return;
    onSendMedia({
      kind: draft.kind,
      mediaUrl: draft.mediaUrl,
      path: draft.path,
      // Audio takes no caption (Meta rejects it). Everything else: the
      // trimmed caption, or undefined when blank.
      caption:
        draft.kind === "audio" ? undefined : draft.caption.trim() || undefined,
      filename: draft.kind === "document" ? draft.filename : undefined,
      replyToId: replyTo?.id,
    });
    // The object is now owned by the sent message — clear without GC.
    setDraft(null);
    onClearReply?.();
  }, [draft, busy, onSendMedia, replyTo?.id, onClearReply]);

  // Discard GCs the staged object — it was uploaded but never sent.
  const discardDraft = useCallback(() => {
    removeStaged(draft?.path);
    setDraft(null);
  }, [draft?.path, removeStaged]);

  const setCaption = useCallback((caption: string) => {
    setDraft((d) => (d ? { ...d, caption } : d));
  }, []);

  // Plantilla desde el panel inline: el envío es el del hilo; el aviso
  // recuerda que la ventana no se abre con la plantilla sino con la
  // respuesta del cliente.
  const handleSendTemplateFromPanel = useCallback(
    (template: MessageTemplate, values: TemplateSendValues) => {
      onSendTemplate(template, values);
      toast(t("templateSent"));
    },
    [onSendTemplate, t],
  );

  // ---- Render --------------------------------------------------------

  const isNote = tab === "note";
  const currentText = isNote ? noteText : text;
  const placeholder = readOnly
    ? t("readOnlyPlaceholder")
    : isNote
      ? t("placeholderNote")
      : firstName
        ? t("placeholderReply", { name: firstName })
        : t("placeholderReplyNoName");
  const canSubmit = isNote ? !!noteText.trim() && !savingNote : !!text.trim() && !sending;

  return (
    // `@container`: la barra, las pestañas y el indicador se adaptan al
    // ancho del HILO (no de la ventana). Con la barra lateral desplegada
    // (248) y el panel de contacto abierto (280), el hilo mide 290 px a
    // 1180, 390 a 1280, 476 a 1366, 550 a 1440 y 790 a 1680; las
    // consultas `@[…]` miden el CONTENIDO del contenedor, sin los 24 px
    // de padding de cada lado (242 px a 1180). Cortes, medidos con
    // margen: texto de "Sugerir respuesta" desde 410, indicador largo de
    // la ventana desde 420, panel de plantillas a dos columnas desde 440,
    // ayuda "Enter envía…" desde 620. Lo que no entra en un renglón pasa
    // a dos (`flex-wrap`): el indicador baja a su propio renglón a la
    // derecha y la barra deja enviar abajo a la derecha. Nada se sale
    // del cuadro a ningún ancho.
    <div className="@container relative min-w-0 shrink-0 px-4 pb-4 pt-1.5 sm:px-6">
      {/* Panel de respuestas rápidas (prototipo `.qr`): se apoya sobre el
          cuadro mientras el texto empiece con "/". */}
      {qrOpen && (
        <div className="absolute inset-x-4 bottom-full z-20 -mb-1 overflow-hidden rounded-[14px] border border-border bg-popover shadow-menu sm:inset-x-6">
          <div className="px-3.5 pb-1 pt-2.5 text-xs font-semibold text-muted-foreground">
            {t("quickReplies")}
          </div>
          <div className="max-h-64 overflow-y-auto pb-1">
            {quickReplies === null ? (
              <div className="flex justify-center py-4">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : quickReplies.length === 0 ? (
              <p className="px-3.5 py-2.5 text-[13px] text-muted-foreground">{t("quickRepliesEmpty")}</p>
            ) : qrItems.length === 0 ? (
              <p className="px-3.5 py-2.5 text-[13px] text-muted-foreground">{t("quickRepliesNoMatch")}</p>
            ) : (
              qrItems.map((qr, i) => (
                <button
                  key={qr.id}
                  type="button"
                  // mousedown en vez de click: el click le sacaría el foco al
                  // textarea antes de llegar.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handlePickQuickReply(qr);
                  }}
                  onMouseEnter={() => setQrIndex(i)}
                  className={cn(
                    "flex w-full items-baseline gap-3 px-3.5 py-[9px] text-left",
                    i === qrSelected && "bg-selected",
                  )}
                >
                  <b className="w-[110px] shrink-0 truncate text-[13.5px] font-semibold text-foreground">
                    {qr.kind === "interactive" && <Zap className="mr-1 inline size-3 text-primary" />}
                    {qr.title}
                  </b>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-secondary-foreground">
                    {qr.kind === "interactive"
                      ? t("interactiveMessage")
                      : (qr.content_text ?? "").replace(/\n/g, " ")}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Pestañas + ventana (prototipo `.cbar`). */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-[18px] gap-y-1 px-1.5 pb-2 text-[13px]">
        <button
          type="button"
          onClick={() => setTab("reply")}
          className={cn(
            "shrink-0 whitespace-nowrap border-b-2 pb-1 font-medium transition-colors",
            !isNote ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t("tabReply")}
        </button>
        <button
          type="button"
          onClick={() => setTab("note")}
          disabled={readOnly}
          title={readOnly ? t("readOnlyTitle") : undefined}
          className={cn(
            "shrink-0 whitespace-nowrap border-b-2 pb-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            isNote ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t("tabNote")}
        </button>
        {!isNote && windowState && <WindowIndicator state={windowState} t={t} />}
      </div>

      {showTemplatePanel ? (
        <TemplatePanel
          kind={windowState?.kind === "none" ? "none" : "closed"}
          firstName={firstName}
          readOnly={readOnly}
          onSend={handleSendTemplateFromPanel}
          t={t}
        />
      ) : (
        <>
          {!isNote && replyTo && (
            <div className="mb-2">
              <ReplyQuote
                authorLabel={replyTo.authorLabel}
                preview={replyTo.preview}
                onDismiss={onClearReply}
              />
            </div>
          )}

          {!isNote && windowState?.kind === "expiring" && (
            <div className="mb-2 flex items-center gap-2.5 rounded-xl bg-warning-soft px-3.5 py-2.5 text-[13.5px] text-warning">
              <Hourglass className="size-4 shrink-0" />
              {t("expiringWarning", { time: hhmm(windowState.until) })}
            </div>
          )}

          {/* Hidden file inputs driven by the attach menu. */}
          <input
            ref={imageInputRef}
            type="file"
            accept={PICKER_ACCEPT.image}
            className="hidden"
            onChange={(e) => {
              handlePicked("image", e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept={PICKER_ACCEPT.video}
            className="hidden"
            onChange={(e) => {
              handlePicked("video", e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={documentInputRef}
            type="file"
            accept={PICKER_ACCEPT.document}
            className="hidden"
            onChange={(e) => {
              handlePicked("document", e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {!isNote && draft ? (
            <MediaDraftPreview
              draft={draft}
              busy={busy}
              readOnly={readOnly}
              onCaptionChange={setCaption}
              onDiscard={discardDraft}
              onSend={sendDraft}
              t={t}
            />
          ) : !isNote && recording ? (
            // Recording bar — replaces the composer while the mic is live.
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted px-4 py-2.5">
              <span className="flex size-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
              <span className="flex-1 text-sm text-foreground">
                {t("recording", {
                  current: formatRecording(recordSeconds),
                  max: formatRecording(MAX_RECORDING_SECONDS),
                })}
              </span>
              <Button variant="ghost" size="sm" onClick={cancelRecording}>
                {t("cancel")}
              </Button>
              <Button size="icon-sm" onClick={stopRecording} title={t("stopAndAttach")}>
                <Square />
              </Button>
            </div>
          ) : (
            // El cuadro (prototipo `.cbox`): gris, se vuelve blanco con el
            // foco; amarillo en la nota interna.
            <div
              className={cn(
                "rounded-2xl border px-3 pb-2 pl-4 pt-2.5 transition-colors focus-within:bg-card",
                isNote
                  ? "border-warning/30 bg-warning-soft/50 focus-within:border-warning/50"
                  : "border-border bg-muted focus-within:border-[#9FB6CF]",
                readOnly && "opacity-70",
              )}
            >
              <textarea
                ref={textareaRef}
                value={currentText}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={readOnly}
                rows={1}
                // Textarea keeps its own inline title — the placeholder
                // text also surfaces the read-only state.
                title={readOnly ? t("readOnlyTitle") : undefined}
                style={{ height: TEXTAREA_MIN_PX }}
                className="block w-full resize-none bg-transparent text-[14.5px] leading-[1.4] text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
              />

              {/* Barra (prototipo `.ctb`). En la nota interna solo quedan
                  la ayuda y guardar: un adjunto o una plantilla saldrían
                  por WhatsApp, y la nota nunca sale. */}
              {/* `flex-wrap`: si no entra en un renglón pasa a dos y enviar
                  (`ml-auto`) queda abajo a la derecha. */}
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-secondary-foreground">
                {!isNote && (
                  <>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        disabled={inputsDisabled || busy}
                        title={readOnly ? t("readOnlyTitle") : t("attach")}
                        aria-label={t("attach")}
                        className={cn(BAR_BUTTON_CLASS, "aria-expanded:bg-selected-strong aria-expanded:text-primary")}
                      >
                        {busy ? <Loader2 className="animate-spin" /> : <Paperclip />}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" side="top">
                        <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                          <ImageIcon />
                          {t("photo")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
                          <Video />
                          {t("video")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => documentInputRef.current?.click()}>
                          <FileText />
                          {t("document")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <button
                      type="button"
                      disabled={inputsDisabled || busy}
                      onClick={() => void startRecording()}
                      title={readOnly ? t("readOnlyTitle") : t("recordAudio")}
                      aria-label={t("recordAudio")}
                      className={BAR_BUTTON_CLASS}
                    >
                      <Mic />
                    </button>

                    <button
                      type="button"
                      disabled={inputsDisabled}
                      onClick={insertSlash}
                      title={readOnly ? t("readOnlyTitle") : t("quickReplies")}
                      aria-label={t("quickReplies")}
                      className={cn(BAR_BUTTON_CLASS, qrOpen && "bg-selected-strong text-primary")}
                    >
                      <MessageSquareText />
                    </button>

                    {/* Con la ventana abierta, el diálogo de plantillas de
                        siempre: mandar una plantilla sigue siendo posible. */}
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={onOpenTemplates}
                      title={readOnly ? t("readOnlyTitle") : t("templates")}
                      aria-label={t("templates")}
                      className={BAR_BUTTON_CLASS}
                    >
                      <FileText />
                    </button>

                    <button
                      type="button"
                      disabled={inputsDisabled}
                      onClick={() => openInteractiveBuilder()}
                      title={readOnly ? t("readOnlyTitle") : t("interactiveMessage")}
                      aria-label={t("interactiveMessage")}
                      className={BAR_BUTTON_CLASS}
                    >
                      <MessageSquareDashed />
                    </button>

                    <button
                      type="button"
                      disabled={inputsDisabled || drafting}
                      onClick={() => void handleDraft()}
                      title={readOnly ? t("readOnlyTitle") : t("suggestReply")}
                      aria-label={t("suggestReply")}
                      className="inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[13px] font-medium text-secondary-foreground transition-colors hover:bg-hover-strong hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
                    >
                      {drafting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      {/* El texto solo cuando entra; si no, el ícono solo con title y aria-label. */}
                      <span className="hidden @[410px]:inline">{t("suggestReply")}</span>
                    </button>
                  </>
                )}

                {/* La ayuda se oculta cuando no entra (ancho del hilo, no de la ventana). */}
                <span className="ml-auto mr-2.5 hidden shrink-0 whitespace-nowrap text-xs text-muted-foreground @[620px]:inline">
                  {t("sendHint")}
                </span>
                <button
                  type="button"
                  disabled={readOnly || !canSubmit}
                  onClick={() => (isNote ? void handleSaveNote() : void handleSend())}
                  title={readOnly ? t("readOnlyTitle") : isNote ? t("saveNote") : t("send")}
                  aria-label={isNote ? t("saveNote") : t("send")}
                  className="ml-auto grid size-[38px] shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-40 @[620px]:ml-0 [&_svg]:size-[18px]"
                >
                  {savingNote ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Interactive-message builder dialog. */}
      <Dialog open={interactiveOpen} onOpenChange={setInteractiveOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("interactiveMessage")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            <InteractiveBuilder
              value={interactivePayload}
              onChange={setInteractivePayload}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingQuickReply}
              onClick={askQuickReplyName}
            >
              <Zap />
              {t("saveAsQuickReply")}
            </Button>
            <Button onClick={sendInteractive}>
              <SendHorizontal />
              {t("send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nombre de la respuesta rápida nueva (antes, window.prompt). */}
      <Dialog open={quickReplyNameOpen} onOpenChange={setQuickReplyNameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("saveAsQuickReply")}</DialogTitle>
            <DialogDescription>{t("quickReplyNameDescription")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void saveAsQuickReply();
            }}
          >
            <Label htmlFor="quick-reply-name">{t("quickReplyNameLabel")}</Label>
            <Input
              id="quick-reply-name"
              autoFocus
              value={quickReplyName}
              onChange={(e) => setQuickReplyName(e.target.value)}
              placeholder={t("quickReplyNamePlaceholder")}
              maxLength={80}
            />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickReplyNameOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={!quickReplyName.trim() || savingQuickReply}
              onClick={() => void saveAsQuickReply()}
            >
              {savingQuickReply ? <Loader2 className="animate-spin" /> : <Zap />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------
// Indicador de la ventana (prototipo `.win`): verde abierta, amarillo
// por vencer, rojo cerrada o sin respuesta. Se recalcula con el reloj
// del hilo, así que se mueve solo.
// ------------------------------------------------------------

function WindowIndicator({ state, t }: { state: WindowState; t: Translator }) {
  let tone: string;
  let dot: string;
  let label: string;
  let short: string;
  switch (state.kind) {
    case "open": {
      const duration = formatDuration(durationParts(state.remainingMs), t);
      tone = "text-success";
      dot = "bg-success";
      label = t("windowOpen", { duration });
      short = t("windowOpenShort", { duration });
      break;
    }
    case "expiring": {
      const duration = formatDuration(durationParts(state.remainingMs), t);
      tone = "text-warning";
      dot = "bg-warning";
      label = t("windowExpiring", { duration });
      short = t("windowExpiringShort", { duration });
      break;
    }
    case "closed":
      tone = "text-danger";
      dot = "bg-danger";
      label = t("windowClosed", { duration: formatDuration(durationParts(state.sinceMs), t) });
      short = t("windowClosedShort");
      break;
    default:
      tone = "text-danger";
      dot = "bg-danger";
      label = t("windowNone");
      short = t("windowNoneShort");
  }
  // Con el hilo angosto va la versión corta entera, nunca la larga con
  // puntos suspensivos; si tampoco entra al lado de las pestañas, la
  // fila (`flex-wrap`) la baja a su propio renglón, a la derecha.
  return (
    <span className={cn("ml-auto flex shrink-0 items-center gap-[7px] whitespace-nowrap text-[12.5px] font-medium", tone)}>
      <span className={cn("size-2 shrink-0 rounded-full", dot)} />
      <span className="hidden @[420px]:inline">{label}</span>
      <span className="@[420px]:hidden">{short}</span>
    </span>
  );
}

// ------------------------------------------------------------
// Panel de plantillas (prototipo `.tplc`): con la ventana cerrada o sin
// respuesta del cliente reemplaza al cuadro. Lista a la izquierda,
// vista previa (y las variables, si la plantilla las pide) a la
// derecha, "Enviar plantilla". Las plantillas, las variables y el
// envío son los mismos del diálogo `TemplatePicker`.
// ------------------------------------------------------------

function TemplatePanel({
  kind,
  firstName,
  readOnly,
  onSend,
  t,
}: {
  kind: "closed" | "none";
  firstName: string;
  readOnly: boolean;
  onSend: (template: MessageTemplate, values: TemplateSendValues) => void;
  t: Translator;
}) {
  const tPicker = useTranslations("Inbox.templatePicker");
  const { templates, loading } = useApprovedTemplates(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = templates.find((tpl) => tpl.id === selectedId) ?? templates[0] ?? null;

  const title =
    kind === "none"
      ? firstName
        ? t("panelNoneTitle", { name: firstName })
        : t("panelNoneTitleNoName")
      : firstName
        ? t("panelClosedTitle", { name: firstName })
        : t("panelClosedTitleNoName");

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div
        className={cn(
          "flex items-start gap-2.5 px-4 py-3 text-[13.5px]",
          kind === "none" ? "bg-neutral-soft text-neutral" : "bg-danger-soft text-danger",
        )}
      >
        <Lock className="mt-0.5 size-4 shrink-0" />
        <div>
          <b className="block font-semibold">{title}</b>
          {t("panelBody")}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm font-medium text-foreground">{tPicker("noApprovedTemplates")}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{tPicker("noApprovedTemplatesHint")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 @[440px]:grid-cols-2">
          <div className="max-h-72 overflow-y-auto border-b border-border @[440px]:border-b-0">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setSelectedId(tpl.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 border-b border-border/60 px-4 py-2.5 text-left text-[13.5px] text-foreground transition-colors hover:bg-hover",
                  selected?.id === tpl.id && "bg-selected font-semibold hover:bg-selected",
                )}
              >
                <FileText className="size-4 shrink-0 text-secondary-foreground" />
                <span className="min-w-0 flex-1 truncate">{tpl.name}</span>
                <small className="shrink-0 text-xs font-normal text-muted-foreground">
                  {tpl.language ? `${tpl.category} · ${tpl.language}` : tpl.category}
                </small>
              </button>
            ))}
          </div>
          {selected && (
            <TemplatePane
              key={selected.id}
              template={selected}
              readOnly={readOnly}
              onSend={onSend}
              t={t}
              tPicker={tPicker}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Vista previa + variables de UNA plantilla; con `key` por plantilla para que los valores no se mezclen. */
function TemplatePane({
  template,
  readOnly,
  onSend,
  t,
  tPicker,
}: {
  template: MessageTemplate;
  readOnly: boolean;
  onSend: (template: MessageTemplate, values: TemplateSendValues) => void;
  t: Translator;
  tPicker: Translator;
}) {
  const slots = useMemo(() => collectVariableSlots(template), [template]);
  const [params, setParams] = useState<string[]>(() => new Array(slots.bodyVars.length).fill(""));
  const [headerText, setHeaderText] = useState("");
  const [buttonParams, setButtonParams] = useState<Record<number, string>>({});

  const canConfirm =
    slots.bodyVars.every((_, i) => (params[i] ?? "").trim().length > 0) &&
    (slots.headerVarCount === 0 || headerText.trim().length > 0) &&
    slots.urlButtonSlots.every((s) => (buttonParams[s.index] ?? "").trim().length > 0);

  const confirm = () => {
    if (!canConfirm) return;
    const values: TemplateSendValues = { body: params };
    if (headerText.trim()) values.headerText = headerText.trim();
    if (Object.keys(buttonParams).length > 0) {
      values.buttonParams = Object.fromEntries(
        Object.entries(buttonParams).map(([k, v]) => [Number(k), v.trim()]),
      );
    }
    onSend(template, values);
  };

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3 text-[13.5px] @[440px]:border-l @[440px]:border-border">
      <span className="text-[12.5px] font-semibold text-muted-foreground">{tPicker("preview")}</span>
      <div className="whitespace-pre-wrap break-words rounded-[20px] rounded-br-md bg-primary px-3.5 py-2 text-[13.5px] leading-[1.42] text-primary-foreground">
        {renderBodyPreview(template.body_text, params)}
        {template.footer_text && (
          <p className="mt-1.5 text-xs italic text-primary-foreground/70">{template.footer_text}</p>
        )}
      </div>
      {slots.headerVarCount > 0 && (
        <Input
          value={headerText}
          onChange={(e) => setHeaderText(e.target.value)}
          placeholder={tPicker("headerValuePlaceholder")}
          className="h-9"
        />
      )}
      {slots.bodyVars.map((v, i) => (
        <Input
          key={v}
          value={params[i] ?? ""}
          onChange={(e) => {
            const next = [...params];
            next[i] = e.target.value;
            setParams(next);
          }}
          placeholder={tPicker("bodyValuePlaceholder", { val: `{{${v}}}` })}
          className="h-9"
        />
      ))}
      {slots.urlButtonSlots.map((slot) => (
        <div key={slot.index} className="space-y-1">
          <Input
            value={buttonParams[slot.index] ?? ""}
            onChange={(e) =>
              setButtonParams((prev) => ({ ...prev, [slot.index]: e.target.value }))
            }
            placeholder={`${slot.text}: ${tPicker("urlSuffixValuePlaceholder")}`}
            className="h-9"
          />
          <p className="break-all text-[11px] text-muted-foreground">
            {tPicker("finalUrl", {
              url: slot.url.replace(/\{\{1\}\}/g, buttonParams[slot.index] || "{{1}}"),
            })}
          </p>
        </div>
      ))}
      <div className="mt-auto flex justify-end pt-1">
        <Button
          size="sm"
          disabled={readOnly || !canConfirm}
          title={readOnly ? t("readOnlyTitle") : undefined}
          onClick={confirm}
        >
          <SendHorizontal />
          {t("sendTemplate")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Staged-attachment preview with caption + send/discard. Declared at
 * module scope (not nested in MessageComposer) so React keeps it mounted
 * across the parent's re-renders — a nested component would remount the
 * caption input on every keystroke and drop focus.
 */
function MediaDraftPreview({
  draft,
  busy,
  readOnly,
  onCaptionChange,
  onDiscard,
  onSend,
  t,
}: {
  draft: MediaDraft;
  busy: boolean;
  readOnly: boolean;
  onCaptionChange: (caption: string) => void;
  onDiscard: () => void;
  onSend: () => void;
  t: Translator;
}) {
  return (
    <div className="rounded-2xl border border-border bg-muted p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {draft.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.mediaUrl}
              alt={draft.filename}
              className="max-h-40 rounded-lg object-cover"
            />
          )}
          {draft.kind === "video" && (
            <video src={draft.mediaUrl} controls className="max-h-40 rounded-lg" />
          )}
          {draft.kind === "audio" && (
            <audio src={draft.mediaUrl} controls className="w-full" />
          )}
          {draft.kind === "document" && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <FileText className="size-5 shrink-0 text-muted-foreground" />
              <span className="truncate">{draft.filename}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDiscard}
          aria-label={t("removeAttachment")}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-hover-strong hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-2 flex items-end gap-2">
        {draft.kind !== "audio" && (
          <Input
            value={draft.caption}
            maxLength={MEDIA_CAPTION_MAX}
            onChange={(e) => onCaptionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={t("addCaption")}
            className="flex-1"
          />
        )}
        <button
          type="button"
          disabled={readOnly || busy}
          onClick={onSend}
          title={readOnly ? t("readOnlyTitle") : t("send")}
          aria-label={t("send")}
          className={cn(
            "grid size-[38px] shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[18px]",
            draft.kind === "audio" && "ml-auto",
          )}
        >
          <SendHorizontal />
        </button>
      </div>
    </div>
  );
}
