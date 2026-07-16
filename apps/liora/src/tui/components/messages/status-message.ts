import { Container, Spacer, Text } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderPremiumHeadline,
  renderShimmerPrefix,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { syncAmbientAnimatedText } from '#/tui/utils/render-cache';

export class StatusMessageComponent extends Container {
  private textComponent: Text;
  private content: string;
  private color?: ColorToken;
  ambientAnimationEpoch = -1;

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
    return super.render(width);
  }

  // Indent every line, not just the first. The `content` may be multi-line
  // (e.g. `!` shell output); prefixing the whole string once would only indent
  // the first line and leave the rest at column 0. Strip carriage returns first
  // so CRLF provider error pages cannot overwrite the visible line in the TUI.
  private renderText(): string {
    const appearance = getActiveAppearancePreferences();
    const shimmer =
      shouldRenderAmbientEffects(appearance) &&
      (this.color === undefined ||
        this.color === 'success' ||
        this.color === 'warning' ||
        this.color === 'primary' ||
        this.color === 'error')
        ? renderShimmerPrefix(appearance)
        : '';
    const content = shimmer + this.content;
    const colored =
      this.color === undefined
        ? currentTheme.fg('textDim', content)
        : currentTheme.fg(this.color, content);
    return colored.replaceAll('\r', '').split('\n').map((line) => `  ${line}`).join('\n');
  }
}

export class NoticeMessageComponent extends Container {
  readonly coalesceKey?: string;
  private titleText: Text;
  private detailText?: Text;
  private title: string;
  private detail?: string;
  ambientAnimationEpoch = -1;

  constructor(title: string, detail: string | undefined, coalesceKey?: string) {
    super();
    this.coalesceKey = coalesceKey;
    this.title = title;
    this.detail = detail;
    this.addChild(new Spacer(1));
    this.titleText = new Text(`  ${renderNoticeTitle(title)}`, 0, 0);
    this.addChild(this.titleText);
    if (detail !== undefined && detail.length > 0) {
      this.detailText = new Text(`  ${renderNoticeDetail(detail)}`, 0, 0);
      this.addChild(this.detailText);
    }
  }

  override invalidate(): void {
    this.ambientAnimationEpoch = -1;
    this.titleText.setText(`  ${renderNoticeTitle(this.title)}`);
    if (this.detailText !== undefined && this.detail !== undefined) {
      this.detailText.setText(`  ${renderNoticeDetail(this.detail)}`);
    }
    super.invalidate();
  }

  override render(width: number): string[] {
    syncAmbientAnimatedText(this.titleText, () => `  ${renderNoticeTitle(this.title)}`, this);
    if (this.detailText !== undefined && this.detail !== undefined) {
      syncAmbientAnimatedText(
        this.detailText,
        () => `  ${renderNoticeDetail(this.detail!)}`,
        this,
      );
    }
    return super.render(width);
  }
}

function renderNoticeTitle(title: string): string {
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
