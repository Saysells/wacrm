import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  added: [] as string[],
  removed: [] as string[],
  /** Orden real de las escrituras, para poder fijarlo en un test. */
  orden: [] as string[],
}));

vi.mock('@/lib/contacts/tag-events', () => ({
  addContactTagAndDispatch: vi.fn(async (input: { tagId: string }) => {
    h.added.push(input.tagId);
    h.orden.push(`add:${input.tagId}`);
    return { added: true, dispatched: true };
  }),
}));

vi.mock('@/lib/contacts/tag-write', () => ({
  removeContactTag: vi.fn(async (_db: unknown, input: { tagId: string }) => {
    h.removed.push(input.tagId);
    h.orden.push(`remove:${input.tagId}`);
  }),
}));

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  aplicarReentrada,
  buscarEtiquetaDeEstado,
  type FilaEtiquetaContacto,
} from './reentrada';

describe('buscarEtiquetaDeEstado', () => {
  const filas: FilaEtiquetaContacto[] = [
    { tag_id: 't-origen', tags: { name: 'origen_form', grupo: 'origen' } },
    { tag_id: 't-no-responde', tags: { name: 'No responde', grupo: 'estado' } },
  ];

  it('encuentra la etiqueta de estado por nombre', () => {
    expect(buscarEtiquetaDeEstado(filas, 'No responde')).toBe('t-no-responde');
  });

  it('no le importan mayúsculas ni espacios de borde', () => {
    expect(buscarEtiquetaDeEstado(filas, '  no RESPONDE ')).toBe(
      't-no-responde'
    );
  });

  it('ignora una etiqueta que se llame igual pero no sea de estado', () => {
    expect(
      buscarEtiquetaDeEstado(
        [{ tag_id: 'x', tags: { name: 'No responde', grupo: null } }],
        'No responde'
      )
    ).toBeNull();
  });

  it('acepta la relación como array (según cómo la devuelva PostgREST)', () => {
    expect(
      buscarEtiquetaDeEstado(
        [{ tag_id: 'y', tags: [{ name: 'No responde', grupo: 'estado' }] }],
        'No responde'
      )
    ).toBe('y');
  });

  it('sin la etiqueta devuelve null', () => {
    expect(buscarEtiquetaDeEstado(filas, 'En gestión')).toBeNull();
  });
});

// ============================================================
// La regla completa contra un Supabase falso.
// ============================================================

interface FakeState {
  contactTags: FilaEtiquetaContacto[];
  enGestion: { id: string } | null;
  cuenta: { agente_reentrada: string | null } | null;
  updates: { table: string; row: Record<string, unknown> }[];
}

let state: FakeState;

function fakeDb(): SupabaseClient {
  function builder(table: string) {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      update: (row: Record<string, unknown>) => {
        state.updates.push({ table, row });
        return b;
      },
      maybeSingle: async () => ({
        data:
          table === 'tags'
            ? state.enGestion
            : table === 'accounts'
              ? state.cuenta
              : null,
        error: null,
      }),
      then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
        resolve({
          data: table === 'contact_tags' ? state.contactTags : [],
          error: null,
        }),
    };
    return b;
  }
  return { from: (t: string) => builder(t) } as unknown as SupabaseClient;
}

const INPUT = {
  accountId: 'acct-1',
  contactId: 'ct-1',
  conversationId: 'cv-1',
};

beforeEach(() => {
  h.added = [];
  h.removed = [];
  h.orden = [];
  state = {
    contactTags: [
      { tag_id: 't-no-responde', tags: { name: 'No responde', grupo: 'estado' } },
    ],
    enGestion: { id: 't-en-gestion' },
    cuenta: { agente_reentrada: 'matias' },
    updates: [],
  };
});

describe('aplicarReentrada', () => {
  it('cambia la etiqueta y manda la conversación a Matías', async () => {
    const result = await aplicarReentrada(fakeDb(), INPUT);

    expect(result).toEqual({ applied: true });
    expect(h.added).toEqual(['t-en-gestion']);
    expect(h.removed).toEqual(['t-no-responde']);
    expect(state.updates).toEqual([
      {
        table: 'conversations',
        row: expect.objectContaining({
          status: 'pending',
          assigned_agent_id: 'matias',
        }),
      },
    ]);
  });

  it('pone "En gestión" antes de sacar "No responde"', async () => {
    // El trigger de la base borra la etiqueta de estado anterior al
    // insertar la nueva; si se hiciera al revés, el contacto quedaría
    // un instante sin estado y el aviso al CRM saldría con el viejo.
    await aplicarReentrada(fakeDb(), INPUT);
    expect(h.orden).toEqual(['add:t-en-gestion', 'remove:t-no-responde']);
  });

  it('no hace nada si el contacto no está en "No responde"', async () => {
    state.contactTags = [
      { tag_id: 't-nuevo', tags: { name: 'Nuevo', grupo: 'estado' } },
    ];

    const result = await aplicarReentrada(fakeDb(), INPUT);

    expect(result).toEqual({ applied: false, reason: 'sin_etiqueta' });
    expect(h.added).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it('sin agente de reentrada la deja pendiente sin asignar', async () => {
    state.cuenta = { agente_reentrada: null };

    await aplicarReentrada(fakeDb(), INPUT);

    const row = state.updates[0].row;
    expect(row.status).toBe('pending');
    expect(row).not.toHaveProperty('assigned_agent_id');
  });

  it('sin la etiqueta "En gestión" en la cuenta igual saca la vieja', async () => {
    state.enGestion = null;

    const result = await aplicarReentrada(fakeDb(), INPUT);

    expect(result).toEqual({ applied: true });
    expect(h.added).toEqual([]);
    expect(h.removed).toEqual(['t-no-responde']);
  });
});
