import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  Box as RendererBox,
  CombinedAutocompleteProvider as RendererCombinedAutocompleteProvider,
  Container as RendererContainer,
  CURSOR_MARKER as RENDERER_CURSOR_MARKER,
  RENDERER_BRAILLE_PROGRESS_EMPTY as RENDERER_PACKAGE_BRAILLE_PROGRESS_EMPTY,
  RENDERER_BRAILLE_PROGRESS_LEVELS as RENDERER_PACKAGE_BRAILLE_PROGRESS_LEVELS,
  RENDERER_BRAILLE_PROGRESS_SEPARATOR as RENDERER_PACKAGE_BRAILLE_PROGRESS_SEPARATOR,
  RENDERER_RATIO_PROGRESS_EMPTY as RENDERER_PACKAGE_RATIO_PROGRESS_EMPTY,
  RENDERER_RATIO_PROGRESS_FILLED as RENDERER_PACKAGE_RATIO_PROGRESS_FILLED,
  RENDERER_EDITOR_CONTENT_X as RENDERER_PACKAGE_EDITOR_CONTENT_X,
  RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY as RENDERER_PACKAGE_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
  RENDERER_EDITOR_PROMPT_X as RENDERER_PACKAGE_EDITOR_PROMPT_X,
  RENDERER_EDITOR_SCROLLBAR_THUMB as RENDERER_PACKAGE_EDITOR_SCROLLBAR_THUMB,
  RENDERER_EDITOR_SCROLLBAR_TRACK as RENDERER_PACKAGE_EDITOR_SCROLLBAR_TRACK,
  decodeKittyPrintable as rendererDecodeKittyPrintable,
  createRendererGradientTextCells as rendererCreateGradientTextCells,
  createRendererGradientTextRuns as rendererCreateGradientTextRuns,
  fitRendererFrameTitle as rendererFitFrameTitle,
  fitRendererLineToWidth as rendererFitLineToWidth,
  formatRendererScrollPosition as rendererFormatScrollPosition,
  fuzzyFilter as rendererFuzzyFilter,
  handleRendererCommandPrefixTextInput as rendererPackageHandleCommandPrefixTextInput,
  highlightRendererEditorSlashToken as rendererHighlightEditorSlashToken,
  hashRendererEffectSeed as rendererHashEffectSeed,
  injectRendererEditorPromptSymbol as rendererInjectEditorPromptSymbol,
  projectRendererCursorMarkerLine as rendererProjectCursorMarkerLine,
  projectRendererCursorMarkerLines as rendererProjectCursorMarkerLines,
  projectRendererEditorArgumentHint as rendererProjectEditorArgumentHint,
  projectRendererEditorSurfaceCursor as rendererProjectEditorSurfaceCursor,
  RendererEditorAutocompleteController as RendererPackageEditorAutocompleteController,
  RendererEditorTextInputController as RendererPackageEditorTextInputController,
  RendererChildrenRenderCache as RendererPackageChildrenRenderCache,
  RendererWidthRenderCache as RendererPackageWidthRenderCache,
  resolveRendererEditorArgumentHint as rendererResolveEditorArgumentHint,
  resolveRendererEditorSurfaceStyles as rendererResolveEditorSurfaceStyles,
  rendererPositiveModulo as rendererPackagePositiveModulo,
  isFocusable as rendererIsFocusable,
  isRendererEditorTextMutation as rendererPackageIsEditorTextMutation,
  Key as RendererKey,
  Markdown as RendererMarkdown,
  matchesKey as rendererMatchesKey,
  formatRendererToolHeaderChip as rendererFormatToolHeaderChip,
  measureRendererEditorSurfaceLayout as rendererMeasureEditorSurfaceLayout,
  measureRendererTranscriptContentWidth as rendererMeasureTranscriptContentWidth,
  measureRendererStyledTextRuns as rendererMeasureStyledTextRuns,
  NativeRendererTerminalHost as RendererPackageNativeRendererTerminalHost,
  NativeRootUI as RendererPackageNativeRootUI,
  parseKey as rendererParseKey,
  projectRendererLinePreview as rendererProjectLinePreview,
  projectRendererLineWindow as rendererProjectLineWindow,
  projectRendererNonEmptyLineWindow as rendererProjectNonEmptyLineWindow,
  projectRendererRatioProgressBar as rendererProjectRatioProgressBar,
  projectRendererScrollableLineWindow as rendererProjectScrollableLineWindow,
  projectRendererSegmentedProgressBar as rendererProjectSegmentedProgressBar,
  projectRendererSteppedProgressBar as rendererProjectSteppedProgressBar,
  projectRendererViewportHistoryStatus as rendererProjectViewportHistoryStatus,
  projectRendererViewportLineWindow as rendererProjectViewportLineWindow,
  renderRendererLabeledDividerRow as rendererRenderLabeledDividerRow,
  renderRendererRightGutterLines as rendererRenderRightGutterLines,
  renderRendererSegmentedProgressBar as rendererRenderSegmentedProgressBar,
  renderRendererSteppedProgressBar as rendererRenderSteppedProgressBar,
  renderRendererScrollablePanelChromeRows as rendererRenderScrollablePanelChromeRows,
  projectRendererToolActivityPhase as rendererProjectToolActivityPhase,
  projectRendererWrappedTextPreview as rendererProjectWrappedTextPreview,
  RendererPrefixedWrappedLine as RendererPackagePrefixedWrappedLine,
  RendererStableScrollableLineViewport as RendererPackageStableScrollableLineViewport,
  RendererTranscriptViewport as RendererPackageTranscriptViewport,
  RendererTranscriptViewportComponent as RendererPackageTranscriptViewportComponent,
  RendererTruncatedOutputComponent as RendererPackageTruncatedOutputComponent,
  createNativeRootUI as rendererPackageCreateNativeRootUI,
  createRendererStyledTextCells as rendererCreateStyledTextCells,
  renderNativeRootChildren as rendererPackageRenderNativeRootChildren,
  renderRendererEditorFrame as rendererPackageRenderEditorFrame,
  renderRendererEditorSurface as rendererPackageRenderEditorSurface,
  renderRendererFooterRow as rendererRenderFooterRow,
  renderRendererGradientTextAnsi as rendererRenderGradientTextAnsi,
  renderRendererRatioProgressBar as rendererRenderRatioProgressBar,
  renderRendererScrollableFrameRows as rendererRenderScrollableFrameRows,
  renderRendererStableScrollableFrameRows as rendererRenderStableScrollableFrameRows,
  renderRendererStyledTextRunsAnsi as rendererRenderStyledTextRunsAnsi,
  renderRendererTranscriptLineBlock as rendererRenderTranscriptLineBlock,
  renderRendererToolActivityHeader as rendererRenderToolActivityHeader,
  resolveRendererSeededIndex as rendererResolveSeededIndex,
  RendererGutterContainer as RendererPackageGutterContainer,
  SelectList as RendererSelectList,
  Spacer as RendererSpacer,
  Text as RendererText,
  truncateRendererStyledTextRuns as rendererTruncateStyledTextRuns,
  truncateToWidth as rendererTruncateToWidth,
  trimRendererTrailingEmptyLines as rendererTrimTrailingEmptyLines,
  visibleWidth as rendererVisibleWidth,
  wrapRendererStyledTextRuns as rendererWrapStyledTextRuns,
  wrapTextWithAnsi as rendererWrapTextWithAnsi,
} from '@harness-kit/tui-renderer';
import { describe, expect, it } from 'vitest';

import {
  Box,
  CombinedAutocompleteProvider,
  Container,
  CURSOR_MARKER,
  decodeKittyPrintable,
  createRendererGradientTextCells,
  createRendererGradientTextRuns,
  fuzzyFilter,
  handleRendererCommandPrefixTextInput,
  hashRendererEffectSeed,
  highlightRendererEditorSlashToken,
  injectRendererEditorPromptSymbol,
  isFocusable,
  isRendererEditorTextMutation,
  Key,
  Markdown,
  matchesKey,
  formatRendererToolHeaderChip,
  measureRendererEditorSurfaceLayout,
  measureRendererTranscriptContentWidth,
  measureRendererStyledTextRuns,
  NativeRendererTerminalHost,
  NativeRootUI,
  parseKey,
  projectRendererLinePreview,
  projectRendererLineWindow,
  projectRendererNonEmptyLineWindow,
  projectRendererRatioProgressBar,
  projectRendererScrollableLineWindow,
  projectRendererSegmentedProgressBar,
  projectRendererSteppedProgressBar,
  projectRendererViewportHistoryStatus,
  projectRendererViewportLineWindow,
  renderRendererLabeledDividerRow,
  renderRendererRightGutterLines,
  renderRendererSegmentedProgressBar,
  renderRendererSteppedProgressBar,
  renderRendererScrollablePanelChromeRows,
  projectRendererToolActivityPhase,
  projectRendererWrappedTextPreview,
  RendererPrefixedWrappedLine,
  RendererStableScrollableLineViewport,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  RendererTruncatedOutputComponent,
  RENDERER_BRAILLE_PROGRESS_EMPTY,
  RENDERER_BRAILLE_PROGRESS_LEVELS,
  RENDERER_BRAILLE_PROGRESS_SEPARATOR,
  RENDERER_RATIO_PROGRESS_EMPTY,
  RENDERER_RATIO_PROGRESS_FILLED,
  RENDERER_EDITOR_CONTENT_X,
  RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
  RENDERER_EDITOR_PROMPT_X,
  RENDERER_EDITOR_SCROLLBAR_THUMB,
  RENDERER_EDITOR_SCROLLBAR_TRACK,
  createNativeRootUI,
  createRendererStyledTextCells,
  projectRendererCursorMarkerLine,
  projectRendererCursorMarkerLines,
  renderNativeRootChildren,
  renderRendererEditorFrame,
  renderRendererEditorSurface,
  renderRendererFooterRow,
  renderRendererRatioProgressBar,
  renderRendererScrollableFrameRows,
  renderRendererStableScrollableFrameRows,
  renderRendererTranscriptLineBlock,
  renderRendererToolActivityHeader,
  renderRendererStyledTextRunsAnsi,
  projectRendererEditorArgumentHint,
  projectRendererEditorSurfaceCursor,
  RendererChildrenRenderCache,
  RendererWidthRenderCache,
  RendererEditorAutocompleteController,
  RendererEditorTextInputController,
  rendererPositiveModulo,
  renderRendererGradientTextAnsi,
  resolveRendererEditorArgumentHint,
  resolveRendererEditorSurfaceStyles,
  resolveRendererSeededIndex,
  RendererGutterContainer,
  SelectList,
  Spacer,
  Text,
  fitRendererFrameTitle,
  fitRendererLineToWidth,
  formatRendererScrollPosition,
  truncateRendererStyledTextRuns,
  truncateToWidth,
  trimRendererTrailingEmptyLines,
  visibleWidth,
  wrapRendererStyledTextRuns,
  wrapTextWithAnsi,
} from '#/tui/renderer';

const PACKAGE_ROOT = join(__dirname, '..', '..');
const SCAN_ROOTS = [join(PACKAGE_ROOT, 'src'), join(PACKAGE_ROOT, 'test', 'tui')];
const GUARD_TEST = 'test/tui/renderer-facade-guard.test.ts';
const PI_TUI_PACKAGE = '@earendil-works/pi-tui';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('TUI renderer facade guard', () => {
  it('serves Text from the reusable renderer package', () => {
    expect(Text).toBe(RendererText);
  });

  it('serves component primitives from the reusable renderer package', () => {
    expect(Container).toBe(RendererContainer);
    expect(RendererChildrenRenderCache).toBe(RendererPackageChildrenRenderCache);
    expect(RendererWidthRenderCache).toBe(RendererPackageWidthRenderCache);
    expect(RendererGutterContainer).toBe(RendererPackageGutterContainer);
    expect(Spacer).toBe(RendererSpacer);
    expect(Box).toBe(RendererBox);
  });

  it('serves Markdown from the reusable renderer package', () => {
    expect(Markdown).toBe(RendererMarkdown);
  });

  it('serves SelectList from the reusable renderer package', () => {
    expect(SelectList).toBe(RendererSelectList);
  });

  it('serves autocomplete provider runtime from the reusable renderer package', () => {
    expect(CombinedAutocompleteProvider).toBe(RendererCombinedAutocompleteProvider);
  });

  it('serves editor autocomplete controller from the reusable renderer package', () => {
    expect(RendererEditorAutocompleteController).toBe(
      RendererPackageEditorAutocompleteController,
    );
  });

  it('serves editor text-input bridge from the reusable renderer package', () => {
    expect(RendererEditorTextInputController).toBe(RendererPackageEditorTextInputController);
    expect(isRendererEditorTextMutation).toBe(rendererPackageIsEditorTextMutation);
    expect(handleRendererCommandPrefixTextInput).toBe(
      rendererPackageHandleCommandPrefixTextInput,
    );
  });

  it('serves editor chrome helpers from the reusable renderer package', () => {
    expect(highlightRendererEditorSlashToken).toBe(rendererHighlightEditorSlashToken);
    expect(injectRendererEditorPromptSymbol).toBe(rendererInjectEditorPromptSymbol);
    expect(resolveRendererEditorArgumentHint).toBe(rendererResolveEditorArgumentHint);
    expect(resolveRendererEditorSurfaceStyles).toBe(rendererResolveEditorSurfaceStyles);
    expect(projectRendererEditorArgumentHint).toBe(rendererProjectEditorArgumentHint);
    expect(projectRendererEditorSurfaceCursor).toBe(rendererProjectEditorSurfaceCursor);
    expect(measureRendererEditorSurfaceLayout).toBe(rendererMeasureEditorSurfaceLayout);
    expect(renderRendererEditorFrame).toBe(rendererPackageRenderEditorFrame);
    expect(renderRendererEditorSurface).toBe(rendererPackageRenderEditorSurface);
    expect(RENDERER_EDITOR_PROMPT_X).toBe(RENDERER_PACKAGE_EDITOR_PROMPT_X);
    expect(RENDERER_EDITOR_CONTENT_X).toBe(RENDERER_PACKAGE_EDITOR_CONTENT_X);
    expect(RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY).toBe(
      RENDERER_PACKAGE_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
    );
    expect(RENDERER_EDITOR_SCROLLBAR_TRACK).toBe(RENDERER_PACKAGE_EDITOR_SCROLLBAR_TRACK);
    expect(RENDERER_EDITOR_SCROLLBAR_THUMB).toBe(RENDERER_PACKAGE_EDITOR_SCROLLBAR_THUMB);
  });

  it('serves cursor and focus contracts from the reusable renderer package', () => {
    expect(CURSOR_MARKER).toBe(RENDERER_CURSOR_MARKER);
    expect(isFocusable).toBe(rendererIsFocusable);
    expect(projectRendererCursorMarkerLine).toBe(rendererProjectCursorMarkerLine);
    expect(projectRendererCursorMarkerLines).toBe(rendererProjectCursorMarkerLines);
  });

  it('serves the native root UI runtime from the reusable renderer package', () => {
    expect(NativeRootUI).toBe(RendererPackageNativeRootUI);
    expect(NativeRendererTerminalHost).toBe(RendererPackageNativeRendererTerminalHost);
    expect(createNativeRootUI).toBe(rendererPackageCreateNativeRootUI);
    expect(renderNativeRootChildren).toBe(rendererPackageRenderNativeRootChildren);
  });

  it('serves input matching and fuzzy search from the reusable renderer package', () => {
    expect(Key).toBe(RendererKey);
    expect(matchesKey).toBe(rendererMatchesKey);
    expect(parseKey).toBe(rendererParseKey);
    expect(decodeKittyPrintable).toBe(rendererDecodeKittyPrintable);
    expect(fuzzyFilter).toBe(rendererFuzzyFilter);
  });

  it('serves text measurement utilities from the reusable renderer package', () => {
    expect(visibleWidth).toBe(rendererVisibleWidth);
    expect(truncateToWidth).toBe(rendererTruncateToWidth);
    expect(wrapTextWithAnsi).toBe(rendererWrapTextWithAnsi);
    expect(fitRendererFrameTitle).toBe(rendererFitFrameTitle);
    expect(fitRendererLineToWidth).toBe(rendererFitLineToWidth);
    expect(formatRendererScrollPosition).toBe(rendererFormatScrollPosition);
  });

  it('serves text effect helpers from the reusable renderer package', () => {
    expect(measureRendererStyledTextRuns).toBe(rendererMeasureStyledTextRuns);
    expect(truncateRendererStyledTextRuns).toBe(rendererTruncateStyledTextRuns);
    expect(wrapRendererStyledTextRuns).toBe(rendererWrapStyledTextRuns);
    expect(createRendererStyledTextCells).toBe(rendererCreateStyledTextCells);
    expect(renderRendererStyledTextRunsAnsi).toBe(rendererRenderStyledTextRunsAnsi);
    expect(createRendererGradientTextCells).toBe(rendererCreateGradientTextCells);
    expect(createRendererGradientTextRuns).toBe(rendererCreateGradientTextRuns);
    expect(renderRendererGradientTextAnsi).toBe(rendererRenderGradientTextAnsi);
    expect(hashRendererEffectSeed).toBe(rendererHashEffectSeed);
    expect(rendererPositiveModulo).toBe(rendererPackagePositiveModulo);
    expect(resolveRendererSeededIndex).toBe(rendererResolveSeededIndex);
  });

  it('serves transcript line helpers from the reusable renderer package', () => {
    expect(measureRendererTranscriptContentWidth).toBe(rendererMeasureTranscriptContentWidth);
    expect(renderRendererTranscriptLineBlock).toBe(rendererRenderTranscriptLineBlock);
    expect(projectRendererLinePreview).toBe(rendererProjectLinePreview);
    expect(projectRendererLineWindow).toBe(rendererProjectLineWindow);
    expect(projectRendererNonEmptyLineWindow).toBe(rendererProjectNonEmptyLineWindow);
    expect(projectRendererScrollableLineWindow).toBe(rendererProjectScrollableLineWindow);
    expect(projectRendererViewportHistoryStatus).toBe(rendererProjectViewportHistoryStatus);
    expect(projectRendererViewportLineWindow).toBe(rendererProjectViewportLineWindow);
    expect(RendererStableScrollableLineViewport).toBe(
      RendererPackageStableScrollableLineViewport,
    );
    expect(renderRendererRightGutterLines).toBe(rendererRenderRightGutterLines);
    expect(renderRendererLabeledDividerRow).toBe(rendererRenderLabeledDividerRow);
    expect(projectRendererRatioProgressBar).toBe(rendererProjectRatioProgressBar);
    expect(renderRendererRatioProgressBar).toBe(rendererRenderRatioProgressBar);
    expect(RENDERER_RATIO_PROGRESS_EMPTY).toBe(RENDERER_PACKAGE_RATIO_PROGRESS_EMPTY);
    expect(RENDERER_RATIO_PROGRESS_FILLED).toBe(RENDERER_PACKAGE_RATIO_PROGRESS_FILLED);
    expect(projectRendererSegmentedProgressBar).toBe(rendererProjectSegmentedProgressBar);
    expect(renderRendererSegmentedProgressBar).toBe(rendererRenderSegmentedProgressBar);
    expect(projectRendererSteppedProgressBar).toBe(rendererProjectSteppedProgressBar);
    expect(renderRendererSteppedProgressBar).toBe(rendererRenderSteppedProgressBar);
    expect(RENDERER_BRAILLE_PROGRESS_EMPTY).toBe(RENDERER_PACKAGE_BRAILLE_PROGRESS_EMPTY);
    expect(RENDERER_BRAILLE_PROGRESS_SEPARATOR).toBe(
      RENDERER_PACKAGE_BRAILLE_PROGRESS_SEPARATOR,
    );
    expect(RENDERER_BRAILLE_PROGRESS_LEVELS).toBe(RENDERER_PACKAGE_BRAILLE_PROGRESS_LEVELS);
    expect(renderRendererScrollablePanelChromeRows).toBe(
      rendererRenderScrollablePanelChromeRows,
    );
    expect(renderRendererScrollableFrameRows).toBe(
      rendererRenderScrollableFrameRows,
    );
    expect(renderRendererStableScrollableFrameRows).toBe(
      rendererRenderStableScrollableFrameRows,
    );
    expect(renderRendererFooterRow).toBe(rendererRenderFooterRow);
    expect(projectRendererWrappedTextPreview).toBe(rendererProjectWrappedTextPreview);
    expect(RendererPrefixedWrappedLine).toBe(RendererPackagePrefixedWrappedLine);
    expect(RendererTranscriptViewport).toBe(RendererPackageTranscriptViewport);
    expect(RendererTranscriptViewportComponent).toBe(
      RendererPackageTranscriptViewportComponent,
    );
    expect(RendererTruncatedOutputComponent).toBe(RendererPackageTruncatedOutputComponent);
    expect(trimRendererTrailingEmptyLines).toBe(rendererTrimTrailingEmptyLines);
  });

  it('serves tool activity helpers from the reusable renderer package', () => {
    expect(projectRendererToolActivityPhase).toBe(rendererProjectToolActivityPhase);
    expect(renderRendererToolActivityHeader).toBe(rendererRenderToolActivityHeader);
    expect(formatRendererToolHeaderChip).toBe(rendererFormatToolHeaderChip);
  });

  it('keeps pi-tui direct imports behind #/tui/renderer', () => {
    const offenders = SCAN_ROOTS.flatMap(walk)
      .map((file) => ({
        file,
        rel: relative(PACKAGE_ROOT, file),
      }))
      .filter(({ rel }) => !rel.startsWith('src/tui/renderer/') && rel !== GUARD_TEST)
      .filter(({ file }) => readFileSync(file, 'utf8').includes(PI_TUI_PACKAGE))
      .map(({ rel }) => rel);

    expect(
      offenders,
      `Import TUI primitives from #/tui/renderer instead of ${PI_TUI_PACKAGE}.\n` +
        offenders.map((file) => `  ${file}`).join('\n'),
    ).toEqual([]);
  });
});
