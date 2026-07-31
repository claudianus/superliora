import {
  filterToolsForPrimaryHelp,
  listHiddenCompatAliases,
} from '#/tui/utils/tool/tool-help-filter';
import { loadProfileLiveGlance } from '#/tui/utils/agent/profile-glance';
import {
  buildToolsSessionLiveLines,
  isHideLegacyToolNamesEnabled,
  resolveHideLegacyToolsGlance,
} from '#/tui/utils/tool/tools-glance';
import { NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import { formatErrorMessage } from '../../utils/event-payload';
import type { SlashCommandHost } from '../hub/dispatch';
import { SEARCHTOOLS_SCHEMA_TIP, TOOLS_WAIST_TIP } from './agent-profile';

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
    let configProfile: string | undefined;
    try {
      const config = await host.harness.getConfig();
      configProfile = config.agent?.profile?.trim();
    } catch {
      /* profile glance falls back to env-only resolution */
    }
    const profile = loadProfileLiveGlance({ configProfile });
    const tools = await session.getTools();
    const active = tools.filter((tool) => tool.active);
    const inactive = tools.filter((tool) => !tool.active);
    const publicActive = filterToolsForPrimaryHelp(active);
    const publicInactive = filterToolsForPrimaryHelp(inactive);
    const hiddenCompat = listHiddenCompatAliases(tools);
    const hideLegacy = resolveHideLegacyToolsGlance({ hiddenCompatAliases: hiddenCompat });
    const bySource = (list: typeof tools) => {
      const m = new Map<string, number>();
      for (const tool of list) {
        m.set(tool.source, (m.get(tool.source) ?? 0) + 1);
      }
      return [...m.entries()].map(([k, v]) => `${k}:${String(v)}`).join(' · ') || 'none';
    };
    const lines: string[] = [
      ...buildToolsSessionLiveLines({
        activeCount: publicActive.length,
        registeredCount: tools.length,
        hideLegacy,
        profile,
      }),
      `Sources: ${bySource(tools)}`,
      '',
      'Active:',
    ];
    const sorted = [...publicActive].sort((a, b) => a.name.localeCompare(b.name));
    const cap = 48;
    for (const tool of sorted.slice(0, cap)) {
      const desc = tool.description.replace(/\s+/g, ' ').trim();
      const short = desc.length > 72 ? `${desc.slice(0, 69)}…` : desc;
      lines.push(`  ${tool.name}  [${tool.source}]  ${short}`);
    }
    if (sorted.length > cap) {
      lines.push(`  … +${String(sorted.length - cap)} more active`);
    }
    if (publicInactive.length > 0) {
      lines.push(
        '',
        `Inactive (${String(publicInactive.length)}): ${publicInactive.map((t) => t.name).sort().slice(0, 24).join(', ')}${publicInactive.length > 24 ? '…' : ''}`,
      );
    }
    if (hiddenCompat.length > 0) {
      lines.push(
        '',
        `Compat aliases hidden (${String(hiddenCompat.length)}): ${hiddenCompat.join(', ')}`,
        'SearchTools query finds compat names when needed.',
      );
    }
    const tipParts = [TOOLS_WAIST_TIP];
    if (!isHideLegacyToolNamesEnabled()) {
      tipParts.push(
        'Legacy compat aliases register (SUPERLIORA_SHOW_LEGACY_TOOL_NAMES=1).',
      );
    }
    if (tools.some((tool) => tool.name === 'SearchTools')) {
      tipParts.push(SEARCHTOOLS_SCHEMA_TIP);
    }
    lines.push('', `Tip: ${tipParts.join(' ')}`);
    host.showNotice(lines.join('\n'));
  } catch (error) {
    host.showError(`Failed to load tools: ${formatErrorMessage(error)}`);
  }
}
