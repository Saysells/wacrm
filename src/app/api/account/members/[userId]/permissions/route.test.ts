import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 }),
  ),
}));

import { PATCH } from './route';

const context = {
  supabase: { rpc: mocks.rpc },
  accountId: 'account-1',
  userId: 'admin-1',
  role: 'admin',
  permissionOverrides: {},
  account: { id: 'account-1', name: 'Acme' },
};

function patch(body: unknown) {
  return PATCH(
    new Request('http://localhost/api/account/members/member-1/permissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ userId: 'member-1' }) },
  );
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.rpc.mockReset();
  mocks.requireRole.mockResolvedValue(context);
  mocks.rpc.mockResolvedValue({ error: null });
});

describe('PATCH /api/account/members/[userId]/permissions', () => {
  it('escribe el override: llama al RPC con la clave y el valor exactos', async () => {
    const res = await patch({ key: 'nav_dashboard', value: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      'set_member_permission_override',
      { p_user_id: 'member-1', p_key: 'nav_dashboard', p_value: true },
    );
  });

  it('value null viaja al RPC (borra el override)', async () => {
    const res = await patch({ key: 'view_all_data', value: null });

    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      'set_member_permission_override',
      { p_user_id: 'member-1', p_key: 'view_all_data', p_value: null },
    );
  });

  it('rechaza una clave fuera de las 10 con 400 sin tocar el RPC', async () => {
    const res = await patch({ key: 'nav_inbox', value: true });

    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rechaza un value no booleano con 400', async () => {
    const res = await patch({ key: 'nav_dashboard', value: 'true' });

    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('mapea el RAISE de autorización del RPC (42501) a 403', async () => {
    mocks.rpc.mockResolvedValue({
      error: { code: '42501', message: 'This action requires the admin role or higher' },
    });

    const res = await patch({ key: 'nav_dashboard', value: true });

    expect(res.status).toBe(403);
  });

  it('un caller no-admin recibe 403 de requireRole antes de todo', async () => {
    mocks.requireRole.mockRejectedValue(new Error('forbidden'));

    const res = await patch({ key: 'nav_dashboard', value: true });

    expect(res.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
