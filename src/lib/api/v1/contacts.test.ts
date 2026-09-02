import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  serializeContact,
  findOrCreateContact,
  setContactTags,
  ContactError,
} from './contacts';

describe('serializeContact', () => {
  it('flattens contact_tags(tags(*)) onto a tags array and nulls missing fields', () => {
    const row = {
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      contact_tags: [
        { tags: { id: 't1', name: 'vip', color: '#fff', grupo: null } },
        { tags: null }, // orphaned join — dropped
      ],
    };
    expect(serializeContact(row)).toEqual({
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      tags: [{ id: 't1', name: 'vip', color: '#fff', grupo: null }],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('expone el grupo de cada etiqueta (estado / origen / senal / null)', () => {
    const row = {
      id: 'c1',
      phone: '+1',
      created_at: 'a',
      updated_at: 'b',
      contact_tags: [
        { tags: { id: 'e1', name: 'En gestión', color: '#06b6d4', grupo: 'estado' } },
        { tags: { id: 'o1', name: 'origen_form', color: '#000', grupo: 'origen' } },
        // Fila vieja sin la columna (antes de la 046): sale como null.
        { tags: { id: 'f1', name: 'vip', color: '#fff' } },
      ],
    };
    expect(serializeContact(row).tags.map((t) => [t.name, t.grupo])).toEqual([
      ['En gestión', 'estado'],
      ['origen_form', 'origen'],
      ['vip', null],
    ]);
  });

  it('tolerates a row with no contact_tags key', () => {
    const row = {
      id: 'c2',
      phone: '+1',
      name: null,
      email: null,
      company: null,
      avatar_url: null,
      created_at: 'a',
      updated_at: 'b',
    };
    expect(serializeContact(row).tags).toEqual([]);
  });
});

describe('findOrCreateContact', () => {
  const noopDb = {} as SupabaseClient;

  it('rejects a non-E.164 phone with a 400 ContactError', async () => {
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toBeInstanceOf(ContactError);
  });
});

// ------------------------------------------------------------
// Supabase falso en memoria para setContactTags. Soporta lo que usan
// setContactTags, resolveImportTagIds y addContactTagAndDispatch:
// select / eq / in / maybeSingle / insert / delete, builder awaitable.
// ------------------------------------------------------------
type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(),
}));

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}));

function fakeDb(store: Record<string, Row[]>) {
  let idCounter = 0;
  return {
    from(table: string) {
      store[table] ??= [];
      const filters: [string, string, unknown][] = [];
      let op: 'select' | 'insert' | 'delete' = 'select';
      let payload: Row[] = [];

      function matches(row: Row): boolean {
        return filters.every(([kind, col, value]) => {
          if (kind === 'eq') return row[col] === value;
          if (kind === 'in') return (value as unknown[]).includes(row[col]);
          return true;
        });
      }

      function resolve(): Promise<{ data: Row[]; error: null }> {
        const rows = store[table];
        if (op === 'insert') {
          const inserted = payload.map((r) => ({
            id: `${table}-${++idCounter}`,
            ...r,
          }));
          rows.push(...inserted);
          return Promise.resolve({ data: inserted, error: null });
        }
        if (op === 'delete') {
          const removed = rows.filter(matches);
          store[table] = rows.filter((r) => !matches(r));
          return Promise.resolve({ data: removed, error: null });
        }
        return Promise.resolve({ data: rows.filter(matches), error: null });
      }

      const builder = {
        select: () => builder,
        insert: (rows: Row | Row[]) => {
          op = 'insert';
          payload = Array.isArray(rows) ? rows : [rows];
          return builder;
        },
        delete: () => {
          op = 'delete';
          return builder;
        },
        eq: (col: string, value: unknown) => {
          filters.push(['eq', col, value]);
          return builder;
        },
        in: (col: string, values: unknown[]) => {
          filters.push(['in', col, values]);
          return builder;
        },
        maybeSingle: async () => {
          const { data } = await resolve();
          return { data: data.length > 0 ? data[0] : null, error: null };
        },
        then: (
          onFulfilled: (v: { data: Row[]; error: null }) => unknown,
          onRejected?: (e: unknown) => unknown
        ) => resolve().then(onFulfilled, onRejected),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('setContactTags', () => {
  it('solo aplica las etiquetas pedidas, no el catalogo entero de la cuenta', async () => {
    // Cuenta con a, b y c; el contacto arranca sin etiquetas.
    const store: Record<string, Row[]> = {
      tags: [
        { id: 'tag-a', account_id: 'acc', name: 'a' },
        { id: 'tag-b', account_id: 'acc', name: 'b' },
        { id: 'tag-c', account_id: 'acc', name: 'c' },
      ],
      contacts: [{ id: 'c1', account_id: 'acc' }],
      contact_tags: [],
    };
    const db = fakeDb(store);

    // Lo que hace PATCH /api/v1/contacts/{id} con tags: ["a"].
    await setContactTags(db, 'acc', 'user', 'c1', ['a']);

    expect(store.contact_tags.map((r) => r.tag_id)).toEqual(['tag-a']);
    // b y c existen en el catalogo pero nadie las pidio: no se insertan.
    expect(store.contact_tags.some((r) => r.tag_id === 'tag-b')).toBe(false);
    expect(store.contact_tags.some((r) => r.tag_id === 'tag-c')).toBe(false);
    expect(h.runAutomationsForTrigger).toHaveBeenCalledTimes(1);
  });

  it('normaliza los nombres con trim y minusculas, igual que resolveImportTagIds', async () => {
    const store: Record<string, Row[]> = {
      tags: [
        { id: 'tag-a', account_id: 'acc', name: 'A' },
        { id: 'tag-b', account_id: 'acc', name: 'b' },
      ],
      contacts: [{ id: 'c1', account_id: 'acc' }],
      contact_tags: [{ id: 'ct-1', contact_id: 'c1', tag_id: 'tag-b' }],
    };
    const db = fakeDb(store);

    await setContactTags(db, 'acc', 'user', 'c1', ['  a  ']);

    // Reemplaza el set completo: b sale, a entra (matcheada sin mayusculas).
    expect(store.contact_tags.map((r) => r.tag_id)).toEqual(['tag-a']);
  });
});
