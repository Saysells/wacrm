import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for the `contact_id` send path (issue #296): sending an approved
// template to a single contact from the Contact detail view. The route must
// find-or-create the contact's conversation server-side, then run the normal
// send + persistence path — no inbound message required to bootstrap a thread.
// ---------------------------------------------------------------------------

// Records of what the route wrote, so we can assert the right rows landed.
const conversationInserts: Array<Record<string, unknown>> = []
const messageInserts: Array<Record<string, unknown>> = []
// Updates against `conversations`, with the filters chained onto each —
// the auto-assign tests assert both the payload and the
// `.is('assigned_agent_id', null)` race guard.
const conversationUpdates: Array<{
  payload: Record<string, unknown>
  filters: Array<[string, string, unknown]>
}> = []

// Toggles for the per-test scenario.
let existingConversation: Record<string, unknown> | null = null
let contactRow: Record<string, unknown> | null = null
// The caller's role, as `requireRole` reads it off the profile. Sending
// requires 'agent'; 'viewer' must be refused before anything reaches Meta.
let callerRole: string = 'admin'
// A conversation created during the request becomes retrievable by id —
// the shared send core re-loads the conversation (with its contact) from
// just the id, so the mock must model insert-then-select-by-id.
let createdConversation: Record<string, unknown> | null = null

const CONTACT = {
  id: 'contact-1',
  account_id: 'acct-1',
  phone: '+15551234567',
}

// Chainable Supabase mock. A fresh builder per `.from()` call tracks whether
// `.insert()` ran so the terminal resolves to the inserted row for creates
// and the canned select row otherwise.
function makeSupabaseMock() {
  function builder(table: string) {
    let didInsert = false

    const selectResult = () => {
      switch (table) {
        case 'profiles':
          return {
            data: { account_id: 'acct-1', account_role: callerRole },
            error: null,
          }
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme' }, error: null }
        case 'contacts':
          return { data: contactRow, error: null }
        case 'conversations':
          // Once created this request, a by-id reload returns it (with
          // its contact); otherwise fall back to the canned existing row.
          return { data: createdConversation ?? existingConversation, error: null }
        case 'whatsapp_config':
          return {
            data: {
              id: 'cfg-1',
              account_id: 'acct-1',
              phone_number_id: 'PNID-1',
              access_token: 'enc-token',
            },
            error: null,
          }
        case 'message_templates':
          return { data: null, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const insertResult = () => {
      switch (table) {
        case 'conversations':
          return {
            data: {
              id: 'conv-new',
              account_id: 'acct-1',
              contact_id: 'contact-1',
              contact: CONTACT,
            },
            error: null,
          }
        case 'messages':
          return { data: { id: 'msg-1' }, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const terminal = () =>
      Promise.resolve(didInsert ? insertResult() : selectResult())

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'in', 'order', 'limit', 'delete']) {
      b[m] = vi.fn(chain)
    }
    // Track the update payload + its filter chain for `conversations`,
    // so tests can assert exactly what an update targeted.
    let updateRecord: {
      payload: Record<string, unknown>
      filters: Array<[string, string, unknown]>
    } | null = null
    b.update = vi.fn((payload: Record<string, unknown>) => {
      if (table === 'conversations') {
        updateRecord = { payload, filters: [] }
        conversationUpdates.push(updateRecord)
      }
      return b
    })
    b.eq = vi.fn((column: string, value: unknown) => {
      updateRecord?.filters.push(['eq', column, value])
      return b
    })
    b.is = vi.fn((column: string, value: unknown) => {
      updateRecord?.filters.push(['is', column, value])
      return b
    })
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      didInsert = true
      if (table === 'conversations') {
        conversationInserts.push(payload)
        createdConversation = {
          id: 'conv-new',
          account_id: 'acct-1',
          contact_id: 'contact-1',
          contact: CONTACT,
        }
      }
      if (table === 'messages') messageInserts.push(payload)
      return b
    })
    b.single = vi.fn(terminal)
    b.maybeSingle = vi.fn(terminal)
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(didInsert ? insertResult() : selectResult())
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

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {}
      const chain = () => b
      for (const m of ['update', 'eq', 'select']) b[m] = vi.fn(chain)
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: null })
      return b
    },
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
  encrypt: vi.fn(() => 'enc-token'),
  isLegacyFormat: vi.fn(() => false),
}))

const { sendTemplateMessage } = vi.hoisted(() => ({
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid-1' })),
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage,
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
}))

import { POST } from './route'

function postContactTemplate(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: 'contact-1',
        message_type: 'template',
        template_name: 'order_update',
        template_language: 'en_US',
        template_message_params: { body: ['Acme', '#1234'] },
        template_params: ['Acme', '#1234'],
        ...overrides,
      }),
    }),
  )
}

describe('POST /api/whatsapp/send — contact_id template path', () => {
  beforeEach(() => {
    conversationInserts.length = 0
    messageInserts.length = 0
    conversationUpdates.length = 0
    existingConversation = null
    createdConversation = null
    contactRow = CONTACT
    callerRole = 'admin'
    supabaseMock = makeSupabaseMock()
    sendTemplateMessage.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('creates a conversation for a contact with none, then sends the template', async () => {
    const res = await postContactTemplate()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.whatsapp_message_id).toBe('wamid-1')

    // A conversation was created for this contact.
    expect(conversationInserts).toHaveLength(1)
    expect(conversationInserts[0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
    })

    // The template was sent to the contact's number.
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
    const args = (sendTemplateMessage.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >
    // Meta wants the bare E.164 digits — sanitizePhoneForMeta strips the '+'.
    expect(args.to).toBe('15551234567')
    expect(args.templateName).toBe('order_update')

    // The outbound message was persisted under the new conversation.
    expect(messageInserts).toHaveLength(1)
    expect(messageInserts[0]).toMatchObject({
      conversation_id: 'conv-new',
      content_type: 'template',
      template_name: 'order_update',
      sender_type: 'agent',
    })
  })

  it('reuses an existing conversation instead of creating a duplicate', async () => {
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      contact: CONTACT,
    }

    const res = await postContactTemplate()
    expect(res.status).toBe(200)

    expect(conversationInserts).toHaveLength(0)
    expect(messageInserts[0]).toMatchObject({ conversation_id: 'conv-existing' })
  })

  it('404s when the contact is not in the caller account', async () => {
    contactRow = null

    const res = await postContactTemplate()
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toMatch(/contact not found/i)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('400s when neither conversation_id nor contact_id is provided', async () => {
    const res = await POST(
      new Request('http://localhost/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_type: 'template', template_name: 'x' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/whatsapp/send — role enforcement', () => {
  beforeEach(() => {
    conversationInserts.length = 0
    messageInserts.length = 0
    conversationUpdates.length = 0
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      contact: CONTACT,
    }
    createdConversation = null
    contactRow = CONTACT
    callerRole = 'admin'
    supabaseMock = makeSupabaseMock()
    sendTemplateMessage.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('refuses a viewer with 403 and never reaches Meta', async () => {
    // A viewer is read-only (`canSendMessages`). The route used to resolve
    // account_id straight off the profile with no role check: RLS blocked
    // the message INSERT, but the send core calls Meta first, so the
    // customer still received a real WhatsApp message that RLS could not
    // un-send. The gate has to come before any outbound call.
    callerRole = 'viewer'

    const res = await postContactTemplate()

    expect(res.status).toBe(403)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(messageInserts).toHaveLength(0)
  })

  it('allows an agent through', async () => {
    callerRole = 'agent'

    const res = await postContactTemplate()

    expect(res.status).toBe(200)
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/whatsapp/send — auto-assign on agent reply', () => {
  beforeEach(() => {
    conversationInserts.length = 0
    messageInserts.length = 0
    conversationUpdates.length = 0
    existingConversation = null
    createdConversation = null
    contactRow = CONTACT
    callerRole = 'agent'
    supabaseMock = makeSupabaseMock()
    sendTemplateMessage.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // The inbox reply path: an existing conversation targeted by id.
  function postReply() {
    return postContactTemplate({ contact_id: undefined, conversation_id: 'conv-1' })
  }

  function conversationRow(assigned: string | null) {
    return {
      id: 'conv-1',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      assigned_agent_id: assigned,
      contact: CONTACT,
    }
  }

  /** The updates that touched ownership, ignoring preview updates. */
  const assignmentUpdates = () =>
    conversationUpdates.filter((u) => 'assigned_agent_id' in u.payload)

  it('assigns an unowned conversation to the replying agent', async () => {
    existingConversation = conversationRow(null)

    const res = await postReply()

    expect(res.status).toBe(200)
    const assigns = assignmentUpdates()
    expect(assigns).toHaveLength(1)
    expect(assigns[0].payload).toEqual({ assigned_agent_id: 'user-1' })
    // Targeted at this conversation, and guarded so a concurrent first
    // reply can't steal a thread claimed between our read and write.
    expect(assigns[0].filters).toContainEqual(['eq', 'id', 'conv-1'])
    expect(assigns[0].filters).toContainEqual(['is', 'assigned_agent_id', null])
  })

  it('does not reassign a conversation another agent already owns', async () => {
    existingConversation = conversationRow('agent-2')

    const res = await postReply()

    expect(res.status).toBe(200)
    // The reply goes out, but ownership is untouched.
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
    expect(assignmentUpdates()).toHaveLength(0)
  })

  it('does not claim the thread when an admin replies', async () => {
    callerRole = 'admin'
    existingConversation = conversationRow(null)

    const res = await postReply()

    expect(res.status).toBe(200)
    expect(assignmentUpdates()).toHaveLength(0)
  })
})
