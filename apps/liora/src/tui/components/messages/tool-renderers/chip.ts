/**
 * Header chip providers — produce a short "stat" suffix appended to the
 * tool call header once a result has arrived. Chips own the *numeric*
 * summary (line counts, exit codes, byte sizes), so summary renderers
 * below don't repeat them.
 *
 * A chip returning `''` is suppressed; tools without an entry in the
 * registry get no chip at all.
 */

export type { ChipProvider, EditStats, WriteStats } from './chip-format';
export {
  countNonEmptyLines,
  computeEditStats,
  computeWriteStats,
  formatEditChip,
  formatWriteChip,
} from './chip-format';

import { goalStatusChip } from './goal';
import type { ChipProvider } from './chip-format';
import { CHIP_PROVIDERS } from './chip-providers';

const goalStatusOutputChip: ChipProvider = (_toolCall, result) =>
  result.is_error ? '' : goalStatusChip(result.output);

const REGISTRY: Record<string, ChipProvider> = {
  ...CHIP_PROVIDERS,
  CreateGoal: goalStatusOutputChip,
  GetGoal: goalStatusOutputChip,
};

export function pickChip(toolName: string): ChipProvider | undefined {
  return REGISTRY[toolName];
}
