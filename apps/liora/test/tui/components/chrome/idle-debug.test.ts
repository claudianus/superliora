import { writeFileSync } from 'node:fs';

import chalk from 'chalk';
import { describe, expect, it } from 'vitest';

import { setCliLocale } from '#/cli/i18n';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { renderIdleStageLines } from '#/tui/components/chrome/idle-stage';
import {
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';
import { stripAnsi } from '#/tui/utils/idle-scene';

/**
 * Manual eyeball dump — skip in CI. Run with:
 *   IDLE_DEBUG=1 pnpm -C apps/liora exec vitest run test/tui/components/chrome/idle-debug.test.ts
 * Writes ANSI + plain dumps to /tmp/jewel-tank-{ansi,plain}.txt
 */
describe.skipIf(!process.env['IDLE_DEBUG'])('debug-render', () => {
  it('prints jewel-tank idle scene frames', () => {
    chalk.level = 3;
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    setCliLocale('en');
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    setActiveAppearancePreferences(appearance);
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');

    const times = (process.env['IDLE_TIMES'] ?? '1200,2600,4200,6000')
      .split(',')
      .map((s) => Number(s));
    const width = Number(process.env['IDLE_WIDTH'] ?? 88);
    const rows = Number(process.env['IDLE_ROWS'] ?? 24);

    const ansiChunks: string[] = [];
    const plainChunks: string[] = [];
    for (const t of times) {
      const lines = renderIdleStageLines(width, appearance, {
        nowMs: t,
        preferredRows: rows,
        workDir: '/tmp/project',
      });
      const header = `=== t=${t}ms ${width}x${rows} ===`;
      ansiChunks.push(header, ...lines, '');
      plainChunks.push(header, ...lines.map((line) => stripAnsi(line)), '');
    }
    writeFileSync('/tmp/jewel-tank-ansi.txt', `${ansiChunks.join('\n')}\n`);
    writeFileSync('/tmp/jewel-tank-plain.txt', `${plainChunks.join('\n')}\n`);
    expect(ansiChunks.length).toBeGreaterThan(0);
    expect(plainChunks.length).toBeGreaterThan(0);
  });
});
