import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../src/landing/i18n/en';
import { ko } from '../src/landing/i18n/ko';
import { INSTALL_CMD, INSTALL_PS, INSTALL_SH } from '../src/content';

const siteRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(siteRoot, '../..');

const BANNED = [
  { re: /\bultrawork\b/i, label: 'ultrawork' },
  { re: /\bblood\s*moon\b/i, label: 'blood moon' },
  { re: /#E63946|#E8414E/i, label: 'blood moon hex' },
  { re: /\/mission\b/i, label: '/mission' },
  { re: /\/ultrawork\b/i, label: '/ultrawork' },
  { re: /\bultraswarm\b/i, label: 'ultraswarm' },
  { re: /\bllm\s*wiki\b/i, label: 'llm wiki' },
  { re: /\bliora\s*memory\b/i, label: 'liora memory' },
  { re: /\b128\s+(specialist\s+)?(sub)?agents?\b/i, label: '128 agents' },
  { re: /\bMission\s+mode\b/i, label: 'Mission mode' },
  { re: /\bMission\s+Control\b/i, label: 'Mission Control' },
];

function walkStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) walkStrings(item, out);
  }
  return out;
}

// Key shape with array lengths baked in, so a ko/en drift in list size fails.
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .toSorted()
        .map((key) => [key, shape((value as Record<string, unknown>)[key])]),
    );
  }
  return typeof value;
}

describe('conductor landing dictionaries', () => {
  it('ships the README install one-liners verbatim in ko and en', () => {
    for (const dict of [ko, en]) {
      expect(dict.hero.installCmd).toBe(INSTALL_SH);
      expect(dict.install.cmds.map((cmd) => cmd.code)).toEqual([INSTALL_SH, INSTALL_PS, INSTALL_CMD]);
      expect(dict.hero.nodeNote).toContain('24.15.0');
      expect(dict.install.notes.some((note) => `${note.title} ${note.body}`.includes('24.15.0'))).toBe(true);
    }
    const readme = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');
    const readmeKo = readFileSync(resolve(repoRoot, 'README.ko.md'), 'utf8');
    for (const cmd of [INSTALL_SH, INSTALL_PS, INSTALL_CMD]) {
      expect(readme, 'README.md').toContain(cmd);
      expect(readmeKo, 'README.ko.md').toContain(cmd);
    }
  });

  it('keeps ko and en structurally identical with non-empty copy', () => {
    expect(shape(ko)).toEqual(shape(en));
    for (const dict of [ko, en]) {
      for (const text of walkStrings(dict)) {
        expect(text.trim().length, text).toBeGreaterThan(0);
      }
    }
  });

  it('points the nav anchors at sections the components render', () => {
    const anchors = ko.header.nav.map((item) => item.href);
    expect(anchors).toEqual(['#flow', '#demo', '#systems', '#surfaces', '#install']);
    expect(en.header.nav.map((item) => item.href)).toEqual(anchors);
    const sources: Record<string, string> = {
      flow: 'Flow.tsx',
      demo: 'ControlRoom.tsx',
      systems: 'Systems.tsx',
      surfaces: 'Surfaces.tsx',
      install: 'Install.tsx',
    };
    for (const [id, file] of Object.entries(sources)) {
      const source = readFileSync(resolve(siteRoot, 'src/landing/components', file), 'utf8');
      expect(source, `${id} in ${file}`).toContain(`id="${id}"`);
    }
  });

  it('shows one semver version badge in both locales', () => {
    expect(ko.header.version).toBe(en.header.version);
    expect(ko.header.version).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('links footer docs entries to pages that ship with this site', () => {
    const pages = [ko, en]
      .flatMap((dict) => dict.footer.columns.flatMap((column) => column.links))
      .map((link) => link.href)
      .filter((href) => href.startsWith('https://claudianus.github.io/superliora/'));
    expect(pages.length).toBeGreaterThan(0);
    for (const href of pages) {
      const rel = href.slice('https://claudianus.github.io/superliora/'.length);
      expect(existsSync(resolve(siteRoot, rel)), href).toBe(true);
    }
  });

  it('keeps retired product language out of the landing dictionaries', () => {
    const hits: string[] = [];
    for (const dict of [ko, en]) {
      for (const text of walkStrings(dict)) {
        for (const ban of BANNED) {
          if (ban.re.test(text)) hits.push(`${ban.label} ← ${text}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

});

describe('landing html entries', () => {
  it('serve the app shell at / and /en/ with absolute Pages metadata', () => {
    const rootPage = readFileSync(resolve(siteRoot, 'index.html'), 'utf8');
    const enPage = readFileSync(resolve(siteRoot, 'en/index.html'), 'utf8');
    for (const html of [rootPage, enPage]) {
      expect(html).toContain('src="/src/main.tsx"');
      expect(html).toContain('https://claudianus.github.io/superliora/og.png');
      expect(html).toContain('hreflang="ko"');
      expect(html).toContain('hreflang="en"');
      expect(html).toContain('hreflang="x-default"');
    }
    expect(enPage).toContain('data-locale="en"');
    expect(existsSync(resolve(siteRoot, 'public/og.png'))).toBe(true);
  });
});
