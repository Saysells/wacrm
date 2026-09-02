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
    created_at: '',
  };
}

describe('tag-groups', () => {
  it('el embudo tiene las 13 etapas de la migracion 046, en orden', () => {
    expect(ESTADO_FUNNEL).toEqual([
      'Nuevo',
      'En gestión',
      'No responde',
      'Agendado a Paola',
      'Agendado a Gustavo',
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
    expect(estadoRank('Perdido')).toBe(12);
    expect(estadoRank('Inventada')).toBe(ESTADO_FUNNEL.length);
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
