/**
 * Command Hub — One-search Command Surface (center modal).
 *
 * Status strip + contextual Now + fuzzy One-search (settings, slash, skills).
 * Space/Enter toggles modes in place; nested pickers stack with Esc back.
 */

export {
  commandHubKeepsOpen,
  commandHubNestsPicker,
  cyclePermissionMode,
  isCommandHubCycleId,
  isCommandHubToggleId,
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
