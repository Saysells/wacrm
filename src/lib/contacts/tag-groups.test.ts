import { describe, expect, it } from 'vitest';

import type { Tag } from '@/types';
import {
  ESTADO_FUNNEL,
  estadoRank,
  findEstadoTag,
  isEstadoTag,
  sortByFunnel,
} from './tag-groups';

function tag(name: string, grupo: Tag['grupo'] = null): Tag {
  return {
    id: name,
    user_id: 'u1',
    name,
    color: '#000',
    grupo,
    requiere_fecha: false,
    created_at: '',
  };
}

describe('tag-groups', () => {
  it('el embudo tiene las 13 etapas de la migracion 046 mas Gestión WhatsApp Mati y los closers de ARG, en orden', () => {
    expect(ESTADO_FUNNEL).toEqual([
      'Nuevo',
      'En gestión',
      'Gestión WhatsApp Mati',
      'No responde',
      'Agendado a Paola',
      'Agendado a Gustavo',
      'Agendado a Ezequiel',
      'Agendado a Manuel',
      'Agendada',
      'No se presentó',
      'Reagendado',
      'Realizada',
      'Propuesta',
      'En negociación',
      'Ganada',
      'Perdido',
    ]);
  });

  it('isEstadoTag mira el grupo, no el nombre', () => {
    expect(isEstadoTag(tag('Nuevo', 'estado'))).toBe(true);
    expect(isEstadoTag(tag('Nuevo'))).toBe(false);
    expect(isEstadoTag(tag('origen_form', 'origen'))).toBe(false);
  });

  it('estadoRank tolera mayusculas y espacios; lo desconocido va al final', () => {
    expect(estadoRank('  nuevo ')).toBe(0);
    expect(estadoRank('Perdido')).toBe(ESTADO_FUNNEL.length - 1);
    expect(estadoRank('Inventada')).toBe(ESTADO_FUNNEL.length);
  });

  it('Gestión WhatsApp Mati va justo despues de En gestión; Ezequiel y Manuel junto a los otros Agendado a, antes de Perdido', () => {
    expect(estadoRank('Gestión WhatsApp Mati')).toBe(estadoRank('En gestión') + 1);
    expect(estadoRank('No responde')).toBe(estadoRank('Gestión WhatsApp Mati') + 1);
    expect(estadoRank('Agendado a Ezequiel')).toBe(estadoRank('Agendado a Gustavo') + 1);
    expect(estadoRank('Agendado a Manuel')).toBe(estadoRank('Agendado a Ezequiel') + 1);
    expect(estadoRank('Agendado a Manuel')).toBeLessThan(estadoRank('Agendada'));
    expect(estadoRank('Agendado a Manuel')).toBeLessThan(estadoRank('Perdido'));
  });

  it('solo ordena, no filtra: una etiqueta que no esta en la lista sigue apareciendo, al final', () => {
    const out = sortByFunnel([
      tag('Inventada', 'estado'),
      tag('Perdido', 'estado'),
      tag('Gestión WhatsApp Mati', 'estado'),
      tag('Agendado a Manuel', 'estado'),
      tag('Nuevo', 'estado'),
    ]);
    expect(out.map((t) => t.name)).toEqual([
      'Nuevo',
      'Gestión WhatsApp Mati',
      'Agendado a Manuel',
      'Perdido',
      'Inventada',
    ]);
    expect(out).toHaveLength(5);
  });

  it('sortByFunnel no muta la entrada', () => {
    const input = [tag('Ganada', 'estado'), tag('Nuevo', 'estado')];
    const out = sortByFunnel(input);
    expect(out.map((t) => t.name)).toEqual(['Nuevo', 'Ganada']);
    expect(input.map((t) => t.name)).toEqual(['Ganada', 'Nuevo']);
  });

  it('findEstadoTag devuelve la de estado o null', () => {
    expect(findEstadoTag(undefined)).toBeNull();
    expect(findEstadoTag([tag('VIP')])).toBeNull();
    expect(findEstadoTag([tag('VIP'), tag('Nuevo', 'estado')])?.name).toBe(
      'Nuevo'
    );
  });
});
