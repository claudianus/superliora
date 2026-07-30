/**
 * Command Hub — beginner home dashboard (center modal).
 *
 * Status strip + contextual Now + Spotlight search (recency-weighted).
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
