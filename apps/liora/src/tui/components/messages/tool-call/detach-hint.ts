import { Text } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';

/** Delay before a long-running foreground Bash/Agent card advertises Ctrl+B. */
const DETACH_HINT_DELAY_MS = 6_000;
const DETACH_HINT_TEXT = 'Press Ctrl+B to background this task · /tasks to inspect';

export function isDetachHintEligible(toolName: string): boolean {
  return toolName === 'Bash' || toolName === 'Agent';
}

export class ToolCallDetachHint {
  private timer: ReturnType<typeof setTimeout> | undefined;
  visible = false;

  constructor(
    private readonly host: {
      readonly rebuildBody: () => void;
      readonly requestRender: () => void;
      readonly hasResult: () => boolean;
    },
  ) {}

  start(toolName: string, uiDefined: boolean): void {
    if (!isDetachHintEligible(toolName)) return;
    if (this.host.hasResult()) return;
    if (!uiDefined) return;
    if (toolName === 'Agent') {
      if (this.visible) return;
      this.visible = true;
      this.host.rebuildBody();
      this.host.requestRender();
      return;
    }
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.host.hasResult()) return;
      this.visible = true;
      this.host.rebuildBody();
      this.host.requestRender();
    }, DETACH_HINT_DELAY_MS);
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    this.stop();
  }

  clearOnResult(): void {
    this.visible = false;
    this.stop();
  }

  buildChild(): Text | undefined {
    if (!this.visible) return undefined;
    if (this.host.hasResult()) return undefined;
    return new Text(currentTheme.dim(DETACH_HINT_TEXT), 2, 0);
  }
}
