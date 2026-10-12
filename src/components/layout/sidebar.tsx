"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import {
  Bell,
  Bot,
  Crown,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import { homePathFor, showsInNav } from "@/lib/auth/nav";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";

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

const navItems: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
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

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

import { useTranslations } from "next-intl";
import { APP_NAME } from "@/lib/app-name";
import { WhatsAppGlyph } from "@/components/brand/whatsapp-glyph";

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, permissionOverrides } =
    useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  // Plegada a solo iconos. Es una preferencia de ESCRITORIO: en mobile
  // la barra es un cajon que se abre y se cierra entero, asi que todo
  // lo que responde a `collapsed` va detras del breakpoint `lg:`. El
  // boton que la pliega esta en la barra superior.
  const { collapsed } = useSidebarCollapsed();

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

        {/* Main navigation */}
        {/* Prototipo `.nav`: 4 px arriba, 12 px a la derecha, 8 px a la
            izquierda; cada fila `.ni` mide 36 px con radio 10 px. */}
        <nav className="flex-1 overflow-x-hidden overflow-y-auto py-1 pr-3 pl-2">
          <ul className="flex flex-col gap-1">
            {visibleNavItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));

              const showUnreadDot =
                item.href === "/inbox" && totalUnread > 0 && !isActive;

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
                      // Taller on mobile so fingers can hit the row reliably (≥44px).
                      "relative flex h-11 items-center gap-3.5 rounded-[10px] pr-3 pl-4 text-sm transition-colors lg:h-9",
                      collapsed && "lg:justify-center lg:px-0",
                      isActive
                        ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-hover-strong hover:text-foreground",
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
                    {showUnreadDot && (
                      <span
                        aria-label={t("unreadConversations", { count: totalUnread })}
                        // Plegada no hay renglon donde apoyar el punto:
                        // se clava en la esquina del icono.
                        className={cn(
                          "relative flex h-2 w-2 shrink-0",
                          collapsed && "lg:absolute lg:right-2 lg:top-1.5",
                        )}
                      >
                        {/* Naranja: es lo que espera respuesta (regla del
                            sistema de diseno), no el color del acento. */}
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pending opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-pending" />
                      </span>
                    )}
                    {showNotificationBadge && (
                      <span
                        aria-label={t("unreadNotifications", { count: unreadNotifications })}
                        className={cn(
                          // Prototipo `.ni .c`: el contador va como numero
                          // a la derecha, sin pastilla.
                          "ml-auto shrink-0 text-[13px] font-semibold tabular-nums text-muted-foreground",
                          isActive && "text-sidebar-accent-foreground",
                          collapsed &&
                            "lg:absolute lg:right-1.5 lg:top-0.5 lg:rounded-[5px] lg:bg-sidebar-accent lg:px-1 lg:text-[10px] lg:leading-4",
                        )}
                      >
                        {unreadNotifications > 9 ? "9+" : unreadNotifications}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="my-3 border-t border-border" />

          <ul className="flex flex-col gap-1">
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
                      "flex h-11 items-center gap-3.5 rounded-[10px] pr-3 pl-4 text-sm transition-colors lg:h-9",
                      collapsed && "lg:justify-center lg:px-0",
                      isActive
                        ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-hover-strong hover:text-foreground",
                    )}
                  >
                    <item.icon className="size-[19px] shrink-0" strokeWidth={1.8} />
                    <span className={cn(collapsed && "lg:hidden")}>{label}</span>
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
    </>
  );
}
