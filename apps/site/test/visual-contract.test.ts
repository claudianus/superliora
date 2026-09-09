import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const src = resolve(import.meta.dirname, '../src');

function read(rel: string): string {
  return readFileSync(resolve(src, rel), 'utf8');
}

describe('conductor landing visual contract', () => {
  it('mounts the story in section order under a locale provider and fixed header', () => {
    const app = read('landing/App.tsx');
    expect(app).toContain('LocaleProvider');
    let pos = -1;
    for (const comp of ['Header', 'Hero', 'Flow', 'ControlRoom', 'Systems', 'Surfaces', 'Install', 'Footer']) {
      const at = app.indexOf(`<${comp}`);
      expect(at, `${comp} mounted`).toBeGreaterThan(pos);
      pos = at;
    }
    const header = read('landing/components/Header.tsx');
    expect(header).toContain('fixed inset-x-0 top-0');
    expect(header).toContain('scroll progress');
  });

  it('reveals sections on scroll and never leaves them stuck invisible', () => {
    const css = read('landing/landing.css');
    const reveal = read('landing/components/shared.tsx');
    expect(reveal).toContain('IntersectionObserver');
    expect(reveal).toMatch(/cn\(\s*"rv", on && "on"/);
    expect(css).toMatch(/\.rv\.on\s*\{[^}]*opacity:\s*1/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.rv\s*\{[^}]*opacity:\s*1/s);
  });

  it('wires install copy through the clipboard hook with a focus fallback', () => {
    const shared = read('landing/components/shared.tsx');
    expect(shared).toContain('navigator.clipboard.writeText');
    expect(shared).toContain('execCommand("copy")');
    expect(read('landing/components/Hero.tsx')).toContain('useCopy');
    expect(read('landing/components/Install.tsx')).toContain('useCopy');
  });

  it('pauses the TUI replay for reduced-motion visitors', () => {
    const tui = read('landing/tui/TuiEmulator.tsx');
    expect(tui).toContain('prefers-reduced-motion');
    // reduced-motion visitors must still get a painted terminal: the runner
    // renders the session end-state as a static frame instead of dead-ending.
    expect(tui).toMatch(/if \(reduced\) \{/);
    expect(tui).toMatch(/finalFrame\(locale\)/);
    expect(tui).not.toMatch(/if \(cancelled \|\| reduced\) return/);
  });

  it('runs the hero replay and the demo console on the TUI-colored stage', () => {
    expect(read('landing/components/Hero.tsx')).toContain('t.hero.installCmd');
    expect(read('landing/components/Hero.tsx')).toContain('<TuiEmulator');
    expect(read('landing/components/Hero.tsx')).toContain('brand-text');
    const css = read('landing/landing.css');
    expect(css).toContain('.noise');
    expect(css).toContain('.tui');
    const demo = read('landing/components/ControlRoom.tsx');
    expect(demo).toContain('"tui scan');
    expect(demo).toContain('OverlayShell');
    // The fake terminal speaks the same tokens as the real TUI chrome.
    const emulator = read('landing/tui/TuiEmulator.tsx');
    expect(emulator).toContain('text-primary');
    expect(read('landing/tui/session.ts')).toContain('primary: "text-primary"');
  });
});
