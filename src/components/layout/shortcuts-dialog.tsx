"use client";

import { useTranslations } from "next-intl";

import { closeShortcutsHelp, useShortcutsHelpOpen } from "@/hooks/use-shortcuts-help";
import { SHORTCUT_HELP } from "@/lib/inbox/shortcuts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// ============================================================
// Modal "Atajos de teclado" (rediseño, sesión E), prototipo `openKeys()`
// y `.kb` / `kbd`: 460 px, título, "Las letras solas funcionan cuando
// no estás escribiendo." y la lista tecla · acción. Cruz visible y clic
// afuera bloqueado como todo modal (`DialogContent`). Montado en el
// shell; lo abren ? en la Bandeja y el botón de la barra superior.
// ============================================================

export function ShortcutsDialog() {
  const t = useTranslations("Shortcuts");
  const open = useShortcutsHelpOpen();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeShortcutsHelp();
      }}
    >
      <DialogContent className="w-[460px] gap-0 p-0 sm:max-w-[460px]">
        <div className="px-[26px] pt-[22px] pb-2.5 pr-16">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 px-[26px] pt-2 pb-6 text-sm text-foreground">
          {SHORTCUT_HELP.map((row) => (
            <div key={row.keys} className="contents">
              <dt>
                <kbd className="inline-grid h-[26px] min-w-7 place-items-center rounded-[7px] border border-border border-b-2 bg-muted px-2 font-sans text-[12.5px] font-semibold">
                  {row.keys}
                </kbd>
              </dt>
              <dd>{t(row.labelKey)}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
