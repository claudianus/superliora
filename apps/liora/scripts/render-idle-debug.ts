/**
 * Eyeball renderer for the Jewel Tank idle scene.
 * Usage: pnpm -C apps/liora exec tsx scripts/render-idle-debug.ts [t0,t1,...] [width] [rows]
 */
import chalk from 'chalk';

import { setCliLocale } from '#/cli/i18n';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';
import { renderIdleStageLines } from '#/tui/components/chrome/idle-stage';

chalk.level = 3;
process.env['TERM'] = 'xterm-256color';
delete process.env['CI'];
delete process.env['NO_COLOR'];
setCliLocale('en');
setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'premium', particles: 'premium' });
setAppearanceRenderQuality('full');
setAppearanceRenderHealth('healthy');

const times = process.argv[2]
  ? process.argv[2].split(',').map((s) => Number(s))
  : [1200, 2600, 4200, 6000];
const width = Number(process.argv[3] ?? 88);
const rows = Number(process.argv[4] ?? 24);

for (const t of times) {
  const lines = renderIdleStageLines(width, DEFAULT_APPEARANCE_PREFERENCES, {
    nowMs: t,
    preferredRows: rows,
    workDir: '/tmp/project',
  });
  console.log(`--- t=${t}ms ${width}x${rows} ---`);
  for (const line of lines) console.log(line);
  console.log('');
}
