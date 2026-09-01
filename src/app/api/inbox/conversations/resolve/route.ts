// ============================================================
// POST /api/inbox/conversations/resolve — resolve a phone number to
// a conversation for the *dashboard session*.
//
// `/api/v1/messages` already turns a phone into a conversation, but
// it authenticates with an API key. The Bandeja's "New message" flow
// is a logged-in human, so it needs the same resolution behind
// `requireRole` and the session's RLS-scoped client.
//
// Two modes, one route, because both share the phone validation and
// the same tenancy gate:
//
//   { phone }                → LOOKUP only. Answers "does this number
//                              already have a thread?" and writes
//                              nothing. The UI needs this before it
//                              can choose between opening the thread
//                              and forcing an approved template.
//   { phone, name?, create } → find-or-create, via the shared
//                              `resolveConversationByPhone` (same
//                              dedupe as the inbound webhook and the
//                              public API: one contact, one thread).
//
// The lookup deliberately does NOT create: typing a number and then
// backing out must not leave an orphan contact + empty conversation
// behind. The UI only sends `create: true` once the agent has picked
// the template it is about to send.
//
// Why a template is unavoidable for a brand-new number is Meta's
// rule, not ours: a business-initiated first message must be an
// approved template. This route doesn't enforce that — the send does
// (`/api/whatsapp/send`, then Meta itself) — it only tells the UI
// which of the two paths it is on.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  findConversationByPhone,
  resolveConversationByPhone,
} from '@/lib/whatsapp/resolve-conversation';
import { SendMessageError } from '@/lib/whatsapp/send-message';

export async function POST(request: Request) {
  try {
    // Same gate as the send this flow ends in: a viewer must not be
    // able to create a contact or a conversation.
    const { supabase, accountId, userId } = await requireRole('agent');

    // Own bucket (not `send:`), so probing numbers can't eat the
    // budget the composer needs — same shape as the send limit.
    const limit = checkRateLimit(`resolve-conv:${userId}`, RATE_LIMITS.send);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    const phone =
      body && typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!phone) {
      return NextResponse.json({ error: 'phone is required' }, { status: 400 });
    }

    const name =
      body && typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : null;

    if (body?.create === true) {
      const resolved = await resolveConversationByPhone(
        supabase,
        accountId,
        phone,
        name
      );
      return NextResponse.json({
        phone,
        contact_id: resolved.contactId,
        conversation_id: resolved.conversationId,
        contact_created: resolved.contactCreated,
      });
    }

    const found = await findConversationByPhone(supabase, accountId, phone);
    return NextResponse.json({
      phone: found.phone,
      contact_id: found.contactId,
      conversation_id: found.conversationId,
      contact_created: false,
    });
  } catch (err) {
    if (err instanceof SendMessageError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return toErrorResponse(err);
  }
}
