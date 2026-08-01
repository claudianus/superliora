import { Container, Text, projectRendererLineWindow } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import {
  isTranscriptEntranceActive,
  polishTranscriptLines,
} from '#/tui/features/transcript/transcript-entrance';

import { formatBashOutputForDisplay, sanitizeShellOutput } from '#/tui/utils/shell-output';
import { formatTranscriptOutput } from '#/tui/utils/transcript/transcript-output-format';
import { areLiveToolTicksSuppressed } from '#/tui/utils/render/transcript-paint-mode';

const RUNNING_TAIL_LINES = 5;
// Cap the live running buffer so a command that spews output for minutes can't
// grow memory without bound or make every render re-strip a multi-MB string.
// Only affects the transient running tail; the final view uses the full
// captured stdout/stderr passed to finish().
const MAX_COMBINED_CHARS = 256 * 1024;
const KEEP_COMBINED_CHARS = 64 * 1024;

/**
 * Live view for a user-initiated `!` shell command. Two phases:
 *
 *  - running: dim, ANSI-stripped tail of the combined output, a `+N lines`
 *    overflow marker, an elapsed `(Xs)` timer that ticks with the render loop,
 *    and a `(ctrl+b to run in background)` hint — matching claude-code's
 *    running card so warnings are grey rather than red while the command works.
 *  - finished: the standard `formatBashOutputForDisplay` view (stderr red only
 *    on failure), the running chrome removed.
 *
 * The elapsed timer is derived from the shared animation clock during render
 * — no private setInterval. See PREMIUM.md §7.1.
 */
export class ShellRunComponent extends Container {
  private readonly entranceStartedAtMs = appearanceAnimationNow();
  private readonly textComponent: Text;
  private combined = '';
  private running = true;
  private backgrounded = false;
  private disposed = false;
  private finalStdout = '';
  private finalStderr = '';
  private finalIsError?: boolean;
  private readonly startedAt = Date.now();

  constructor(private readonly requestRender: () => void) {
    super();
    this.textComponent = new Text(this.renderText(), 0, 0);
    this.addChild(this.textComponent);
  }

  append(text: string): void {
    if (this.disposed || !this.running || text.length === 0) return;
    this.combined += text;
    if (this.combined.length > MAX_COMBINED_CHARS) {
      this.combined = this.combined.slice(-KEEP_COMBINED_CHARS);
    }
    this.flush();
  }

  finish(stdout: string, stderr: string, isError?: boolean): void {
    if (this.disposed || !this.running) return;
    this.running = false;
    this.finalStdout = stdout;
    this.finalStderr = stderr;
    this.finalIsError = isError;
    this.flush();
  }

  finishBackgrounded(): void {
    if (this.disposed || !this.running) return;
    this.running = false;
    this.backgrounded = true;
    this.flush();
  }

  dispose(): void {
    this.disposed = true;
  }

  override render(width: number): string[] {
    // Refresh elapsed from the animation clock. Never requestRender() here —
    // flush() used to schedule another frame on every paint of a running card,
    // which busy-loops the TUI under scroll/ambient (permanent freeze feel).
    // Pure-scroll paint skips the refresh entirely (stale (Xs) is fine).
    if (this.running && !areLiveToolTicksSuppressed()) {
      this.refreshText();
    }
    const lines = super.render(width);
    if (areLiveToolTicksSuppressed() || !isTranscriptEntranceActive(this.entranceStartedAtMs)) {
      return lines;
    }
    return polishTranscriptLines(lines, {
      startedAtMs: this.entranceStartedAtMs,
      kind: 'status',
      streaming: true,
      appearance: getActiveAppearancePreferences(),
    });
  }

  private flush(): void {
    if (this.disposed) return;
    try {
      this.refreshText();
      this.requestRender();
    } catch {
      // Never let a render/render-request error escape into a timer or event
      // handler — an uncaught exception there can take down the whole TUI.
    }
  }

  private refreshText(): void {
    this.textComponent.setText(this.renderText());
  }

  private renderText(): string {
    try {
      if (this.backgrounded) {
        return `  ${currentTheme.fg('textDim', 'Moved to background.')}`;
      }
      if (!this.running) {
        return formatBashOutputForDisplay(this.finalStdout, this.finalStderr, this.finalIsError)
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');
      }
      const elapsed = Math.floor((appearanceAnimationNow() - this.startedAt) / 1000);
      const dim = (s: string): string => currentTheme.fg('textDim', s);
      const trimmed = sanitizeShellOutput(this.combined).trimEnd();
      let body: string;
      let extra = 0;
      if (trimmed.length === 0) {
        body = `  ${dim('Running…')}`;
      } else {
        const lines = trimmed.split('\n');
        const preview = projectRendererLineWindow({
          lines,
          maxLines: RUNNING_TAIL_LINES,
          tail: true,
        });
        extra = preview.hiddenLineCount;
        // Pretty-print the visible tail (JSON / logs / paths) while the
        // command is still running — same formatter as the finished view.
        body = formatTranscriptOutput(preview.lines.join('\n'), {
          isError: false,
          mode: 'bash',
        })
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');
      }
      const appearance = getActiveAppearancePreferences();
      const timingRaw = `${extra > 0 ? `+${extra} lines ` : ''}(${elapsed}s)`;
      const timing = `  ${
        shouldRenderAmbientEffects(appearance)
          ? renderPulseText(timingRaw, 'shell-run:elapsed', 'textDim')
          : dim(timingRaw)
      }`;
      const hint = `  ${dim('(ctrl+b to run in background)')}`;
      return `${body}\n${timing}\n${hint}`;
    } catch {
      return '  (output unavailable)';
    }
  }
}
