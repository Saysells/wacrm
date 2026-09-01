import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_NAME, resolveAppName } from './app-name';

describe('resolveAppName', () => {
  it('usa el valor de la variable cuando esta cargada', () => {
    expect(resolveAppName('Bandeja KOSMO')).toBe('Bandeja KOSMO');
  });

  it('le saca los espacios de borde', () => {
    expect(resolveAppName('  Bandeja KOSMO  ')).toBe('Bandeja KOSMO');
  });

  it('cae al default sin variable, vacia o con solo espacios', () => {
    expect(resolveAppName(undefined)).toBe(DEFAULT_APP_NAME);
    expect(resolveAppName('')).toBe(DEFAULT_APP_NAME);
    expect(resolveAppName('   ')).toBe(DEFAULT_APP_NAME);
  });
});
