// ============================================================
// GET /api/contacts/export — CSV download of the account's contacts.
//
// Gateado por el permiso efectivo `can_export_contacts` (migración
// 041): default admin+, pero un override por persona lo pisa en
// cualquier dirección — un agent habilitado exporta, un admin
// deshabilitado recibe 403. Se bloquea el endpoint, no solo el
// botón (sesión de roles, 2026-08-31).
// ============================================================

import { NextResponse } from 'next/server'

import {
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account'
import { effectivePermission } from '@/lib/auth/permissions'

/** Column order for the CSV, matching the import template's fields. */
const COLUMNS = ['name', 'phone', 'email', 'company', 'created_at'] as const

type ContactRow = Record<(typeof COLUMNS)[number], string | null>

// RFC 4180 quoting — quote every field so names containing commas,
// quotes or newlines survive a round-trip through spreadsheet apps.
function csvField(value: string | null | undefined): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function toCsv(rows: ContactRow[]): string {
  const lines = [COLUMNS.map(csvField).join(',')]
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => csvField(row[c])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

// PostgREST caps a single response (1000 rows by default), so page
// through the table instead of trusting one unbounded select.
const PAGE = 1000

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    if (
      !effectivePermission(
        ctx.role,
        ctx.permissionOverrides,
        'can_export_contacts',
      )
    ) {
      throw new ForbiddenError(
        "This action requires the 'can_export_contacts' permission",
      )
    }
    const { supabase, accountId } = ctx

    const rows: ContactRow[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('contacts')
        .select('name, phone, email, company, created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1)

      if (error) {
        console.error('[contacts/export] fetch failed:', error.message)
        return NextResponse.json(
          { error: 'Failed to load contacts' },
          { status: 500 }
        )
      }

      rows.push(...((data ?? []) as ContactRow[]))
      if (!data || data.length < PAGE) break
    }

    return new NextResponse(toCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="contacts.csv"',
      },
    })
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden → 401/403.
    return toErrorResponse(error)
  }
}
