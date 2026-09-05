import { APP_NAME } from "@/lib/app-name";

// ============================================================
// El manifest de la app movil, para agregarla a la pantalla de inicio.
//
// Va como route handler y NO como el archivo `app/manifest.ts` de Next
// por dos razones concretas:
//
//  1. El nombre sale de NEXT_PUBLIC_APP_NAME, asi que el manifest no
//     puede ser un archivo estatico en public/: cada instancia se llama
//     distinto y ninguno de los dos nombres se escribe en el codigo.
//  2. La convencion `app/manifest.ts` inyecta el <link rel="manifest">
//     en TODAS las paginas, incluidas las de escritorio. Asi, el link lo
//     declara solo el layout movil (metadata.manifest) y el HTML de
//     escritorio queda igual que antes.
//
// Y vive fuera de /m a proposito: el navegador pide el manifest SIN
// credenciales, y /m esta en DASHBOARD_PREFIXES, asi que ahi el
// middleware lo mandaria a /login y el telefono recibiria HTML en vez de
// JSON. La app quedaria sin instalar y sin decir por que.
// ============================================================

export const dynamic = "force-static";

export function GET() {
  const manifest = {
    id: "/m",
    name: APP_NAME,
    short_name: APP_NAME,
    description: `${APP_NAME} en el teléfono.`,
    lang: "es-AR",
    dir: "ltr",
    // Arranca en la Bandeja, que es a lo que se abre la app.
    start_url: "/m",
    // El alcance es el sitio entero y no solo /m: si la sesion vence,
    // /login tiene que abrirse DENTRO de la app. Con scope "/m" saltaria
    // a Safari y volver seria imposible sin cerrar todo.
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Los mismos dos colores del modo oscuro de la maqueta, que es el
    // modo por defecto (DEFAULT_MODE en src/lib/themes.ts).
    background_color: "#0F1520",
    theme_color: "#0F1520",
    icons: [
      {
        // El PNG incrustado en la maqueta, extraido tal cual. iOS ignora
        // los SVG del manifest, asi que tiene que ser PNG si o si.
        src: "/movil/icono.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        // El mismo archivo declarado como maskable: es un cuadrado navy
        // a sangre, asi que recortarlo en circulo no come nada del
        // bocadillo. No es un icono nuevo, es otra declaracion del mismo.
        src: "/movil/icono.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
