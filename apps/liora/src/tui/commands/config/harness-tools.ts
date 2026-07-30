import {
  formatHarnessEyesReadiness,
  loadHarnessEyesReadiness,
} from '#/tui/utils/harness-eyes-readiness';
import { getHostPackageRoot } from '#/cli/version';
import { NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import { formatErrorMessage } from '../../utils/event-payload';
import type { SlashCommandHost } from '../dispatch';

/** List active tools for the current session (TUI eyes for the tool surface). */
export async function showToolsInventory(host: SlashCommandHost): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  if (typeof session.getTools !== 'function') {
    host.showError('Tools inventory is not available on this session.');
    return;
  }
  try {
    const tools = await session.getTools();
    const active = tools.filter((tool) => tool.active);
    const inactive = tools.filter((tool) => !tool.active);
    const bySource = (list: typeof tools) => {
      const m = new Map<string, number>();
      for (const tool of list) {
        m.set(tool.source, (m.get(tool.source) ?? 0) + 1);
      }
      return [...m.entries()].map(([k, v]) => `${k}:${String(v)}`).join(' · ') || 'none';
    };
    const lines: string[] = [
      `Tools: ${String(active.length)} active / ${String(tools.length)} registered (${bySource(tools)})`,
      '',
      'Active:',
    ];
    const sorted = [...active].sort((a, b) => a.name.localeCompare(b.name));
    const cap = 48;
    for (const tool of sorted.slice(0, cap)) {
      const desc = tool.description.replace(/\s+/g, ' ').trim();
      const short = desc.length > 72 ? `${desc.slice(0, 69)}…` : desc;
      lines.push(`  ${tool.name}  [${tool.source}]  ${short}`);
    }
    if (sorted.length > cap) {
      lines.push(`  … +${String(sorted.length - cap)} more active`);
    }
    if (inactive.length > 0) {
      lines.push('', `Inactive (${String(inactive.length)}): ${inactive.map((t) => t.name).sort().slice(0, 24).join(', ')}${inactive.length > 24 ? '…' : ''}`);
    }
    lines.push('', 'Tip: agent can call SearchTools for the same inventory mid-turn.');
    host.showNotice(lines.join('\n'));
  } catch (error) {
    host.showError(`Failed to load tools: ${formatErrorMessage(error)}`);
  }
}

/** Browser-use / computer-use runtime readiness (Harness eyes). */
export async function showHarnessEyesReadiness(host: SlashCommandHost): Promise<void> {
  try {
    const report = await loadHarnessEyesReadiness({ packageRoot: getHostPackageRoot() });
    host.showNotice(formatHarnessEyesReadiness(report));
  } catch (error) {
    host.showError(`Failed to load eyes readiness: ${formatErrorMessage(error)}`);
  }
}
