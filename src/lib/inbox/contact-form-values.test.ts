import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadContactFormValues, pairFieldValues } from './contact-form-values';

const FIELDS = [
  { id: 'f-1', field_name: 'provincia' },
  { id: 'f-2', field_name: 'tipo_negocio' },
  { id: 'f-3', field_name: 'utm_source' },
];

/** Stub mínimo: dos lecturas, una por tabla. */
function makeDb(script: {
  fields?: { id: string; field_name: string }[];
  values?: { custom_field_id: string; value: string | null }[];
  fieldsError?: boolean;
  valuesError?: boolean;
}): SupabaseClient {
  const from = vi.fn((table: string) => {
    if (table === 'custom_fields') {
      return {
        select: () =>
          Promise.resolve({
            data: script.fieldsError ? null : (script.fields ?? []),
            error: script.fieldsError ? { message: 'boom' } : null,
          }),
      };
    }
    return {
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: script.valuesError ? null : (script.values ?? []),
            error: script.valuesError ? { message: 'boom' } : null,
          }),
      }),
    };
  });
  return { from } as unknown as SupabaseClient;
}

describe('pairFieldValues', () => {
  it('cruza catálogo y valores, ordenado por nombre de campo', () => {
    expect(
      pairFieldValues(FIELDS, [
        { custom_field_id: 'f-3', value: 'facebook' },
        { custom_field_id: 'f-1', value: 'CABA' },
      ])
    ).toEqual([
      { fieldId: 'f-1', name: 'provincia', value: 'CABA' },
      { fieldId: 'f-3', name: 'utm_source', value: 'facebook' },
    ]);
  });

  it('descarta valores vacíos, en blanco y nulos', () => {
    expect(
      pairFieldValues(FIELDS, [
        { custom_field_id: 'f-1', value: '' },
        { custom_field_id: 'f-2', value: '   ' },
        { custom_field_id: 'f-3', value: null },
      ])
    ).toEqual([]);
  });

  it('descarta un valor cuyo campo ya no está en el catálogo', () => {
    expect(
      pairFieldValues(FIELDS, [{ custom_field_id: 'f-borrado', value: 'x' }])
    ).toEqual([]);
  });

  it('recorta los espacios de borde del valor', () => {
    expect(
      pairFieldValues(FIELDS, [{ custom_field_id: 'f-1', value: '  CABA  ' }])
    ).toEqual([{ fieldId: 'f-1', name: 'provincia', value: 'CABA' }]);
  });
});

describe('loadContactFormValues', () => {
  it('devuelve los valores del contacto', async () => {
    const db = makeDb({
      fields: FIELDS,
      values: [
        { custom_field_id: 'f-2', value: 'Local a la calle' },
        { custom_field_id: 'f-1', value: 'CABA' },
      ],
    });

    await expect(loadContactFormValues(db, 'contact-1')).resolves.toEqual([
      { fieldId: 'f-1', name: 'provincia', value: 'CABA' },
      { fieldId: 'f-2', name: 'tipo_negocio', value: 'Local a la calle' },
    ]);
  });

  it('devuelve vacío cuando el contacto no tiene ninguno', async () => {
    const db = makeDb({ fields: FIELDS, values: [] });
    await expect(loadContactFormValues(db, 'contact-1')).resolves.toEqual([]);
  });

  it('devuelve vacío ante un error de lectura, en vez de romper el sidebar', async () => {
    await expect(
      loadContactFormValues(makeDb({ valuesError: true }), 'contact-1')
    ).resolves.toEqual([]);
    await expect(
      loadContactFormValues(makeDb({ fieldsError: true }), 'contact-1')
    ).resolves.toEqual([]);
  });
});
