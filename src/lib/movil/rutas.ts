// ============================================================
// Las rutas de la app movil. Puro, sin React ni I/O, para que el
// tabbar y el shell coincidan en que es una pestaña y que no.
//
// Cinco pestañas, las mismas cinco de docs/maquetas/bandeja-app.html
// (`TABS = ['inbox','contacts','flows','panel','settings']`). El chat NO
// es pestaña: es una pantalla de detalle y esconde el tabbar, igual que
// en la maqueta.
// ============================================================

export type TabId = "bandeja" | "contactos" | "flujos" | "panel" | "ajustes";

export interface MobileTab {
  id: TabId;
  href: string;
  /** Rotulo del tabbar y titulo de la pantalla. */
  label: string;
}

export const MOBILE_TABS: readonly MobileTab[] = [
  { id: "bandeja", href: "/m", label: "Bandeja" },
  { id: "contactos", href: "/m/contactos", label: "Contactos" },
  { id: "flujos", href: "/m/flujos", label: "Flujos" },
  { id: "panel", href: "/m/panel", label: "Panel" },
  { id: "ajustes", href: "/m/ajustes", label: "Ajustes" },
] as const;

/**
 * Cual pestaña esta activa para `pathname`, o null si la ruta no es
 * una pestaña (el chat). `/m` es exacto a proposito: si se comparara
 * por prefijo, `/m/ajustes` marcaria Bandeja tambien.
 */
export function activeTab(pathname: string): TabId | null {
  const clean = pathname.replace(/\/+$/, "") || "/m";
  for (const tab of MOBILE_TABS) {
    if (tab.id === "bandeja") {
      if (clean === "/m") return "bandeja";
      continue;
    }
    if (clean === tab.href || clean.startsWith(`${tab.href}/`)) return tab.id;
  }
  return null;
}

/** El tabbar se ve en las cinco pestañas y se esconde en el chat. */
export function showsTabBar(pathname: string): boolean {
  return activeTab(pathname) !== null;
}
