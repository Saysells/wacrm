// ============================================================
// PATCH /api/account/members/[userId]/permissions — Admin+.
//
// Escribe UN override granular en profiles.permission_overrides
// del miembro: body { key, value } donde key es una de las 10
// claves del motor (cualquier otra se rechaza con 400) y value es
// boolean (escribe el override) o null (lo borra: el permiso
// vuelve al default del rol).
//
// Delega en el RPC SECURITY DEFINER de la migración 042
// (set_member_permission_override), que hace la autorización real
// — caller admin+ del mismo account, el owner solo se edita a sí
// mismo — porque el RLS de profiles solo permite UPDATEar el
// propio perfil. Acá solo se valida la forma y se mapean los
// SQLSTATEs a HTTP, igual que el PATCH de rol.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isPermissionKey, PERMISSION_KEYS } from "@/lib/auth/permissions";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// Mismo mapeo que ../route.ts: 42501 = RAISE de autorización del
// RPC, 22023 = argumento inválido (clave desconocida, target
// inexistente).
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[member permissions route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update permission" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberPerms:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { key?: unknown; value?: unknown }
      | null;

    // Fail-closed sobre la clave: solo las 10 conocidas cruzan el
    // wire (el RPC las re-valida, pero el 400 amable sale de acá).
    const key = body?.key;
    if (!isPermissionKey(key)) {
      return NextResponse.json(
        {
          error: `'key' must be one of: ${PERMISSION_KEYS.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const value = body?.value;
    if (typeof value !== "boolean" && value !== null) {
      return NextResponse.json(
        { error: "'value' must be true, false, or null (to clear)" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc(
      "set_member_permission_override",
      {
        p_user_id: userId,
        p_key: key,
        p_value: value,
      },
    );

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
