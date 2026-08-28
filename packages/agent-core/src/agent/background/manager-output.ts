import {
  emptyOutputSnapshot,
  MAX_OUTPUT_BYTES,
  type BackgroundTaskOutputSnapshot,
  type ManagedTask,
} from './managed-types';
import type { BackgroundManagerHost } from './manager-host';

export async function getBackgroundTaskOutputSnapshot(
  host: BackgroundManagerHost,
  taskId: string,
  maxPreviewBytes: number,
): Promise<BackgroundTaskOutputSnapshot> {
  if (host.getTask(taskId) === undefined) return emptyOutputSnapshot();

  await host.tasks.get(taskId)?.outputWriteQueue;

  const previewLimit = Math.max(0, Math.trunc(maxPreviewBytes));
  const persistence = host.persistence;
  if (persistence !== undefined && (await persistence.taskOutputExists(taskId))) {
    const outputSizeBytes = await persistence.taskOutputSizeBytes(taskId);
    const previewOffset = Math.max(0, outputSizeBytes - previewLimit);
    const previewBytes = outputSizeBytes - previewOffset;
    const preview = await persistence.readTaskOutputBytes(taskId, previewOffset, previewBytes);
    return {
      outputPath: persistence.taskOutputFile(taskId),
      outputSizeBytes,
      previewBytes,
      truncated: previewOffset > 0,
      fullOutputAvailable: true,
      preview,
    };
  }

  const entry = host.tasks.get(taskId);
  if (entry === undefined) return emptyOutputSnapshot();

  const available = Buffer.from(entry.outputChunks.join(''), 'utf-8');
  const previewBytes = Math.min(previewLimit, available.byteLength, entry.outputSizeBytes);
  const previewOffset = available.byteLength - previewBytes;
  return {
    outputSizeBytes: entry.outputSizeBytes,
    previewBytes,
    truncated: entry.outputSizeBytes > previewBytes,
    fullOutputAvailable: false,
    preview: available.subarray(previewOffset).toString('utf-8'),
  };
}

export async function readBackgroundTaskOutput(
  host: BackgroundManagerHost,
  taskId: string,
  tail?: number,
): Promise<string> {
  const output = (await getBackgroundTaskOutputSnapshot(host, taskId, Number.MAX_SAFE_INTEGER)).preview;
  if (tail !== undefined && tail < output.length) {
    return output.slice(-tail);
  }
  return output;
}

/**
 * Running char total of `outputChunks`, keyed per entry — recomputing the sum
 * on every appended chunk made chatty processes quadratic (CPU DoS on the
 * agent's event loop). WeakMap so replaced/GC'd entries never leak.
 */
const ringBytes = new WeakMap<ManagedTask, number>();

/** Drop the in-memory ring and its cached running total (terminal tasks). */
export function resetBackgroundOutputRing(entry: ManagedTask): void {
  entry.outputChunks.length = 0;
  ringBytes.delete(entry);
}

export function appendBackgroundTaskOutput(host: BackgroundManagerHost, entry: ManagedTask, chunk: string): void {
  entry.outputSizeBytes += Buffer.byteLength(chunk, 'utf-8');
  entry.outputChunks.push(chunk);
  let total = (ringBytes.get(entry) ?? 0) + chunk.length;
  while (total > MAX_OUTPUT_BYTES && entry.outputChunks.length > 1) {
    const removed = entry.outputChunks.shift();
    if (removed === undefined) break;
    total -= removed.length;
  }
  ringBytes.set(entry, total);

  if (host.persistence === undefined) return;

  if (!entry.outputPersistStarted) {
    entry.pendingOutput.push(chunk);
    entry.pendingOutputBytes += Buffer.byteLength(chunk, 'utf-8');
    if (entry.pendingOutputBytes > MAX_OUTPUT_BYTES) startBackgroundTaskOutputPersist(host, entry);
    return;
  }

  appendTaskOutputChunk(host, entry, chunk);
}

function appendTaskOutputChunk(host: BackgroundManagerHost, entry: ManagedTask, chunk: string): void {
  const persistence = host.persistence;
  if (persistence === undefined) return;
  entry.outputWriteQueue = entry.outputWriteQueue
    .then(() => persistence.appendTaskOutput(entry.taskId, chunk))
    .catch(() => { });
}

export function startBackgroundTaskOutputPersist(host: BackgroundManagerHost, entry: ManagedTask): void {
  if (entry.outputPersistStarted) return;
  entry.outputPersistStarted = true;
  if (entry.pendingOutput.length > 0) {
    appendTaskOutputChunk(host, entry, entry.pendingOutput.join(''));
  }
  entry.pendingOutput = [];
  entry.pendingOutputBytes = 0;
}

export function persistBackgroundTaskOutput(host: BackgroundManagerHost, taskId: string): void {
  const entry = host.tasks.get(taskId);
  if (entry === undefined) return;
  startBackgroundTaskOutputPersist(host, entry);
}
