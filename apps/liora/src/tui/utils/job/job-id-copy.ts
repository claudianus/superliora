/**
 * Short job id for clipboard / status (Job Deck `c`).
 */

import { shortJobId } from '../../components/job-board/job-board-helpers';

/** Clipboard payload for a selected Conductor job. */
export function shortJobIdForCopy(jobId: string): string {
  return shortJobId(jobId);
}
