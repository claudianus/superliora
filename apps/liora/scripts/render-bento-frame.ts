/**
 * Dump a real native frame (ANSI) for visual eyeballing of the bento chrome.
 * Usage: pnpm -C apps/liora exec tsx --tsconfig tsconfig.dev.json scripts/render-bento-frame.ts [cols] [rows]
 */
import chalk from 'chalk';

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
  particles: 'premium',
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

const cols = Number(process.argv[2] ?? 120);
const rows = Number(process.argv[3] ?? 36);

const state = createTUIState({
  initialAppState: fakeInitialAppState(),
  startup: { continueLast: false, yolo: false, auto: false, plan: false },
});
Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => rows });
Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => cols });
state.editorContainer.addChild(state.editor);
state.editor.setText('bento frame check — type here');

// Seed a couple of transcript lines so the hero surface isn't empty
const TextComp = Text as unknown as new () => { setText?: (t: string) => void; render: (w: number) => string[] };
try {
  // Prefer welcome/idle content already mounted by createTUIState
} catch {
  /* ignore */
}

const regions = buildTUIStateNativeFrameRegions(state, cols, rows);

console.log(`--- bento frame ${cols}x${rows} regions=${regions.map((r) => r.id).join(',')} ---`);
for (const region of regions) {
  const r = region.rect;
  if (!r) continue;
  const sample = Array.isArray(region.content)
    ? region.content.slice(0, 3).map((line) => {
        if (typeof line === 'string') return line.slice(0, 80);
        if (Array.isArray(line)) {
          return line
            .slice(0, 40)
            .map((cell) => (typeof cell === 'object' && cell && 'char' in cell ? cell.char : '?'))
            .join('');
        }
        return String(line).slice(0, 80);
      })
    : [];
  console.log(
    `${region.id.padEnd(12)} @(${r.x},${r.y}) ${r.width}×${r.height}  sample=${JSON.stringify(sample)}`,
  );
}

// Compose a crude character grid from region rects for shape verification
const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ' '));
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
for (const region of regions) {
  const r = region.rect;
  if (!r) continue;
  const g = glyph[region.id] ?? '·';
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const px = r.x + x;
      const py = r.y + y;
      if (px < 0 || py < 0 || px >= cols || py >= rows) continue;
      const border = y === 0 || y === r.height - 1 || x === 0 || x === r.width - 1;
      grid[py]![px] = border ? (g === 'T' ? '░' : '█') : g;
    }
  }
}
console.log('');
for (const row of grid) console.log(row.join(''));
