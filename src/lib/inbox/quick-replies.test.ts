import { describe, expect, it } from 'vitest';

import {
  clampSelection,
  filterQuickReplies,
  moveSelection,
  slashQuery,
} from './quick-replies';
import type { QuickReply } from '@/types';

function qr(title: string, content: string | null = null, kind: QuickReply['kind'] = 'text'): QuickReply {
  return {
    id: `id-${title}`,
    account_id: 'a1',
    user_id: 'u1',
    title,
    kind,
    content_text: content,
    interactive_payload: null,
    created_at: '2026-10-12T00:00:00Z',
    updated_at: '2026-10-12T00:00:00Z',
  };
}

describe('slashQuery', () => {
  it('solo cuando el texto empieza con "/" y es una línea', () => {
    expect(slashQuery('')).toBeNull();
    expect(slashQuery('hola /precio')).toBeNull();
    expect(slashQuery('/precio\nmás')).toBeNull();
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/Precio ')).toBe('precio');
  });
});

describe('filterQuickReplies', () => {
  const items = [
    qr('/precio', 'La lista de precios es…'),
    qr('Horarios', 'Atendemos de 9 a 18'),
    qr('Catálogo', 'Te paso el catálogo con los precios'),
    qr('Menú', null, 'interactive'),
  ];

  it('sin búsqueda lista todo en orden', () => {
    expect(filterQuickReplies(items, '').map((i) => i.title)).toEqual([
      '/precio',
      'Horarios',
      'Catálogo',
      'Menú',
    ]);
  });

  it('coincide por título (sin la barra) y por contenido, título primero', () => {
    expect(filterQuickReplies(items, 'precio').map((i) => i.title)).toEqual(['/precio', 'Catálogo']);
    expect(filterQuickReplies(items, 'HORA').map((i) => i.title)).toEqual(['Horarios']);
    expect(filterQuickReplies(items, 'menú').map((i) => i.title)).toEqual(['Menú']);
  });

  it('sin coincidencias devuelve vacío', () => {
    expect(filterQuickReplies(items, 'zzz')).toEqual([]);
  });
});

describe('moveSelection / clampSelection', () => {
  it('se queda en los bordes', () => {
    expect(moveSelection(0, -1, 3)).toBe(0);
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, 1, 3)).toBe(2);
    expect(moveSelection(5, 1, 0)).toBe(0);
  });

  it('clamp cuando la lista se achica', () => {
    expect(clampSelection(4, 2)).toBe(1);
    expect(clampSelection(1, 0)).toBe(0);
    expect(clampSelection(-2, 3)).toBe(0);
  });
});
