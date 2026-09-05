"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { rutaSegunAncho } from "@/lib/movil/deteccion";

/**
 * La raiz reparte: desde un telefono, a la app movil; desde una ventana
 * grande, al panel de siempre.
 *
 * Antes era un `redirect('/dashboard')` de servidor. Ahora es de
 * cliente porque el ancho de la ventana no existe en el servidor y la
 * deteccion tiene que ser por ancho, no por user agent (que miente:
 * el iPad pide escritorio por default y cualquier navegador tiene el
 * interruptor de "solicitar version de escritorio").
 *
 * Nadie se queda aca: /m y /dashboard siguen accesibles a mano, que es
 * como se prueba la app movil desde una computadora.
 */
export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(rutaSegunAncho(window.innerWidth));
  }, [router]);

  // Un fondo del color de la app en vez de blanco: el salto dura un
  // frame, pero en un telefono en modo oscuro un flash blanco se ve.
  return <div className="min-h-dvh bg-background" />;
}
