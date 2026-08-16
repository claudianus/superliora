import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const src = resolve(import.meta.dirname, '../src');

function read(rel: string): string {
  return readFileSync(resolve(src, rel), 'utf8');
}

describe('landing visual contract', () => {
  it('ships a cinematic full-bleed first viewport without ProductFrame card-hero', () => {
    const css = read('index.css');
    const sections = read('components/Sections.tsx');
    expect(sections).toMatch(/hero-band--cinematic|hero-band hero-band--cinematic/);
    expect(sections).toMatch(/className="hero-copy" eager/);
    expect(sections).toMatch(/product-band/);
    expect(sections).toMatch(/ProductFrame/);
    // ProductFrame lives outside the cinematic hero band.
    const heroStart = sections.indexOf('hero-band');
    const heroEnd = sections.indexOf('</section>', heroStart);
    const heroChunk = sections.slice(heroStart, heroEnd);
    expect(heroChunk).not.toContain('ProductFrame');
    expect(heroChunk).toContain('hero-copy');
    expect(css).toMatch(/\.hero-band--cinematic/);
    expect(css).toMatch(/\.product-band/);
    // Old split-hero grid that forced ProductFrame beside copy is retired.
    expect(css).not.toContain('grid-template-columns: minmax(0, 0.88fr) minmax(32rem, 1.12fr)');
  });

  it('separates Features / Usage / Workflow / Install as distinct bands', () => {
    const sections = read('components/Sections.tsx');
    expect(sections).toContain('section-band--features');
    expect(sections).toContain('section-band--usage');
    expect(sections).toContain('section-band--workflow');
    expect(sections).toContain('section-band--install');
    expect(sections).toContain('data-cta="install"');
    expect(sections).toContain('btn-pulse');
  });

  it('wires motion, copy reward, and reduced-motion kill switches', () => {
    const css = read('index.css');
    const copy = read('components/CopyButton.tsx');
    const reveal = read('components/Reveal.tsx');
    expect(copy).toContain('copy-reward');
    expect(copy).toContain('data-copied');
    expect(reveal).toContain('motionEnabled');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain("html[data-motion='off']");
    expect(css).toContain('copy-burst');
    expect(css).toMatch(/animation:\s*none/);
  });

  it('honors forced-colors fallbacks for atmosphere layers', () => {
    const css = read('index.css');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toMatch(/forced-colors:\s*active[\s\S]*\.noir-field/);
  });
});
