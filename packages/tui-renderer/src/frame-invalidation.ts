import { FrameInvalidationStats } from './frame-stats';

export type FrameInvalidationSource =
  | 'input'
  | 'stream'
  | 'animation'
  | 'layout'
  | 'resize'
  | 'state';

export type FrameInvalidationPriority = 'ambient' | 'normal' | 'interactive';

export interface FrameInvalidationRequest {
  readonly source: FrameInvalidationSource;
  readonly requiresLayout?: boolean;
  readonly priority?: FrameInvalidationPriority;
}

export interface FrameInvalidation {
  readonly frame: number;
  readonly sourceMask: number;
  readonly requestCount: number;
  readonly requiresLayout: boolean;
  readonly priority: FrameInvalidationPriority;
}

export type FrameInvalidationCancel = () => void;
export type FrameInvalidationSchedule = (
  flush: () => void,
) => FrameInvalidationCancel | undefined;

export interface FrameInvalidationCoordinatorOptions {
  /**
   * Arms one host-owned frame callback. Tests can inject a queue; production
   * hosts should bridge this to their existing render loop or ticker.
   */
  readonly schedule: FrameInvalidationSchedule;
  readonly layout: (invalidation: FrameInvalidation) => void;
  readonly render: (invalidation: FrameInvalidation) => void;
  readonly present: (invalidation: FrameInvalidation) => void;
  readonly stats?: FrameInvalidationStats;
}

const SOURCE_MASKS: Readonly<Record<FrameInvalidationSource, number>> = {
  input: 1,
  stream: 1 << 1,
  animation: 1 << 2,
  layout: 1 << 3,
  resize: 1 << 4,
  state: 1 << 5,
};

const PRIORITY_RANKS: Readonly<Record<FrameInvalidationPriority, number>> = {
  ambient: 0,
  normal: 1,
  interactive: 2,
};

const PRIORITIES: readonly FrameInvalidationPriority[] = [
  'ambient',
  'normal',
  'interactive',
];

export class FrameInvalidationCoordinator {
  readonly stats: FrameInvalidationStats;

  private readonly schedule: FrameInvalidationSchedule;
  private readonly layout: (invalidation: FrameInvalidation) => void;
  private readonly render: (invalidation: FrameInvalidation) => void;
  private readonly present: (invalidation: FrameInvalidation) => void;
  private readonly runScheduledFlush = () => {
    this.flushPendingFrame();
  };

  private pendingSourceMask = 0;
  private pendingRequestCount = 0;
  private pendingRequiresLayout = false;
  private pendingPriorityRank = 0;
  private cancelScheduledFlush: FrameInvalidationCancel | undefined;
  private frame = 0;
  private scheduled = false;
  private flushing = false;
  private disposed = false;

  constructor(options: FrameInvalidationCoordinatorOptions) {
    this.schedule = options.schedule;
    this.layout = options.layout;
    this.render = options.render;
    this.present = options.present;
    this.stats = options.stats ?? new FrameInvalidationStats();
  }

  get hasPendingFrame(): boolean {
    return this.pendingRequestCount > 0 || this.scheduled || this.flushing;
  }

  request(request: FrameInvalidationRequest): void {
    if (this.disposed) return;

    const coalesced = this.pendingRequestCount > 0;
    this.stats.recordRequest(coalesced);
    this.pendingSourceMask |= SOURCE_MASKS[request.source];
    this.pendingRequestCount++;
    this.pendingRequiresLayout ||=
      request.requiresLayout ?? defaultRequiresLayout(request.source);
    this.pendingPriorityRank = Math.max(
      this.pendingPriorityRank,
      PRIORITY_RANKS[request.priority ?? defaultPriority(request.source)],
    );

    if (!this.flushing && !this.scheduled) this.schedulePendingFrame();
  }

  cancelPending(): void {
    this.cancelScheduledFlush?.();
    this.cancelScheduledFlush = undefined;
    this.scheduled = false;
    this.clearPending();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending();
  }

  private schedulePendingFrame(): void {
    this.scheduled = true;
    const cancel = this.schedule(this.runScheduledFlush);
    if (this.scheduled) this.cancelScheduledFlush = cancel;
  }

  private flushPendingFrame(): void {
    if (this.disposed || this.flushing) return;
    this.scheduled = false;
    this.cancelScheduledFlush = undefined;
    if (this.pendingRequestCount === 0) return;

    const invalidation: FrameInvalidation = {
      frame: this.frame++,
      sourceMask: this.pendingSourceMask,
      requestCount: this.pendingRequestCount,
      requiresLayout: this.pendingRequiresLayout,
      priority: PRIORITIES[this.pendingPriorityRank] ?? 'ambient',
    };
    this.clearPending();
    this.flushing = true;
    this.stats.recordFlush();

    try {
      if (invalidation.requiresLayout) {
        this.stats.recordLayout();
        this.layout(invalidation);
      }
      this.stats.recordRender();
      this.render(invalidation);
      this.stats.recordPresent();
      this.present(invalidation);
    } finally {
      this.flushing = false;
      if (!this.disposed && this.pendingRequestCount > 0 && !this.scheduled) {
        this.schedulePendingFrame();
      }
    }
  }

  private clearPending(): void {
    this.pendingSourceMask = 0;
    this.pendingRequestCount = 0;
    this.pendingRequiresLayout = false;
    this.pendingPriorityRank = 0;
  }
}

export function frameInvalidationIncludes(
  invalidation: FrameInvalidation,
  source: FrameInvalidationSource,
): boolean {
  return (invalidation.sourceMask & SOURCE_MASKS[source]) !== 0;
}

function defaultRequiresLayout(source: FrameInvalidationSource): boolean {
  return source === 'layout' || source === 'resize';
}

function defaultPriority(source: FrameInvalidationSource): FrameInvalidationPriority {
  if (source === 'input' || source === 'resize') return 'interactive';
  if (source === 'animation') return 'ambient';
  return 'normal';
}
