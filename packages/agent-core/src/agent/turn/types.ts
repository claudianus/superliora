/**
 * Shared turn-flow types — extracted from TurnFlow.
 */

import type { ControlledPromise } from '@antfu/utils';

import type { LoopTurnStopReason } from '../../loop/index';
import type { TurnEndedEvent } from '../../rpc/events';

export interface TurnEndResult {
  readonly event: TurnEndedEvent;
  readonly stopReason?: LoopTurnStopReason;
  readonly blockedByUserPromptHook?: boolean;
}

export interface ActiveTurn {
  readonly turnId: number;
  readonly controller: AbortController;
  readonly promise: Promise<TurnEndResult>;
  readonly firstRequest: ControlledPromise;
}
