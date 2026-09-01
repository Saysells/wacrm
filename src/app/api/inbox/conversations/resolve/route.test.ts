import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SendMessageError } from '@/lib/whatsapp/send-message';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findConversationByPhone: vi.fn(),
  resolveConversationByPhone: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 }),
  ),
}));

vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  findConversationByPhone: mocks.findConversationByPhone,
  resolveConversationByPhone: mocks.resolveConversationByPhone,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: vi.fn(() =>
    Response.json({ error: 'Too many requests' }, { status: 429 }),
  ),
  RATE_LIMITS: { send: { limit: 60, windowMs: 60_000 } },
}));

import { POST } from './route';

const context = {
  supabase: { from: vi.fn() },
  accountId: 'account-1',
  userId: 'agent-1',
  role: 'agent',
  permissionOverrides: {},
  account: { id: 'account-1', name: 'Acme' },
};

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/inbox/conversations/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.findConversationByPhone.mockReset();
  mocks.resolveConversationByPhone.mockReset();
  mocks.checkRateLimit.mockReset();
  mocks.requireRole.mockResolvedValue(context);
  mocks.checkRateLimit.mockReturnValue({ success: true });
});

describe('POST /api/inbox/conversations/resolve', () => {
  it('sin create solo mira: devuelve la conversacion existente sin escribir nada', async () => {
    mocks.findConversationByPhone.mockResolvedValue({
      phone: '14155550123',
      contactId: 'c1',
      conversationId: 'conv-1',
    });

    const res = await post({ phone: '+1 415 555 0123' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      phone: '14155550123',
      contact_id: 'c1',
      conversation_id: 'conv-1',
      contact_created: false,
    });
    expect(mocks.findConversationByPhone).toHaveBeenCalledExactlyOnceWith(
      context.supabase,
      'account-1',
      '+1 415 555 0123',
    );
    expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
  });

  it('sin create y sin conversacion devuelve conversation_id null (no crea el hilo)', async () => {
    mocks.findConversationByPhone.mockResolvedValue({
      phone: '14155550123',
      contactId: null,
      conversationId: null,
    });

    const res = await post({ phone: '+14155550123' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      phone: '14155550123',
      contact_id: null,
      conversation_id: null,
      contact_created: false,
    });
    expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
  });

  it('con create:true delega en resolveConversationByPhone (un contacto y un hilo)', async () => {
    mocks.resolveConversationByPhone.mockResolvedValue({
      conversationId: 'conv-9',
      contactId: 'c9',
      contactCreated: true,
    });

    const res = await post({ phone: '+14155550123', name: 'Jane', create: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      phone: '+14155550123',
      contact_id: 'c9',
      conversation_id: 'conv-9',
      contact_created: true,
    });
    expect(mocks.resolveConversationByPhone).toHaveBeenCalledExactlyOnceWith(
      context.supabase,
      'account-1',
      '+14155550123',
      'Jane',
    );
    expect(mocks.findConversationByPhone).not.toHaveBeenCalled();
  });

  it('rechaza un body sin telefono con 400 sin tocar la base', async () => {
    const res = await post({ phone: '   ' });

    expect(res.status).toBe(400);
    expect(mocks.findConversationByPhone).not.toHaveBeenCalled();
    expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
  });

  it('mapea el SendMessageError de un telefono invalido a su status', async () => {
    mocks.findConversationByPhone.mockRejectedValue(
      new SendMessageError('bad_request', 'not E.164', 400),
    );

    const res = await post({ phone: 'no-es-un-numero' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not E.164' });
  });

  it('un viewer recibe 403 de requireRole antes de todo', async () => {
    mocks.requireRole.mockRejectedValue(new Error('forbidden'));

    const res = await post({ phone: '+14155550123' });

    expect(res.status).toBe(403);
    expect(mocks.findConversationByPhone).not.toHaveBeenCalled();
  });

  it('respeta el rate limit por usuario', async () => {
    mocks.checkRateLimit.mockReturnValue({ success: false });

    const res = await post({ phone: '+14155550123', create: true });

    expect(res.status).toBe(429);
    expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
  });
});
