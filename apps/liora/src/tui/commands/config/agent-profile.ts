/**
 * `/profile` — main agent tool profile (Core≤12 waist opt-in).
 */

import {
  DEFAULT_MAIN_AGENT_PROFILE_NAME,
  KNOWN_MAIN_AGENT_PROFILE_NAMES,
  MAIN_AGENT_PROFILE_ENV,
  SOVEREIGN_CORE_DEFAULT_ENV,
  SOVEREIGN_CORE_PROFILE_NAME,
  SOVEREIGN_UMBRELLA_ENV,
  loadProfileLiveGlance,
} from '#/tui/utils/agent/profile-glance';
import { NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import { formatErrorMessage } from '../../utils/event-payload';
import { completeLeadingArg, type ArgCompletionSpec } from '../hub/complete-args';
import type { SlashCommandHost } from '../hub/dispatch';

/** User-facing Core waist opt-in hint (Mission/Fleet; not Ultra*). */
export const CORE_WAIST_TIP =
  'Core≤12 is the product waist (recommended: /profile core, /new). TaskGraph and wider orchestration: agent or superliora-full profiles.';

/** Compact /status Tools row hint (SSOT with CORE_WAIST_TIP). */
export const CORE_WAIST_STATUS_HINT = 'Core≤12 product waist · TaskGraph: agent/full';

/** W2 waist — Tools inventory footer (core.yaml SSOT; DeepResearch opt-in). */
export const TOOLS_WAIST_TIP =
  'Core≤12 waist includes ApplyPatch+RepoQuery; DeepResearch via agent/full profiles.';

/** Appended when SearchTools is registered — schema discovery without full dump. */
export const SEARCHTOOLS_SCHEMA_TIP = 'SearchTools dumps tool schemas mid-turn.';

/** Appended in Tools inventory when hide-legacy product default is active. */
export const HIDE_LEGACY_SOVEREIGN_TIP =
  'Legacy compat aliases hidden by default; opt out via SUPERLIORA_SHOW_LEGACY_TOOL_NAMES=1. Explicit profile selection keeps them.';

const PROFILE_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  {
    value: 'help',
    description: 'Terse usage — Core waist, SUPERLIORA_PROFILE, /new',
  },
  {
    value: 'status',
    description: 'Show active default profile and activation paths',
  },
  {
    value: SOVEREIGN_CORE_PROFILE_NAME,
    description: 'Sovereign Core waist — exactly 12 universal tools',
  },
  {
    value: DEFAULT_MAIN_AGENT_PROFILE_NAME,
    description: 'Default SuperLiora agent (wider orchestration surface)',
  },
  {
    value: 'superliora-full',
    description: 'Legacy full tool set (backwards compatible)',
  },
];

export function profileArgumentCompletions(args: string) {
  return completeLeadingArg(PROFILE_ARG_COMPLETIONS, args);
}

export async function handleProfileCommand(host: SlashCommandHost, args: string): Promise<void> {
  const trimmed = args.trim();
  const sub = trimmed.length === 0 ? 'status' : trimmed.split(/\s+/)[0]!.toLowerCase();

  if (sub === 'help') {
    showProfileHelp(host);
    return;
  }

  if (sub === 'status') {
    await showProfileStatus(host);
    return;
  }

  if (!KNOWN_MAIN_AGENT_PROFILE_NAMES.includes(sub as (typeof KNOWN_MAIN_AGENT_PROFILE_NAMES)[number])) {
    host.showError(
      `Unknown profile "${sub}". Try: ${KNOWN_MAIN_AGENT_PROFILE_NAMES.join(', ')}`,
    );
    return;
  }

  try {
    const config = await host.harness.getConfig();
    await host.harness.setConfig({
      agent: { ...config.agent, profile: sub },
    });
    const envHint =
      process.env[MAIN_AGENT_PROFILE_ENV] !== undefined
        ? `\nNote: ${MAIN_AGENT_PROFILE_ENV}=${process.env[MAIN_AGENT_PROFILE_ENV]} overrides config until unset.`
        : '';
    host.showNotice(
      `Default agent profile set to "${sub}" in config.\n` +
        `Start a fresh session with /new (or restart liora) to apply.${envHint}\n` +
        (sub === SOVEREIGN_CORE_PROFILE_NAME
          ? 'Core waist (≤12 tools) for Mission/Fleet — not Ultra*. /new to apply.'
          : ''),
    );
  } catch (error) {
    host.showError(`Failed to set agent profile: ${formatErrorMessage(error)}`);
  }
}

function showProfileHelp(host: SlashCommandHost): void {
  host.showNotice(
    [
      '/profile — main agent tool profile (persisted to config)',
      '',
      CORE_WAIST_TIP,
      '/profile status — effective profile, env override, bundled list',
    ].join('\n'),
  );
}

async function showProfileStatus(host: SlashCommandHost): Promise<void> {
  try {
    const config = await host.harness.getConfig();
    const configProfile = config.agent?.profile?.trim();
    const envProfile = process.env[MAIN_AGENT_PROFILE_ENV]?.trim();
    const profile = loadProfileLiveGlance({ configProfile });
    const sovereignFlag = process.env[SOVEREIGN_CORE_DEFAULT_ENV]?.trim();
    const sovereignUmbrella = process.env[SOVEREIGN_UMBRELLA_ENV]?.trim();

    const lines = [
      '── Agent tool profile ─────────────────────',
      `Effective default: ${profile.effectiveProfile}`,
      configProfile ? `Config (agent.profile): ${configProfile}` : 'Config (agent.profile): (default core)',
      envProfile ? `Env (${MAIN_AGENT_PROFILE_ENV}): ${envProfile}` : `Env (${MAIN_AGENT_PROFILE_ENV}): (unset)`,
      sovereignFlag
        ? `Env (${SOVEREIGN_CORE_DEFAULT_ENV}): ${sovereignFlag}`
        : `Env (${SOVEREIGN_CORE_DEFAULT_ENV}): (unset)`,
      sovereignUmbrella
        ? `Env (${SOVEREIGN_UMBRELLA_ENV}): ${sovereignUmbrella}`
        : `Env (${SOVEREIGN_UMBRELLA_ENV}): (unset)`,
      '',
      'Core≤12 is the default product waist; TaskGraph and wider orchestration via agent or superliora-full.',
      'Wide waist opt-out: SUPERLIORA_PROFILE=agent or agent.profile = "agent".',
      '',
      'Core waist (Sovereign Core ≤12 tools) — Mission/Fleet; not Ultra*:',
      `  (default) unset profile → ${SOVEREIGN_CORE_PROFILE_NAME}`,
      `  ${MAIN_AGENT_PROFILE_ENV}=${DEFAULT_MAIN_AGENT_PROFILE_NAME} liora  (wide waist)`,
      `  ${SOVEREIGN_CORE_DEFAULT_ENV}=1 / ${SOVEREIGN_UMBRELLA_ENV}=1  (other sovereign soft gates)`,
      '  config.toml → [agent] profile = "core"',
      '  /profile core  (persists config; /new to apply)',
      '',
      'Bundled profiles:',
      ...KNOWN_MAIN_AGENT_PROFILE_NAMES.map((name) => {
        const tag =
          name === SOVEREIGN_CORE_PROFILE_NAME
            ? ' — default Sovereign Core waist (12 tools)'
            : name === DEFAULT_MAIN_AGENT_PROFILE_NAME
              ? ' — wide waist'
              : '';
        return `  ${name}${tag}`;
      }),
    ];

    const session = host.session;
    if (session !== undefined && typeof session.getTools === 'function') {
      try {
        const tools = await session.getTools();
        const active = tools.filter((tool) => tool.active).length;
        lines.push('', `This session: ${String(active)} active tools registered.`);
      } catch {
        lines.push('', 'This session: tools inventory unavailable.');
      }
    } else if (session === undefined) {
      lines.push('', `This session: ${NO_ACTIVE_SESSION_MESSAGE}`);
    }

    host.showNotice(lines.join('\n'));
  } catch (error) {
    host.showError(`Failed to read agent profile: ${formatErrorMessage(error)}`);
  }
}
