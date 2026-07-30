import { SubagentActivityComponent } from '../components/subagents/subagent-activity';
import type { TUIState } from '../tui-state';

export interface SubagentActivityPanelHost {
  readonly state: TUIState;
}

/**
 * Owns the optional background subagent activity panel mounted in the transcript.
 */
export class SubagentActivityPanel {
  private panel: SubagentActivityComponent | undefined;

  constructor(
    private readonly host: SubagentActivityPanelHost,
    private readonly requestRender: () => void,
  ) {}

  reset(): void {
    this.remove();
  }

  ensure(): SubagentActivityComponent {
    const existing = this.panel;
    if (existing !== undefined) return existing;
    const panel = new SubagentActivityComponent({
      requestRender: () => {
        this.requestRender();
      },
    });
    this.panel = panel;
    this.host.state.transcriptContainer.addChild(panel);
    this.requestRender();
    return panel;
  }

  remove(): void {
    const panel = this.panel;
    if (panel === undefined) return;
    this.panel = undefined;
    const children = this.host.state.transcriptContainer.children;
    const index = children.indexOf(panel);
    if (index >= 0) {
      children.splice(index, 1);
      this.host.state.transcriptContainer.invalidate();
    }
  }

  markTerminal(subagentId: string, phase: 'completed' | 'failed'): void {
    const panel = this.panel;
    if (panel === undefined) return;
    panel.markTerminal(subagentId, phase);
    this.requestRender();
  }

  recordToolCall(input: {
    subagentId: string;
    subagentName: string | undefined;
    toolCallId: string;
    name: string;
    argsPreview: string | undefined;
    detail: string | undefined;
  }): void {
    this.ensure().recordToolCall(input);
  }

  recordToolResult(input: {
    subagentId: string;
    toolCallId: string;
    name: string;
    isError: boolean;
  }): void {
    const panel = this.panel;
    if (panel === undefined) return;
    panel.recordToolResult(input);
  }
}
