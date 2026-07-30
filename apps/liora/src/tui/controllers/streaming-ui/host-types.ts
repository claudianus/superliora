import type { Session } from '@superliora/sdk';

import type { MotionBeatController } from '../../utils/render/motion-beats';
import type {
  AppState,
  LivePaneState,
  QueuedMessage,
  TranscriptEntry,
} from '../../types';
import type { TUIState } from '../../tui-state';

export interface StreamingUIHost {
  state: TUIState;
  session: Session | undefined;
  readonly motionBeats: MotionBeatController;
  setAppState(patch: Partial<AppState>): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  resetLivePane(): void;
  updateActivityPane(): void;
  updateQueueDisplay(): void;
  requireSession(): Session;
  deferUserMessages: boolean;
  shiftQueuedMessage(): QueuedMessage | undefined;
  pushTranscriptEntry(entry: TranscriptEntry): void;
  mergeCurrentTurnSteps(): void;
}
