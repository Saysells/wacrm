import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guarda estática, sin navegador, del contrato que fija
 * `dropdown-menu-group-label.test.tsx` (issue #336): `DropdownMenuLabel`
 * es el `Menu.GroupLabel` de base-ui y `SelectLabel` el
 * `Select.GroupLabel`; los dos TIRAN ERROR al renderizarse sin su
 * `Group` arriba, y como el menú se abre en el cliente, el error se
 * lleva la página entera. Recorre todos los .tsx de `src/` y falla si
 * un rótulo queda fuera de su grupo. La sesión A del rediseño volvió a
 * romper esto en el selector de bandejas (top-bar.tsx).
 *
 * Criterio: en cada archivo, para cada `<DropdownMenuLabel`, la cantidad
 * de `<DropdownMenuGroup` abiertos menos los `</DropdownMenuGroup>`
 * cerrados ANTES de esa posición tiene que ser mayor a cero. Es un
 * conteo textual, no un parser: alcanza porque un grupo y su rótulo
 * viven siempre en el mismo archivo.
 */

const SRC = join(process.cwd(), 'src');
/** Las definiciones de los componentes no cuentan. */
const SKIP_DIR = join(SRC, 'components', 'ui');

const PAIRS: ReadonlyArray<{ label: string; group: string }> = [
  { label: 'DropdownMenuLabel', group: 'DropdownMenuGroup' },
  { label: 'SelectLabel', group: 'SelectGroup' },
];

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (full === SKIP_DIR || name === 'node_modules') continue;
      tsxFiles(full, out);
    } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function unwrappedLabels(source: string, label: string, group: string): number[] {
  const open = new RegExp(`<${group}(?![A-Za-z])[^>]*?(?<!/)>`, 'g');
  const close = new RegExp(`</${group}>`, 'g');
  const use = new RegExp(`<${label}(?![A-Za-z])`, 'g');
  const events: Array<{ at: number; delta: number }> = [];
  for (const m of source.matchAll(open)) events.push({ at: m.index, delta: 1 });
  for (const m of source.matchAll(close)) events.push({ at: m.index, delta: -1 });
  events.sort((a, b) => a.at - b.at);
  const lines: number[] = [];
  for (const m of source.matchAll(use)) {
    const depth = events
      .filter((e) => e.at < m.index)
      .reduce((acc, e) => acc + e.delta, 0);
    if (depth <= 0) {
      lines.push(source.slice(0, m.index).split('\n').length);
    }
  }
  return lines;
}

describe('rótulos de menú siempre adentro de su grupo (issue #336)', () => {
  const files = tsxFiles(SRC);

  it('encuentra archivos para revisar', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(PAIRS)('ningún <$label> fuera de un <$group>', ({ label, group }) => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes(`<${label}`)) continue;
      for (const line of unwrappedLabels(source, label, group)) {
        offenders.push(`${relative(process.cwd(), file)}:${line}`);
      }
    }
    expect(offenders, `<${label}> sin <${group}> arriba`).toEqual([]);
  });

  it('detecta un rótulo suelto (autoprueba del conteo)', () => {
    expect(
      unwrappedLabels('<DropdownMenuContent><DropdownMenuLabel>x</DropdownMenuLabel></DropdownMenuContent>', 'DropdownMenuLabel', 'DropdownMenuGroup'),
    ).toEqual([1]);
    expect(
      unwrappedLabels('<DropdownMenuGroup>\n<DropdownMenuLabel>x</DropdownMenuLabel>\n</DropdownMenuGroup>', 'DropdownMenuLabel', 'DropdownMenuGroup'),
    ).toEqual([]);
    expect(
      unwrappedLabels('<DropdownMenuGroup />\n<DropdownMenuLabel>x</DropdownMenuLabel>', 'DropdownMenuLabel', 'DropdownMenuGroup'),
    ).toEqual([2]);
  });
});
