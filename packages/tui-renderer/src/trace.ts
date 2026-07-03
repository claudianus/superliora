export type RendererTraceEventKind = 'frame' | 'resize' | 'input' | 'marker';

export type RendererChromeTracePhase = 'X' | 'I' | 'C' | 'M';

export interface RendererTraceRecorderOptions {
  readonly enabled?: boolean;
  readonly maxEvents?: number;
}

export interface RendererTraceSize {
  readonly columns: number;
  readonly rows: number;
}

export interface RendererTraceFrameMetrics {
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly targetFrameMs: number;
  readonly overBudget: boolean;
  readonly renderCallbackDurationMs: number;
  readonly presentDurationMs: number;
  readonly diffDurationMs: number;
  readonly encodeDurationMs: number;
  readonly writeDurationMs: number;
  readonly qualityDurationMs: number;
  readonly outputBytes: number;
  readonly outputBackpressure: boolean;
  readonly outputCells: number;
  readonly outputRuns: number;
  readonly outputBridgedCells: number;
  readonly outputBridgedCellRatio: number;
  readonly cursorAbsoluteMoves: number;
  readonly cursorRelativeMoves: number;
  readonly cursorHorizontalAbsoluteMoves: number;
  readonly cursorMoveBytes: number;
  readonly cursorMoveAbsoluteBytes: number;
  readonly cursorMoveSavedBytes: number;
  readonly outputMode: string;
  readonly outputSynchronized: boolean;
  readonly outputLargeFrame: boolean;
  readonly outputPolicyReason: string;
  readonly outputEraseLine: boolean;
  readonly changedCells: number;
  readonly scannedCells: number;
  readonly scannedRows: number;
  readonly dirtyRows: number;
  readonly totalCells: number;
  readonly scanStrategy: string;
  readonly scanRatio: number;
  readonly damageCells: number;
  readonly damageRatio: number;
  readonly compositionRowsVisited: number;
  readonly compositionRowsComposed: number;
  readonly compositionRowsReused: number;
  readonly compositionReuseRatio: number;
  readonly lineCacheHits: number;
  readonly lineCacheMisses: number;
  readonly lineCacheHitRatio: number;
  readonly lineCacheEvictions: number;
}

export interface RendererTraceInputData {
  readonly type: string;
  readonly key?: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly button?: string;
  readonly action?: string;
  readonly x?: number;
  readonly y?: number;
}

interface RendererTraceBaseEvent {
  readonly sequence: number;
  readonly kind: RendererTraceEventKind;
  readonly timestampMs: number;
}

export interface RendererTraceFrameEvent extends RendererTraceBaseEvent {
  readonly kind: 'frame';
  readonly frameIndex: number;
  readonly causes: readonly string[];
  readonly size: RendererTraceSize;
  readonly health?: string;
  readonly qualityLevel: string;
  readonly metrics: RendererTraceFrameMetrics;
}

export interface RendererTraceResizeEvent extends RendererTraceBaseEvent {
  readonly kind: 'resize';
  readonly size: RendererTraceSize;
}

export interface RendererTraceInputEvent extends RendererTraceBaseEvent {
  readonly kind: 'input';
  readonly input: RendererTraceInputData;
}

export interface RendererTraceMarkerEvent extends RendererTraceBaseEvent {
  readonly kind: 'marker';
  readonly name: string;
  readonly args?: Record<string, unknown>;
}

export type RendererTraceEvent =
  | RendererTraceFrameEvent
  | RendererTraceResizeEvent
  | RendererTraceInputEvent
  | RendererTraceMarkerEvent;

export interface RendererTraceFrameRecord {
  readonly frameIndex: number;
  readonly causes: readonly string[];
  readonly size: RendererTraceSize;
  readonly health?: string;
  readonly qualityLevel: string;
  readonly metrics: RendererTraceFrameMetrics;
}

export interface RendererTraceResizeRecord {
  readonly timestampMs: number;
  readonly size: RendererTraceSize;
}

export interface RendererTraceInputRecord {
  readonly timestampMs: number;
  readonly input: RendererTraceInputData;
}

export interface RendererTraceMarkerRecord {
  readonly timestampMs: number;
  readonly name: string;
  readonly args?: Record<string, unknown>;
}

export interface RendererTraceSnapshot {
  readonly enabled: boolean;
  readonly maxEvents: number;
  readonly events: readonly RendererTraceEvent[];
  readonly eventCount: number;
  readonly totalEvents: number;
  readonly droppedEvents: number;
  readonly startedAtMs?: number;
  readonly endedAtMs?: number;
}

export interface RendererChromeTraceEvent {
  readonly name: string;
  readonly cat: string;
  readonly ph: RendererChromeTracePhase;
  readonly ts: number;
  readonly pid: number;
  readonly tid: number;
  readonly dur?: number;
  readonly s?: 't' | 'p' | 'g';
  readonly args?: Record<string, unknown>;
}

export interface RendererChromeTraceFile {
  readonly traceEvents: readonly RendererChromeTraceEvent[];
  readonly displayTimeUnit: 'ms';
  readonly metadata: {
    readonly source: 'tui-renderer';
    readonly eventCount: number;
    readonly droppedEvents: number;
  };
}

export interface RendererChromeTraceOptions {
  readonly processId?: number;
  readonly processName?: string;
  readonly rendererThreadName?: string;
}

const DEFAULT_TRACE_MAX_EVENTS = 1_000;
const MIN_TRACE_MAX_EVENTS = 0;
const MAX_TRACE_MAX_EVENTS = 100_000;
const RENDERER_TID = 1;
const PHASE_TID = 2;
const COUNTER_TID = 3;
const INPUT_TID = 4;

export class RendererTraceRecorder {
  private readonly maxEventCount: number;
  private readonly eventBuffer: Array<RendererTraceEvent | undefined>;
  private startIndex = 0;
  private eventSize = 0;
  private nextSequence = 0;
  private totalEventCount = 0;
  private droppedEventCount = 0;
  private firstTimestampMs: number | undefined;
  private lastTimestampMs: number | undefined;

  constructor(private readonly options: RendererTraceRecorderOptions = {}) {
    this.maxEventCount = normalizeTraceMaxEvents(options.maxEvents);
    this.eventBuffer = Array.from<RendererTraceEvent | undefined>({
      length: this.maxEventCount,
    });
  }

  get enabled(): boolean {
    return this.options.enabled !== false;
  }

  get maxEvents(): number {
    return this.maxEventCount;
  }

  get size(): number {
    return this.eventSize;
  }

  recordFrame(record: RendererTraceFrameRecord): RendererTraceFrameEvent | undefined {
    return this.record({
      sequence: this.nextSequence,
      kind: 'frame',
      timestampMs: record.metrics.startedAt,
      frameIndex: record.frameIndex,
      causes: [...record.causes],
      size: record.size,
      health: record.health,
      qualityLevel: record.qualityLevel,
      metrics: record.metrics,
    });
  }

  recordResize(record: RendererTraceResizeRecord): RendererTraceResizeEvent | undefined {
    return this.record({
      sequence: this.nextSequence,
      kind: 'resize',
      timestampMs: record.timestampMs,
      size: record.size,
    });
  }

  recordInput(record: RendererTraceInputRecord): RendererTraceInputEvent | undefined {
    return this.record({
      sequence: this.nextSequence,
      kind: 'input',
      timestampMs: record.timestampMs,
      input: record.input,
    });
  }

  recordMarker(record: RendererTraceMarkerRecord): RendererTraceMarkerEvent | undefined {
    return this.record({
      sequence: this.nextSequence,
      kind: 'marker',
      timestampMs: record.timestampMs,
      name: record.name,
      args: record.args,
    });
  }

  reset(): void {
    this.eventBuffer.fill(undefined);
    this.startIndex = 0;
    this.eventSize = 0;
    this.nextSequence = 0;
    this.totalEventCount = 0;
    this.droppedEventCount = 0;
    this.firstTimestampMs = undefined;
    this.lastTimestampMs = undefined;
  }

  snapshot(): RendererTraceSnapshot {
    return {
      enabled: this.enabled,
      maxEvents: this.maxEventCount,
      events: this.events(),
      eventCount: this.eventSize,
      totalEvents: this.totalEventCount,
      droppedEvents: this.droppedEventCount,
      startedAtMs: this.firstTimestampMs,
      endedAtMs: this.lastTimestampMs,
    };
  }

  toChromeTraceFile(options: RendererChromeTraceOptions = {}): RendererChromeTraceFile {
    return rendererTraceSnapshotToChromeTraceFile(this.snapshot(), options);
  }

  private record<T extends RendererTraceEvent>(event: T): T | undefined {
    if (!this.enabled) return undefined;
    this.nextSequence++;
    this.totalEventCount++;
    this.firstTimestampMs ??= event.timestampMs;
    this.lastTimestampMs = traceEventEndTimestampMs(event);
    if (this.maxEventCount === 0) {
      this.droppedEventCount++;
      return event;
    }

    if (this.eventSize < this.maxEventCount) {
      this.eventBuffer[(this.startIndex + this.eventSize) % this.maxEventCount] = event;
      this.eventSize++;
      return event;
    }

    this.eventBuffer[this.startIndex] = event;
    this.startIndex = (this.startIndex + 1) % this.maxEventCount;
    this.droppedEventCount++;
    return event;
  }

  private events(): RendererTraceEvent[] {
    return Array.from({ length: this.eventSize }, (_, index) =>
      this.eventBuffer[(this.startIndex + index) % this.maxEventCount]!,
    );
  }
}

export function rendererTraceSnapshotToChromeTraceFile(
  snapshot: RendererTraceSnapshot,
  options: RendererChromeTraceOptions = {},
): RendererChromeTraceFile {
  const pid = normalizeProcessId(options.processId);
  const traceEvents: RendererChromeTraceEvent[] = [
    metadataEvent(pid, RENDERER_TID, 'process_name', options.processName ?? 'tui-renderer'),
    metadataEvent(pid, RENDERER_TID, 'thread_name', options.rendererThreadName ?? 'renderer'),
    metadataEvent(pid, PHASE_TID, 'thread_name', 'renderer phases'),
    metadataEvent(pid, COUNTER_TID, 'thread_name', 'renderer counters'),
    metadataEvent(pid, INPUT_TID, 'thread_name', 'renderer input'),
  ];

  for (const event of snapshot.events) {
    traceEvents.push(...rendererTraceEventToChromeTraceEvents(event, pid));
  }

  return {
    traceEvents,
    displayTimeUnit: 'ms',
    metadata: {
      source: 'tui-renderer',
      eventCount: snapshot.eventCount,
      droppedEvents: snapshot.droppedEvents,
    },
  };
}

function rendererTraceEventToChromeTraceEvents(
  event: RendererTraceEvent,
  pid: number,
): RendererChromeTraceEvent[] {
  switch (event.kind) {
    case 'frame':
      return frameEventToChromeTraceEvents(event, pid);
    case 'resize':
      return [
        instantEvent(pid, RENDERER_TID, 'renderer', 'resize', event.timestampMs, {
          columns: event.size.columns,
          rows: event.size.rows,
        }),
      ];
    case 'input':
      return [
        instantEvent(pid, INPUT_TID, 'renderer.input', inputTraceName(event.input), event.timestampMs, {
          ...event.input,
        }),
      ];
    case 'marker':
      return [instantEvent(pid, RENDERER_TID, 'renderer', event.name, event.timestampMs, event.args)];
  }
}

function frameEventToChromeTraceEvents(
  event: RendererTraceFrameEvent,
  pid: number,
): RendererChromeTraceEvent[] {
  const metrics = event.metrics;
  const start = metrics.startedAt;
  const presentStart = start + metrics.renderCallbackDurationMs;
  const qualityStart = metrics.endedAt;
  const changedCellRatio = ratio(metrics.changedCells, metrics.totalCells);
  const frameBudgetRatio = ratio(metrics.durationMs, metrics.targetFrameMs);
  const events: RendererChromeTraceEvent[] = [
    completeEvent(pid, RENDERER_TID, 'renderer', 'frame', start, metrics.durationMs, {
      frame: event.frameIndex,
      causes: event.causes.join(','),
      columns: event.size.columns,
      rows: event.size.rows,
      health: event.health,
      quality: event.qualityLevel,
      overBudget: metrics.overBudget,
      targetFrameMs: metrics.targetFrameMs,
      outputBytes: metrics.outputBytes,
      outputBackpressure: metrics.outputBackpressure,
      outputCells: metrics.outputCells,
      outputRuns: metrics.outputRuns,
      outputBridgedCells: metrics.outputBridgedCells,
      outputBridgedCellRatio: metrics.outputBridgedCellRatio,
      cursorAbsoluteMoves: metrics.cursorAbsoluteMoves,
      cursorRelativeMoves: metrics.cursorRelativeMoves,
      cursorHorizontalAbsoluteMoves: metrics.cursorHorizontalAbsoluteMoves,
      cursorMoveBytes: metrics.cursorMoveBytes,
      cursorMoveAbsoluteBytes: metrics.cursorMoveAbsoluteBytes,
      cursorMoveSavedBytes: metrics.cursorMoveSavedBytes,
      outputMode: metrics.outputMode,
      outputSynchronized: metrics.outputSynchronized,
      outputLargeFrame: metrics.outputLargeFrame,
      outputPolicyReason: metrics.outputPolicyReason,
      outputEraseLine: metrics.outputEraseLine,
      changedCells: metrics.changedCells,
      scanStrategy: metrics.scanStrategy,
      scanRatio: metrics.scanRatio,
      damageRatio: metrics.damageRatio,
      compositionReuseRatio: metrics.compositionReuseRatio,
      lineCacheHitRatio: metrics.lineCacheHitRatio,
    }),
    completeEvent(pid, PHASE_TID, 'renderer.phase', 'render', start, metrics.renderCallbackDurationMs),
    completeEvent(pid, PHASE_TID, 'renderer.phase', 'present', presentStart, metrics.presentDurationMs),
    completeEvent(pid, PHASE_TID, 'renderer.phase', 'diff', presentStart, metrics.diffDurationMs),
    completeEvent(
      pid,
      PHASE_TID,
      'renderer.phase',
      'encode',
      presentStart + metrics.diffDurationMs,
      metrics.encodeDurationMs,
    ),
    completeEvent(
      pid,
      PHASE_TID,
      'renderer.phase',
      'write',
      presentStart + metrics.diffDurationMs + metrics.encodeDurationMs,
      metrics.writeDurationMs,
    ),
    completeEvent(pid, PHASE_TID, 'renderer.phase', 'quality', qualityStart, metrics.qualityDurationMs),
    counterEvent(pid, COUNTER_TID, 'renderer.counter', 'frame budget ratio', start, {
      ratio: frameBudgetRatio,
    }),
    counterEvent(pid, COUNTER_TID, 'renderer.counter', 'output bytes', start, {
      bytes: metrics.outputBytes,
    }),
    counterEvent(pid, COUNTER_TID, 'renderer.counter', 'output runs', start, {
      runs: metrics.outputRuns,
    }),
    counterEvent(pid, COUNTER_TID, 'renderer.counter', 'bridged cells', start, {
      cells: metrics.outputBridgedCells,
      ratio: metrics.outputBridgedCellRatio,
    }),
    counterEvent(pid, COUNTER_TID, 'renderer.counter', 'cursor move bytes', start, {
      bytes: metrics.cursorMoveBytes,
      saved: metrics.cursorMoveSavedBytes,
      absoluteBytes: metrics.cursorMoveAbsoluteBytes,
    }),
    counterEvent(pid, COUNTER_TID, 'renderer.counter', 'changed cell ratio', start, {
      ratio: changedCellRatio,
    }),
  ];

  return events.filter((traceEvent) => traceEvent.ph !== 'X' || (traceEvent.dur ?? 0) > 0);
}

function metadataEvent(
  pid: number,
  tid: number,
  name: 'process_name' | 'thread_name',
  value: string,
): RendererChromeTraceEvent {
  return {
    name,
    cat: '__metadata',
    ph: 'M',
    ts: 0,
    pid,
    tid,
    args: { name: value },
  };
}

function completeEvent(
  pid: number,
  tid: number,
  cat: string,
  name: string,
  timestampMs: number,
  durationMs: number,
  args?: Record<string, unknown>,
): RendererChromeTraceEvent {
  return {
    name,
    cat,
    ph: 'X',
    ts: msToUs(timestampMs),
    pid,
    tid,
    dur: msToUs(durationMs),
    args,
  };
}

function instantEvent(
  pid: number,
  tid: number,
  cat: string,
  name: string,
  timestampMs: number,
  args?: Record<string, unknown>,
): RendererChromeTraceEvent {
  return {
    name,
    cat,
    ph: 'I',
    s: 't',
    ts: msToUs(timestampMs),
    pid,
    tid,
    args,
  };
}

function counterEvent(
  pid: number,
  tid: number,
  cat: string,
  name: string,
  timestampMs: number,
  args: Record<string, number>,
): RendererChromeTraceEvent {
  return {
    name,
    cat,
    ph: 'C',
    ts: msToUs(timestampMs),
    pid,
    tid,
    args,
  };
}

function inputTraceName(input: RendererTraceInputData): string {
  if (input.type === 'key' && input.key !== undefined) return `input:${input.key}`;
  if (input.type === 'mouse' && input.button !== undefined) return `input:${input.button}`;
  return `input:${input.type}`;
}

function traceEventEndTimestampMs(event: RendererTraceEvent): number {
  if (event.kind === 'frame') {
    return event.metrics.endedAt + event.metrics.qualityDurationMs;
  }
  return event.timestampMs;
}

function normalizeTraceMaxEvents(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TRACE_MAX_EVENTS;
  return Math.min(MAX_TRACE_MAX_EVENTS, Math.max(MIN_TRACE_MAX_EVENTS, Math.floor(value)));
}

function normalizeProcessId(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function msToUs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000);
}

function ratio(value: number, total: number): number {
  return total <= 0 ? 0 : value / total;
}
