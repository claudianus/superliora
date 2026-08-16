import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

describe('theme paint bootstrap contract', () => {
  it('covers the twelve Pages HTML entries', () => {
    expect(htmlFiles.length).toBeGreaterThanOrEqual(12);
    const rel = htmlFiles.map((p) => p.slice(siteRoot.length + 1).replaceAll('\\', '/')).sort();
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

  it('puts color-scheme meta and superliora-theme bootstrap in every HTML entry', () => {
    for (const file of htmlFiles) {
      const html = readFileSync(file, 'utf8');
      expect(html, file).toMatch(/<meta\s+name=["']color-scheme["']\s+content=["']dark light["']\s*\/?>/i);
      expect(html, file).toContain("superliora-theme");
      expect(html, file).toContain('dataset.theme');
      expect(html, file).toMatch(/colorScheme\s*=\s*theme|style\.colorScheme\s*=\s*theme/);
      expect(html, file).not.toMatch(/matchMedia\s*\(\s*['"]prefers-color-scheme/);
    }
  });

  it('declares root color-scheme tokens for dark default and light override', () => {
    const css = readFileSync(resolve(siteRoot, 'src/index.css'), 'utf8');
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/s);
    expect(css).toMatch(/html\[data-theme=["']light["']\]\s*\{[^}]*color-scheme:\s*light/s);
  });

  it('applies theme before paint via shared applyTheme path (not effect-only)', () => {
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

  it('stops dark-only atmosphere on light theme instead of CSS display:none alone', () => {
    const noir = readFileSync(resolve(siteRoot, 'src/components/NoirField.tsx'), 'utf8');
    const living = readFileSync(resolve(siteRoot, 'src/components/LivingField.tsx'), 'utf8');
    expect(noir).toMatch(/data-theme|dataset\.theme|getAttribute\(['"]data-theme/);
    expect(noir).toMatch(/cancelAnimationFrame|loseContext/);
    expect(living).toMatch(/data-theme|dataset\.theme|getAttribute\(['"]data-theme/);
  });
});

describe('theme contract fixtures exist', () => {
  it('keeps the theme hook file present', () => {
    expect(existsSync(resolve(siteRoot, 'src/hooks/useTheme.ts'))).toBe(true);
  });
});
