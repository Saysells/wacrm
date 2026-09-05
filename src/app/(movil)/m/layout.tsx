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
  title: APP_NAME,
  robots: { index: false, follow: false, nocache: true },
  appleWebApp: {
    // Genera <meta name="apple-mobile-web-app-capable" content="yes">.
    // Sin esto, agregar a la pantalla de inicio abre una pestaña de
    // Safari con toda su barra en vez de una app a pantalla completa.
    capable: true,
    // black-translucent deja el contenido pasar POR DEBAJO de la barra
    // de estado; el hueco lo reserva `padding-top: var(--sat)` de la
    // barra superior con env(safe-area-inset-top).
    statusBarStyle: "black-translucent",
    title: APP_NAME,
  },
  other: {
    // El equivalente estandar del de Apple, para Chrome en Android.
    "mobile-web-app-capable": "yes",
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
