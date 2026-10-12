"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState, useSyncExternalStore, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  CircleQuestionMark,
  FilePen,
  Globe,
  Grip,
  Kanban,
  Layers,
  LogOut,
  Menu,
  MessagesSquare,
  Moon,
  Search,
  Settings as SettingsIcon,
  Sun,
  User,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { setInboxSearch, useInboxSearch } from "@/hooks/use-inbox-search";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { useSaysellsSelector } from "@/hooks/use-saysells-selector";
import { openShortcutsHelp } from "@/hooks/use-shortcuts-help";
import { APP_NAME } from "@/lib/app-name";
import { homePathFor } from "@/lib/auth/nav";
import {
  SAYSELLS_APPS,
  bandejaColor,
  bandejaInitials,
  isCurrentBandeja,
  type Bandeja,
  type SaysellsApp,
} from "@/lib/saysells/selector";
import { cn } from "@/lib/utils";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ============================================================
// Barra superior (rediseño, sesión A), prototipo `.top`: estilo Google
// Workspace, 64 px de alto sobre el fondo gris de la app.
//
//   izquierda  botón de menú (abre el cajón en mobile, pliega la barra
//              en escritorio) · marca · selector de bandeja
//   centro     buscador grande; Enter lleva a Contactos con `?q=`
//   derecha    campana con contador · lanzador de apps · avatar
//
// El selector y el lanzador aparecen SOLO si `GET /api/saysells/
// selector` dice `visible: true` (gente de Saysells, por variables de
// servidor). Para el resto la barra muestra el nombre de la Bandeja
// sin desplegable y sin lanzador.
// ============================================================

/** Botón redondo de 40 px del prototipo (`.ib`). */
const ICON_BUTTON =
  "relative inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sidebar-foreground transition-colors outline-none hover:bg-hover-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-selected-strong data-popup-open:text-primary";

const noopSubscribe = () => () => {};
/** Host actual, null en el servidor y en la primera pasada de hidratación. */
function useCurrentHost(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.host.toLowerCase(),
    () => null,
  );
}

const APP_ICONS: Record<SaysellsApp["key"], typeof Grip> = {
  bandejas: MessagesSquare,
  crm: Kanban,
  propuestas: FilePen,
  sayworld: Layers,
  portal: Globe,
};

function BandejaBadge({ nombre, size }: { nombre: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-lg text-xs font-bold tracking-[0.3px] text-white"
      style={{ width: size, height: size, background: bandejaColor(nombre) }}
    >
      {bandejaInitials(nombre)}
    </span>
  );
}

interface TopBarProps {
  /** Wired to the shell's drawer state. Used only on mobile. */
  onOpenSidebar?: () => void;
}

export function TopBar({ onOpenSidebar }: TopBarProps) {
  const t = useTranslations("TopBar");
  const router = useRouter();
  const pathname = usePathname();
  // Búsqueda (rediseño, sesión B): en la Bandeja filtra mientras se
  // escribe, a través del store compartido; desde otra pantalla Enter
  // lleva a la Bandeja con `?q=`.
  const inboxSearch = useInboxSearch();
  const onInbox = pathname === "/inbox";
  const { profile, accountRole, permissionOverrides, signOut } = useAuth();
  const { mode, toggleMode } = useTheme();
  const { collapsed, toggle } = useSidebarCollapsed();
  const unreadNotifications = useUnreadNotifications();
  const selector = useSaysellsSelector();
  const currentHost = useCurrentHost();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  /** Bandeja que se está abriendo: muestra la transición hasta que el navegador se va. */
  const [opening, setOpening] = useState<Bandeja | null>(null);
  const [query, setQuery] = useState("");

  const goTo = useCallback((bandeja: Bandeja) => {
    if (!bandeja.url) return;
    setPickerOpen(false);
    setOpening(bandeja);
    // Un respiro para que se vea "Abriendo…" antes de que la pestaña
    // cambie de dirección; la otra Bandeja es otro dominio, así que
    // es una navegación completa, no del router.
    window.setTimeout(() => {
      window.location.assign(bandeja.url as string);
    }, 450);
  }, []);

  const searchValue = onInbox ? inboxSearch : query;
  const onSearchChange = (value: string) => {
    if (onInbox) setInboxSearch(value);
    else setQuery(value);
  };
  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (onInbox) return; // ya está filtrando
    const q = query.trim();
    setQuery("");
    router.push(q ? `/inbox?q=${encodeURIComponent(q)}` : "/inbox");
  };

  const userName = profile?.full_name ?? t("defaultUser");
  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="flex h-16 min-w-0 items-center gap-1.5 px-3">
      {/* Menú: en mobile abre el cajón; en escritorio pliega la barra.
          Son dos botones con el mismo ícono porque hacen cosas distintas. */}
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label={t("openMenu")}
        title={t("openMenu")}
        className={cn(ICON_BUTTON, "lg:hidden")}
      >
        <Menu className="size-5" />
      </button>
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}
        aria-expanded={!collapsed}
        title={collapsed ? t("expandSidebar") : t("collapseSidebar")}
        className={cn(ICON_BUTTON, "hidden lg:inline-flex")}
      >
        <Menu className="size-5" />
      </button>

      {/* Marca (prototipo `.logo`): cuadrado navy con la S y el producto. */}
      <Link
        href={homePathFor(accountRole, permissionOverrides)}
        className="mr-2.5 hidden items-center gap-2.5 sm:flex"
      >
        <span className="grid size-8 place-items-center rounded-[9px] bg-primary text-[17px] font-bold text-primary-foreground">
          S
        </span>
        <span className="text-xl text-sidebar-foreground">{t("product")}</span>
      </Link>

      {/* Selector de bandeja (prototipo `.picker`). */}
      {selector.visible ? (
        <DropdownMenu open={pickerOpen} onOpenChange={setPickerOpen}>
          <DropdownMenuTrigger
            aria-label={t("switchInbox")}
            className="flex h-11 min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card py-0 pr-2.5 pl-1.5 text-left transition-colors outline-none hover:border-[#CDD5DF] focus-visible:ring-2 focus-visible:ring-ring data-popup-open:border-primary md:min-w-[236px]"
          >
            <BandejaBadge nombre={APP_NAME} size={30} />
            <span className="hidden min-w-0 md:block">
              <b className="block truncate text-sm font-semibold leading-tight text-foreground">
                {APP_NAME}
              </b>
              <span className="block truncate text-xs leading-tight text-muted-foreground">
                {currentHost ?? ""}
              </span>
            </span>
            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[370px] max-w-[calc(100vw-24px)]">
            {/* DropdownMenuGroup es OBLIGATORIO: DropdownMenuLabel es el
                Menu.GroupLabel de base-ui y tira error al renderizarse sin
                un Menu.Group arriba; suelto, abrir el selector tiraba la
                página entera (mismo caso del issue #336). */}
            <DropdownMenuGroup>
            <DropdownMenuLabel>{t("inboxesHeading")}</DropdownMenuLabel>
            {selector.bandejas.map((bandeja) => {
              const current = isCurrentBandeja(bandeja, currentHost);
              const off = !bandeja.url;
              return (
                <DropdownMenuItem
                  key={`${bandeja.nombre}|${bandeja.url ?? ""}`}
                  disabled={off}
                  onClick={() => {
                    if (!current) goTo(bandeja);
                  }}
                  className={cn("gap-3", current && "bg-selected")}
                >
                  <BandejaBadge nombre={bandeja.nombre} size={36} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate font-semibold">{bandeja.nombre}</b>
                    <span className="block truncate text-[12.5px] text-muted-foreground">
                      {bandeja.dominio ?? t("comingSoon")}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {current ? (
                      <Check className="size-4" aria-label={t("current")} />
                    ) : off ? null : (
                      <ArrowUpRight className="size-4" />
                    )}
                  </span>
                </DropdownMenuItem>
              );
            })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex h-11 min-w-0 items-center gap-2.5 pl-1.5 pr-2.5">
          <BandejaBadge nombre={APP_NAME} size={30} />
          <span className="hidden min-w-0 md:block">
            <b className="block truncate text-sm font-semibold leading-tight text-foreground">
              {APP_NAME}
            </b>
            <span className="block truncate text-xs leading-tight text-muted-foreground">
              {currentHost ?? ""}
            </span>
          </span>
        </div>
      )}

      {/* Buscador (prototipo `.search`): 48 px, gris; blanco al enfocar. */}
      <form
        role="search"
        onSubmit={onSearch}
        className="ml-2 flex h-12 min-w-0 flex-1 items-center gap-3 rounded-xl bg-hover-strong px-4 text-sidebar-foreground transition-colors focus-within:bg-card focus-within:shadow-[0_1px_3px_rgba(16,24,40,0.12)] focus-within:ring-1 focus-within:ring-border sm:ml-5 lg:max-w-[640px]"
      >
        <Search className="size-5 shrink-0" aria-hidden="true" />
        <input
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("searchPlaceholder", { name: APP_NAME })}
          aria-label={t("searchLabel")}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
        />
      </form>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {/* "Atajos de teclado" (sesión E), antes de la campana, en todas
            las pantallas. En esta versión de lucide el CircleHelp del
            prototipo se llama CircleQuestionMark. */}
        <button
          type="button"
          onClick={openShortcutsHelp}
          aria-label={t("shortcuts")}
          title={t("shortcuts")}
          className={ICON_BUTTON}
        >
          <CircleQuestionMark className="size-5" />
        </button>

        {/* Campana con el contador de no leídas que ya existe. */}
        <Link
          href="/notifications"
          aria-label={
            unreadNotifications > 0
              ? t("unreadNotifications", { count: unreadNotifications })
              : t("notifications")
          }
          title={t("notifications")}
          className={ICON_BUTTON}
        >
          <Bell className="size-5" />
          {unreadNotifications > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-[5px] bg-pending px-1 text-[10px] font-bold leading-none text-pending-foreground ring-2 ring-background"
            >
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </Link>

        {/* Lanzador de 9 puntos (prototipo `.apps`), solo con selector visible. */}
        {selector.visible && (
          <DropdownMenu open={appsOpen} onOpenChange={setAppsOpen}>
            <DropdownMenuTrigger
              aria-label={t("apps")}
              title={t("apps")}
              className={ICON_BUTTON}
            >
              <Grip className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[330px] max-w-[calc(100vw-24px)] p-3">
              <div className="grid grid-cols-3 gap-1">
                {SAYSELLS_APPS.map((app) => {
                  const Icon = APP_ICONS[app.key];
                  const tile = (
                    <>
                      <i
                        aria-hidden="true"
                        className="grid size-12 place-items-center rounded-[14px] text-white"
                        style={{ background: app.color }}
                      >
                        <Icon className="size-6" />
                      </i>
                      {app.nombre}
                    </>
                  );
                  const tileClass =
                    "flex flex-col items-center gap-2 rounded-xl px-1 py-3.5 text-[13px] font-medium text-foreground focus:bg-hover";
                  if (!app.url) {
                    return (
                      <DropdownMenuItem
                        key={app.key}
                        className={cn(tileClass, "bg-selected")}
                        onClick={() => {
                          setAppsOpen(false);
                          setPickerOpen(true);
                        }}
                      >
                        {tile}
                      </DropdownMenuItem>
                    );
                  }
                  return (
                    <DropdownMenuItem
                      key={app.key}
                      className={tileClass}
                      render={
                        <a href={app.url} target="_blank" rel="noopener noreferrer" />
                      }
                    >
                      {tile}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Avatar con el menú de siempre más el modo. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("openAccountMenu")}
            title={userName}
            className="ml-1.5 inline-flex shrink-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Avatar className="size-[34px]">
              {profile?.avatar_url ? (
                <AvatarImage
                  src={profile.avatar_url}
                  alt={profile.full_name ?? t("defaultAvatar")}
                />
              ) : null}
              <AvatarFallback className="bg-selected-strong text-[13px] font-semibold text-primary">
                {initial}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-60">
            <div className="px-4 pt-3 pb-2">
              <p className="truncate text-sm font-semibold text-foreground">{userName}</p>
              <p className="truncate text-xs text-muted-foreground">{profile?.email ?? ""}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/settings?tab=profile" />}>
              <User className="size-4" />
              {t("menuProfile")}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/settings?tab=whatsapp" />}>
              <SettingsIcon className="size-4" />
              {t("menuSettings")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleMode}>
              {mode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              {mode === "dark" ? t("modeLight") : t("modeDark")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOut className="size-4" />
              {t("menuSignOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Transición "Abriendo dominio…" (prototipo `.trans`). */}
      {opening && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-[90] grid place-items-center bg-background/90 text-[15px] text-sidebar-foreground"
        >
          <div className="flex flex-col items-center gap-3.5">
            <span
              aria-hidden="true"
              className="size-7 animate-spin rounded-full border-[3px] border-selected-strong border-t-primary"
            />
            {t("opening", { domain: opening.dominio ?? opening.nombre })}
          </div>
        </div>
      )}
    </header>
  );
}
