import type { Component } from '#/tui/renderer';
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import type { BannerState } from '#/tui/types';
import {
  getActiveAppearancePreferences,
  renderParticleRail,
  renderPremiumAccentLine,
  renderPremiumHeadline,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';

const PREFIX_STAR = '✦';
const PADDING = ' ';

export class BannerComponent implements Component {
  /** Marks pure empty-state chrome for `isEmptyTranscriptChrome` (minification-safe). */
  readonly isEmptyTranscriptChrome = true;

  constructor(private readonly state: BannerState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const main = (s: string): string =>
      animated
        ? renderPremiumAccentLine(s, `banner:main:${s.slice(0, 24)}`, appearance)
        : currentTheme.boldFg('textStrong', s);
    const dim = (s: string): string => currentTheme.fg('textDim', s);

    // Render nothing but the trailing blank if the terminal cannot hold a
    // single visible column.
    if (width < 1) {
      return [''];
    }

    const tagText = this.state.tag ?? '';
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    // Do not add a colon/tag suffix here; the caller-provided tag includes its
    // own punctuation/separator.
    const tagLabel = tagText.length > 0 ? `${PREFIX_STAR} ${tagText}` : '';
    const tagStyled =
      tagLabel.length > 0
        ? animated
          ? renderPremiumHeadline(tagLabel, `banner:tag:${tagText}`, appearance)
          : currentTheme.boldFg('primary', tagLabel)
        : '';
    const tagDisplay = tagStyled.length > 0 ? tagStyled + PADDING : '';
    const tagWidth = visibleWidth(tagDisplay);
    // Tag shares the first line when it fits; on narrow terminals it renders
    // truncated on its own line instead of silently disappearing.
    const tagFitsInline = tagWidth > 0 && tagWidth < width;
    // On micro terminals (width ≤ star + ellipsis) nothing readable fits, so
    // the tag line is skipped entirely rather than overflowing the row.
    const tagOwnLine = tagWidth > 0 && !tagFitsInline && width > visibleWidth(PREFIX_STAR) + 1;
    const showTag = tagFitsInline;
    // Body lines (continuations of the main text) indent to match the first
    // line's main-text column, which starts right after the tag display.
    const bodyIndent = showTag ? ' '.repeat(tagWidth) : '';
    const bodyContentWidth = width - (showTag ? tagWidth : 0);
    const descContentWidth = width - (tagWidth > 0 ? visibleWidth(PREFIX_STAR + PADDING) : 0);
    // Descriptive subtext lines (the second line in the design) start at the
    // column after the leading star + space, aligning with the tag text itself.
    // The indent only applies when that column actually fits — on micro
    // terminals it would push every subtext row past the terminal width.
    const descIndent =
      tagWidth > 0 && descContentWidth > 0 ? ' '.repeat(visibleWidth(PREFIX_STAR + PADDING)) : '';

    if (bodyContentWidth <= 0) {
      return [''];
    }

    const mainSegments = this.state.mainText.split('\n');
    const subSegments = this.state.subText ? this.state.subText.split('\n') : [];

    const result: string[] = [];
    if (tagOwnLine) {
      result.push(truncateToWidth(tagStyled, width, '…'));
    }
    for (let i = 0; i < mainSegments.length; i++) {
      const wrapped = wrapTextWithAnsi(mainSegments[i]!, bodyContentWidth);
      for (let j = 0; j < wrapped.length; j++) {
        const boldLine = main(wrapped[j]!);
        if (i === 0 && j === 0 && showTag) {
          result.push(tagDisplay + boldLine);
        } else {
          result.push(bodyIndent + boldLine);
        }
      }
    }

    for (const sub of subSegments) {
      const available = descContentWidth <= 0 ? bodyContentWidth : descContentWidth;
      const wrapped = wrapTextWithAnsi(sub, available);
      for (const line of wrapped) {
        result.push(descIndent + dim(line));
      }
    }

    // Add a blank line below the banner so the following transcript content
    // (e.g. the input prompt / status messages) is visually separated.
    if (animated && width >= 24) {
      result.push(renderParticleRail(width, appearance, 'banner:rail'));
    }
    result.push('');

    return result;
  }
}
