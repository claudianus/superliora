import { describe, expect, it } from 'vitest';

import { extractSymbols, langForFile } from '#/indexer/extract';

describe('langForFile', () => {
  it('maps extensions to parser langs', () => {
    expect(langForFile('a.ts')).toBe('ts');
    expect(langForFile('a.tsx')).toBe('tsx');
    expect(langForFile('a.d.ts')).toBe('dts');
    expect(langForFile('a.mjs')).toBe('js');
    expect(langForFile('a.jsx')).toBe('jsx');
  });
});

describe('extractSymbols', () => {
  it('extracts top-level declarations with kind, line, and export flags', () => {
    const source = [
      'import { x } from "./x";',
      '',
      'export function alpha() { return 1; }',
      'function hidden() {}',
      'export class Beta {}',
      'export interface Gamma { a: number }',
      'export type Delta = string;',
      'export enum Epsilon { A, B }',
      'export const zeta = 1, eta = 2;',
      'let theta = 3;',
    ].join('\n');
    const { symbols, parseErrorCount } = extractSymbols('sample.ts', source);
    expect(parseErrorCount).toBe(0);
    const byName = new Map(symbols.map((s) => [s.name, s]));
    expect(byName.get('alpha')).toMatchObject({ kind: 'function', line: 3, exported: true, defaultExport: false });
    expect(byName.get('hidden')).toMatchObject({ kind: 'function', line: 4, exported: false });
    expect(byName.get('Beta')).toMatchObject({ kind: 'class', line: 5, exported: true });
    expect(byName.get('Gamma')).toMatchObject({ kind: 'interface', line: 6, exported: true });
    expect(byName.get('Delta')).toMatchObject({ kind: 'type', line: 7, exported: true });
    expect(byName.get('Epsilon')).toMatchObject({ kind: 'enum', line: 8, exported: true });
    expect(byName.get('zeta')).toMatchObject({ kind: 'variable', line: 9, exported: true });
    expect(byName.get('eta')).toMatchObject({ kind: 'variable', line: 9, exported: true });
    expect(byName.get('theta')).toMatchObject({ kind: 'variable', line: 10, exported: false });
    expect(byName.has('x')).toBe(false);
  });

  it('marks default exports', () => {
    const source = 'export default function main() {}\n';
    const { symbols } = extractSymbols('main.ts', source);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({ name: 'main', exported: true, defaultExport: true });
  });

  it('parses tsx with jsx bodies', () => {
    const source = 'export const App = () => <div className="a">hi</div>;\n';
    const { symbols, parseErrorCount } = extractSymbols('app.tsx', source);
    expect(parseErrorCount).toBe(0);
    expect(symbols.some((s) => s.name === 'App' && s.exported)).toBe(true);
  });

  it('reports parse errors without throwing', () => {
    const source = 'export const broken = ;\nfunction )(\n';
    const { parseErrorCount } = extractSymbols('broken.ts', source);
    expect(parseErrorCount).toBeGreaterThan(0);
  });
});
