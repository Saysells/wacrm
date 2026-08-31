import { beforeEach, describe, expect, it, vi } from 'vitest'

// The role gate is the point of these tests, so the REAL requireRole
// runs against a mocked Supabase client — a 403 here is the same 403
// an agent gets in production, not a stubbed one.

let callerRole = 'admin'
let callerOverrides: Record<string, unknown> = {}
let contactRows: Array<Record<string, string | null>> = []
// Every table the route touched, to prove an agent's request never
// reaches the contacts table.
const tablesQueried: string[] = []

function makeSupabaseMock() {
  function builder(table: string) {
    tablesQueried.push(table)

    const result = () => {
      switch (table) {
        case 'profiles':
          return {
            data: {
              account_id: 'acct-1',
              account_role: callerRole,
              permission_overrides: callerOverrides,
            },
            error: null,
          }
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme' }, error: null }
        case 'contacts':
          return { data: contactRows, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'order', 'range']) b[m] = vi.fn(chain)
    b.single = vi.fn(async () => result())
    b.maybeSingle = vi.fn(async () => result())
    b.then = (resolve: (v: unknown) => unknown) => resolve(result())
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1' } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

import { GET } from './route'

describe('GET /api/contacts/export', () => {
  beforeEach(() => {
    callerRole = 'admin'
    callerOverrides = {}
    contactRows = []
    tablesQueried.length = 0
    supabaseMock = makeSupabaseMock()
  })

  it('returns 403 for an agent and never reads the contacts table', async () => {
    callerRole = 'agent'

    const res = await GET()

    expect(res.status).toBe(403)
    expect(tablesQueried).not.toContain('contacts')
  })

  it('returns 403 for a viewer', async () => {
    callerRole = 'viewer'

    const res = await GET()

    expect(res.status).toBe(403)
  })

  it('el permiso manda, no el rol: agent con override exporta', async () => {
    callerRole = 'agent'
    callerOverrides = { can_export_contacts: true }

    const res = await GET()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
  })

  it('el permiso manda, no el rol: admin con override en false recibe 403', async () => {
    callerRole = 'admin'
    callerOverrides = { can_export_contacts: false }

    const res = await GET()

    expect(res.status).toBe(403)
    expect(tablesQueried).not.toContain('contacts')
  })

  it.each(['admin', 'owner'])('serves the CSV to an %s', async (role) => {
    callerRole = role
    contactRows = [
      {
        name: 'Ada, "La Jefa"',
        phone: '+5491100000001',
        email: null,
        company: 'ACME',
        created_at: '2026-08-01T00:00:00Z',
      },
    ]

    const res = await GET()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('contacts.csv')

    const body = await res.text()
    expect(body).toContain('"name","phone","email","company","created_at"')
    // RFC 4180: embedded comma survives, quotes are doubled, null → "".
    expect(body).toContain('"Ada, ""La Jefa""","+5491100000001","","ACME"')
  })
})
