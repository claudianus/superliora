import { visibleWidth } from '#/tui/renderer';

import type { AppearancePreferences } from '#/tui/config';
import type { ResponsiveLayoutProfile } from '#/tui/controllers/responsive-layout';
import { currentTheme } from '#/tui/theme';
import { gradientText } from '#/tui/theme/gradient-text';
import { appearanceAnimationNow } from '#/tui/utils/appearance-effects';

export type KimiMascotVariant = 'off' | 'tiny' | 'compact' | 'standard' | 'premium';

export interface KimiMascotOptions {
  readonly layout: ResponsiveLayoutProfile;
  readonly appearance: AppearancePreferences;
}

export const PREMIUM_MASCOT_FRAMES: readonly (readonly string[])[] = [
  [
    '   ╭────╮   ',
    '   ◢●  ●◣   ',
    '  ◢  ◡   ◣  ',
    '  ╰─╮⌁╭─╯   ',
    '    ╰──╯    ',
  ],
  [
    '   ╭────╮   ',
    '   ◢─  ●◣   ',
    '  ◢  ◡   ◣  ',
    '  ╰─╮✦╭─╯   ',
    '    ╰──╯    ',
  ],
];

const STANDARD_MASCOT = [' ╭───╮ ', '◢● ●◣', '◥ ◡ ◤', ' ╰─╯ '] as const;
const COMPACT_MASCOT = ['◢●●◣', '╰◡╯'] as const;
const ASCII_STANDARD_MASCOT = [' /---\\ ', '| o o |', '|  -  |', ' \\___/ '] as const;
const ASCII_COMPACT_MASCOT = ['/-\\', '\\_/'] as const;

export function resolveKimiMascotVariant(options: KimiMascotOptions): KimiMascotVariant {
  const mascot = options.appearance.mascot;
  if (mascot === 'off') return 'off';
  if (mascot === 'minimal') return 'tiny';
  if (mascot === 'standard') return options.layout === 'tiny' ? 'tiny' : 'standard';
  if (mascot === 'premium') {
    return options.layout !== 'tiny' &&
      (options.layout === 'wide' || options.layout === 'ultrawide') &&
      !motionDegraded()
      ? 'premium'
      : 'standard';
  }
  switch (options.layout) {
    case 'tiny':
      return 'tiny';
    case 'compact':
      return 'compact';
    case 'wide':
    case 'ultrawide':
      return options.appearance.profile === 'premium' && !motionDegraded()
        ? 'premium'
        : 'standard';
    case 'standard':
      return 'standard';
  }
}

export function renderKimiMascotIcon(options: KimiMascotOptions): string[] {
  const variant = resolveKimiMascotVariant(options);
  switch (variant) {
    case 'off':
      return [];
    case 'tiny':
      return [currentTheme.boldFg('primary', asciiFallback() ? '> Kimi' : '◆ Kimi')];
    case 'compact':
      return paintRows(asciiFallback() ? ASCII_COMPACT_MASCOT : COMPACT_MASCOT, 'primary');
    case 'standard':
      return paintRows(asciiFallback() ? ASCII_STANDARD_MASCOT : STANDARD_MASCOT, 'primary');
    case 'premium': {
      const frame = PREMIUM_MASCOT_FRAMES[
        Math.floor(appearanceAnimationNow() / 900) % PREMIUM_MASCOT_FRAMES.length
      ]!;
      return frame.map((line) =>
        gradientText(
          padPlain(line, mascotWidth(frame)),
          currentTheme.color('gradientStart'),
          currentTheme.color('gradientEnd'),
          1.1,
        ),
      );
    }
  }
}

function paintRows(rows: readonly string[], token: 'primary'): string[] {
  const width = mascotWidth(rows);
  return rows.map((line) => currentTheme.fg(token, padPlain(line, width)));
}

export function mascotWidth(rows: readonly string[]): number {
  return rows.reduce((max, row) => Math.max(max, visibleWidth(row)), 0);
}

function padPlain(line: string, width: number): string {
  return line + ' '.repeat(Math.max(0, width - visibleWidth(line)));
}

function asciiFallback(): boolean {
  return process.env['TERM'] === 'dumb' || process.env['KIMI_CODE_ASCII'] === '1';
}

function motionDegraded(): boolean {
  return (
    asciiFallback() ||
    process.env['NO_COLOR'] !== undefined ||
    (process.env['CI'] !== undefined && process.env['CI'] !== '' && process.env['CI'] !== '0') ||
    (process.env['SSH_TTY'] ?? '').length > 0 ||
    (process.env['SSH_CONNECTION'] ?? '').length > 0 ||
    (process.env['SSH_CLIENT'] ?? '').length > 0
  );
}
