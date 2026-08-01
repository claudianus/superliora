import { SubagentActivityComponent, type SubagentToolCallInput } from '../../components/subagents/subagent-activity';
import type { TUIState } from '../../tui-state';
import { requestTranscriptPaintRefresh } from '../../utils/render/frame-render';

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
    // removeChild + paint drop — no full sibling invalidate cascade.
    this.host.state.transcriptContainer.removeChild(panel);
    requestTranscriptPaintRefresh(this.host.state);
  }

  markTerminal(subagentId: string, phase: 'completed' | 'failed'): void {
    const panel = this.panel;
    if (panel === undefined) return;
    panel.markTerminal(subagentId, phase);
    this.requestRender();
  }

  recordToolCall(input: SubagentToolCallInput): void {
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
