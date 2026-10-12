"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, FilePen, StickyNote, User } from "lucide-react";

import { useInboxStore } from "@/hooks/use-inbox-store";
import { useSaysellsSelector } from "@/hooks/use-saysells-selector";
import { useSidePanel } from "@/hooks/use-side-panel";
import { visibleSideTabs, type SideTab } from "@/lib/inbox/side-panel";
import { hasScheduling } from "@/lib/inbox/vistas";
import { cn } from "@/lib/utils";

// ============================================================
// Riel del panel lateral (rediseño, sesión D), prototipo `rail()`:
// la columna de 56 px a la derecha de la tarjeta, en todas las
// pantallas desde `lg`, con una pestaña por herramienta del panel:
// Ficha, Llamadas (solo si la cuenta agenda), Notas y Propuestas (solo
// el equipo de Saysells). Sin el "+" del prototipo.
//
// En la Bandeja, tocar la pestaña activa cierra el panel y otra lo
// abre ahí. Desde otra pantalla lleva a la Bandeja con esa pestaña
// abierta.
// ============================================================

const TAB_ICONS: Record<SideTab, typeof User> = {
  ficha: User,
  calls: CalendarClock,
  notes: StickyNote,
  props: FilePen,
};

/** Botón redondo de 40 px del prototipo (`.ib`). */
const RAIL_BUTTON =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sidebar-foreground transition-colors outline-none hover:bg-hover-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

export function SideRail() {
  const t = useTranslations("Inbox.sidebar");
  const pathname = usePathname();
  const router = useRouter();
  const panel = useSidePanel();
  const { tags } = useInboxStore();
  const selector = useSaysellsSelector();

  const onInbox = pathname === "/inbox";
  const tabs = useMemo(
    () => visibleSideTabs({ scheduling: hasScheduling(tags), saysells: selector.visible }),
    [tags, selector.visible],
  );

  const labels: Record<SideTab, string> = {
    ficha: t("tabFicha"),
    calls: t("tabCalls"),
    notes: t("tabNotes"),
    props: t("tabProposals"),
  };

  const onTab = (tab: SideTab) => {
    if (onInbox) {
      panel.toggleTab(tab);
      return;
    }
    panel.show(tab);
    router.push("/inbox");
  };

  return (
    <aside
      aria-label={t("railLabel")}
      className="hidden w-14 shrink-0 flex-col items-center gap-2 pt-2 lg:flex"
    >
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab];
        const active = onInbox && panel.open && panel.tab === tab;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onTab(tab)}
            aria-label={labels[tab]}
            aria-pressed={active}
            title={labels[tab]}
            className={cn(RAIL_BUTTON, active && "bg-selected-strong text-primary hover:bg-selected-strong hover:text-primary")}
          >
            <Icon className="size-5" />
          </button>
        );
      })}
    </aside>
  );
}
