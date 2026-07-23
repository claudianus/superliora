/**
 * Multi-size bento frame visual harness.
 * Writes ASCII maps + region tables under /tmp/liora-bento-frames/
 */
import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Text } from '#/tui/renderer';
import type { AppState } from '#/tui/types';
import { createTUIState } from '#/tui/tui-state';
import { buildTUIStateNativeFrameRegions } from '#/tui/utils/native-layout-frame';
import { setCliLocale } from '#/cli/i18n';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

chalk.level = 3;
process.env['TERM'] = 'xterm-256color';
delete process.env['CI'];
delete process.env['NO_COLOR'];
setCliLocale('en');
setActiveAppearancePreferences({
  ...DEFAULT_APPEARANCE_PREFERENCES,
  profile: 'premium',
  particles: 'off',
});
setAppearanceRenderQuality('full');
setAppearanceRenderHealth('healthy');

function fakeInitialAppState(): AppState {
  return {
    model: 'kimi-k2.5',
    workDir: '/Users/demo/project',
    additionalDirs: [],
    sessionId: 'sess-bento',
    permissionMode: 'manual',
    planMode: false,
    inputMode: 'prompt',
    swarmMode: false,
    thinking: false,
    contextUsage: 0.42,
    contextTokens: 42000,
    maxContextTokens: 100000,
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: 'dark',
    version: '0.0.0-bento',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    availableModels: {},
    availableProviders: {},
    sessionTitle: 'Bento visual check',
    mcpServersSummary: null,
  };
}

const OUT = '/tmp/liora-bento-frames';
mkdirSync(OUT, { recursive: true });

const SIZES = [
  { cols: 80, rows: 24, label: 'narrow' },
  { cols: 120, rows: 36, label: 'medium' },
  { cols: 160, rows: 40, label: 'wide' },
  { cols: 200, rows: 50, label: 'ultrawide' },
];

const glyph: Record<string, string> = {
  header: 'H',
  transcript: 'T',
  editor: 'E',
  footer: 'F',
  activity: 'A',
  todo: 'D',
  queue: 'Q',
  btw: 'B',
  rail: 'R',
};

for (const size of SIZES) {
  const state = createTUIState({
    initialAppState: fakeInitialAppState(),
    startup: { continueLast: false, yolo: false, auto: false, plan: false },
  });
  Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => size.rows });
  Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => size.cols });
  state.editorContainer.addChild(state.editor);
  state.editor.setText('bento frame check');

  // Mount real chrome components (same as LioraTUI startup)
  state.headerContainer.addChild(state.header);
  state.footerContainer.addChild(state.footer);
  state.todoPanel.setTodos([
    { title: 'Wire bento shell', status: 'in_progress' },
    { title: 'Visual verify', status: 'pending' },
  ]);
  state.todoPanelContainer.addChild(state.todoPanel);
  state.activityContainer.addChild(new Text('● reading apps/liora/src/tui/…', 0, 0));
  state.transcriptContainer.addChild(
    new Text('Hello — this is the hero transcript surface.\nFramed chrome tiles sit around it.', 0, 0),
  );

  const regions = buildTUIStateNativeFrameRegions(state, size.cols, size.rows);
  const grid = Array.from({ length: size.rows }, () => Array.from({ length: size.cols }, () => ' '));

  const lines: string[] = [
    `=== ${size.label} ${size.cols}x${size.rows} ===`,
    `regions: ${regions.map((r) => `${r.id}@(${r.rect?.x},${r.rect?.y},${r.rect?.width}x${r.rect?.height})`).join(' | ')}`,
    '',
  ];

  for (const region of regions) {
    const r = region.rect;
    if (!r) continue;
    const g = glyph[region.id] ?? '·';
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const px = r.x + x;
        const py = r.y + y;
        if (px < 0 || py < 0 || px >= size.cols || py >= size.rows) continue;
        const border = y === 0 || y === r.height - 1 || x === 0 || x === r.width - 1;
        grid[py]![px] = border ? (g === 'T' ? '░' : '█') : g;
      }
    }

    // Sample first content line for frame glyph check (prefer mid-line so
    // centered titles like "Status" show up in the dump).
    const content = region.content;
    let sample = '';
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0];
      let plain = '';
      if (typeof first === 'string') plain = first.replace(/\x1b\[[0-9;]*m/g, '');
      else if (Array.isArray(first)) {
        plain = first.map((c) => (c && typeof c === 'object' && 'char' in c ? c.char : '?')).join('');
      }
      if (plain.length <= 60) sample = plain;
      else {
        const mid = Math.max(0, Math.floor(plain.length / 2) - 30);
        sample = plain.slice(mid, mid + 60);
      }
    }
    lines.push(`${region.id.padEnd(12)} sample=${JSON.stringify(sample)}`);
  }

  lines.push('');
  for (const row of grid) lines.push(row.join(''));

  const path = join(OUT, `${size.label}-${size.cols}x${size.rows}.txt`);
  writeFileSync(path, lines.join('\n') + '\n');
  console.log(`wrote ${path}`);
}

console.log(`done → ${OUT}`);
