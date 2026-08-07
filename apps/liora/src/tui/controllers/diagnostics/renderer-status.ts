import {
  formatRendererDiagnosticsLines,
  type RendererDiagnosticsSnapshot,
  type RendererTraceSnapshot,
} from '#/tui/renderer';
import type { ColorToken } from '#/tui/theme';

export type RendererDiagnosticsOverlayCommand = 'on' | 'off' | 'toggle' | 'status' | 'reset';
export type RendererTraceCommand =
  | { readonly action: 'status' | 'reset' }
  | { readonly action: 'export'; readonly path?: string };

export interface RendererDiagnosticsStatusInput {
  readonly hudEnabled: boolean;
  readonly nativeRendererEnabled: boolean;
  readonly diagnostics?: RendererDiagnosticsSnapshot;
}

export interface RendererDiagnosticsStatusReport {
  readonly message: string;
  readonly color: ColorToken | undefined;
}

export interface RendererTraceStatusInput {
  readonly nativeRendererEnabled: boolean;
  readonly trace?: RendererTraceSnapshot;
}

export function formatRendererDiagnosticsStatusReport(
  input: RendererDiagnosticsStatusInput,
): RendererDiagnosticsStatusReport {
  const lines = [`Native renderer diagnostics HUD: ${input.hudEnabled ? 'ON' : 'OFF'}.`];
  if (!input.nativeRendererEnabled) {
    lines.push('Native renderer is not active.');
    return { message: lines.join('\n'), color: 'warning' };
  }
  if (input.diagnostics === undefined) {
    lines.push('No native renderer frame has been recorded yet.');
    return { message: lines.join('\n'), color: 'warning' };
  }

  lines.push(...formatRendererDiagnosticsLines(input.diagnostics, { maxIssues: 4 }));
  return {
    message: lines.join('\n'),
    color: rendererDiagnosticsStatusColor(input.diagnostics),
  };
}

export function formatRendererTraceStatusReport(
  input: RendererTraceStatusInput,
): RendererDiagnosticsStatusReport {
  const lines = ['Native renderer trace: ON.'];
  if (!input.nativeRendererEnabled) {
    lines.push('Native renderer is not active.');
    return { message: lines.join('\n'), color: 'warning' };
  }
  if (input.trace === undefined) {
    lines.push('No native renderer trace is available yet.');
    return { message: lines.join('\n'), color: 'warning' };
  }
  if (!input.trace.enabled) {
    lines[0] = 'Native renderer trace: OFF.';
    lines.push('Trace recording is disabled for this renderer runtime.');
    return { message: lines.join('\n'), color: 'warning' };
  }

  lines.push(
    `${String(input.trace.eventCount)}/${String(input.trace.maxEvents)} events buffered; ${String(input.trace.totalEvents)} total; ${String(input.trace.droppedEvents)} dropped.`,
  );
  lines.push(`${String(rendererTraceFrameCount(input.trace))} frame events recorded.`);
  const windowMs = rendererTraceWindowMs(input.trace);
  if (windowMs !== undefined) lines.push(`Trace window: ${formatTraceNumber(windowMs)}ms.`);
  return {
    message: lines.join('\n'),
    color: input.trace.droppedEvents > 0 ? 'warning' : 'success',
  };
}

function rendererDiagnosticsStatusColor(
  diagnostics: RendererDiagnosticsSnapshot,
): ColorToken | undefined {
  if (diagnostics.severity === 'degraded') return 'error';
  if (diagnostics.severity === 'watch') return 'warning';
  if (diagnostics.health === 'idle') return undefined;
  return 'success';
}

function rendererTraceFrameCount(trace: RendererTraceSnapshot): number {
  return trace.events.filter((event) => event.kind === 'frame').length;
}

function rendererTraceWindowMs(trace: RendererTraceSnapshot): number | undefined {
  if (trace.startedAtMs === undefined || trace.endedAtMs === undefined) return undefined;
  return Math.max(0, trace.endedAtMs - trace.startedAtMs);
}

function formatTraceNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 10) return String(Math.round(value));
  return value.toFixed(1).replace(/\.0$/, '');
}
