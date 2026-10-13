"use client";

/**
 * Editor toolbar — flow name / description, status chip, dirty
 * indicator, and the action buttons (Save, Activate/Pause, Delete,
 * View runs, Back).
 *
 * Rediseño (sesión F2): textos del catálogo (`Flows.header`), estado en
 * `Badge` de 5 px, botones `sm` del sistema, "Editado" en ámbar del
 * sistema y borrar con un modal (nunca `window.confirm`). Lo que hace
 * cada botón (guardar, activar, borrar) sigue en `flow-editor-state`.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CircleDot,
  History,
  Loader2,
  PauseCircle,
  PlayCircle,
  Save,
  Trash2,
  Workflow,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useFlowEditor,
  type BuilderState,
} from "./flow-editor-state";

export function EditorHeader() {
  const router = useRouter();
  const t = useTranslations("Flows.header");
  const {
    flow,
    state,
    setState,
    dirty,
    saving,
    activating,
    canActivate,
    save,
    setStatus,
    deleteFlow,
  } = useFlowEditor();
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5 px-6 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        {/* ---- left: back · icon · name · status · edited ---- */}
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => router.push("/flows")}
          title={t("backToFlows")}
          aria-label={t("backToFlows")}
        >
          <ArrowLeft />
        </Button>
        <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-selected text-primary">
          <Workflow className="h-[18px] w-[18px]" />
        </span>
        <input
          value={state.name}
          onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
          placeholder={t("flowName")}
          spellCheck={false}
          aria-label={t("flowName")}
          className="min-w-[120px] max-w-[340px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-[17px] font-semibold leading-tight text-foreground outline-none transition-colors hover:bg-hover focus:border-[#9FB6CF] focus:bg-transparent"
        />
        <StatusChip status={state.status} />
        {dirty && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-warning"
            title={t("unsaved")}
            aria-live="polite"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            {t("edited")}
          </span>
        )}

        {/* ---- right: runs · delete · activate · save ---- */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/flows/${flow.id}/runs`)}
          >
            <History />
            {t("runs")}
            <Badge variant="secondary" className="ml-0.5 tabular-nums">
              {flow.execution_count}
            </Badge>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="text-danger hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 />
            {t("delete")}
          </Button>
          {state.status === "active" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setStatus("draft")}
              disabled={activating}
            >
              {activating ? <Loader2 className="animate-spin" /> : <PauseCircle />}
              {t("pause")}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setStatus("active")}
              disabled={activating || !canActivate}
              title={!canActivate ? t("fixIssuesFirst") : undefined}
            >
              {activating ? <Loader2 className="animate-spin" /> : <PlayCircle />}
              {t("activate")}
            </Button>
          )}
          <Button onClick={() => void save()} disabled={saving} size="sm">
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {t("save")}
          </Button>
        </div>
      </div>

      {/* ---- description note (subtle, inline-editable) ---- */}
      <input
        value={state.description}
        onChange={(e) =>
          setState((s) => ({ ...s, description: e.target.value }))
        }
        placeholder={t("descriptionPlaceholder")}
        aria-label={t("descriptionAria")}
        className="w-full max-w-[78ch] rounded-lg border border-transparent bg-transparent px-2 py-1 text-[13px] text-muted-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-hover focus:border-[#9FB6CF] focus:bg-transparent focus:text-foreground"
      />

      <Dialog open={deleteOpen} onOpenChange={(o) => !o && setDeleteOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteDesc", { name: state.name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteOpen(false);
                void deleteFlow();
              }}
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusChip({ status }: { status: BuilderState["status"] }) {
  const t = useTranslations("Flows.header");
  // Neutral for draft and archived; green only when live. Amber stays
  // for the adjacent "Edited" dirty signal, so the two never read alike.
  const variant = status === "active" ? "success" : "secondary";
  return (
    <Badge variant={variant}>
      <CircleDot />
      {t(`status.${status}`)}
    </Badge>
  );
}
