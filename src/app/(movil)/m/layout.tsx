import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";

import { APP_NAME } from "@/lib/app-name";
import { MobileShell } from "@/components/movil/shell";

import "./movil.css";

// La tipografia de la maqueta. Va por next/font (self-hosted en el
// build) y no por un <link> a Google Fonts: el layout raiz no se toca y
// el escritorio sigue con Inter.
const outfit = Outfit({
  variable: "--m-font",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  // `absolute` para saltear el template del layout raiz (`%s — APP`),
  // que si no deja el titulo repetido dos veces.
  title: { absolute: APP_NAME },
  robots: { index: false, follow: false, nocache: true },
  // Solo el layout movil declara el manifest, asi el HTML de las
  // paginas de escritorio queda exactamente como estaba.
  manifest: "/app-movil.webmanifest",
  icons: {
    // El favicon de la pestaña sigue siendo el de siempre.
    icon: [{ url: "/icon" }],
    // iOS usa ESTE para el icono de la pantalla de inicio, y solo
    // entiende PNG. Es el que venia incrustado en la maqueta.
    apple: [{ url: "/movil/icono.png", sizes: "180x180" }],
  },
  appleWebApp: {
    // black-translucent deja el contenido pasar POR DEBAJO de la barra
    // de estado; el hueco lo reserva `padding-top: var(--sat)` de la
    // barra superior con env(safe-area-inset-top).
    statusBarStyle: "black-translucent",
    // El nombre debajo del icono en la pantalla de inicio.
    title: APP_NAME,
  },
  other: {
    // Los dos nombres, a mano y a proposito.
    //
    // `appleWebApp.capable: true` de Next YA NO emite
    // `apple-mobile-web-app-capable`: en Next 16 escribe el nombre
    // estandar `mobile-web-app-capable`. Se comprobo mirando el HTML
    // renderizado de /m, no deduciendolo. Y el nombre viejo sigue
    // haciendo falta: iOS lee el `display` del manifest recien desde
    // 16.4, y antes de eso este meta es lo UNICO que hace que agregar a
    // la pantalla de inicio abra a pantalla completa en vez de una
    // pestaña de Safari con toda su barra.
    //
    // `mobile-web-app-capable` NO va aca: Next lo emite solo con que
    // exista el bloque `appleWebApp`, y declararlo tambien lo dejaba
    // repetido dos veces en el HTML.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // El par que impide el zoom por doble toque y, sobre todo, el zoom
  // automatico de Safari al enfocar un input. La otra mitad de ese
  // arreglo es `font-size: 16px` en inputs y textareas (movil.css).
  maximumScale: 1,
  userScalable: false,
  // Sin esto la app no llega a los bordes de la pantalla en el iPhone y
  // env(safe-area-inset-*) devuelve 0 en todos lados.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F6F8" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1520" },
  ],
};

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MobileShell className={outfit.variable}>{children}</MobileShell>;
}
