import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import type { AppState } from '#/tui/types';
import {
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';
import { buildSplashMorphScene } from '#/tui/utils/splash/splash-reveal-preview';
import { STAGE_MAX_WIDTH } from '#/tui/controllers/layout/stage-layout';

const appState: AppState = {
  version: '1.2.3',
  workDir: '/tmp/project',
  additionalDirs: [],
  sessionId: 'ses-1',
  sessionTitle: null,
  model: 'kimi-k2',
  permissionMode: 'manual',
  thinking: false,
  contextUsage: 0,
  contextTokens: 0,
  maxContextTokens: 0,
  isCompacting: false,
  isBackgroundCompacting: false,
  isReplaying: false,
  streamingPhase: 'idle',
  streamingStartTime: 0,
  planMode: false,
  askMode: false,
  inputMode: 'prompt',
  theme: 'dark',
  editorCommand: null,
  notifications: { enabled: true, condition: 'unfocused' },
  upgrade: { autoInstall: true },
  availableModels: {},
  availableProviders: {},
  mcpServersSummary: null,
  appearance: {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium',
    particles: 'ambient',
  },
};

describe('buildSplashMorphScene', () => {
  beforeEach(() => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('places Welcome brand target inside a capped centered stage', () => {
    const scene = buildSplashMorphScene({
      width: 200,
      rows: 80,
      appState,
      nowMs: 12_000,
    });
    expect(scene.lines).toHaveLength(80);
    expect(scene.stage.width).toBeLessThanOrEqual(STAGE_MAX_WIDTH);
    expect(scene.stage.x).toBeGreaterThan(0);
    expect(scene.brandTarget.x).toBeGreaterThanOrEqual(scene.stage.x);
    expect(scene.brandTarget.y).toBeGreaterThanOrEqual(scene.stage.y);
    expect(scene.brandTarget.width).toBeLessThanOrEqual(scene.stage.width);
    const joined = scene.lines.join('\n');
    expect(joined).toMatch(/SUPERLIORA|___|\|/);
  });

  it('aligns chrome + Welcome with the native header→transcript stack', () => {
    const width = 120;
    const rows = 40;
    const headerLines = ['HEADER'];
    const editorLines = ['EDITOR', 'EDITOR2', 'EDITOR3'];
    const footerLines = ['FOOTER', 'FOOTER2'];
    const scene = buildSplashMorphScene({
      width,
      rows,
      appState,
      nowMs: 12_000,
      headerLines,
      editorLines,
      footerLines,
    });

    // Header pins to stage.y (no phantom +1 gutter).
    const headerY = scene.stage.y;
    const plainHeader = strip(scene.lines[headerY] ?? '');
    expect(plainHeader.includes('HEADER')).toBe(true);

    // Transcript / Welcome starts immediately under the header.
    const contentTop = scene.stage.y + headerLines.length;
    // Brand target is inside the Welcome box, not shifted by old +1 offset.
    expect(scene.brandTarget.y).toBeGreaterThanOrEqual(contentTop);
    expect(scene.brandTarget.y).toBeLessThan(contentTop + 8);

    // Editor + footer sit at the bottom of the stage (native stack order).
    const bottomStart = scene.stage.y + scene.stage.height - footerLines.length - editorLines.length;
    expect(strip(scene.lines[bottomStart] ?? '')).toContain('EDITOR');
    expect(strip(scene.lines[bottomStart + editorLines.length] ?? '')).toContain('FOOTER');
  });
});

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}
