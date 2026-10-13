"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useInboxStore } from "@/hooks/use-inbox-store";
import { useNow } from "@/hooks/use-now";
import type { Notification } from "@/types";
import { Bell, CheckCheck, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { uniqueChannelName } from "@/lib/realtime/channel-name";
import {
  missingContactIds,
  notificationText,
  prependNotification,
  unreadCount,
  withContactNames,
} from "@/lib/inbox/notificaciones";
import { relativeTime } from "@/lib/inbox/vistas";
import { formatRelative } from "@/lib/inbox/time-text";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ============================================================
// Notificaciones (rediseño, sesión F1): encabezado como Contactos
// (título, contador de sin leer, "Marcar todas como leídas") y filas
// con el estilo de la lista de la Bandeja. El texto se arma en el
// navegador (`src/lib/inbox/notificaciones.ts`): la base escribe
// título y texto en inglés y eso no se toca. Click: la marca leída y
// abre la conversación, como siempre.
// ============================================================

// Icon per notification type. Only one type exists today
// (conversation_assigned) but this keeps future types a one-line add.
const TYPE_ICON: Record<Notification["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
};

export default function NotificationsPage() {
  const t = useTranslations("Notifications");
  const tList = useTranslations("Inbox.conversationList");
  const router = useRouter();
  const { accountId } = useAuth();
  const { memberNames } = useInboxStore();
  const now = useNow();
  const [notifications, setNotifications] = useState<Notification[] | null>(
    null,
  );
  // Nombre (o teléfono) de cada contacto nombrado en la lista: una
  // consulta a `contacts` con los ids que faltan, también para las que
  // llegan en vivo.
  const [contactNames, setContactNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("notifications")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Los contactos que la lista nombra y todavía no conocemos. Ante un
  // error de lectura la fila dice "un contacto" en vez de romper.
  const missing = useMemo(
    () => missingContactIds(notifications ?? [], contactNames),
    [notifications, contactNames],
  );
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    const ids = missingKey.split(",");
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("contacts").select("id, name, phone").in("id", ids);
      if (cancelled || !data) return;
      setContactNames((prev) => withContactNames(prev, data));
    })();
    return () => {
      cancelled = true;
    };
  }, [missingKey]);

  // Realtime — new assignments appear without a refresh, and a
  // "mark all read" fired from another tab/device stays in sync here.
  // Un canal por instancia con nombre único (`uniqueChannelName`).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(uniqueChannelName("notifications-page"))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            setNotifications((prev) => prependNotification(prev, row));
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as Notification;
            setNotifications((prev) =>
              prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ??
              prev,
            );
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications(
              (prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev,
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      // Optimistic — the row is already visually "read" by the time the
      // request lands, so the UI doesn't wait on the round-trip.
      setNotifications(
        (prev) =>
          prev?.map((n) =>
            n.id === id && !n.read_at
              ? { ...n, read_at: new Date().toISOString() }
              : n,
          ) ?? prev,
      );
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (updateErr) {
        toast.error(t("toastMarkFailed"));
        load();
      }
    },
    [load, t],
  );

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      }
    },
    [markRead, router],
  );

  const unread = unreadCount(notifications);

  const markAllRead = useCallback(async () => {
    if (unread === 0) return;
    setMarkingAll(true);
    const nowIso = new Date().toISOString();
    setNotifications(
      (prev) => prev?.map((n) => (n.read_at ? n : { ...n, read_at: nowIso })) ?? prev,
    );
    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from("notifications")
      .update({ read_at: nowIso })
      .is("read_at", null);
    setMarkingAll(false);
    if (updateErr) {
      toast.error(t("toastMarkAllFailed"));
      load();
    }
  }, [unread, load, t]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-danger">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (notifications === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    // Ocupa la tarjeta entera (como Contactos): encabezado fijo, lista con scroll.
    <div className="-m-4 flex h-[calc(100%+2rem)] flex-col overflow-hidden sm:-m-6 sm:h-[calc(100%+3rem)]">
      {/* Encabezado común (`PageHeader`, prototipo `.ctop`). */}
      <PageHeader
        padded
        border
        title={t("title")}
        meta={unread > 0 ? t("unreadCount", { count: unread }) : undefined}
        actions={
          <Button
            variant="outline"
            disabled={unread === 0 || markingAll}
            onClick={markAllRead}
          >
            {markingAll ? <Loader2 className="animate-spin" /> : <CheckCheck />}
            {t("markAllRead")}
          </Button>
        }
      />

      {notifications.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={Bell}
          title={t("emptyTitle")}
          description={t("emptyBody")}
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-2">
          {notifications.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            const isUnread = !n.read_at;
            const text = notificationText(n, memberNames, contactNames);
            const contact =
              text.kind === "raw" ? "" : (text.contact ?? t("someContact"));
            const line =
              text.kind === "assignedBy"
                ? t("assignedBy", { actor: text.actor, contact })
                : text.kind === "assigned"
                  ? t("assigned", { contact })
                  : text.title;
            const createdAt = new Date(n.created_at).getTime();
            const when = Number.isNaN(createdAt) ? "" : formatRelative(relativeTime(createdAt, now), tList);
            return (
              <li key={n.id}>
                {/* Fila como `row()` de la lista: ícono de 42, texto, hora. */}
                <button
                  type="button"
                  onClick={() => handleClick(n)}
                  className="mx-2 flex w-[calc(100%-16px)] items-center gap-3 rounded-xl px-3.5 py-[11px] text-left transition-colors hover:bg-hover"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-[42px] shrink-0 place-items-center rounded-full",
                      isUnread ? "bg-selected-strong text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[15px] text-foreground",
                        isUnread ? "font-bold" : "font-medium",
                      )}
                    >
                      {line}
                    </span>
                    {text.kind === "raw" && text.body && (
                      <span className="mt-0.5 block truncate text-[13.5px] text-sidebar-foreground">
                        {text.body}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {isUnread && (
                      <span
                        aria-label={t("unread")}
                        className="size-2 rounded-full bg-unread"
                      />
                    )}
                    <span
                      className={cn(
                        "text-[12.5px] tabular-nums",
                        isUnread ? "font-semibold text-primary" : "text-muted-foreground",
                      )}
                    >
                      {when}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
