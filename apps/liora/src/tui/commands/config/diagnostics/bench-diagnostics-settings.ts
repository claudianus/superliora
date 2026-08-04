/**
 * Settings → Bench / Diagnostics — read-only /bench tips (SSOT §9.2).
 * Loop17b: session TTFT export block from AppState rolling window.
 * Loop19b: session trace dump via session.getSessionTrace().
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  BENCH_SLASH_TIP,
  buildBenchDiagnosticsSettingsLines,
} from '../../../utils/bench/bench-diagnostics-glance';
import { resolveHostRuntimeMode } from '../../../utils/host/host-glance';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';

export { BENCH_SLASH_TIP };

export function showBenchDiagnosticsSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Bench / Diagnostics',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Bench / Diagnostics status',
          description:
            '/bench · visual smoke · session TTFT + trace dump · W6 redteam (read-only).',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showBenchDiagnosticsSettingsPanel(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Bench / Diagnostics' },
  );
}

async function showBenchDiagnosticsSettingsPanel(host: SlashCommandHost): Promise<void> {
  let traceDump:
    | {
        readonly trace: {
          readonly sessionId: string;
          readonly agentId: string;
          readonly generatedAt: string;
          readonly completeness: {
            readonly source: string;
            readonly recordCount: number;
            readonly traceEventCount: number;
            readonly messageCount: number;
            readonly filteredInternalMessageCount: number;
            readonly toolCallCount: number;
            readonly toolResultCount: number;
            readonly subagentLifecycleCount: number;
            readonly ultraworkEventCount: number;
            readonly redactedCount: number;
            readonly warnings: readonly string[];
          };
          readonly events: readonly {
            readonly id?: string;
            readonly index?: number;
            readonly type: string;
            readonly title: string;
            readonly summary?: string;
            readonly time?: number;
          }[];
          readonly verificationArtifacts?: readonly { readonly id: string; readonly kind: string }[];
        };
      }
    | null = null;
  let traceDumpUnavailableReason: string | null = null;

  const session = host.session;
  if (session === undefined) {
    traceDumpUnavailableReason = 'No active session — open a session, then reopen this panel.';
  } else {
    try {
      const trace = await session.getSessionTrace();
      traceDump = {
        trace: {
          sessionId: trace.sessionId,
          agentId: trace.agentId,
          generatedAt: trace.generatedAt,
          completeness: {
            source: trace.completeness.source,
            recordCount: trace.completeness.recordCount,
            traceEventCount: trace.completeness.traceEventCount,
            messageCount: trace.completeness.messageCount,
            filteredInternalMessageCount: trace.completeness.filteredInternalMessageCount,
            toolCallCount: trace.completeness.toolCallCount,
            toolResultCount: trace.completeness.toolResultCount,
            subagentLifecycleCount: trace.completeness.subagentLifecycleCount,
            ultraworkEventCount: trace.completeness.ultraworkEventCount,
            redactedCount: trace.completeness.redactedCount,
            warnings: [...trace.completeness.warnings],
          },
          events: trace.events.map((event) => ({
            id: event.id,
            index: event.index,
            type: event.type,
            title: event.title,
            ...(event.summary !== undefined ? { summary: event.summary } : {}),
            ...(event.time !== undefined ? { time: event.time } : {}),
          })),
          verificationArtifacts: trace.verificationArtifacts.map((a) => ({
            id: a.id,
            kind: a.kind,
          })),
        },
      };
    } catch {
      traceDumpUnavailableReason =
        'getSessionTrace failed — try /export or reopen after a turn completes.';
    }
  }

  const lines = buildBenchDiagnosticsSettingsLines({
    ttft: {
      runtimeMode: resolveHostRuntimeMode(host.harness, process.env),
      lastStepTtft: host.state.appState.lastStepTtft ?? null,
      lastStepTtftMsWindow: host.state.appState.lastStepTtftMsWindow ?? null,
    },
    traceDump,
    traceDumpUnavailableReason,
  });

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Bench ',
    enterBeatSeed: 'bench-diagnostics',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
