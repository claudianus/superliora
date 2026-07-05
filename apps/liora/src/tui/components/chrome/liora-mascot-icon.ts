import { visibleWidth } from '#/tui/renderer';

import type { AppearancePreferences } from '#/tui/config';
import type { ResponsiveLayoutProfile } from '#/tui/controllers/responsive-layout';
import { currentTheme } from '#/tui/theme';
import { gradientText } from '#/tui/theme/gradient-text';
import { appearanceAnimationNow } from '#/tui/utils/appearance-effects';

export type LioraMascotVariant = 'off' | 'tiny' | 'compact' | 'standard' | 'premium';

export interface LioraMascotOptions {
  readonly layout: ResponsiveLayoutProfile;
  readonly appearance: AppearancePreferences;
}

// Premium frames: hex logo rasterised with ascii-image-converter (12×6, map " .:-=+*#@").
// Standard / compact: figlet Graceful "Li" and a smaller converter pass. Regenerate via
// scripts/generate-liora-mascot-art.sh.
export const PREMIUM_MASCOT_FRAMES: readonly (readonly string[])[] = [
  [
    '   .-=+-.   ',
    ' -+=-  :=== ',
    ' #:  ==   @:',
    ' #:  +*.  #:',
    ' =+-:  .-=+.',
    '   :=++=:   ',
  ],
  [
    '   :=**+:   ',
    ' =*+-. -+*+.',
    '.@- .+*: .@-',
    '.@- .##-  @-',
    ' +*+-  :=**.',
    '   -+*#*-.  ',
  ],
  [
    '   :+##+-   ',
    '.+#*=:.-*#*:',
    ':@+ :*#= :@+',
    ':@= -@@+ .@=',
    '.*#*-..:+##:',
    '  .-*##*=.  ',
  ],
  [
    '   -*@@*-.  ',
    '.*##+-:=#@*-',
    '-@+ =##+ -@+',
    '-@+ +@@# :@+',
    ':#@*=::-*@#-',
    '  .=#@@#+:  ',
  ],
];

/** Animation interval for the premium mascot — fast enough for a smooth
 *  breathing pulse, slow enough to feel calm. */
export const PREMIUM_MASCOT_INTERVAL_MS = 600;

const STANDARD_MASCOT = [' __    __  ', '(  )  (  ) ', '/ (_/\\ )(  ', '\\____/(__) '] as const;
const COMPACT_MASCOT = [' :====: ', '-*.-.=++', '=* == =+', ' :====- '] as const;

export function resolveLioraMascotVariant(options: LioraMascotOptions): LioraMascotVariant {
  const mascot = options.appearance.mascot;
  if (mascot === 'off') return 'off';
  if (mascot === 'minimal') return 'tiny';
  if (mascot === 'standard') return options.layout === 'tiny' ? 'tiny' : 'standard';
  if (mascot === 'premium') {
    return options.layout !== 'tiny' && options.layout !== 'compact' && !motionDegraded()
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
      return options.appearance.profile === 'premium' && !motionDegraded()
        ? 'premium'
        : 'standard';
  }
}

export function renderLioraMascotIcon(options: LioraMascotOptions): string[] {
  const variant = resolveLioraMascotVariant(options);
  switch (variant) {
    case 'off':
      return [];
    case 'tiny':
      return [currentTheme.boldFg('primary', asciiFallback() ? '> Liora' : '◆ Liora')];
    case 'compact':
      return paintRows(COMPACT_MASCOT, 'primary');
    case 'standard':
      return paintRows(STANDARD_MASCOT, 'primary');
    case 'premium': {
      const frameIndex =
        Math.floor(appearanceAnimationNow() / PREMIUM_MASCOT_INTERVAL_MS) %
        PREMIUM_MASCOT_FRAMES.length;
      const frame = PREMIUM_MASCOT_FRAMES[frameIndex]!;
      // Shift the gradient phase per frame so colours breathe alongside the
      // border pulse, giving the mascot a living, premium feel.
      const phase = frameIndex * 2;
      return frame.map((line) =>
        gradientText(
          padPlain(line, mascotWidth(frame)),
          currentTheme.color('gradientStart'),
          currentTheme.color('gradientEnd'),
          1.1,
          phase,
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
  return process.env['TERM'] === 'dumb' || process.env['SUPERLIORA_ASCII'] === '1';
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
