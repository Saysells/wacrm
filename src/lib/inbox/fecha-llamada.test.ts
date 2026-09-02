import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Tag } from '@/types';
import {
  formatCallDateShort,
  fromDatetimeLocalValue,
  initialCallDate,
  scheduleWithDate,
  suggestedCallDate,
  toDatetimeLocalValue,
} from './fecha-llamada';

function tag(id: string, name = id, requiere_fecha = true): Tag {
  return {
    id,
    user_id: 'user-1',
    name,
    color: '#8b5cf6',
    grupo: 'estado',
    requiere_fecha,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('suggestedCallDate', () => {
  it('es manana a las 10:00 hora local', () => {
    // Jueves 3 de septiembre de 2026, 16:45 local.
    const now = new Date(2026, 8, 3, 16, 45, 12);
    const d = suggestedCallDate(now);

    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 4]);
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([10, 0, 0]);
  });

  it('pasa de mes y de anio sin ayuda', () => {
    const d = suggestedCallDate(new Date(2026, 11, 31, 23, 59));
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2027, 0, 1]);
  });
});

describe('initialCallDate', () => {
  const now = new Date(2026, 8, 3, 9, 0);

  it('precarga la fecha del contacto si la tiene', () => {
    const d = initialCallDate('2026-09-10T13:00:00.000Z', now);
    expect(d.toISOString()).toBe('2026-09-10T13:00:00.000Z');
  });

  it('sin fecha (null, vacio o invalida) cae en la sugerida', () => {
    for (const v of [null, undefined, '', 'no es fecha']) {
      const d = initialCallDate(v, now);
      expect([d.getDate(), d.getHours()]).toEqual([4, 10]);
    }
  });
});

describe('datetime-local', () => {
  it('serializa en hora local con dos digitos', () => {
    expect(toDatetimeLocalValue(new Date(2026, 8, 4, 9, 5))).toBe(
      '2026-09-04T09:05'
    );
  });

  it('parsea lo que devuelve el input, y null si esta vacio o roto', () => {
    const d = fromDatetimeLocalValue('2026-09-04T10:00');
    expect(d && [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([
      2026, 8, 4, 10,
    ]);
    expect(fromDatetimeLocalValue('')).toBeNull();
    expect(fromDatetimeLocalValue('ayer')).toBeNull();
  });

  it('ida y vuelta conserva el minuto', () => {
    const d = new Date(2026, 0, 15, 18, 30);
    expect(fromDatetimeLocalValue(toDatetimeLocalValue(d))?.getTime()).toBe(
      d.getTime()
    );
  });
});

describe('formatCallDateShort', () => {
  it('"Jue 03/09 · 10:00" en castellano, con inicial mayuscula', () => {
    // Fecha local para no depender de la zona del runner.
    expect(formatCallDateShort(new Date(2026, 8, 3, 10, 0))).toBe(
      'Jue 03/09 · 10:00'
    );
    expect(formatCallDateShort(new Date(2026, 8, 7, 9, 30))).toBe(
      'Lun 07/09 · 09:30'
    );
  });

  it('una cadena invalida da vacio en vez de romper', () => {
    expect(formatCallDateShort('nope')).toBe('');
  });
});

// ------------------------------------------------------------
// Primero la fecha, despues la etiqueta.
// ------------------------------------------------------------
function makeDb(script: { error?: { message: string } | null }) {
  const calls: string[] = [];
  const updates: Record<string, unknown>[] = [];
  const builder = {
    update: (values: Record<string, unknown>) => {
      updates.push(values);
      return builder;
    },
    eq: () => {
      calls.push('contacts.update');
      return Promise.resolve({ error: script.error ?? null });
    },
  };
  const db = { from: () => builder } as unknown as SupabaseClient;
  return { db, calls, updates };
}

describe('scheduleWithDate', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('guarda la fecha en el contacto ANTES de aplicar la etiqueta', async () => {
    const { db, calls, updates } = makeDb({});
    fetchMock.mockImplementation(async () => {
      calls.push('contact_tags.insert');
      return { ok: true, json: async () => ({ ok: true }) };
    });
    const fecha = new Date(2026, 8, 4, 10, 0);

    const result = await scheduleWithDate({
      db,
      contactId: 'contact-9',
      tag: tag('t-agendada', 'Agendada'),
      fecha,
      attached: [],
    });

    // El orden es lo que importa: el aviso al CRM sale del INSERT de
    // la etiqueta y lee contacts.fecha_llamada.
    expect(calls).toEqual(['contacts.update', 'contact_tags.insert']);
    expect(updates[0]).toMatchObject({ fecha_llamada: fecha.toISOString() });
    expect(result.fechaLlamada).toBe(fecha.toISOString());
    expect(result.attached.map((t) => t.id)).toEqual(['t-agendada']);
  });

  it('si guardar la fecha falla, la etiqueta no se aplica', async () => {
    const { db } = makeDb({ error: { message: 'RLS' } });

    await expect(
      scheduleWithDate({
        db,
        contactId: 'contact-9',
        tag: tag('t-agendada', 'Agendada'),
        fecha: new Date(),
        attached: [],
      })
    ).rejects.toThrow('RLS');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
