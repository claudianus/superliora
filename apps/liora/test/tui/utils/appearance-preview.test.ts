import { describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { renderAppearanceValuePreview } from '#/tui/utils/appearance/appearance-preview';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

describe('renderAppearanceValuePreview', () => {
  const start = 1_000;

  it('shows a transcript-density sample that differs across levels', () => {
    const compact = renderAppearanceValuePreview(
      'transcript-detail',
      'compact',
      72,
      start,
      DEFAULT_APPEARANCE_PREFERENCES,
    ).map(strip);
    const full = renderAppearanceValuePreview(
      'transcript-detail',
      'full',
      72,
      start,
      DEFAULT_APPEARANCE_PREFERENCES,
    ).map(strip);
    expect(compact.join('\n')).toContain('Reading src/app.ts');
    expect(full.join('\n')).toContain('export function boot');
    expect(compact.join('\n')).not.toBe(full.join('\n'));
  });

  it('shows extra chrome gaps at spacious density vs compact', () => {
    const compact = renderAppearanceValuePreview(
      'density',
      'compact',
      72,
      start,
      DEFAULT_APPEARANCE_PREFERENCES,
    );
    const spacious = renderAppearanceValuePreview(
      'density',
      'spacious',
      72,
      start,
      DEFAULT_APPEARANCE_PREFERENCES,
    );
    expect(spacious.length).toBeGreaterThan(compact.length);
  });

  it('keeps a motion sample line for profile values', () => {
    const off = renderAppearanceValuePreview(
      'profile',
      'off',
      72,
      start,
      DEFAULT_APPEARANCE_PREFERENCES,
    ).map(strip);
    expect(off.join('\n')).toMatch(/static chrome|premium motion|subtle pulse/);
  });
});
