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
  const worker = { id: rowId, name: 'Nested reviewer' };
  const getIndependentSessionTrace = vi.fn(async () => ({ context: { history: [] } }));
  const withInteractiveAgent = vi.fn();
  const host = {
    session: {}, requireSession: () => ({ id: 'conductor' }), showStatus: vi.fn(),
    state: { appState: {}, workerDockPanel: { currentView: { snapshot: { workers: [worker] } } }, renderer: { requestRender: vi.fn() } },
    workerDock: { registry: {
      snapshot: () => ({ workers: [worker], ops: [] }),
      workerTranscriptTarget: vi.fn(() => ({ sessionId: 'actual-worker', agentId: 'nested-reviewer', recordId: 'durable-record' })),
    } },
    harness: { getIndependentSessionTrace, withInteractiveAgent },
  } as unknown as SlashCommandHost;
  openWorkerTranscript(host, rowId);
  expect(captured.options).toBeDefined();
  await captured.options!.loadTranscript(rowId);
  expect(getIndependentSessionTrace).toHaveBeenCalledExactlyOnceWith('conductor', 'durable-record', 'nested-reviewer');
  expect(withInteractiveAgent).not.toHaveBeenCalled();
});
