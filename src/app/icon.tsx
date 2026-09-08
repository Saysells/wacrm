import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with la marca de la Bandeja
// KOSMO — cuadrado navy redondeado + dos bocadillos superpuestos.
// Next.js renderiza esto en build time e inyecta solo el
// <link rel="icon"> en el <head>.
//
// El navy está hard-codeado a propósito: esto es un PNG de build time,
// no ve las CSS custom properties, y un favicon no puede seguir el
// acento elegido por el usuario. Espeja el navy de marca detrás de
// `--primary` del tema `saysells` en globals.css.
//
// El glifo son dos bocadillos: el de atrás (celeste, arriba a la
// derecha) y el de adelante (celeste, abajo a la izquierda, con su
// cola). Entre los dos van dos rellenos navy — un rect y la cola —
// que abren el hueco que los separa. Ese navy TIENE que ser
// exactamente el mismo que el del fondo: es lo que hace que el hueco
// se lea como aire y no como un tercer color. Por eso los dos
// bocadillos no se empastan a 32x32. Verificado renderizando a 32 y
// mirándolo.
//
// El dibujo va inline y no sale de `@/components/brand/whatsapp-glyph`:
// ese sigue siendo el mark de WhatsApp que usan el sidebar y las
// pantallas de auth, y este ícono ya no lo usa.
//
// Esta ruta tiene precedencia sobre src/app/favicon.ico, que es el
// default de Next.js y puede quedarse en disco sin molestar (o
// borrarse).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const NAVY = "#1C2B48";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: NAVY,
          borderRadius: 6,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 100 100">
          <rect x="36" y="4" width="60" height="42" rx="11" fill="#8EB1D1" />
          <rect x="-3" y="23" width="82" height="62" rx="18" fill="#1C2B48" />
          <path d="M11 71 L11 106 L51 71 Z" fill="#1C2B48" />
          <rect x="4" y="30" width="68" height="48" rx="12" fill="#8EB1D1" />
          <path d="M18 74 L18 98 L44 74 Z" fill="#8EB1D1" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
