import { RendererWidthRenderCache } from './component-primitives';
import {
  Text,
  visibleWidth,
  type RendererComponent,
} from './text-component';
import type { RendererPrefixedWrappedLineOptions } from './transcript-types';
import { renderRendererTranscriptLineBlock } from './transcript-line-block';
import { normalizeTranscriptWidth } from './transcript-normalize';

export class RendererPrefixedWrappedLine implements RendererComponent {
  private readonly renderCache = new RendererWidthRenderCache();

  constructor(private readonly options: RendererPrefixedWrappedLineOptions) {}

  invalidate(): void {
    this.renderCache.clear();
  }

  render(width: number): string[] {
    const safeWidth = normalizeTranscriptWidth(width);
    if (safeWidth <= 0) return [''];

    return this.renderCache.render({
      width: safeWidth,
      render: () => {
        const prefixWidth = Math.max(
          visibleWidth(this.options.firstPrefix),
          visibleWidth(this.options.continuationPrefix),
        );
        const contentWidth = Math.max(1, safeWidth - prefixWidth);
        const wrapped = new Text(this.options.text, 0, 0).render(contentWidth);
        const tailLines = this.options.tailLines;
        const lines =
          tailLines !== undefined && wrapped.length > tailLines
            ? wrapped.slice(wrapped.length - tailLines)
            : wrapped;
        const padded =
          this.options.minLines !== undefined
            ? [...lines, ...Array.from({ length: Math.max(0, this.options.minLines - lines.length) }, () => '')]
            : lines;
        return renderRendererTranscriptLineBlock({
          width: safeWidth,
          prefix: this.options.firstPrefix,
          continuationPrefix: this.options.continuationPrefix,
          lines: padded,
          truncateMark: this.options.truncateMark ?? '…',
        });
      },
    });
  }
}
