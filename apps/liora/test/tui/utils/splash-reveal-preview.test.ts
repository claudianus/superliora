import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import type { AppState } from '#/tui/types';
import {
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';
import { buildSplashMorphScene } from '#/tui/utils/splash-reveal-preview';
import { STAGE_MAX_WIDTH } from '#/tui/controllers/stage-layout';

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
  inputMode: 'prompt',
  swarmMode: false,
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
});
