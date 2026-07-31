import { describe, expect, it } from 'vitest';

import {
  KEYMAP_ALL,
  KEYMAP_ALWAYS,
  KEYMAP_IDLE,
  KEYMAP_STREAMING,
  formatKeymapBindingSample,
  keymapBindingsForSlash,
  keymapSurfaceCounts,
} from '#/tui/keymap';
import {
  buildKeybindingsSettingsLines,
  loadKeybindingsGlance,
} from '#/tui/utils/keymap/keybindings-glance';

describe('keymap registry', () => {
  it('counts bindings per surface', () => {
    const counts = keymapSurfaceCounts();
    expect(counts.total).toBe(KEYMAP_ALL.length);
    expect(counts.always).toBe(KEYMAP_ALWAYS.length);
    expect(counts.idle).toBe(KEYMAP_IDLE.length);
    expect(counts.streaming).toBe(KEYMAP_STREAMING.length);
  });

  it('tags Mission / Ops / Fleet slash samples', () => {
    expect(keymapBindingsForSlash('/mission').map((b) => b.id)).toEqual([
      'interrupt',
      'ultrawork',
      'steer',
    ]);
    expect(keymapBindingsForSlash('/ops').map((b) => b.id)).toEqual([
      'expand-tool-output',
      'expand-todo',
      'steer',
    ]);
    expect(keymapBindingsForSlash('/fleet').map((b) => b.id)).toEqual([
      'interrupt',
      'steer',
      'background',
    ]);
    expect(formatKeymapBindingSample(keymapBindingsForSlash('/mission')[1]!)).toContain('Shift-Tab');
  });
});

describe('keybindings-glance', () => {
  it('references keymap SSOT and /help', () => {
    const glance = loadKeybindingsGlance();
    expect(glance.bindingCount).toBe(KEYMAP_ALL.length);
    expect(glance.alwaysCount).toBe(KEYMAP_ALWAYS.length);
    expect(glance.idleCount).toBe(KEYMAP_IDLE.length);
    expect(glance.streamingCount).toBe(KEYMAP_STREAMING.length);

    const lines = buildKeybindingsSettingsLines(glance).join('\n');
    expect(lines).toContain('Keyboard / Keybindings (read-only)');
    expect(lines).toContain('Live registry (keymap.ts)');
    expect(lines).toContain('Mission / Ops / Fleet samples');
    expect(lines).toContain('/help');
    expect(lines).toContain(String(KEYMAP_ALL.length));
    expect(lines).toContain('Shift-Tab — Toggle Mission mode');
    expect(lines).toContain('Ctrl-O — Toggle tool output');
    expect(lines).toContain('Ctrl-B — Background the current work');
    expect(lines).toContain('No keybinding editor here');
  });
});
