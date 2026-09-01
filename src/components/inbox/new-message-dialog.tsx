"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MessageSquarePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { TemplatePicker } from "./template-picker";
import type { TemplateSendValues } from "./template-picker";
import {
  canSendNewMessage,
  isSendablePhone,
  lookupConversation,
  nextStepAfterLookup,
  startConversation,
} from "@/lib/inbox/new-conversation";
import type { MessageTemplate } from "@/types";

interface NewMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Abre el hilo resuelto en la Bandeja (existente o recien creado). */
  onOpenConversation: (conversationId: string) => void;
}

type Phase = "phone" | "template";

/**
 * "Nuevo mensaje": arranca una conversacion con un numero que
 * todavia no escribio.
 *
 * Dos pasos, y el orden importa. Primero se MIRA el numero sin
 * escribir nada: si ya tiene hilo se abre directo y no se ofrece
 * ninguna plantilla. Recien si no lo tiene aparece el segundo paso,
 * donde hay que elegir una plantilla aprobada — regla de Meta, no
 * nuestra: el primer mensaje a un numero que nunca escribio no puede
 * ser texto libre. Si no hay plantillas aprobadas todavia, el
 * selector sale vacio; eso es lo esperado, no un error.
 *
 * El contacto y el hilo se crean recien al enviar (`create: true`),
 * asi que escribir un numero y arrepentirse no deja un contacto
 * huerfano ni una conversacion vacia.
 *
 * El TemplatePicker se reusa tal cual. Mientras esta abierto este
 * dialogo se oculta (no se desmonta) para no apilar dos modales: el
 * estado —telefono, paso, plantilla— vive aca y sobrevive intacto.
 */
export function NewMessageDialog({
  open,
  onOpenChange,
  onOpenConversation,
}: NewMessageDialogProps) {
  const t = useTranslations("Inbox.newMessage");

  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>("phone");
  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  const [values, setValues] = useState<TemplateSendValues | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhone("");
    setPhase("phone");
    setTemplate(null);
    setValues(null);
    setPickerOpen(false);
    setBusy(false);
    setError(null);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset],
  );

  const handleContinue = useCallback(async () => {
    if (!isSendablePhone(phone)) {
      setError(t("invalidPhone"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const step = nextStepAfterLookup(await lookupConversation(phone));
      if (step.action === "open") {
        onOpenConversation(step.conversationId);
        handleOpenChange(false);
        return;
      }
      setPhase("template");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }, [phone, onOpenConversation, handleOpenChange, t]);

  const handleTemplateSelected = useCallback(
    (picked: MessageTemplate, pickedValues: TemplateSendValues) => {
      setTemplate(picked);
      setValues(pickedValues);
    },
    [],
  );

  const handleSend = useCallback(async () => {
    if (!template || !values) return;
    setBusy(true);
    setError(null);
    try {
      const { conversationId } = await startConversation({
        phone,
        template,
        values,
      });
      onOpenConversation(conversationId);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }, [phone, template, values, onOpenConversation, handleOpenChange, t]);

  const canSend = canSendNewMessage({ phone, template });

  return (
    <>
      <Dialog open={open && !pickerOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <MessageSquarePlus className="h-4 w-4 text-primary" />
              {t("title")}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-popover-foreground">
                {t("phoneLabel")}
              </Label>
              <Input
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  // Cambiar el numero invalida lo ya resuelto: hay que
                  // volver a mirar antes de ofrecer nada.
                  setPhase("phone");
                  setTemplate(null);
                  setValues(null);
                  setError(null);
                }}
                placeholder={t("phonePlaceholder")}
                inputMode="tel"
                disabled={busy}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-[10px] text-muted-foreground">
                {t("phoneHint")}
              </p>
            </div>

            {phase === "template" && (
              <div className="space-y-2 rounded-md border border-border bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">
                  {t("templateRequired")}
                </p>
                {template && (
                  <p className="text-sm font-medium text-popover-foreground">
                    {t("selectedTemplate", { name: template.name })}
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setPickerOpen(true)}
                  className="border-border text-popover-foreground hover:bg-muted"
                >
                  {template ? t("changeTemplate") : t("chooseTemplate")}
                </Button>
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => handleOpenChange(false)}
              className="border-border text-popover-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            {phase === "phone" ? (
              <Button
                disabled={busy || !isSendablePhone(phone)}
                onClick={handleContinue}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? t("checking") : t("continue")}
              </Button>
            ) : (
              <Button
                // Sin plantilla elegida no se puede enviar.
                disabled={busy || !canSend}
                onClick={handleSend}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? t("sending") : t("send")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TemplatePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handleTemplateSelected}
      />
    </>
  );
}
