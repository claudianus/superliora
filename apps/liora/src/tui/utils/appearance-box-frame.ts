import {
  mixHexColor,
  rendererPositiveModulo,
  renderRendererStyledTextRunsAnsi,
  stripAnsiControls,
  truncateToWidth,
  visibleWidth,
  type RendererStyledTextRun,
} from '#/tui/renderer';
import type { AppearancePreferences } from '#/tui/config';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  motionProgress,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-state';

/**
 * Premium floating box frame for center modals (Command Hub and friends).
 *
 * The static shell — a rounded `╭╮╰╯` box with an optional title embedded in
 * the top border and live status embedded in the bottom border — always
 * renders, so reduced-motion terminals still get a real bordered panel.
 *
 * When ambient motion is allowed the perimeter comes alive:
 * - a slow primary↔accent gradient "breath" tints the whole frame,
 * - a comet chase travels clockwise with a decaying trail,
 * - corners stay jewel-bright,
 * - and right after `openedAtMs` the frame blooms (brighter base, longer
 *   trail, faster lap) before settling into its idle cadence.
 *
 * Body lines are padded/truncated to the inner width; every returned row has
 * the same visible width (`options.width`).
 */
export interface PremiumBoxFrameOptions {
  /** Outer box width, border included. Clamped to ≥ 8. */
  readonly width: number;
  /** Styled title (ANSI ok) embedded in the top border. */
  readonly title?: string;
  /** Plain title for width measurement; defaults to stripping `title`. */
  readonly titlePlain?: string;
  /** Styled text embedded left-of-center in the bottom border. */
  readonly footerLeft?: string;
  readonly footerLeftPlain?: string;
  /** Styled text embedded right-of-center in the bottom border. */
  readonly footerRight?: string;
  readonly footerRightPlain?: string;
  readonly appearance?: AppearancePreferences;
  /** Entry-bloom start; defaults to the current animation clock. */
  readonly openedAtMs?: number;
}

const BOX_HUE_BREATH_MS = 4200;
const BOX_CHASE_MS_PER_CELL = 30;
const BOX_CHASE_TRAIL = 14;
const BOX_BLOOM_MS = 560;

export function renderPremiumBoxFrame(
  body: readonly string[],
  options: PremiumBoxFrameOptions,
): string[] {
  const width = Math.max(8, Math.trunc(options.width));
  const inner = width - 2;
  const height = body.length + 2;
  const appearance = options.appearance ?? getActiveAppearancePreferences();
  const ambient = shouldRenderAmbientEffects(appearance);
  const now = appearanceAnimationNow();

  const glowHex = currentTheme.color('glow');
  const borderHex = currentTheme.color('borderFocus');
  const breath = (Math.sin((2 * Math.PI * now) / BOX_HUE_BREATH_MS) + 1) / 2;
  let baseHex = ambient
    ? mixHexColor(currentTheme.color('primary'), currentTheme.color('accent'), breath)
    : borderHex;

  const openedAt = options.openedAtMs ?? now;
  const bloomP = ambient ? motionProgress(openedAt, BOX_BLOOM_MS, now) : 1;
  if (ambient && bloomP < 1) {
    baseHex = mixHexColor(baseHex, glowHex, 0.45 * (1 - bloomP));
  }
  // The chase runs a faster lap while blooming, then settles to idle cadence.
  const chaseNow = openedAt + (now - openedAt) * (1 + 0.9 * (1 - bloomP));
  const trail = BOX_CHASE_TRAIL + Math.round(8 * (1 - bloomP));
  const perimeter = 2 * width + 2 * height - 4;
  const headIndex = rendererPositiveModulo(
    Math.floor(chaseNow / BOX_CHASE_MS_PER_CELL),
    perimeter,
  );

  const hexAt = (s: number): string => {
    if (!ambient) return borderHex;
    const dist = rendererPositiveModulo(headIndex - s, perimeter);
    if (dist > trail) return baseHex;
    if (dist <= 1) return glowHex;
    const t = dist / (trail + 1);
    const ease = t * t * (3 - 2 * t);
    return mixHexColor(glowHex, baseHex, ease);
  };
  const boldAt = (s: number): boolean =>
    ambient && rendererPositiveModulo(headIndex - s, perimeter) <= 3;
  const cornerHex = ambient ? mixHexColor(baseHex, glowHex, 0.4) : borderHex;

  const dashRuns = (fromX: number, toX: number, pathAt: (x: number) => number): RendererStyledTextRun[] => {
    const runs: RendererStyledTextRun[] = [];
    for (let x = fromX; x <= toX; x += 1) {
      const s = pathAt(x);
      runs.push({ text: '─', style: { fg: hexAt(s), bold: boldAt(s) } });
    }
    return runs;
  };
  const cornerRun = (char: string): RendererStyledTextRun => ({
    text: char,
    style: { fg: cornerHex, bold: true },
  });
  const ansi = (runs: readonly RendererStyledTextRun[]): string =>
    renderRendererStyledTextRunsAnsi(runs, { resetStyle: true });

  // ── Top border (path index == x) with optional embedded title ──────────
  const titleStyled = options.title;
  const titlePlain =
    options.titlePlain ?? (titleStyled === undefined ? '' : stripAnsiControls(titleStyled));
  const titleW = visibleWidth(titlePlain);
  const titleFits = titleStyled !== undefined && titleW > 0 && titleW + 4 <= inner;
  let top: string;
  if (titleFits) {
    const leftFill = Math.floor((inner - titleW - 2) / 2);
    const leftRuns = [cornerRun('╭'), ...dashRuns(1, leftFill, (x) => x)];
    const rightStart = leftFill + titleW + 3;
    const rightRuns = [...dashRuns(rightStart, width - 2, (x) => x), cornerRun('╮')];
    top = ansi(leftRuns) + ' ' + titleStyled + ' ' + ansi(rightRuns);
  } else {
    top = ansi([cornerRun('╭'), ...dashRuns(1, width - 2, (x) => x), cornerRun('╮')]);
  }

  // ── Bottom border with optional live footer embeds ─────────────────────
  const sBottom = (x: number): number => width - 1 + height - 2 + (width - 1 - x);
  const flPlainRaw =
    options.footerLeftPlain ??
    (options.footerLeft === undefined ? '' : stripAnsiControls(options.footerLeft));
  const frPlainRaw =
    options.footerRightPlain ??
    (options.footerRight === undefined ? '' : stripAnsiControls(options.footerRight));
  let flPlain = flPlainRaw;
  let flStyled = options.footerLeft ?? '';
  const frPlain = frPlainRaw;
  const frStyled = options.footerRight ?? '';
  let flW = visibleWidth(flPlain);
  const frW = visibleWidth(frPlain);
  if (flW > 0 && flW + 4 > inner) {
    const capped = Math.max(1, inner - 4);
    flPlain = truncateToWidth(flPlain, capped, '…');
    flStyled = truncateToWidth(flStyled, capped, '…');
    flW = visibleWidth(flPlain);
  }
  const bothFit = flW > 0 && frW > 0 && inner - flW - frW - 6 >= 2;
  const leftOnly = flW > 0 && flW + 4 <= inner && !bothFit;

  const parts: string[] = [ansi([cornerRun('╰')])];
  if (bothFit) {
    const mid = inner - flW - frW - 6;
    parts.push(
      ansi(dashRuns(1, 1, sBottom)),
      ' ',
      flStyled,
      ' ',
      ansi(dashRuns(4 + flW, 3 + flW + mid, sBottom)),
      ' ',
      frStyled,
      ' ',
      ansi(dashRuns(width - 2, width - 2, sBottom)),
    );
  } else if (leftOnly) {
    parts.push(
      ansi(dashRuns(1, 1, sBottom)),
      ' ',
      flStyled,
      ' ',
      ansi(dashRuns(4 + flW, width - 2, sBottom)),
    );
  } else {
    parts.push(ansi(dashRuns(1, width - 2, sBottom)));
  }
  parts.push(ansi([cornerRun('╯')]));
  const bottom = parts.join('');

  // ── Side rails + padded body ───────────────────────────────────────────
  const middle = body.map((line, index) => {
    const y = index + 1;
    const leftS = perimeter - y;
    const rightS = width - 1 + y;
    const left = ansi([{ text: '│', style: { fg: hexAt(leftS), bold: boldAt(leftS) } }]);
    const right = ansi([{ text: '│', style: { fg: hexAt(rightS), bold: boldAt(rightS) } }]);
    const content = truncateToWidth(line, inner);
    const pad = Math.max(0, inner - visibleWidth(content));
    return left + content + ' '.repeat(pad) + right;
  });

  return [top, ...middle, bottom];
}
