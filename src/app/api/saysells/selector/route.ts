// ============================================================
// GET /api/saysells/selector
//
// Qué bandejas ve la persona en el selector de la barra superior
// (rediseño, sesión A). Lee el mail con la sesión del servidor y lo
// cruza con SELECTOR_EQUIPO; la lista sale de SELECTOR_BANDEJAS. Las
// dos variables son de servidor: nunca llegan al cliente enteras,
// solo lo que esta persona puede ver.
//
//   200 { visible: true,  bandejas: [{ nombre, url, dominio }] }
//   200 { visible: false, bandejas: [] }   sin variables o fuera del equipo
//   401 { visible: false, bandejas: [] }   sin sesión
//
// El middleware no cubre esta ruta (solo /api/whatsapp/*): el 401 lo
// resuelve acá. Toda la lógica está en `@/lib/saysells/selector`.
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { SELECTOR_HIDDEN, resolveSelector } from "@/lib/saysells/selector";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json(SELECTOR_HIDDEN, { status: 401 });
  }

  return NextResponse.json(
    resolveSelector({
      email: user.email,
      bandejasRaw: process.env.SELECTOR_BANDEJAS,
      equipoRaw: process.env.SELECTOR_EQUIPO,
    }),
  );
}
