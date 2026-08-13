import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const src = resolve(import.meta.dirname, '../src');

function read(rel: string): string {
  return readFileSync(resolve(src, rel), 'utf8');
}

describe('landing visual contract', () => {
  it('keeps first-viewport copy above the product frame on a stacked layout', () => {
    const css = read('index.css');
    const sections = read('components/Sections.tsx');
    expect(sections).toMatch(/className="hero-copy" eager/);
    expect(sections).toMatch(/className="hero-visual" eager/);
    expect(css).toMatch(/\.hero-copy\s*\{[^}]*order:\s*1/s);
    expect(css).toMatch(/\.hero-visual\s*\{[^}]*order:\s*2/s);
    expect(css).toContain('@media (min-width: 1024px)');
    expect(css).toContain('grid-template-columns: minmax(0, 0.88fr) minmax(32rem, 1.12fr)');
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
});
