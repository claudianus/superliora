import { Spacer } from '#/tui/renderer';
import type {
  Event,
  LioraHarness,
  Session,
  TurnEndedEvent,
} from '@superliora/sdk';

import { NO_ACTIVE_SESSION_MESSAGE } from '../constant/liora-tui';
import { BtwPanelComponent } from '../components/panes/btw-panel';
import { formatErrorMessage } from '../utils/event-payload';
import { formatHookResultPlain } from '../utils/hook-result-format';
import { createMarkdownTheme } from '../theme/pi-tui-theme';
import type { TUIState } from '../tui-state';
import { requestTUILayoutRender } from '../utils/frame-render';

const BTW_BUSY_NOTICE = 'Wait for /btw to finish before sending another question.';

export interface BtwPanelHost {
  state: TUIState;
  session: Session | undefined;
  readonly harness: LioraHarness;

  showError(msg: string): void;
}

export class BtwPanelController {
  private active:
    | {
        readonly agentId: string;
        readonly panel: BtwPanelComponent;
      }
    | undefined;
  private readonly panelsByAgentId = new Map<string, BtwPanelComponent>();

  constructor(private readonly host: BtwPanelHost) {}

  open(agentId: string, initialPrompt: string): void {
    let panel: BtwPanelComponent;
    panel = new BtwPanelComponent({
      markdownTheme: createMarkdownTheme(),
      canUseScrollKeys: () => this.host.state.editor.getText().length === 0,
      terminalRows: () => this.host.state.terminal.rows,
      onPrompt: (prompt) => {
        this.promptAgent(agentId, prompt, panel);
      },
    });
    this.active = { agentId, panel };
    this.panelsByAgentId.set(agentId, panel);
    this.mount(panel);
    panel.submit(initialPrompt);
  }

  clear(): void {
    const active = this.active;
    if (active !== undefined && this.shouldCancelOnUnmount(active.panel)) {
      void this.cancelAgent(active.agentId);
    }
    this.active = undefined;
    this.panelsByAgentId.clear();
    this.host.state.btwPanelContainer.clear();
    this.host.state.editor.connectedAbove = false;
  }

  closeOrCancel(): boolean {
    const active = this.active;
    if (active === undefined) return false;
    const shouldCancel = this.shouldCancelOnUnmount(active.panel);
    this.close(active.panel);
    if (shouldCancel) {
      void this.cancelAgent(active.agentId);
    }
    return true;
  }

  cancelRunning(): boolean {
    const active = this.active;
    if (active === undefined || !active.panel.isRunning()) return false;
    void this.cancelAgent(active.agentId);
    return true;
  }

  sendUserInput(text: string): boolean {
    const active = this.active;
    if (active === undefined) return false;
    if (active.panel.isRunning()) {
      this.showBusyNotice(active, text);
      return true;
    }
    active.panel.submit(text);
    this.host.state.ui.setFocus(this.host.state.editor);
    requestTUILayoutRender(this.host.state);
    return true;
  }

  scroll(direction: 'up' | 'down'): boolean {
    const panel = this.active?.panel;
    if (panel === undefined || !panel.scroll(direction)) return false;
    requestTUILayoutRender(this.host.state);
    return true;
  }

  routeEvent(event: Event): boolean {
    const panel = this.panelsByAgentId.get(event.agentId);
    if (panel === undefined) return false;

    switch (event.type) {
      case 'assistant.delta':
        panel.appendAnswer(event.delta);
        requestTUILayoutRender(this.host.state);
        return true;
      case 'thinking.delta':
        panel.appendThinking(event.delta);
        requestTUILayoutRender(this.host.state);
        return true;
      case 'hook.result':
        panel.appendAnswer(formatHookResultPlain(event));
        requestTUILayoutRender(this.host.state);
        return true;
      case 'turn.ended':
        if (event.reason === 'completed') {
          panel.markDone();
        } else {
          panel.markFailed(formatBtwTurnEnd(event));
        }
        requestTUILayoutRender(this.host.state);
        return true;
      default:
        return true;
    }
  }

  private mount(panel: BtwPanelComponent): void {
    this.host.state.btwPanelContainer.clear();
    this.host.state.btwPanelContainer.addChild(new Spacer(1));
    this.host.state.btwPanelContainer.addChild(panel);
    this.host.state.editor.connectedAbove = true;
    this.host.state.ui.setFocus(this.host.state.editor);
    requestTUILayoutRender(this.host.state);
  }

  private close(panel: BtwPanelComponent): void {
    if (!this.host.state.btwPanelContainer.children.includes(panel)) return;
    this.unregister(panel);
    this.host.state.btwPanelContainer.clear();
    this.host.state.editor.connectedAbove = false;
    this.host.state.ui.setFocus(this.host.state.editor);
    requestTUILayoutRender(this.host.state);
  }

  private unregister(panel: BtwPanelComponent): void {
    for (const [agentId, candidate] of this.panelsByAgentId) {
      if (candidate === panel) {
        this.panelsByAgentId.delete(agentId);
      }
    }
    if (this.active?.panel === panel) this.active = undefined;
  }

  private showBusyNotice(
    active: { readonly panel: BtwPanelComponent },
    input: string,
  ): void {
    this.host.state.editor.setText(input);
    active.panel.addTransientNotice(BTW_BUSY_NOTICE);
    requestTUILayoutRender(this.host.state);
  }

  private promptAgent(agentId: string, prompt: string, panel: BtwPanelComponent): void {
    const session = this.host.session;
    if (session === undefined) {
      panel.markFailed(NO_ACTIVE_SESSION_MESSAGE);
      requestTUILayoutRender(this.host.state);
      return;
    }
    void this.withInteractiveAgent(agentId, () => session.prompt(prompt)).catch((error: unknown) => {
      panel.markFailed(`Failed to send /btw prompt: ${formatErrorMessage(error)}`);
      requestTUILayoutRender(this.host.state);
    });
  }

  private async cancelAgent(agentId: string): Promise<void> {
    const session = this.host.session;
    if (session === undefined) return;
    await this.withInteractiveAgent(agentId, () => session.cancel()).catch((error: unknown) => {
      this.host.showError(`Failed to cancel /btw: ${formatErrorMessage(error)}`);
    });
  }

  private shouldCancelOnUnmount(panel: BtwPanelComponent): boolean {
    return panel.isRunning() || panel.isEmpty();
  }

  private withInteractiveAgent<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
    return this.host.harness.withInteractiveAgent(agentId, fn);
  }
}

function formatBtwTurnEnd(event: TurnEndedEvent): string {
  if (event.error !== undefined) {
    return `[${event.error.code}] ${event.error.message}`;
  }
  if (event.reason === 'cancelled') {
    return 'Interrupted by user';
  }
  if (event.reason === 'filtered') {
    return 'Provider safety policy blocked the response.';
  }
  return `BTW turn ended with reason: ${event.reason}`;
}
