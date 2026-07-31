/**
 * W5 mission contract soft stub — TUI-facing re-exports from ultrawork-contract.
 * Implementation stays in commands/ultrawork/ until hard rename (W5 cutover).
 */

export type {
  ParsedUltraworkCommand,
  UltraworkActivationSource,
  UltraworkCreateRequest,
  UltraworkEvidenceSeed,
  UltraworkPromptCapabilities,
  UltraworkPromptOptions,
} from '#/tui/commands/ultrawork/ultrawork-contract';

export {
  buildUltraworkPrompt,
  detectUltraworkPromptCapabilities,
  isActiveUltraworkRun,
  parseUltraworkCommand,
  ultraworkModeDisableBlockedMessage,
} from '#/tui/commands/ultrawork/ultrawork-contract';

/** Mission-named aliases — same implementation until W5 hard rename. */
export type { UltraworkActivationSource as MissionActivationSource } from '#/tui/commands/ultrawork/ultrawork-contract';
export type { ParsedUltraworkCommand as ParsedMissionCommand } from '#/tui/commands/ultrawork/ultrawork-contract';
export type { UltraworkEvidenceSeed as MissionEvidenceSeed } from '#/tui/commands/ultrawork/ultrawork-contract';

export { buildUltraworkPrompt as buildMissionPrompt } from '#/tui/commands/ultrawork/ultrawork-contract';
export { isActiveUltraworkRun as isActiveMissionRun } from '#/tui/commands/ultrawork/ultrawork-contract';
export { parseUltraworkCommand as parseMissionCommand } from '#/tui/commands/ultrawork/ultrawork-contract';
export { ultraworkModeDisableBlockedMessage as missionModeDisableBlockedMessage } from '#/tui/commands/ultrawork/ultrawork-contract';

export const MISSION_CONTRACT_STUB_TIP =
  'W5 soft path: cross-module Mission wiring imports #/tui/utils/mission/mission-contract (ultrawork-contract stays on disk).';
