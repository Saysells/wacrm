"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTotalUnread } from "@/hooks/use-total-unread";
import { MOBILE_TABS, activeTab, type TabId } from "@/lib/movil/rutas";
import {
  IconContacts,
  IconFlows,
  IconInbox,
  IconPanel,
  IconSettings,
} from "@/components/movil/icons";

const ICONO: Record<TabId, () => React.JSX.Element> = {
  bandeja: IconInbox,
  contactos: IconContacts,
  flujos: IconFlows,
  panel: IconPanel,
  ajustes: IconSettings,
};

/**
 * El tabbar de la maqueta. Cada pestaña es un <Link>, no un boton con
 * router.push: asi el prefetch de Next precarga la pantalla al aparecer
 * en viewport y el toque se siente inmediato.
 *
 * El contador de no leidos sale de `useTotalUnread`, el MISMO hook que
 * alimenta el punto del sidebar de escritorio — canal de realtime
 * propio y filtrado por visibilidad. No se escribio ninguna
 * suscripcion nueva para esto.
 */
export function TabBar() {
  const pathname = usePathname();
  const activa = activeTab(pathname);
  const noLeidas = useTotalUnread();

  return (
    <nav className="m-tabbar" aria-label="Secciones">
      {MOBILE_TABS.map((tab) => {
        const Icono = ICONO[tab.id];
        const on = tab.id === activa;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`m-tab${on ? " on" : ""}`}
            aria-current={on ? "page" : undefined}
          >
            <Icono />
            {tab.label}
            {tab.id === "bandeja" && noLeidas > 0 ? (
              <span className="dot">{noLeidas}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
