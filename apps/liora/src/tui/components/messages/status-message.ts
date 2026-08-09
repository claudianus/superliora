import { Container, Spacer, Text } from '#/tui/renderer';

import type { AppearancePreferences } from '#/tui/config';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPremiumHeadline,
  renderShimmerPrefix,
  renderSpectacularText,
  renderStatusFlashLine,
  renderToneSettleFlash,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { syncAmbientAnimatedText } from '#/tui/utils/render/render-cache';
import {
  isTranscriptEntranceActive,
  polishTranscriptLines,
} from '#/tui/features/transcript/transcript-entrance';

export class StatusMessageComponent extends Container {
  private textComponent: Text;
  private content: string;
  private color?: ColorToken;
  ambientAnimationEpoch = -1;
  private readonly entranceStartedAtMs = appearanceAnimationNow();

  constructor(content: string, color?: ColorToken) {
    super();
    this.content = content;
    this.color = color;
    this.textComponent = new Text(this.renderText(), 0, 0);
    this.addChild(this.textComponent);
  }

  // Update the body in place (used for live-streamed `!` shell output) without
  // remounting the component.
  updateContent(content: string): void {
    this.content = content;
    this.textComponent.setText(this.renderText());
  }

  override invalidate(): void {
    this.ambientAnimationEpoch = -1;
    this.textComponent.setText(this.renderText());
    super.invalidate();
  }

  override render(width: number): string[] {
    syncAmbientAnimatedText(this.textComponent, () => this.renderText(), this);
    const lines = super.render(width);
    if (!isTranscriptEntranceActive(this.entranceStartedAtMs)) return lines;
    return polishTranscriptLines(lines, {
      startedAtMs: this.entranceStartedAtMs,
      kind: 'status',
      appearance: getActiveAppearancePreferences(),
    });
  }

  // Indent every line, not just the first. The `content` may be multi-line
  // (e.g. `!` shell output); prefixing the whole string once would only indent
  // the first line and leave the rest at column 0. Strip carriage returns first
  // so CRLF provider error pages cannot overwrite the visible line in the TUI.
  private renderText(): string {
    const appearance = getActiveAppearancePreferences();
    const tone: ColorToken = this.color ?? 'textDim';
    const clean = this.content.replaceAll('\r', '');
    // Single-line statuses get a finite enter→exit flash (spectacular → pulse
    // → bold → shimmer → dim fade → static) driven by the shared animation
    // clock. Multi-line payloads (live `!` shell output) keep the ambient
    // shimmer instead: restarting the flash on every streaming delta would
    // flicker, and the block entrance wash already covers their arrival.
    const styled = clean.includes('\n')
      ? currentTheme.fg(tone, this.statusShimmerPrefix(appearance) + clean)
      : renderStatusFlashLine(
          clean,
          `status:${clean}`,
          this.entranceStartedAtMs,
          tone,
          appearance,
        );
    return styled.split('\n').map((line) => `  ${line}`).join('\n');
  }

  private statusShimmerPrefix(appearance: AppearancePreferences): string {
    if (!shouldRenderAmbientEffects(appearance)) return '';
    if (
      this.color !== undefined &&
      this.color !== 'success' &&
      this.color !== 'warning' &&
      this.color !== 'primary' &&
      this.color !== 'error'
    ) {
      return '';
    }
    return renderShimmerPrefix(appearance);
  }
}

export class NoticeMessageComponent extends Container {
  readonly coalesceKey?: string;
  private titleText: Text;
  private detailText?: Text;
  private title: string;
  private detail?: string;
  ambientAnimationEpoch = -1;
  private readonly entranceStartedAtMs = appearanceAnimationNow();

  constructor(title: string, detail: string | undefined, coalesceKey?: string) {
    super();
    this.coalesceKey = coalesceKey;
    this.title = title;
    this.detail = detail;
    this.addChild(new Spacer(1));
    this.titleText = new Text(
      `  ${renderNoticeTitle(title, this.entranceStartedAtMs, coalesceKey)}`,
      0,
      0,
    );
    this.addChild(this.titleText);
    if (detail !== undefined && detail.length > 0) {
      this.detailText = new Text(`  ${renderNoticeDetail(detail)}`, 0, 0);
      this.addChild(this.detailText);
    }
  }

  override invalidate(): void {
    this.ambientAnimationEpoch = -1;
    this.titleText.setText(
      `  ${renderNoticeTitle(this.title, this.entranceStartedAtMs, this.coalesceKey)}`,
    );
    if (this.detailText !== undefined && this.detail !== undefined) {
      this.detailText.setText(`  ${renderNoticeDetail(this.detail)}`);
    }
    super.invalidate();
  }

  override render(width: number): string[] {
    syncAmbientAnimatedText(
      this.titleText,
      () => `  ${renderNoticeTitle(this.title, this.entranceStartedAtMs, this.coalesceKey)}`,
      this,
    );
    if (this.detailText !== undefined && this.detail !== undefined) {
      syncAmbientAnimatedText(
        this.detailText,
        () => `  ${renderNoticeDetail(this.detail!)}`,
        this,
      );
    }
    const lines = super.render(width);
    if (!isTranscriptEntranceActive(this.entranceStartedAtMs)) return lines;
    return polishTranscriptLines(lines, {
      startedAtMs: this.entranceStartedAtMs,
      kind: 'notice',
      appearance: getActiveAppearancePreferences(),
    });
  }
}

function renderNoticeTitle(
  title: string,
  startedAtMs: number,
  coalesceKey?: string,
): string {
  // F15: short success settle on land/complete notices (motion helpers only).
  if (
    coalesceKey !== undefined &&
    coalesceKey.startsWith('job-land:') &&
    !/held/i.test(title)
  ) {
    return renderToneSettleFlash(title, `notice-land:${title}`, startedAtMs, 'success');
  }
  return renderPremiumHeadline(title, `notice:${title}`);
}

function renderNoticeDetail(detail: string): string {
  const appearance = getActiveAppearancePreferences();
  if (shouldRenderAmbientEffects(appearance)) {
    return renderSpectacularText(detail, `notice-detail:${detail}`, appearance, {
      intense: true,
      pace: 'slow',
    });
  }
  return currentTheme.fg('textDim', detail);
}
