/**
 * User-facing product name for the in-stage worker monitor band.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export function workerDockProductName(): string {
  return ttui('tui.workerDock.workerDock');
}

/**
 * Short recorded Job-kind provenance for dock rows hydrated from the ledger.
 */
export function workerLedgerChip(
  worker: { readonly ledger?: { readonly kind: string } | undefined },
): string | undefined {
  return worker.ledger?.kind;
}
