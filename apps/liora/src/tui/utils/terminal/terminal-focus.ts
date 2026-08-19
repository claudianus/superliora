import {
  DISABLE_TERMINAL_FOCUS_REPORTING,
  ENABLE_TERMINAL_FOCUS_REPORTING,
  TERMINAL_FOCUS_IN,
  TERMINAL_FOCUS_OUT,
} from '#/tui/constant/terminal';
import type { TUIState } from '#/tui/tui-state';
import type { TerminalState } from '#/tui/utils/terminal/terminal-state';

export {
  DISABLE_TERMINAL_FOCUS_REPORTING,
  ENABLE_TERMINAL_FOCUS_REPORTING,
  TERMINAL_FOCUS_IN,
  TERMINAL_FOCUS_OUT,
} from '#/tui/constant/terminal';

export function installTerminalFocusTracking(
  state: TUIState,
  options: { readonly writeEnable?: boolean } = {},
): () => void {
  state.terminalState.focused = true;
  const disposeInputListener = state.ui.addInputListener((data) =>
    handleTerminalFocusInput(state.terminalState, data),
  );
  const writeEnable = options.writeEnable !== false;
  if (writeEnable) state.terminal.write(ENABLE_TERMINAL_FOCUS_REPORTING);

  return () => {
    disposeInputListener();
    if (writeEnable) state.terminal.write(DISABLE_TERMINAL_FOCUS_REPORTING);
    state.terminalState.focused = true;
  };
}

export function handleTerminalFocusInput(
  state: Pick<TerminalState, 'focused'>,
  data: string,
): { consume: true } | undefined {
  if (data === TERMINAL_FOCUS_IN) {
    state.focused = true;
    return { consume: true };
  }
  if (data === TERMINAL_FOCUS_OUT) {
    state.focused = false;
    return { consume: true };
  }
  return undefined;
}
