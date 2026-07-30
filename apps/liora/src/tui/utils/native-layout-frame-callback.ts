import {
  type NativeTerminalRendererRender,
  type RendererRegionLine,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  getActiveAppearancePreferences,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

import { shouldAnimate, shouldRenderAmbientAnimationFrame } from '../controllers/appearance';
import { resolveStageLayout } from '../controllers/stage-layout';
import type { TUIState } from '../tui-state';
import { IdleStageComponent } from '../components/chrome/idle-stage';
import {
  isLiveGoalChromeActive,
  isPureInputFrame,
  isPureTranscriptScrollFrame,
  resolveTUIStateNativeFramePolicy,
  shouldForceNativeCursor,
  shouldReuseTUIChromeCache,
  shouldUseAmbientDamageOnlyPaint,
  tuiChromeEpoch,
  type TUIStateNativeFramePolicy,
} from './native-frame-policy';
import {
  buildTUIStateNativeFrame,
  isNativeFullscreenTakeover,
  transcriptSelectionCacheKey,
} from './native-layout-frame-build';
import type { TUIStateNativeRenderCallbackOptions } from './native-layout-frame-types';
import {
  detectTUIStateNativeLayoutShift,
  type TUIStateNativeLayoutTracking,
} from './native-layout-frame-shift';
import { resetStageResizePointerShape } from './stage-resize-mouse';
import type { TUINativeStageChrome } from './native-stage-plan';

interface TUIStateNativeChromeCache extends TUINativeStageChrome {
  readonly width: number;
  readonly stageWidth: number;
  /**
   * Activity-state signature (streaming phase + thinking) the cached chrome was
   * built under. Chrome only carries time-based content (moon spinner, pulsing
   * model label) while the agent is active; matching this epoch is what lets
   * animation frames reuse idle chrome safely and forces a rebuild the instant
   * activity starts/stops so a stale spinner is never reused.
   */
  readonly chromeEpoch: string;
}

export function createTUIStateNativeRenderCallback(
  state: TUIState,
  options: TUIStateNativeRenderCallbackOptions,
): NativeTerminalRendererRender {
  let layoutTracking: TUIStateNativeLayoutTracking = {};
  let chromeCache: TUIStateNativeChromeCache | undefined;
  let transcriptLineCache: readonly RendererRegionLine[] | undefined;
  let transcriptLineCacheWidth: number | undefined;
  let transcriptLineCacheSelectionKey: string | undefined;
  return ({ frame, runtime, size, quality }) => {
    if (frame.causes.includes('start')) runtime.cancelRegionAnimationFrame();
    if (frame.causes.includes('resize')) {
      // Terminal resize invalidates the grip geometry the Kitty pointer shape
      // was pushed for; drop drag/hover state so the cursor cannot get stuck.
      resetStageResizePointerShape(state.terminal);
    }
    advanceAppearanceAnimationClock(frame.timestamp);
    setAppearanceRenderQuality(quality.level);
    // The frame buffer may already be capped below the real terminal height
    // (see `measureFrameHeight` in createTUIStateNativeRenderer), so layout
    // must be computed against the actual buffer height, not `size.rows`.
    const height = runtime.frameRenderer.height;
    const priorStart = layoutTracking.transcriptStart;
    const layoutShift = detectTUIStateNativeLayoutShift(
      state,
      size.columns,
      layoutTracking,
      height,
    );
    const ambientAnimationAllowed =
      shouldAnimate(state.appState.appearance ?? getActiveAppearancePreferences()) &&
      (isNativeFullscreenTakeover(state) ||
        shouldRenderAmbientAnimationFrame(
          size.rows,
          state.transcriptSelection.isDragging || state.transcriptSelection.hasSelection,
          { nowMs: frame.timestamp },
        ));
    const policy = resolveTUIStateNativeFramePolicy({
      causes: frame.causes,
      viewportScrolled: layoutShift.viewportScrolled,
      structuralShift: layoutShift.structuralShift,
      geometryShift: layoutShift.geometryShift,
      contentGrew: layoutShift.contentGrew,
      contentShrunk: layoutShift.contentShrunk,
      priorTranscriptStart: priorStart,
      nextTranscriptStart: layoutShift.next.transcriptStart ?? 0,
      ambientAnimationAllowed,
    });
    // Post-splash anti-flicker: the last morph frame is still on screen. Suppress
    // the full-clear so the real UI cross-fades in without a black flash. The flag
    // is consumed exactly once (first frame after splash disposal).
    const splashJustDisposed = state.splashJustDisposed === true;
    if (splashJustDisposed) {
      state.splashJustDisposed = false;
    }
    const effectivePolicy: TUIStateNativeFramePolicy = splashJustDisposed
      ? { ...policy, clear: false }
      : policy;
    if (
      policy.clearTranscriptSelection &&
      (state.transcriptSelection.hasSelection || state.transcriptSelection.isDragging)
    ) {
      state.transcriptSelection.clear();
    }
    layoutTracking = layoutShift.next;
    if (policy.refreshTerminalPalette) options.onAuthoritativeFrame?.();
    // Pure keystroke frames only rewrite the editor. Reuse chrome lines so we
    // do not re-render header/footer/queue on every character.
    const pureInputFrame = isPureInputFrame(
      frame.causes,
      layoutShift.structuralShift,
      layoutShift.viewportScrolled,
    );
    const workspaceCenter =
      options.workspaceCenter?.({ columns: size.columns, rows: height }) ?? undefined;
    const stageProbe = resolveStageLayout({
      width: size.columns,
      height,
      workspaceCenter,
      userStageSize: state.userStageSize,
    });
    // Cache the rendered stage band so mouse hit-testing (resize grab zones)
    // matches the on-screen geometry exactly, dock and workspace centering
    // included.
    state.cachedStageBand = stageProbe.stage;
    // Chrome (header/footer/panels) only carries time-based content while the
    // agent is active — the activity pane's moon spinner and the footer's
    // pulsing model label both gate on `streamingPhase !== 'idle' || thinking`.
    // A live goal also keeps chrome dynamic: footer goal badge + Todo Board
    // monitor wall-clock / status pulse must re-render on content + animation
    // ticks (footer 1s timer invalidates 'content' → cause 'request').
    // When idle with no live goal, chrome is fully static, so animation frames
    // can reuse the cached chrome lines instead of re-rendering the whole
    // chrome tree every tick (the dominant per-frame cost once the transcript
    // is long). The chromeEpoch guard forces a rebuild whenever activity or
    // live-goal presence starts/stops so stale chrome is never reused.
    const liveGoal = isLiveGoalChromeActive(state.appState.goal);
    const chromeStatic =
      state.appState.streamingPhase === 'idle' && !state.appState.thinking && !liveGoal;
    const chromeEpoch = tuiChromeEpoch({
      streamingPhase: state.appState.streamingPhase,
      thinking: state.appState.thinking,
      liveGoalId: liveGoal ? state.appState.goal!.goalId : undefined,
      liveGoalStatus: liveGoal ? state.appState.goal!.status : undefined,
    });
    const reuseChrome = shouldReuseTUIChromeCache({
      hasCache: chromeCache !== undefined,
      widthMatches: chromeCache?.width === size.columns,
      stageWidthMatches: chromeCache?.stageWidth === stageProbe.stage.width,
      epochMatches: chromeCache?.chromeEpoch === chromeEpoch,
      pureInputFrame,
      chromeStatic,
      causes: frame.causes,
    })
      ? chromeCache
      : undefined;
    // Animation / idle-aquarium ticks must not full-clear. Request-only frames
    // while Jewel Tank is mounted (e.g. thinking footer) used to clear:true the
    // whole transcript — ~70% frame rewrite that tears into black horizontal bands
    // inside the stage even with sync wrapping.
    // Structural / viewport / resize frames keep clears so layout holes wipe.
    const idleAquariumMounted = state.transcriptContainer.children.some(
      (child) => child instanceof IdleStageComponent,
    );
    const ambientDamageOnly = splashJustDisposed || shouldUseAmbientDamageOnlyPaint({
      structuralShift: layoutShift.structuralShift,
      geometryShift: layoutShift.geometryShift,
      contentGrew: layoutShift.contentGrew,
      contentShrunk: layoutShift.contentShrunk,
      viewportScrolled: layoutShift.viewportScrolled,
      causes: frame.causes,
      ambientAnimationAllowed,
      idleAquariumMounted,
      fullscreenTakeover: isNativeFullscreenTakeover(state),
    });
    // Pure-input fast path: skip panel probes and transcript rendering when
    // the layout has not shifted. The editor is the only region that changes.
    // Mouse clicks that alter the transcript selection invalidate the cache
    // so the selection overlay is repainted immediately.
    //
    // Pure-scroll fast path: the transcript content has not changed — only
    // the viewport offset moved. Reuse the cached lines so we do not
    // regenerate the entire transcript (ANSI conversion, markdown rendering,
    // syntax highlighting) on every wheel tick.
    const selectionKey = transcriptSelectionCacheKey(state);
    const pureScrollFrame = isPureTranscriptScrollFrame(
      frame.causes,
      layoutShift.viewportScrolled,
      layoutShift.structuralShift,
    );
    const canReuseTranscript =
      (pureInputFrame || pureScrollFrame) &&
      transcriptLineCache !== undefined &&
      transcriptLineCacheWidth === size.columns &&
      transcriptLineCacheSelectionKey === selectionKey;
    const nativeFrame = buildTUIStateNativeFrame(state, size.columns, height, {
      diagnosticsOverlay: options.diagnosticsOverlay,
      diagnostics: runtime.diagnostics,
      reuseChrome,
      workspaceCenter,
      // Skip Ultrawork perimeter repaint on pure-input and pure-scroll frames;
      // animation frames still paint it so the border chase stays smooth.
      skipDecorativeEditorEffects: pureInputFrame || pureScrollFrame,
      // Damage-only stage paint on ambient ticks — see ambientDamageOnly.
      ambientDamageOnly,
      // Reuse transcript lines when the transcript has not changed.
      reuseTranscriptLines: canReuseTranscript ? transcriptLineCache : undefined,
    });
    // Refresh the cache only when chrome was freshly built this frame. Reused
    // frames keep the existing cache (its lines already match nativeFrame.chrome).
    if (reuseChrome === undefined) {
      chromeCache = {
        width: size.columns,
        stageWidth: nativeFrame.stageWidth,
        chromeEpoch,
        header: nativeFrame.chrome.header,
        activity: nativeFrame.chrome.activity,
        todo: nativeFrame.chrome.todo,
        queue: nativeFrame.chrome.queue,
        btw: nativeFrame.chrome.btw,
        footer: nativeFrame.chrome.footer,
      };
    }
    // Cache transcript lines for pure-input frame reuse.
    if (!canReuseTranscript) {
      transcriptLineCache = nativeFrame.transcriptLines;
      transcriptLineCacheWidth = size.columns;
      transcriptLineCacheSelectionKey = selectionKey;
    }
    // force/clear come from policy (pure input stays incremental). forceCursor
    // is independent and always on for IME caret stickiness — see shouldForceNativeCursor.
    const forceCursor = shouldForceNativeCursor({
      causes: frame.causes,
      structuralShift: layoutShift.structuralShift,
      viewportScrolled: layoutShift.viewportScrolled,
    });
    const result = runtime.renderLayoutFrame(nativeFrame.regions, {
      fill: options.fill ?? currentTheme.canvasBackgroundCell(),
      force: effectivePolicy.force,
      clear: effectivePolicy.clear,
      cursor: nativeFrame.cursor,
      forceCursor,
      // Draw workspace panels/ticker/status bar BEFORE present() so the writes
      // are flushed within this frame. Calling this after renderLayoutFrame
      // wrote into the back buffer past present(), where the next beginFrame()
      // discarded it — so panels/ticker/status bar never reached the terminal.
      beforePresent: (frameRenderer) => {
        options.postFrameRender?.({ frameRenderer, columns: size.columns, rows: height });
      },
    });
    return result;
  };
}
