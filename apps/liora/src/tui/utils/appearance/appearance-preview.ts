/**
 * Settings → Appearance enum picker preview — settle-flash title plus a
 * compact sample of the highlighted motion / density / transcript look.
 */

import { visibleWidth } from '#/tui/renderer';
import type { AppearancePreferences } from '#/tui/config';
import { currentTheme } from '#/tui/theme';
import {
  renderParticleRail,
  renderPulseText,
  renderSettleFlash,
  renderSpectacularText,
} from '#/tui/features/appearance/appearance-effects';
import { parseAppearancePatch } from '#/tui/utils/appearance/appearance-patch';
import { ttui } from '#/tui/utils/tui-i18n';

const TRANSCRIPT_SAMPLE: Record<string, readonly string[]> = {
  minimal: ['▌ tools · 3 tools · +12/−3', '  Thinking collapsed'],
  compact: ['Reading src/app.ts', '  42 lines'],
  standard: ['Used Read', '  preview · phase tint'],
  full: ['Used Read', '    1  export function boot() {', '    2    return true;', '    3  }'],
};

const DENSITY_GAPS: Record<string, number> = {
  compact: 0,
  auto: 0,
  comfortable: 1,
  spacious: 2,
};

export function renderAppearanceValuePreview(
  key: string,
  value: string,
  width: number,
  startedAtMs: number,
  base: AppearancePreferences,
): readonly string[] {
  const patched = parseAppearancePatch(base, key, value) ?? base;
  const inner = Math.max(12, width - 4);
  const headline = renderSettleFlash(
    value,
    `appearance-preview:${key}:${value}`,
    startedAtMs,
    patched,
  );
  const rows: string[] = [
    currentTheme.boldFg('primary', ` ${ttui('tui.settings.pane.appearance.title')} · `) + headline,
  ];

  if (key === 'profile' || key === 'particles' || key === 'animation-fps') {
    const rail = renderParticleRail(inner, patched, `appearance-preview-rail:${key}:${value}`);
    rows.push(`  ${rail}`);
    const sample =
      patched.profile === 'off'
        ? currentTheme.fg('textMuted', 'static chrome')
        : patched.profile === 'subtle'
          ? renderPulseText('subtle pulse', `appearance-preview-pulse:${value}`, 'accent', patched)
          : renderSpectacularText('premium motion', `appearance-preview-spec:${value}`, patched, {
              intense: true,
              pace: 'fast',
            });
    rows.push(`  ${sample}`);
  } else if (key === 'transcript-detail') {
    const sample = TRANSCRIPT_SAMPLE[value] ?? TRANSCRIPT_SAMPLE['standard']!;
    for (const line of sample) {
      rows.push(currentTheme.fg('textDim', `  ${line}`));
    }
  } else if (key === 'density') {
    const gaps = DENSITY_GAPS[value] ?? 1;
    rows.push(currentTheme.fg('textMuted', '  chrome row'));
    for (let i = 0; i < gaps; i++) rows.push('');
    rows.push(currentTheme.fg('textMuted', '  next chrome row'));
  } else if (key === 'neat') {
    rows.push(
      currentTheme.fg(
        'textDim',
        value === 'on' ? '  ┌ structured card ┐' : '  raw tool dump',
      ),
    );
  } else {
    const desc = currentTheme.fg('textMuted', value);
    rows.push(`  ${desc}`);
  }

  return rows.map((row) => {
    const pad = Math.max(0, inner + 2 - visibleWidth(row));
    return row + ' '.repeat(pad);
  });
}
