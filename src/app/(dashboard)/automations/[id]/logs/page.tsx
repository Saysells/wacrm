"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Check,
  Loader2,
  X,
  ChevronDown,
  ChevronRight, FileText } from "lucide-react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { useNow } from "@/hooks/use-now"
import { relativeTime } from "@/lib/inbox/vistas"
import { formatRelative } from "@/lib/inbox/time-text"

import { createClient } from "@/lib/supabase/client"
import type {
  Automation,
  AutomationLog,
  AutomationLogStepResult,
} from "@/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default function AutomationLogsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const t = useTranslations("Automations.logs")
  const tBuilder = useTranslations("Automations.builder")
  const tList = useTranslations("Inbox.conversationList")
  const now = useNow()
  // Nombre del disparador del catálogo del editor; si es uno que no
  // conocemos, el valor crudo.
  const triggerLabel = (ev: string) =>
    tBuilder.has(`triggers.${ev}.label`) ? tBuilder(`triggers.${ev}.label`) : ev

  const [automation, setAutomation] = useState<Automation | null>(null)
  const [logs, setLogs] = useState<AutomationLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openLogId, setOpenLogId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()
        const [autRes, logRes] = await Promise.all([
          supabase
            .from("automations")
            .select("*")
            .eq("id", id)
            .maybeSingle(),
          supabase
            .from("automation_logs")
            .select("*, contact:contacts(id, name, phone)")
            .eq("automation_id", id)
            .order("created_at", { ascending: false })
            .limit(100),
        ])
        if (autRes.error) throw autRes.error
        if (logRes.error) throw logRes.error
        setAutomation(autRes.data as Automation | null)
        setLogs((logRes.data ?? []) as AutomationLog[])
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadError"))
      }
    }
    load()
  }, [id])

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-danger">{error}</p>
        <Button variant="outline" onClick={() => router.push("/automations")}>
          {t("back")}
        </Button>
      </div>
    )
  }

  if (!automation || logs === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Encabezado común (rediseño, sesión F2). */}
      <PageHeader
        back={
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => router.push("/automations")}
            aria-label={t("backAria")}
            title={t("backAria")}
          >
            <ArrowLeft />
          </Button>
        }
        title={automation.name}
        meta={logs.length > 0 ? logs.length : undefined}
        note={t("title")}
      />

      {logs.length === 0 ? (
        <EmptyState icon={FileText} title={t("emptyTitle")} description={t("emptyDesc")} />
      ) : (
        <ul className="space-y-2">
          {logs.map((log) => {
            const isOpen = openLogId === log.id
            return (
              <li
                key={log.id}
                className="rounded-[14px] border border-border bg-card"
              >
                <button
                  type="button"
                  onClick={() => setOpenLogId(isOpen ? null : log.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <StatusBadge status={log.status} t={t} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {log.contact?.name ?? log.contact?.phone ?? t("unknownContact")}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {triggerLabel(log.trigger_event)} · {t("stepCount", { count: log.steps_executed?.length ?? 0 })}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {formatRelative(relativeTime(new Date(log.created_at).getTime(), now), tList)}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-border px-4 py-3">
                    {log.error_message && (
                      <p className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                        {log.error_message}
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {(log.steps_executed ?? []).map((r, i) => (
                        <StepRow key={i} result={r} tBuilder={tBuilder} />
                      ))}
                      {(log.steps_executed ?? []).length === 0 && (
                        <li className="text-xs text-muted-foreground">{t("noSteps")}</li>
                      )}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function StatusBadge({ status, t }: { status: AutomationLog["status"], t: ReturnType<typeof useTranslations> }) {
  // Chip de 5 px del sistema (sesión F2).
  const variant = status === "success" ? "success" : status === "partial" ? "warning" : "danger"
  return <Badge variant={variant}>{t(`status.${status}`)}</Badge>
}

function StepRow({ result, tBuilder }: { result: AutomationLogStepResult; tBuilder: ReturnType<typeof useTranslations> }) {
  const ok = result.status === "success"
  const stepLabel = tBuilder.has(`steps.${result.step_type}`)
    ? tBuilder(`steps.${result.step_type}`)
    : result.step_type
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px]",
          ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
        )}
        aria-hidden
      >
        {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </span>
      <span className="text-muted-foreground">{stepLabel}</span>
      {result.detail && (
        <span className="truncate text-muted-foreground">— {result.detail}</span>
      )}
    </li>
  )
}
