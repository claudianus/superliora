import { writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import type { LioraHarness } from '@superliora/sdk';

import type { ColorToken } from '../../theme';
import type { TUIState } from '../../tui-state';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { ttui } from '../../utils/tui-i18n';
import {
  formatRendererDiagnosticsStatusReport,
  formatRendererTraceStatusReport,
  type RendererDiagnosticsOverlayCommand,
  type RendererTraceCommand,
} from './renderer-status';

function truthyEnv(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}

export function nativeRendererDiagnosticsOverlayEnabled(): boolean {
  return truthyEnv(process.env['SUPERLIORA_NATIVE_RENDERER_DIAGNOSTICS']);
}

/** Host surface required by native-renderer diagnostics / trace controls. */
export interface NativeRendererDiagnosticsHost {
  state: TUIState;
  nativeRendererDiagnosticsHudEnabled: boolean;

  showStatus(msg: string, color?: ColorToken): void;
  track(event: string, properties?: Parameters<LioraHarness['track']>[1]): void;
}

/**
 * Native renderer diagnostics HUD and trace export controls.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class NativeRendererDiagnosticsController {
  constructor(private readonly host: NativeRendererDiagnosticsHost) {}

  setNativeRendererDiagnosticsOverlay(command: RendererDiagnosticsOverlayCommand): void {
    const { host } = this;
    if (command === 'status') {
      const report = formatRendererDiagnosticsStatusReport({
        hudEnabled: host.nativeRendererDiagnosticsHudEnabled,
        nativeRendererEnabled: true,
        diagnostics: this.nativeRendererDiagnosticsSnapshot(),
      });
      host.showStatus(report.message, report.color);
      return;
    }
    if (command === 'reset') {
      host.track('native_renderer_diagnostics_reset');
      if (!this.resetNativeRendererDiagnostics()) {
        host.showStatus(
          'Native renderer diagnostics reset skipped: native renderer is not active.',
          'warning',
        );
        return;
      }
      host.showStatus(ttui('tui.native.diagReset'));
      return;
    }

    const enabled = command === 'toggle'
      ? !host.nativeRendererDiagnosticsHudEnabled
      : command === 'on';
    host.nativeRendererDiagnosticsHudEnabled = enabled;
    host.track('native_renderer_diagnostics_hud', { enabled, command });

    requestTUILayoutRender(host.state);
    host.showStatus(ttui('tui.native.diagHud', { state: enabled ? ttui('tui.native.stateOn') : ttui('tui.native.stateOff') }));
  }

  setNativeRendererTrace(command: RendererTraceCommand): void {
    const { host } = this;
    if (command.action === 'status') {
      const report = formatRendererTraceStatusReport({
        nativeRendererEnabled: true,
        trace: this.nativeRendererTraceSnapshot(),
      });
      host.showStatus(report.message, report.color);
      return;
    }

    if (command.action === 'reset') {
      host.track('native_renderer_trace_reset');
      if (!this.resetNativeRendererTrace()) {
        host.showStatus(ttui('tui.native.traceResetSkipped'), 'warning');
        return;
      }
      host.showStatus(ttui('tui.native.traceReset'));
      return;
    }

    if (command.action === 'export') {
      const outputPath = this.exportNativeRendererTrace(command.path);
      if (outputPath === undefined) {
        host.showStatus(ttui('tui.native.traceExportSkipped'), 'warning');
        return;
      }
      host.track('native_renderer_trace_export');
      host.showStatus(ttui('tui.native.traceExported', { outputPath }));
    }
  }

  private nativeRendererDiagnosticsSnapshot() {
    return this.host.state.renderer.nativeRuntime?.diagnostics;
  }

  private resetNativeRendererDiagnostics(): boolean {
    const renderer = this.host.state.renderer.nativeRuntime;
    if (renderer === undefined) return false;
    renderer.resetStats();
    requestTUILayoutRender(this.host.state);
    return true;
  }

  private nativeRendererTraceSnapshot() {
    return this.nativeRendererTraceRuntime()?.traceSnapshot;
  }

  private resetNativeRendererTrace(): boolean {
    const renderer = this.nativeRendererTraceRuntime();
    if (renderer === undefined) return false;
    renderer.resetTrace();
    requestTUILayoutRender(this.host.state);
    return true;
  }

  private exportNativeRendererTrace(path: string | undefined): string | undefined {
    const { host } = this;
    const renderer = this.nativeRendererTraceRuntime();
    if (renderer === undefined) return undefined;
    const workDir = host.state.appState.workDir;
    const outputPath = path === undefined
      ? join(workDir, `renderer-trace-${String(Date.now())}.json`)
      : resolve(workDir, path);
    const rel = relative(workDir, outputPath);
    if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`)) {
      host.showStatus(ttui('tui.native.tracePathOutside'), 'error');
      return undefined;
    }
    writeFileSync(
      outputPath,
      `${JSON.stringify(renderer.exportTrace({ processName: 'SuperLiora TUI' }), null, 2)}\n`,
    );
    return outputPath;
  }

  private nativeRendererTraceRuntime() {
    return this.host.state.renderer.nativeRuntime;
  }
}
