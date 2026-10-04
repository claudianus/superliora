import { expect, it, vi } from 'vitest';
import { openWorkerTranscript } from '#/tui/commands/worker-transcript';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import type { WorkerTranscriptViewerOptions } from '#/tui/components/dialogs/worker-dock/worker-transcript-viewer';

const captured = vi.hoisted(() => ({ options: undefined as WorkerTranscriptViewerOptions | undefined }));
vi.mock('#/tui/components/dialogs/worker-dock/worker-transcript-viewer', () => ({
  WorkerTranscriptViewerComponent: class {
    constructor(options: WorkerTranscriptViewerOptions) { captured.options = options; }
  },
}));
vi.mock('#/tui/features/workspace/workspace-dock', () => ({
  toggleWorkspaceDock: (input: { createViewer: () => unknown }) => { input.createViewer(); },
  closeWorkspaceDock: vi.fn(),
}));

it('opens nested independent traces using the registry-authoritative record and agent tuple, not the synthetic row ID', async () => {
  const rowId = 'synthetic:row:not-an-agent';
  const worker = { id: rowId, name: 'Nested reviewer', description: 'review the parser' };
  const getIndependentSessionTrace = vi.fn(async () => ({ context: { history: [] } }));
  const withInteractiveAgent = vi.fn();
  const workerTranscriptTarget = vi.fn((id: string) => id === rowId ? { sessionId: 'actual-worker', agentId: 'nested-reviewer', recordId: 'durable-record' } : undefined);
  const host = {
    session: {}, requireSession: () => ({ id: 'conductor' }), showStatus: vi.fn(),
    state: { appState: {}, workerDockPanel: { currentView: { snapshot: { workers: [worker] } } }, renderer: { requestRender: vi.fn() } },
    workerDock: { registry: {
      snapshot: () => ({ workers: [worker], ops: [] }),
      workerTranscriptTarget,
    } },
    harness: { getIndependentSessionTrace, withInteractiveAgent },
  } as unknown as SlashCommandHost;
  openWorkerTranscript(host, rowId);
  expect(captured.options).toBeDefined();
  workerTranscriptTarget.mockClear();
  const loaded = await captured.options!.loadTranscript(rowId);
  expect(workerTranscriptTarget).toHaveBeenCalledExactlyOnceWith(rowId);
  expect(getIndependentSessionTrace).toHaveBeenCalledExactlyOnceWith('conductor', 'durable-record', 'nested-reviewer');
  // An empty durable history still shows the worker's registry telemetry.
  expect(loaded.lines).toEqual(['task  review the parser']);
  expect(withInteractiveAgent).not.toHaveBeenCalled();
});

it('opens fact-only tree rows that have a transcript target but no roster worker yet', async () => {
  captured.options = undefined;
  const rowId = 'record:conductor:fact-only';
  const getIndependentSessionTrace = vi.fn(async () => ({ context: { history: [] } }));
  const showStatus = vi.fn();
  const host = {
    session: {}, requireSession: () => ({ id: 'conductor' }), showStatus,
    state: { appState: {}, workerDockPanel: { currentView: { snapshot: { workers: [] } } }, renderer: { requestRender: vi.fn() } },
    workerDock: { registry: {
      snapshot: () => ({ workers: [], ops: [] }),
      workerTranscriptTarget: vi.fn((id: string) => id === rowId ? { sessionId: 'fact-only', agentId: 'main', recordId: 'fact-only' } : undefined),
    } },
    harness: { getIndependentSessionTrace, withInteractiveAgent: vi.fn() },
  } as unknown as SlashCommandHost;
  openWorkerTranscript(host, rowId);
  expect(showStatus).not.toHaveBeenCalled();
  await captured.options!.loadTranscript(rowId);
  expect(getIndependentSessionTrace).toHaveBeenCalledExactlyOnceWith('conductor', 'fact-only', 'main');

  captured.options = undefined;
  openWorkerTranscript(host, 'record:conductor:unknown');
  expect(captured.options).toBeUndefined();
  expect(showStatus).toHaveBeenCalledOnce();
});
