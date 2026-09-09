import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { translations, type DocSlug } from '../src/i18n/translations';
import { splitRichText } from '../src/docs/richtext';

const siteRoot = resolve(import.meta.dirname, '..');
const src = resolve(siteRoot, 'src');

const read = (rel: string): string => readFileSync(resolve(siteRoot, rel), 'utf8');
const readSrc = (rel: string): string => readFileSync(resolve(src, rel), 'utf8');

const SLUGS: DocSlug[] = [
  'getting-started',
  'how-conductor-works',
  'jobs',
  'control-tower',
  'reference',
];

function docsHtml(): { rel: string; html: string; lang: 'ko' | 'en'; slug: DocSlug }[] {
  const out: { rel: string; html: string; lang: 'ko' | 'en'; slug: DocSlug }[] = [];
  for (const lang of ['ko', 'en'] as const) {
    const dir = lang === 'ko' ? 'docs' : 'en/docs';
    for (const slug of SLUGS) {
      const rel = `${dir}/${slug}.html`;
      out.push({ rel, html: read(rel), lang, slug });
    }
  }
  return out;
}

describe('docs html entries', () => {
  it('ships ten localized entries with the same metadata bar as the landing', () => {
    const files = docsHtml();
    expect(files).toHaveLength(10);
    for (const { rel, html, lang, slug } of files) {
      const url =
        lang === 'ko'
          ? `https://claudianus.github.io/superliora/docs/${slug}.html`
          : `https://claudianus.github.io/superliora/en/docs/${slug}.html`;
      expect(html, `${rel} doctype`).toMatch(/^<!doctype html>/i);
      expect(html, `${rel} data-doc`).toContain(`data-doc="${slug}"`);
      // Localized title — never the raw slug.
      expect(html, `${rel} title`).not.toContain(`<title>${slug} · SuperLiora</title>`);
      expect(html, `${rel} title`).toMatch(/<title>[^<]* — SuperLiora (가이드|Guide)<\/title>/);
      expect(html, `${rel} fonts`).toContain('Space+Grotesk');
      expect(html, `${rel} fonts`).toContain('IBM+Plex+Mono');
      expect(html, `${rel} legacy fonts`).not.toContain('Syne');
      expect(html, `${rel} legacy fonts`).not.toContain('JetBrains');
      expect(html, `${rel} canonical`).toContain(`<link rel="canonical" href="${url}" />`);
      expect(html, `${rel} hreflang`).toContain('hreflang="ko"');
      expect(html, `${rel} hreflang`).toContain('hreflang="en"');
      expect(html, `${rel} hreflang`).toContain('hreflang="x-default"');
      expect(html, `${rel} og`).toContain('property="og:title"');
      expect(html, `${rel} og`).toContain('property="og:description"');
      expect(html, `${rel} og`).toContain('https://claudianus.github.io/superliora/og.png');
      expect(html, `${rel} twitter`).toContain('name="twitter:card"');
      expect(html, `${rel} jsonld`).toContain('"@type":"TechArticle"');
      expect(html, `${rel} legacy body`).not.toContain('bg-bg');
      expect(html, `${rel} legacy body`).not.toContain('text-text');
    }
  });
});

describe('docs app shell', () => {
  const app = () => readSrc('docs/DocsApp.tsx');

  it('mirrors the landing header: fixed bar, scroll progress, locale + theme + GitHub', () => {
    const source = app();
    expect(source).toContain('fixed inset-x-0 top-0');
    expect(source).toContain('scroll progress');
    expect(source).toContain('useTheme');
    expect(source).toContain('https://github.com/claudianus/superliora');
    expect(source).toContain('max-w-6xl');
    expect(source).toContain('docsShell.onThisSite');
  });

  it('renders a sidebar index, a scrollspy TOC, and a prev/next pager', () => {
    const source = app();
    expect(source).toContain('docsShell.guide');
    expect(source).toContain('docsShell.toc');
    expect(source).toContain('IntersectionObserver');
    expect(source).toContain('docsShell.prev');
    expect(source).toContain('docsShell.next');
    expect(source).toContain('aria-current');
  });

  it('wires terminal blocks through tabs and the shared clipboard hook', () => {
    const source = app();
    expect(source).toContain('useCopy');
    expect(source).toContain('role="tablist"');
    expect(source).toContain('docsShell.copy');
    expect(source).toContain('docsShell.copied');
    expect(source).toContain('docsShell.terminal');
  });

  it('reveals on scroll, highlights keys/commands inline, and closes with the landing footer', () => {
    const source = app();
    expect(source).toContain('Reveal');
    expect(source).toContain('KeyCap');
    expect(source).toContain('outline-word');
    expect(source).toContain('#docs-article');
  });

  it('uses no legacy docs classes or the old narrow container', () => {
    const source = app();
    for (const legacy of ['bg-bg', 'text-text', 'text-soft', 'text-muted', 'mesh-bg', 'grain ', 'max-w-5xl']) {
      expect(source, legacy).not.toContain(legacy);
    }
  });
});

describe('docs stylesheet parity with the landing stage', () => {
  it('declares the same dark token hexes as landing.css', () => {
    const docs = readSrc('index.css');
    const landing = readSrc('landing/landing.css');
    for (const token of [
      'paper',
      'panel',
      'raise',
      'sunken',
      'ink',
      'dim',
      'faint',
      'primary',
      'primary-deep',
      'mint',
      'red',
      'azure',
      'violet',
      'line',
    ]) {
      const expected = new RegExp(`--color-${token}:\\s*(#[0-9a-f]{6})`).exec(landing)?.[1];
      expect(expected, `landing --color-${token}`).toBeTruthy();
      expect(docs, `docs --color-${token}`).toContain(`--color-${token}: ${expected!.toLowerCase()}`);
    }
    for (const atom of ['.noise', '.grid-bg', '.rv', '.rv.on', '.kbd', '.brand-text', '.outline-word']) {
      expect(docs, atom).toContain(atom);
    }
    expect(docs).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.rv\s*\{[^}]*opacity:\s*1/s);
  });

  it('keeps a light override for the themed tokens', () => {
    const docs = readSrc('index.css');
    expect(docs).toMatch(/html\[data-theme="light"\]\s*\{[^}]*--color-paper:\s*#[0-9a-f]{6}/s);
    expect(docs).toMatch(/html\[data-theme="light"\]\s*\{[^}]*--color-ink:\s*#[0-9a-f]{6}/s);
    expect(docs).toMatch(/html\[data-theme="light"\]\s*\{[^}]*--color-primary:\s*#[0-9a-f]{6}/s);
  });
});

describe('docs content structure', () => {
  it('keeps ko and en structurally identical with non-empty copy', () => {
    for (const slug of SLUGS) {
      const ko = translations.ko.docs[slug];
      const en = translations.en.docs[slug];
      expect(ko.sections.length, `${slug} section count`).toBe(en.sections.length);
      ko.sections.forEach((section, i) => {
        const other = en.sections[i];
        expect(section.heading.trim().length, `${slug}[${i}].heading`).toBeGreaterThan(0);
        expect(section.body.trim().length, `${slug}[${i}].body`).toBeGreaterThan(0);
        expect(section.list?.length ?? 0, `${slug}[${i}].list`).toBe(other.list?.length ?? 0);
        expect(section.tabs?.length ?? 0, `${slug}[${i}].tabs`).toBe(other.tabs?.length ?? 0);
        expect(Boolean(section.code), `${slug}[${i}].code`).toBe(Boolean(other.code));
        expect(Boolean(section.note), `${slug}[${i}].note`).toBe(Boolean(other.note));
        for (const item of section.list ?? []) {
          expect(item.trim().length, `${slug}[${i}].list`).toBeGreaterThan(0);
        }
        for (const tab of section.tabs ?? []) {
          expect(tab.label.trim().length, `${slug}[${i}].tabs`).toBeGreaterThan(0);
          expect(tab.code.trim().length, `${slug}[${i}].tabs`).toBeGreaterThan(0);
        }
      });
    }
    for (const lang of ['ko', 'en'] as const) {
      for (const [key, value] of Object.entries(translations[lang].docsShell)) {
        expect(value.trim().length, `docsShell.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('renders install commands as per-OS tabs, not one pasted wall', () => {
    for (const lang of ['ko', 'en'] as const) {
      const install = translations[lang].docs['getting-started'].sections[0];
      expect(install.tabs?.length).toBe(3);
      expect(install.code).toBeUndefined();
    }
  });

  it('touches every docs html file the sitemap advertises', () => {
    const sitemap = read('public/sitemap.xml');
    const advertised = [...sitemap.matchAll(/\/superliora\/(en\/docs\/[^<]+\.html|docs\/[^<]+\.html)/g)].map(
      (m) => m[1],
    );
    expect(advertised.length).toBeGreaterThanOrEqual(10);
    for (const rel of advertised) {
      expect(() => read(rel), rel).not.toThrow();
    }
    // No orphan docs html outside the sitemap.
    const onDisk = [
      ...readdirSync(resolve(siteRoot, 'docs')),
      ...readdirSync(resolve(siteRoot, 'en/docs')).map((f) => `en/docs/${f}`),
    ]
      .filter((f) => f.endsWith('.html'))
      .map((f) => (f.startsWith('en/') ? f : `docs/${f}`))
      .toSorted();
    expect(onDisk).toEqual(advertised.toSorted());
  });
});

describe('docs inline tokenizer', () => {
  it('highlights keys, commands, flags, and idents without swallowing prose', () => {
    expect(splitRichText('Alt+J 진행 · Alt+I 질문함')).toEqual([
      { text: 'Alt+J', kind: 'kbd' },
      { text: ' 진행 · ', kind: 'plain' },
      { text: 'Alt+I', kind: 'kbd' },
      { text: ' 질문함', kind: 'plain' },
    ]);
    // Prose around a command stays plain.
    expect(splitRichText('Use /plan for big design, /goal to push until done.')).toEqual([
      { text: 'Use ', kind: 'plain' },
      { text: '/plan', kind: 'cmd' },
      { text: ' for big design, ', kind: 'plain' },
      { text: '/goal', kind: 'cmd' },
      { text: ' to push until done.', kind: 'plain' },
    ]);
    expect(splitRichText('liora upgrade 또는 /upgrade로 갱신')).toEqual([
      { text: 'liora upgrade', kind: 'cmd' },
      { text: ' 또는 ', kind: 'plain' },
      { text: '/upgrade', kind: 'cmd' },
      { text: '로 갱신', kind: 'plain' },
    ]);
    // Slashes with a space after them (lists, Ask / Build) are not commands.
    expect(splitRichText('balanced / greenfield / hotfix')).toEqual([
      { text: 'balanced / greenfield / hotfix', kind: 'plain' },
    ]);
    // Brand and prose words are never tokenized.
    expect(splitRichText('SuperLiora가 OAuth로 연결')).toEqual([
      { text: 'SuperLiora가 OAuth로 연결', kind: 'plain' },
    ]);
    expect(splitRichText('--worktree와는 다릅니다. $env:SUPERLIORA_HOME, SUPERLIORA_LOCALE=ko|en')).toEqual([
      { text: '--worktree', kind: 'mono' },
      { text: '와는 다릅니다. ', kind: 'plain' },
      { text: '$env:SUPERLIORA_HOME', kind: 'mono' },
      { text: ', ', kind: 'plain' },
      { text: 'SUPERLIORA_LOCALE=ko|en', kind: 'mono' },
    ]);
  });
});

describe('shared docs imports', () => {
  it('reuses the landing reveal/copy/key atoms instead of forking them', () => {
    const source = readSrc('docs/DocsApp.tsx');
    expect(source).toContain("from '../landing/components/shared'");
    expect(source).toContain("from '../landing/utils/cn'");
  });
});
