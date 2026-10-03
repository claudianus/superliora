/**
 * Command Hub — One-search Command Surface (center modal).
 *
 * Status strip + contextual Now + searchable settings and slash commands.
 * Space/Enter toggles modes in place; nested pickers stack with Esc back.
 */

export {
  commandHubNestsPicker,
  cyclePermissionMode,
  cycleTranscriptRegionMode,
  isCommandHubCycleId,
} from './command-hub-behavior';
export { CommandHubComponent } from './command-hub-component';
export { buildDefaultCommandHubItems } from './command-hub-items';
export type {
  CommandHubActionId,
  CommandHubItem,
  CommandHubItemKind,
  CommandHubOptions,
  CommandHubSelectMode,
} from './command-hub-types';
