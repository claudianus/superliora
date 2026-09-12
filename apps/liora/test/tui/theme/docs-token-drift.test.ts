import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { darkColors, lightColors, type ColorPalette } from '#/tui/theme/colors';

const THEMES_DOC_REL = 'docs/en/customization/themes.md';
const SKILL_DOC_REL = 'packages/agent-core/src/skill/builtin/custom-theme.md';
const SCHEMA_REL = 'apps/liora/src/tui/theme/theme-schema.json';

/** Walk up to the repo root (marker: pnpm-workspace.yaml) — robust to vitest transforms. */
function findRepoRoot(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repo root not found (no pnpm-workspace.yaml above the test file)');
}

const REPO_ROOT = findRepoRoot();
const THEMES_DOC = join(REPO_ROOT, THEMES_DOC_REL);
const SKILL_DOC = join(REPO_ROOT, SKILL_DOC_REL);
const SCHEMA = join(REPO_ROOT, SCHEMA_REL);

/** Parse the built-in token table rows of themes.md → { token: { dark, light } }. */
function parseThemesDocTable(): Map<string, { dark?: string; light?: string }> {
  const table = new Map<string, { dark?: string; light?: string }>();
  const text = readFileSync(THEMES_DOC, 'utf8');
  for (const line of text.split('\n')) {
    const match = /^\| `([a-zA-Z]+)` \| (`#[0-9a-fA-F]{6}`) \| (`#[0-9a-fA-F]{6}`) \|/.exec(line);
    if (match === null) continue;
    table.set(match[1]!, { dark: match[2]!.slice(1, -1), light: match[3]!.slice(1, -1) });
  }
  return table;
}

/** Parse the custom-theme skill doc's token table → token names. */
function parseSkillDocTokenNames(): Set<string> {
  const names = new Set<string>();
  const text = readFileSync(SKILL_DOC, 'utf8');
  for (const line of text.split('\n')) {
    const match = /^\| `([a-zA-Z]+)` \|/.exec(line);
    if (match !== null) names.add(match[1]!);
  }
  return names;
}

function parseSchemaTokenNames(): Set<string> {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as {
    properties?: { colors?: { properties?: Record<string, unknown> } };
  };
  return new Set(Object.keys(schema.properties?.colors?.properties ?? {}));
}

function paletteKeys(palette: ColorPalette): string[] {
  return Object.keys(palette);
}

describe('theme docs token mirrors', () => {
  it('themes.md documents every ColorPalette token', () => {
    const doc = parseThemesDocTable();
    const code = [...paletteKeys(darkColors), ...paletteKeys(lightColors)];
    const missing = code.filter((token) => !doc.has(token));
    expect(missing, `themes.md is missing tokens: ${missing.join(', ')}`).toEqual([]);
  });

  it('themes.md dark/light hex values match colors.ts exactly', () => {
    const doc = parseThemesDocTable();
    const drift: string[] = [];
    for (const [token, values] of doc) {
      const dark = darkColors[token as keyof ColorPalette];
      const light = lightColors[token as keyof ColorPalette];
      if (dark !== undefined && values.dark !== undefined && values.dark !== dark) {
        drift.push(`${token} dark: doc ${values.dark} != code ${dark}`);
      }
      if (light !== undefined && values.light !== undefined && values.light !== light) {
        drift.push(`${token} light: doc ${values.light} != code ${light}`);
      }
    }
    expect(drift, 'themes.md hex drift from colors.ts').toEqual([]);
  });

  it('custom-theme skill doc and schema list every ColorPalette token', () => {
    const code = new Set([...paletteKeys(darkColors), ...paletteKeys(lightColors)]);
    const skillDoc = parseSkillDocTokenNames();
    const schema = parseSchemaTokenNames();
    const missingFromSkill = [...code].filter((token) => !skillDoc.has(token));
    const missingFromSchema = [...code].filter((token) => !schema.has(token));
    expect(
      missingFromSkill,
      `custom-theme.md is missing tokens: ${missingFromSkill.join(', ')}`,
    ).toEqual([]);
    expect(
      missingFromSchema,
      `theme-schema.json is missing tokens: ${missingFromSchema.join(', ')}`,
    ).toEqual([]);
  });

  it('tokens present in the mirrors are not stale extras', () => {
    const code = new Set([...paletteKeys(darkColors), ...paletteKeys(lightColors)]);
    const doc = parseThemesDocTable();
    const stale = [...doc.keys()].filter((token) => !code.has(token));
    expect(stale, `themes.md documents removed tokens: ${stale.join(', ')}`).toEqual([]);
  });

  it('guards exist in the repo tree (layout sanity for this test itself)', () => {
    expect(existsSync(THEMES_DOC)).toBe(true);
    expect(existsSync(SKILL_DOC)).toBe(true);
    expect(readdirSync(join(REPO_ROOT, 'docs/en')).length).toBeGreaterThan(0);
    expect(existsSync(SCHEMA)).toBe(true);
  });
});
