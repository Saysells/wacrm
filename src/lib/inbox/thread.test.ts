import { describe, expect, it } from 'vitest';

import {
  buildTimeline,
  dayLabel,
  firstNameOf,
  lastCustomerMessageAt,
  outgoingLabel,
} from './thread';
import type { ContactNote, Message } from '@/types';

// Un martes a las 15:00 hora local.
const NOW = new Date(2026, 9, 13, 15, 0, 0).getTime();

function msg(id: string, at: Date, sender: Message['sender_type'] = 'customer'): Message {
  return {
    id,
    conversation_id: 'c1',
    sender_type: sender,
    content_type: 'text',
    content_text: id,
    status: 'delivered',
    created_at: at.toISOString(),
  };
}

function note(id: string, at: Date): ContactNote {
  return { id, contact_id: 'k1', user_id: 'u1', note_text: id, created_at: at.toISOString() };
}

describe('dayLabel', () => {
  it('hoy y ayer por día calendario, no por 24 h', () => {
    expect(dayLabel(new Date(2026, 9, 13, 0, 5).getTime(), NOW)).toEqual({ kind: 'today' });
    expect(dayLabel(new Date(2026, 9, 12, 23, 59).getTime(), NOW)).toEqual({ kind: 'yesterday' });
  });

  it('cualquier otro día lleva día de semana, número y mes', () => {
    expect(dayLabel(new Date(2026, 9, 8, 10, 0).getTime(), NOW)).toEqual({
      kind: 'date',
      weekday: 4,
      day: 8,
      month: 9,
      year: 2026,
      sameYear: true,
    });
    expect(dayLabel(new Date(2025, 11, 24, 10, 0).getTime(), NOW)).toMatchObject({
      kind: 'date',
      sameYear: false,
    });
  });
});

describe('buildTimeline', () => {
  it('sin nada devuelve vacío', () => {
    expect(buildTimeline([], [], NOW)).toEqual([]);
  });

  it('abre cada día con un separador y respeta el orden de llegada', () => {
    const items = buildTimeline(
      [
        msg('a', new Date(2026, 9, 12, 9, 0)),
        msg('b', new Date(2026, 9, 12, 9, 5), 'agent'),
        msg('c', new Date(2026, 9, 13, 8, 0)),
      ],
      [],
      NOW,
    );
    expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'message', 'day', 'message']);
    expect(items[0]).toMatchObject({ kind: 'day', label: { kind: 'yesterday' } });
    expect(items[3]).toMatchObject({ kind: 'day', label: { kind: 'today' } });
  });

  it('intercala las notas internas por fecha, en su lugar', () => {
    const items = buildTimeline(
      [msg('a', new Date(2026, 9, 13, 9, 0)), msg('b', new Date(2026, 9, 13, 11, 0))],
      [note('n1', new Date(2026, 9, 13, 10, 0)), note('n0', new Date(2026, 9, 11, 10, 0))],
      NOW,
    );
    expect(items.map((i) => i.key)).toEqual([
      `d:${new Date(2026, 9, 11).getTime()}`,
      'n:n0',
      `d:${new Date(2026, 9, 13).getTime()}`,
      'm:a',
      'n:n1',
      'm:b',
    ]);
  });

  it('a igual instante, el mensaje va antes que la nota', () => {
    const at = new Date(2026, 9, 13, 9, 0);
    const items = buildTimeline([msg('a', at)], [note('n', at)], NOW);
    expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'note']);
  });
});

describe('lastCustomerMessageAt', () => {
  it('null si el cliente nunca escribió', () => {
    expect(lastCustomerMessageAt([])).toBeNull();
    expect(lastCustomerMessageAt([msg('a', new Date(NOW), 'agent')])).toBeNull();
  });

  it('toma el último del cliente, ignorando lo que mandamos después', () => {
    const a = msg('a', new Date(2026, 9, 13, 9, 0));
    const b = msg('b', new Date(2026, 9, 13, 10, 0));
    const c = msg('c', new Date(2026, 9, 13, 11, 0), 'agent');
    expect(lastCustomerMessageAt([a, b, c])).toBe(b.created_at);
  });
});

describe('firstNameOf', () => {
  it('nombre de pila; un teléfono como nombre no es un nombre', () => {
    expect(firstNameOf('Juan Pérez')).toBe('Juan');
    expect(firstNameOf('  ')).toBe('');
    expect(firstNameOf('5491122334455', '+54 9 11 2233-4455')).toBe('');
    expect(firstNameOf(undefined)).toBe('');
  });
});

describe('outgoingLabel', () => {
  it('nada para el cliente ni para un texto nuestro', () => {
    expect(outgoingLabel({ sender_type: 'customer', content_type: 'template', template_name: 'x' })).toBeNull();
    expect(outgoingLabel({ sender_type: 'agent', content_type: 'text' })).toBeNull();
  });

  it('plantilla con su nombre; bot gana aunque sea plantilla', () => {
    expect(outgoingLabel({ sender_type: 'agent', content_type: 'template', template_name: 'hola_kosmo' })).toEqual({
      kind: 'template',
      name: 'hola_kosmo',
    });
    expect(outgoingLabel({ sender_type: 'agent', content_type: 'template' })).toEqual({ kind: 'template', name: null });
    expect(outgoingLabel({ sender_type: 'bot', content_type: 'template', template_name: 'x' })).toEqual({ kind: 'bot' });
    expect(outgoingLabel({ sender_type: 'bot', content_type: 'text' })).toEqual({ kind: 'bot' });
  });
});
