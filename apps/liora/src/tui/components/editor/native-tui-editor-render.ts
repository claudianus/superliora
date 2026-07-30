import {
  measureRendererEditorSurfaceLayout,
  measureRendererEditorSurfaceNaturalRows,
  RENDERER_EDITOR_CONTENT_RIGHT_INSET,
  RENDERER_EDITOR_CONTENT_X,
  RENDERER_EDITOR_SHELL_MODE_LABEL,
  renderRendererEditorSurface,
  resolveRendererEditorSurfaceStyles,
  type RendererEditorAutocompleteLineStyles,
  type RendererEditorCursor,
  type RendererRegionLine,
  type RendererTextInput,
} from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';

import type { TUIEditorInputMode } from './editor-contract';

export interface NativeTUIEditorRenderHost {
  getTextInput(): RendererTextInput;
  readonly focused: boolean;
  readonly connectedAbove: boolean;
  readonly borderHighlighted: boolean;
  readonly borderColor: (text: string) => string;
  readonly inputMode: TUIEditorInputMode;
  getGhostText(): string | undefined;
  readonly argumentHints: ReadonlyMap<string, string>;
  getText(): string;
  getCursor(): RendererEditorCursor;
  getNativeOverlayLines(
    width: number,
    styles?: RendererEditorAutocompleteLineStyles,
  ): readonly RendererRegionLine[];
  setLastContentWidth(width: number): void;
}

export function regionLineToText(line: RendererRegionLine): string {
  if (typeof line === 'string') return line;
  return line.map((cell) => cell.char).join('');
}

export function extractHexFromBorderColor(borderColor: (text: string) => string): string | undefined {
  // borderColor is chalk-styled; sample a single glyph and recover #RRGGBB.
  // chalk.hex() emits truecolor SGR (`38;2;r;g;b`) — not a literal `#` token.
  const sample = borderColor('x');
  const hexLiteral = /#([0-9A-Fa-f]{6})/.exec(sample);
  if (hexLiteral !== null) return `#${hexLiteral[1]!}`;
  const truecolor = /\x1b\[(?:38|48);2;(\d{1,3});(\d{1,3});(\d{1,3})m/.exec(sample);
  if (truecolor === null) return undefined;
  const toByte = (raw: string): string => {
    const n = Math.max(0, Math.min(255, Number.parseInt(raw, 10)));
    return n.toString(16).padStart(2, '0');
  };
  return `#${toByte(truecolor[1]!)}${toByte(truecolor[2]!)}${toByte(truecolor[3]!)}`;
}

export function resolveNativeTUIEditorSurfaceStyles(host: NativeTUIEditorRenderHost) {
  const palette = currentTheme.palette;
  // When Ultrawork (or any highlight) is active, borderHighlighted is true and
  // borderColor carries the live glow hex. Prefer that over static primary.
  const focusHex =
    host.borderHighlighted && host.inputMode !== 'bash'
      ? extractHexFromBorderColor(host.borderColor) ?? palette.primary
      : palette.primary;
  return resolveRendererEditorSurfaceStyles({
    commandMode: host.inputMode === 'bash',
    focused: host.focused || host.borderHighlighted,
    canvasBackground: currentTheme.canvasBackgroundEnabled,
    palette: {
      text: palette.text,
      textMuted: palette.textMuted,
      textStrong: palette.textStrong,
      border: palette.border,
      borderFocus: focusHex,
      command: palette.shellMode,
      surfaceSunken: palette.surfaceSunken,
      background: palette.background,
      selectionBg: palette.selectionBg,
      selectionText: palette.selectionText,
      ghostText: palette.ghostText,
    },
  });
}

export function buildNativeTUIEditorSurface(host: NativeTUIEditorRenderHost, width: number) {
  const safeWidth = Math.max(1, Math.floor(width));
  const contentWidth = Math.max(
    1,
    safeWidth - RENDERER_EDITOR_CONTENT_X - RENDERER_EDITOR_CONTENT_RIGHT_INSET,
  );
  host.setLastContentWidth(contentWidth);
  host.getTextInput().setLayoutWidth(contentWidth);
  const editorStyles = resolveNativeTUIEditorSurfaceStyles(host);
  const overlayLines = host.getNativeOverlayLines(safeWidth, {
    text: editorStyles.textStyle,
    selected: editorStyles.autocompleteSelectedStyle,
    description: editorStyles.autocompleteDescriptionStyle,
    scroll: editorStyles.autocompleteScrollStyle,
  });
  const content = host.getTextInput().render({
    width: contentWidth,
    focused: host.focused,
    ghostText: host.getGhostText(),
    ghostStyle: editorStyles.ghostStyle,
  });
  const surfaceLayout = measureRendererEditorSurfaceLayout({
    height: measureRendererEditorSurfaceNaturalRows(overlayLines, content.contentRows),
    overlays: overlayLines,
  });
  return renderRendererEditorSurface({
    width: safeWidth,
    frameRows: surfaceLayout.frameRows,
    content,
    argumentHint: host.inputMode === 'bash'
      ? undefined
      : {
          text: host.getText(),
          cursor: host.getCursor(),
          hints: host.argumentHints,
          width: contentWidth,
        },
    prompt: host.inputMode === 'bash' ? '!' : '>',
    topLabel: host.inputMode === 'bash' ? RENDERER_EDITOR_SHELL_MODE_LABEL : undefined,
    connectedAbove: host.connectedAbove && !host.borderHighlighted,
    overlays: surfaceLayout.overlayLines,
    borderStyle: editorStyles.borderStyle,
    promptStyle: editorStyles.promptStyle,
    surfaceStyle: editorStyles.surfaceStyle,
    slashTokenStyle: host.inputMode === 'bash' ? undefined : editorStyles.slashTokenStyle,
  });
}

export function measureNativeTUIEditorLayoutRowCount(
  host: NativeTUIEditorRenderHost & {
    readonly autocompleteOpen: boolean;
    getOverlayLineCount(width: number): number;
    getOverlayLines(width: number): readonly RendererRegionLine[];
    getLayoutRowCountCache():
      | { width: number; text: string; overlayCount: number; ghost: string; rows: number }
      | undefined;
    setLayoutRowCountCache(
      cache:
        | { width: number; text: string; overlayCount: number; ghost: string; rows: number }
        | undefined,
    ): void;
  },
  width: number,
): number {
  const safeWidth = Math.max(1, Math.floor(width));
  const text = host.getText();
  // Overlay open/close must bust the cache: typing `/` keeps the same text
  // while slash suggestions arrive async, and a stale 3-row height clips the
  // prompt + autocomplete into a broken stub frame.
  const overlayOpen = host.autocompleteOpen;
  // Closed autocomplete: avoid building styled overlay cells just to count 0.
  const overlayCount = overlayOpen ? host.getOverlayLineCount(safeWidth) : 0;
  const cached = host.getLayoutRowCountCache();
  if (
    cached !== undefined &&
    cached.width === safeWidth &&
    cached.text === text &&
    cached.overlayCount === overlayCount &&
    cached.ghost === (host.getGhostText() ?? '')
  ) {
    return cached.rows;
  }
  const overlayLines = overlayOpen ? host.getOverlayLines(safeWidth) : [];
  const contentWidth = Math.max(
    1,
    safeWidth - RENDERER_EDITOR_CONTENT_X - RENDERER_EDITOR_CONTENT_RIGHT_INSET,
  );
  host.setLastContentWidth(contentWidth);
  host.getTextInput().setLayoutWidth(contentWidth);
  const content = host.getTextInput().render({
    width: contentWidth,
    focused: host.focused,
  });
  const rows = measureRendererEditorSurfaceNaturalRows(overlayLines, content.contentRows);
  host.setLayoutRowCountCache({
    width: safeWidth,
    text,
    overlayCount,
    ghost: host.getGhostText() ?? '',
    rows,
  });
  return rows;
}
