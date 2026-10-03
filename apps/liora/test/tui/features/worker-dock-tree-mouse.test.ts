import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeInputEvent } from '#/tui/renderer';
import { WorkerDockPanelComponent } from '#/tui/components/panes/worker-dock/panel';
import { handleWorkerDockMouse, type WorkerDockMouseHost } from '#/tui/features/worker-dock/worker-dock-mouse';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';
import { emptyConductorJobsSnapshot } from '#/tui/utils/job/job-strip';

vi.mock('#/tui/features/transcript/transcript-hit-test', () => ({ getTUIStateNativeWorkerDockRect: () => ({ x: 0, y: 10, width: 120, height: 14 }) }));
vi.mock('#/tui/utils/render/frame-render', () => ({ requestTUIContentRender: vi.fn() }));
const strip = (text: string): string => text.replaceAll(/\u001B\[[0-9;]*m/g, '');
beforeEach(() => setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' }));
afterEach(() => setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES));

describe('tree mouse navigation', () => {
  it('routes only caret clicks to disclosure and ordinary worker clicks to the existing transcript', () => {
    const panel = new WorkerDockPanelComponent();
    panel.setView({ snapshot: { version: 1, workers: [], activeCount: 0, totalTokens: 0, ops: [] }, jobs: emptyConductorJobsSnapshot(), tree: {
      rootAgentId: 'session:main', nodes: [
        { id: 'parent', parentAgentId: 'session:main', phase: 'running', label: 'Parent' },
        { id: 'child', parentAgentId: 'parent', phase: 'running', label: 'Child' },
      ],
    } });
    const openWorkerTranscript = vi.fn();
    const host = { state: { workerDockPanel: panel }, openWorkerTranscript } as unknown as WorkerDockMouseHost;
    const lines = panel.render(120).map(strip);
    const y = lines.findIndex(line => line.includes('▸ Parent'));
    const x = lines[y]!.indexOf('▸');
    const press = (column: number): NativeInputEvent => ({ type: 'mouse', action: 'press', button: 'left', x: column, y: y + 10 } as NativeInputEvent);
    expect(handleWorkerDockMouse(host, press(x))).toBe(true);
    expect(openWorkerTranscript).not.toHaveBeenCalled();
    expect(panel.focused).toBe(true);
    const expanded = panel.render(120).map(strip).join('\n');
    expect(expanded).toContain('Child');
    expect(handleWorkerDockMouse(host, press(x + 4))).toBe(true);
    expect(openWorkerTranscript).toHaveBeenCalledWith('parent');
    expect(panel.selectedWorker).toBe('parent');
  });
});
