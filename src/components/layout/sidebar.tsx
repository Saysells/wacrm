"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { useInboxStore } from "@/hooks/use-inbox-store";
import { useInboxSearch } from "@/hooks/use-inbox-search";
import { useNow } from "@/hooks/use-now";
import {
  Archive,
  Bell,
  Bot,
  Crown,
  GitBranch,
  Hourglass,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  Radio,
  Settings,
  Shield,
  SquarePen,
  User,
  UserCog,
  UserRoundPlus,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
  CalendarClock,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import { canSendMessages } from "@/lib/auth/roles";
import { homePathFor, showsInNav } from "@/lib/auth/nav";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import {
  VISTAS,
  countFunnel,
  countVistas,
  defaultVista,
  funnelCount,
  funnelGroups,
  hasScheduling,
  parseVista,
  type Vista,
} from "@/lib/inbox/vistas";
import { NewMessageDialog } from "@/components/inbox/new-message-dialog";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: "roleOwner",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className: "bg-warning-soft text-warning",
  },
  admin: {
    icon: Shield,
    labelKey: "roleAdmin",
    // Primary-tinted: significant but not as scarce as owner.
    className: "bg-selected-strong text-primary",
  },
  agent: {
    icon: UserCog,
    labelKey: "roleAgent",
    // Neutral slate: the operational default.
    className: "bg-neutral-soft text-neutral",
  },
  viewer: {
    icon: User,
    labelKey: "roleViewer",
    // Muted slate: read-only role; visually quieter than agent.
    className: "bg-muted text-muted-foreground",
  },
};

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
}

// Herramientas (rediseño, sesión B): todas las entradas de siempre
// menos "Bandeja", que la reemplazan las vistas de arriba. Los
// permisos son los mismos: `showsInNav` (nav.ts no se toca).
const navItems: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/notifications", labelKey: "notifications", icon: Bell },
  { href: "/contacts", labelKey: "contacts", icon: Users },
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
  { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
  { href: "/automations", labelKey: "automations", icon: Zap },
  { href: "/flows", labelKey: "flows", icon: Workflow, beta: true },
  { href: "/agents", labelKey: "aiAgents", icon: Bot },
];

const bottomNavItems = [
  { href: "/settings", labelKey: "settings", icon: Settings },
];

/** Vistas de la Bandeja (prototipo `VIEWS`): ícono y rótulo por clave. */
const VISTA_META: Record<Vista, { icon: typeof Inbox; labelKey: string }> = {
  "para-mi": { icon: Inbox, labelKey: "vistaParaMi" },
  "sin-tomar": { icon: UserRoundPlus, labelKey: "vistaSinTomar" },
  agendadas: { icon: CalendarClock, labelKey: "vistaAgendadas" },
  "por-vencer": { icon: Hourglass, labelKey: "vistaPorVencer" },
  todas: { icon: MessagesSquare, labelKey: "vistaTodas" },
  cerradas: { icon: Archive, labelKey: "vistaCerradas" },
};

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

import { useTranslations } from "next-intl";
import { APP_NAME } from "@/lib/app-name";
import { WhatsAppGlyph } from "@/components/brand/whatsapp-glyph";

/** Fila del nav (prototipo `.ni`): 36 px, radio 10 px, activo celeste. */
const NAV_ROW =
  "relative flex h-11 w-full items-center gap-3.5 rounded-[10px] pr-3 pl-4 text-left text-sm transition-colors lg:h-9";
const NAV_ROW_IDLE = "text-sidebar-foreground hover:bg-hover-strong hover:text-foreground";
const NAV_ROW_ACTIVE = "bg-sidebar-accent font-semibold text-sidebar-accent-foreground";
/** Contador a la derecha (prototipo `.ni .c`): número, sin pastilla. */
const NAV_COUNT = "ml-auto shrink-0 text-[13px] font-semibold tabular-nums text-muted-foreground";
const NAV_COUNT_COLLAPSED =
  "lg:absolute lg:right-1.5 lg:top-0.5 lg:rounded-[5px] lg:bg-sidebar-accent lg:px-1 lg:text-[10px] lg:leading-4";

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile, profileLoading, account, accountRole, permissionOverrides } =
    useAuth();
  const unreadNotifications = useUnreadNotifications();
  // Plegada a solo iconos. Es una preferencia de ESCRITORIO: en mobile
  // la barra es un cajon que se abre y se cierra entero, asi que todo
  // lo que responde a `collapsed` va detras del breakpoint `lg:`. El
  // boton que la pliega esta en la barra superior.
  const { collapsed } = useSidebarCollapsed();

  // Vistas y embudo (rediseño, sesión B): se cuentan sobre la MISMA
  // lista que pinta la Bandeja (store compartido), con el reloj por
  // minuto para "Por vencer".
  const store = useInboxStore();
  const inboxSearch = useInboxSearch();
  const now = useNow();
  const vistaCounts = useMemo(
    () => countVistas(store.conversations, { userId: user?.id ?? null, now }),
    [store.conversations, user?.id, now],
  );
  const funnelCounts = useMemo(() => countFunnel(store.conversations), [store.conversations]);
  const groups = useMemo(() => funnelGroups(store.tags), [store.tags]);
  const showAgendadas = useMemo(() => hasScheduling(store.tags), [store.tags]);

  const onInbox = pathname === "/inbox";
  const activeEmbudo = onInbox ? searchParams.get("embudo") : null;
  const activeVista: Vista | null =
    onInbox && !activeEmbudo
      ? (parseVista(searchParams.get("vista")) ?? defaultVista(accountRole))
      : null;
  const searching = onInbox && inboxSearch.trim().length > 0;

  // "Nuevo mensaje": mismo permiso que enviar. Al resolver, abre el
  // hilo por `?c=` (la Bandeja lo toma como deep link).
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const canStartConversation = !!accountRole && canSendMessages(accountRole);

  // Navegación por permisos: cada entrada mapea a una clave nav_* y
  // se resuelve por rol + overrides (el middleware bloquea además la
  // ruta directa — esto es presentación, no la frontera de seguridad).
  // Mientras el perfil carga, el rol es null y showsInNav falla
  // cerrado: primero se pinta el set reducido y se expande al
  // resolver, así nunca flashea un menú privilegiado.
  const visibleNavItems = navItems.filter((item) =>
    showsInNav(accountRole, permissionOverrides, item.href),
  );
  const visibleBottomNavItems = bottomNavItems.filter((item) =>
    showsInNav(accountRole, permissionOverrides, item.href),
  );
  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Once
  // the account is renamed or the user joins a shared account, the
  // name diverges and the strip becomes meaningful — that's the signal
  // we gate on. Wait for the profile fetch to settle first, otherwise
  // the strip flashes in once the row resolves (a layout jump).
  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const vistasToShow = VISTAS.filter((v) => v !== "agendadas" || showAgendadas);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-[rgba(15,23,42,0.34)] transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground shadow-menu",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          // Rediseno (sesion A): la barra se apoya directo sobre el fondo
          // gris de la app, sin panel ni borde propio; anchos del
          // prototipo (`.body` 248 px, `.body.nc` 76 px plegada).
          "lg:static lg:z-0 lg:translate-x-0 lg:shadow-none lg:transition-none",
          collapsed ? "lg:w-[76px]" : "lg:w-[248px]",
        )}
        aria-label="Primary"
      >
        {/* Rediseño (sesión A): en escritorio la barra ya no tiene fila
            de marca ni botón de plegar — la marca y el botón viven en la
            barra superior (`top-bar.tsx`). Esta fila existe solo en el
            cajón de mobile, para cerrarlo. */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4 lg:hidden">
          <Link
            href={homePathFor(accountRole, permissionOverrides)}
            className="flex min-w-0 items-center gap-2"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-primary text-primary-foreground">
              <WhatsAppGlyph className="h-4 w-4" />
            </div>
            <span className="truncate text-sm font-semibold text-foreground">
              {APP_NAME}
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-hover-strong hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Prototipo `.nav`: 4 px arriba, 12 px a la derecha, 8 px a la
            izquierda; cada fila `.ni` mide 36 px con radio 10 px. */}
        <nav className="flex-1 overflow-x-hidden overflow-y-auto py-1 pr-3 pl-2">
          {/* "Nuevo mensaje" (prototipo `.compose`): 56 px, celeste. */}
          {canStartConversation && (
            <button
              type="button"
              onClick={() => setNewMessageOpen(true)}
              aria-label={t("newMessage")}
              title={t("newMessage")}
              className={cn(
                "mt-1 mb-3.5 ml-1 inline-flex h-14 items-center gap-3 rounded-2xl bg-selected-strong pr-5.5 pl-4.5 text-[15px] font-semibold whitespace-nowrap text-primary transition-shadow hover:shadow-[0_1px_4px_rgba(16,24,40,0.18)]",
                collapsed && "lg:w-14 lg:justify-center lg:px-0",
              )}
            >
              <SquarePen className="size-5 shrink-0" strokeWidth={1.8} />
              <span className={cn(collapsed && "lg:hidden")}>{t("newMessage")}</span>
            </button>
          )}

          {/* Vistas */}
          <ul className="flex flex-col gap-1">
            {vistasToShow.map((vista) => {
              const meta = VISTA_META[vista];
              const label = t(meta.labelKey);
              const isActive = !searching && activeVista === vista;
              const count = vista === "cerradas" ? 0 : vistaCounts[vista];
              // Naranja solo para lo que espera respuesta: Sin tomar.
              const hot = vista === "sin-tomar" && count > 0;
              return (
                <li key={vista}>
                  <Link
                    href={`/inbox?vista=${vista}`}
                    aria-label={collapsed ? label : undefined}
                    title={collapsed ? label : undefined}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      NAV_ROW,
                      collapsed && "lg:justify-center lg:px-0",
                      isActive ? NAV_ROW_ACTIVE : NAV_ROW_IDLE,
                    )}
                  >
                    <meta.icon className="size-[19px] shrink-0" strokeWidth={1.8} />
                    <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>
                      {label}
                    </span>
                    {count > 0 && (
                      <span
                        aria-label={t("vistaCount", { count })}
                        className={cn(
                          NAV_COUNT,
                          isActive && "text-sidebar-accent-foreground",
                          hot && "text-unread",
                          collapsed && NAV_COUNT_COLLAPSED,
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Embudo: un renglón por grupo con su cuadrado de color. */}
          {groups.length > 0 && (
            <>
              <div
                className={cn(
                  "px-4 pt-4 pb-1.5 text-[13px] font-semibold whitespace-nowrap text-muted-foreground",
                  collapsed && "lg:hidden",
                )}
              >
                {t("funnel")}
              </div>
              <div className={cn("hidden", collapsed && "lg:my-3 lg:block lg:border-t lg:border-border")} />
              <ul className="flex flex-col gap-1">
                {groups.map((group) => {
                  const isActive =
                    !searching &&
                    !!activeEmbudo &&
                    activeEmbudo.trim().toLocaleLowerCase() === group.name.toLocaleLowerCase();
                  const count = funnelCount(funnelCounts, group.name);
                  return (
                    <li key={group.name}>
                      <Link
                        href={`/inbox?embudo=${encodeURIComponent(group.name)}`}
                        aria-label={collapsed ? group.name : undefined}
                        title={collapsed ? group.name : undefined}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          NAV_ROW,
                          collapsed && "lg:justify-center lg:px-0",
                          isActive ? NAV_ROW_ACTIVE : NAV_ROW_IDLE,
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="mx-1 size-[11px] shrink-0 rounded-[3px]"
                          style={{ background: group.color }}
                        />
                        <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>
                          {group.name}
                        </span>
                        {count > 0 && (
                          <span
                            aria-label={t("vistaCount", { count })}
                            className={cn(
                              NAV_COUNT,
                              isActive && "text-sidebar-accent-foreground",
                              collapsed && NAV_COUNT_COLLAPSED,
                            )}
                          >
                            {count}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {/* Herramientas */}
          <div
            className={cn(
              "px-4 pt-4 pb-1.5 text-[13px] font-semibold whitespace-nowrap text-muted-foreground",
              collapsed && "lg:hidden",
            )}
          >
            {t("tools")}
          </div>
          <div className={cn("hidden", collapsed && "lg:my-3 lg:block lg:border-t lg:border-border")} />
          <ul className="flex flex-col gap-1">
            {visibleNavItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));

              // Unlike the inbox dot, the notifications count stays visible
              // even while the page is active — it reflects unread state
              // (cleared by marking notifications read), not "currently
              // viewing this section".
              const showNotificationBadge =
                item.href === "/notifications" && unreadNotifications > 0;

              const label = t(item.labelKey as string);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    // Plegada, el rotulo desaparece en lg y con el la
                    // unica etiqueta accesible de la fila: la repone
                    // `aria-label`, y `title` la muestra al pasar el mouse.
                    aria-label={collapsed ? label : undefined}
                    title={collapsed ? label : undefined}
                    className={cn(
                      NAV_ROW,
                      collapsed && "lg:justify-center lg:px-0",
                      isActive ? NAV_ROW_ACTIVE : NAV_ROW_IDLE,
                    )}
                  >
                    <item.icon className="size-[19px] shrink-0" strokeWidth={1.8} />
                    <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>
                      {label}
                    </span>
                    {item.beta && (
                      <span
                        aria-label={t("beta")}
                        className={cn(
                          "rounded-[5px] bg-warning-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-warning",
                          collapsed && "lg:hidden",
                        )}
                      >
                        {t("beta")}
                      </span>
                    )}
                    {showNotificationBadge && (
                      <span
                        aria-label={t("unreadNotifications", { count: unreadNotifications })}
                        className={cn(
                          NAV_COUNT,
                          isActive && "text-sidebar-accent-foreground",
                          collapsed && NAV_COUNT_COLLAPSED,
                        )}
                      >
                        {unreadNotifications > 9 ? "9+" : unreadNotifications}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
            {visibleBottomNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              const label = t(item.labelKey as string);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-label={collapsed ? label : undefined}
                    title={collapsed ? label : undefined}
                    className={cn(
                      NAV_ROW,
                      collapsed && "lg:justify-center lg:px-0",
                      isActive ? NAV_ROW_ACTIVE : NAV_ROW_IDLE,
                    )}
                  >
                    <item.icon className="size-[19px] shrink-0" strokeWidth={1.8} />
                    <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Franja de cuenta — solo cuando el nombre de la cuenta difiere
            del de la persona (ver `showAccountStrip`). El menú de avatar
            que iba acá pasó a la barra superior. */}
        {showAccountStrip && account?.name ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-2 px-6 pb-4 pt-2 text-xs text-muted-foreground",
              // Plegada no entra ni el nombre ni el chip de rol; el
              // rol sigue visible en Configuracion.
              collapsed && "lg:hidden",
            )}
          >
            <UsersRound className="size-3.5 shrink-0" />
            {/* `title=` exposes the full name on hover when it
                gets truncated (long account names + narrow
                sidebars). Cheap a11y win. */}
            <span className="truncate" title={account.name}>
              {account.name}
            </span>
            {accountRole ? (
              (() => {
                const meta = ROLE_CHIP[accountRole];
                const Icon = meta.icon;
                return (
                  <span
                    className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                  >
                    <Icon className="size-3" />
                    {t(meta.labelKey as string)}
                  </span>
                );
              })()
            ) : null}
          </div>
        ) : null}
      </aside>

      {canStartConversation && (
        <NewMessageDialog
          open={newMessageOpen}
          onOpenChange={setNewMessageOpen}
          onOpenConversation={(conversationId) => {
            setNewMessageOpen(false);
            router.push(`/inbox?c=${encodeURIComponent(conversationId)}`);
          }}
        />
      )}
    </>
  );
}
