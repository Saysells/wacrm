"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { AccountAccessAlert } from "@/components/layout/account-access-alert";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { InboxStoreProvider } from "@/hooks/use-inbox-store";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.
//
// Estructura del rediseno (sesion A, prototipo `docs/rediseno/
// prototipo-v1.html`): una grilla de dos filas — barra superior de
// 64 px y cuerpo — y, en el cuerpo, la barra lateral apoyada
// directamente sobre el fondo gris de la app y el contenido de cada
// pantalla adentro de UNA tarjeta blanca de 16 px de radio, con 12 px
// de aire abajo y a la derecha. La tarjeta es la que scrollea; el
// cuerpo no.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="grid h-screen grid-rows-[4rem_1fr] overflow-hidden bg-background">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <TopBar onOpenSidebar={() => setSidebarOpen(true)} />
      <div className="flex min-h-0 overflow-hidden">
        {/* La barra lee `?vista=` / `?embudo=` con useSearchParams, que
            pide un Suspense para que el build no caiga a CSR entero. */}
        <Suspense fallback={null}>
          <Sidebar open={sidebarOpen} onClose={closeSidebar} />
        </Suspense>
        {/* La tarjeta de contenido. `min-w-0` para que una tabla ancha
            no la ensanche; `min-h-0` para que el scroll quede adentro. */}
        <div className="mx-3 mb-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-card shadow-card lg:ml-0">
          {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
          <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {/* Above every page: writes are being rejected and here's why.
                Renders nothing unless the account/role failed to resolve. */}
            <AccountAccessAlert />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {/* Una lista de conversaciones para toda la app (rediseño, sesión
          B): los contadores de la barra lateral y la lista de la Bandeja
          leen de acá, así cuentan siempre lo mismo. */}
      <InboxStoreProvider>
        <DashboardShellInner>{children}</DashboardShellInner>
      </InboxStoreProvider>
    </AuthProvider>
  );
}
