import { describe, expect, it } from 'vitest';

import {
  MAX_TAG_CHIPS,
  splitConversationTags,
  tagTint,
  visibleChips,
} from './conversation-tags';
import type { Tag, TagGrupo } from '@/types';

function tag(name: string, grupo: TagGrupo | null = null): Tag {
  return {
    id: `id-${name}`,
    user_id: 'u1',
    name,
    color: '#3b82f6',
    grupo,
    requiere_fecha: false,
    created_at: '2026-09-08T00:00:00Z',
  };
}

describe('splitConversationTags', () => {
  it('sin etiquetas no hay principal ni secundarias', () => {
    expect(splitConversationTags(undefined)).toEqual({
      principal: null,
      secundarias: [],
    });
    expect(splitConversationTags([])).toEqual({
      principal: null,
      secundarias: [],
    });
  });

  it('la de estado es la principal aunque venga ultima', () => {
    const mati = tag('WhatsApp Mati');
    const estado = tag('En gestión', 'estado');

    const { principal, secundarias } = splitConversationTags([mati, estado]);

    expect(principal).toBe(estado);
    expect(secundarias).toEqual([mati]);
  });

  it('descarta las del bot: solo estado y las que no tienen grupo', () => {
    const mati = tag('WhatsApp Mati');
    const form = tag('origen_form', 'origen');
    const senal = tag('senal_prefiere_chat', 'senal');
    const estado = tag('En gestión', 'estado');

    const { principal, secundarias } = splitConversationTags([
      form,
      mati,
      senal,
      estado,
    ]);

    expect(principal).toBe(estado);
    expect(secundarias).toEqual([mati]);
  });

  it('sin estado sube la primera sin grupo y el resto quedan como puntitos', () => {
    const mati = tag('WhatsApp Mati');
    const vip = tag('VIP');
    const senal = tag('senal_prefiere_chat', 'senal');

    const { principal, secundarias } = splitConversationTags([
      senal,
      mati,
      vip,
    ]);

    expect(principal).toBe(mati);
    expect(secundarias).toEqual([vip]);
  });

  it('un contacto con solo etiquetas del bot se ve como uno sin etiquetas', () => {
    expect(
      splitConversationTags([
        tag('origen_form', 'origen'),
        tag('senal_lead_grande', 'senal'),
      ]),
    ).toEqual({ principal: null, secundarias: [] });
  });

  it('conserva el orden de entrada en las secundarias', () => {
    const a = tag('a');
    const b = tag('b');
    const c = tag('c');

    expect(
      splitConversationTags([tag('Nuevo', 'estado'), c, a, b]).secundarias,
    ).toEqual([c, a, b]);
  });
});

describe('visibleChips', () => {
  it('sin recorte cuando entran todas', () => {
    const dos = [tag('a'), tag('b')];
    expect(visibleChips(dos)).toEqual({ chips: dos, extra: 0 });
  });

  it('recorta al maximo y cuenta el resto en +N', () => {
    const seis = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => tag(n));

    const { chips, extra } = visibleChips(seis);

    expect(chips).toHaveLength(MAX_TAG_CHIPS);
    expect(chips.map((t) => t.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(extra).toBe(2);
  });

  it('no muta la lista que recibe', () => {
    const tres = [tag('a'), tag('b'), tag('c')];
    visibleChips(tres, 1);
    expect(tres).toHaveLength(3);
  });
});

describe('tagTint', () => {
  it('mezcla el color de la etiqueta al 15 %', () => {
    expect(tagTint('#ef4444')).toBe(
      'color-mix(in srgb, #ef4444 15%, transparent)',
    );
  });
});
