import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 }),
  ),
}));

import { GET } from './route';

const ROSTER = [
  {
    user_id: 'member-1',
    full_name: 'Marta',
    email: 'marta@acme.test',
    avatar_url: null,
    account_role: 'agent',
    permission_overrides: { nav_dashboard: true },
    created_at: '2026-08-01T00:00:00Z',
  },
];

function contextFor(role: string) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(async () => ({ data: ROSTER, error: null }));
  return {
    supabase: { from: vi.fn(() => builder) },
    accountId: 'account-1',
    userId: 'caller-1',
    role,
    permissionOverrides: {},
    account: { id: 'account-1', name: 'Acme' },
  };
}

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
});

describe('GET /api/account/members — lectura de permission_overrides', () => {
  it('un admin lee el override guardado de cada miembro', async () => {
    mocks.getCurrentAccount.mockResolvedValue(contextFor('admin'));

    const res = await GET();
    const { members } = (await res.json()) as {
      members: Array<{ permission_overrides: Record<string, unknown> | null }>;
    };

    expect(res.status).toBe(200);
    expect(members[0].permission_overrides).toEqual({ nav_dashboard: true });
  });

  it('agent y viewer no reciben los overrides ajenos (misma regla que email)', async () => {
    for (const role of ['agent', 'viewer']) {
      mocks.getCurrentAccount.mockResolvedValue(contextFor(role));

      const res = await GET();
      const { members } = (await res.json()) as {
        members: Array<{
          email: string | null;
          permission_overrides: Record<string, unknown> | null;
        }>;
      };

      expect(members[0].permission_overrides).toBeNull();
      expect(members[0].email).toBeNull();
    }
  });
});
