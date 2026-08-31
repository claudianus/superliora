/**
 * User-facing product name for the in-stage worker monitor band.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export function workerDockProductName(): string {
  return ttui('tui.workerDock.workerDock');
}

/**
 * Short provenance chip for ghost rows seeded from the Job ledger. Only goal
 * lanes get one — a goal-desk umbrella has no worker behind it, so the row
 * must not read like a generic worker.
 */
export function workerLedgerChip(
  worker: { readonly ledger?: { readonly kind: string } | undefined },
): string | undefined {
  switch (worker.ledger?.kind) {
    case 'goal-desk':
      return 'desk';
    case 'goal-driver':
      return 'driver';
    default:
      return undefined;
  }
}
