/**
 * `/term` — show what the TUI detected about the host terminal: color mode,
 * image protocol, and input features, with the env signals behind each so
 * users can see why a capability is on or off.
 */

import { TerminalDiagnosticsPanel } from '../components/messages/terminal-diagnostics-panel';
import { requestTUILayoutRender } from '../utils/frame-render';
import { collectTerminalDiagnostics } from '../utils/terminal-diagnostics';
import type { SlashCommandHost } from './dispatch';

export function showTerm(host: SlashCommandHost): void {
  const report = collectTerminalDiagnostics(process.env);
  const panel = new TerminalDiagnosticsPanel(report);
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
