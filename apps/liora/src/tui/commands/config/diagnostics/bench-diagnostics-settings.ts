/**
 * Settings → Bench / Diagnostics — read-only /bench, /ops tips (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  BENCH_SLASH_TIP,
  buildBenchDiagnosticsSettingsLines,
  OPS_SLASH_TIP,
} from '../../../utils/bench/bench-diagnostics-glance';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';

export { BENCH_SLASH_TIP, OPS_SLASH_TIP };

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
            '/bench · /ops · visual smoke · W6 redteam · branding debt glance (read-only).',
        },
        {
          value: 'tip-bench',
          label: '/bench tip',
          description: 'Evidence score, pass rate, holdout, replay hints.',
        },
        {
          value: 'tip-ops',
          label: '/ops tip',
          description: 'Ops Theatre grid · git churn · approval tray · Never-Halt.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          showBenchDiagnosticsSettingsPanel(host);
          return;
        }
        if (value === 'tip-bench') {
          host.showStatus(BENCH_SLASH_TIP, 'info');
          return;
        }
        if (value === 'tip-ops') {
          host.showStatus(OPS_SLASH_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Bench / Diagnostics' },
  );
}

function showBenchDiagnosticsSettingsPanel(host: SlashCommandHost): void {
  const lines = buildBenchDiagnosticsSettingsLines();

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
