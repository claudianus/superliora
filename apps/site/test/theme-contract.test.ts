import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const siteRoot = resolve(import.meta.dirname, '..');

function collectHtml(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.visual-qa') continue;
      out.push(...collectHtml(full));
      continue;
    }
    if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const htmlFiles = collectHtml(siteRoot).filter((p) => !p.includes(`${join('dist')}`));
const relOf = (p: string) => p.slice(siteRoot.length + 1).replaceAll('\\', '/');
const LANDING_ENTRIES = ['index.html', 'en/index.html'];

describe('theme paint bootstrap contract', () => {
  it('covers the twelve Pages HTML entries', () => {
    expect(htmlFiles.length).toBeGreaterThanOrEqual(12);
    const rel = htmlFiles.map(relOf).toSorted();
    expect(rel).toEqual(
      expect.arrayContaining([
        'index.html',
        'en/index.html',
        'docs/getting-started.html',
        'docs/how-conductor-works.html',
        'docs/jobs.html',
        'docs/control-tower.html',
        'docs/reference.html',
        'en/docs/getting-started.html',
        'en/docs/how-conductor-works.html',
        'en/docs/jobs.html',
        'en/docs/control-tower.html',
        'en/docs/reference.html',
      ]),
    );
  });

  it('pins the landing entries to the dark Gold Noir stage without the legacy bootstrap', () => {
    for (const rel of LANDING_ENTRIES) {
      const html = readFileSync(resolve(siteRoot, rel), 'utf8');
      expect(html, rel).toMatch(/<meta\s+name=["']color-scheme["']\s+content=["']dark["']\s*\/?>/i);
      expect(html, rel).toContain('#0a0b0d');
      expect(html, rel).not.toContain('superliora-theme');
      expect(html, rel).not.toMatch(/dataset\.theme/);
    }
  });

  it('keeps the dark/light theme bootstrap on the docs entries', () => {
    const docs = htmlFiles.map(relOf).filter((rel) => !LANDING_ENTRIES.includes(rel));
    expect(docs.length).toBeGreaterThanOrEqual(10);
    for (const rel of docs) {
      const html = readFileSync(resolve(siteRoot, rel), 'utf8');
      expect(html, rel).toMatch(/<meta\s+name=["']color-scheme["']\s+content=["']dark light["']\s*\/?>/i);
      expect(html, rel).toContain('superliora-theme');
      expect(html, rel).toContain('dataset.theme');
      expect(html, rel).toMatch(/colorScheme\s*=\s*theme|style\.colorScheme\s*=\s*theme/);
      expect(html, rel).not.toMatch(/matchMedia\s*\(\s*['"]prefers-color-scheme/);
    }
  });

  it('declares root color-scheme tokens for docs dark default and light override', () => {
    const css = readFileSync(resolve(siteRoot, 'src/index.css'), 'utf8');
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/s);
    expect(css).toMatch(/html\[data-theme=["']light["']\]\s*\{[^}]*color-scheme:\s*light/s);
  });

  it('applies docs theme before paint via shared applyTheme path (not effect-only)', () => {
    const hook = readFileSync(resolve(siteRoot, 'src/hooks/useTheme.ts'), 'utf8');
    expect(hook).toMatch(/export\s+function\s+applyTheme/);
    expect(hook).toMatch(/dataset\.theme\s*=\s*theme/);
    expect(hook).toMatch(/colorScheme\s*=\s*theme|style\.colorScheme\s*=\s*theme/);
    expect(hook).toMatch(/theme-color/);
    expect(hook).toMatch(/applyTheme\s*\(/);
    expect(hook).not.toMatch(/matchMedia\s*\(\s*['"]prefers-color-scheme/);
    // Module-scope or initial-state path must call applyTheme so first paint is not effect-only.
    expect(hook).toMatch(/applyTheme\s*\(\s*getInitialTheme\s*\(\s*\)\s*\)|applyTheme\s*\(\s*theme\s*\)/);
  });

  it('keeps the landing stylesheet a dark-only Gold Noir stage', () => {
    const css = readFileSync(resolve(siteRoot, 'src/landing/landing.css'), 'utf8');
    expect(css).toContain('--color-paper: #0a0b0d');
    expect(css).toContain('--color-gold: #f2b94b');
    expect(css).toMatch(/body\s*\{[^}]*background:\s*var\(--color-paper\)/s);
    expect(css).not.toMatch(/0D1422|00D5FF/i);
    expect(css).not.toMatch(/html\[data-theme=["']light["']\]/);
  });
});

describe('theme contract fixtures exist', () => {
  it('keeps the theme hook file present', () => {
    expect(existsSync(resolve(siteRoot, 'src/hooks/useTheme.ts'))).toBe(true);
  });
});
