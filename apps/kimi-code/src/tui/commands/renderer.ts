import {
  formatRendererDiagnosticsLines,
  type AutocompleteItem,
  type RendererDiagnosticsSnapshot,
  type RendererTraceSnapshot,
} from '#/tui/renderer';
import type { ColorToken } from '#/tui/theme';

import type { SlashCommandHost } from './dispatch';
import { completeLeadingArg, type ArgCompletionSpec } from './complete-args';

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

const RENDERER_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'diagnostics', description: 'Inspect or toggle the native renderer diagnostics HUD' },
  { value: 'trace', description: 'Inspect or export the native renderer performance trace' },
];

const RENDERER_DIAGNOSTICS_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'on', description: 'Show the native renderer diagnostics HUD' },
  { value: 'off', description: 'Hide the native renderer diagnostics HUD' },
  { value: 'toggle', description: 'Toggle the native renderer diagnostics HUD' },
  { value: 'status', description: 'Show HUD state and current renderer metrics' },
  { value: 'reset', description: 'Clear the current renderer diagnostics sample window' },
];

const RENDERER_TRACE_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'status', description: 'Show native renderer trace buffer state' },
  { value: 'reset', description: 'Clear the native renderer trace buffer' },
  { value: 'export', description: 'Write the native renderer trace as Chrome JSON' },
];

const RENDERER_USAGE =
  'Usage: /renderer diagnostics [on|off|toggle|status|reset] | /renderer trace [status|reset|export [path]]';

export function rendererArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  const diagnosticsMatch = argumentPrefix.match(/^diagnostics\s+(\S*)$/i);
  if (diagnosticsMatch !== null) {
    const valuePrefix = diagnosticsMatch[1] ?? '';
    return completeLeadingArg(RENDERER_DIAGNOSTICS_ARG_COMPLETIONS, valuePrefix)?.map((item) => ({
      ...item,
      value: `diagnostics ${item.value}`,
    })) ?? null;
  }
  const traceMatch = argumentPrefix.match(/^trace\s+(\S*)$/i);
  if (traceMatch !== null) {
    const valuePrefix = traceMatch[1] ?? '';
    return completeLeadingArg(RENDERER_TRACE_ARG_COMPLETIONS, valuePrefix)?.map((item) => ({
      ...item,
      value: `trace ${item.value}`,
    })) ?? null;
  }
  return completeLeadingArg(RENDERER_ARG_COMPLETIONS, argumentPrefix);
}

export function handleRendererCommand(host: SlashCommandHost, args: string): void {
  const command = parseRendererCommand(args);
  if (command === undefined) {
    host.showError(RENDERER_USAGE);
    return;
  }
  if (command.kind === 'diagnostics') {
    host.setNativeRendererDiagnosticsOverlay(command.action);
    return;
  }
  host.setNativeRendererTrace(command.command);
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

type ParsedRendererCommand =
  | { readonly kind: 'diagnostics'; readonly action: RendererDiagnosticsOverlayCommand }
  | { readonly kind: 'trace'; readonly command: RendererTraceCommand };

function parseRendererCommand(args: string): ParsedRendererCommand | undefined {
  const trimmed = args.trim();
  if (trimmed.length === 0) return { kind: 'diagnostics', action: 'status' };
  const trace = parseRendererTraceCommand(trimmed);
  if (trace !== undefined) return { kind: 'trace', command: trace };
  const diagnostics = parseRendererDiagnosticsCommand(trimmed);
  if (diagnostics !== undefined) return { kind: 'diagnostics', action: diagnostics };
  return undefined;
}

function parseRendererDiagnosticsCommand(
  args: string,
): RendererDiagnosticsOverlayCommand | undefined {
  const parts = args.trim().toLowerCase().split(/\s+/).filter((part) => part.length > 0);
  if (parts[0] !== 'diagnostics') return undefined;
  if (parts.length === 1) return 'toggle';
  if (parts.length > 2) return undefined;
  const action = parts[1];
  if (
    action === 'on' ||
    action === 'off' ||
    action === 'toggle' ||
    action === 'status' ||
    action === 'reset'
  ) {
    return action;
  }
  return undefined;
}

function parseRendererTraceCommand(args: string): RendererTraceCommand | undefined {
  const match = args.match(/^trace(?:\s+(\S+)(?:\s+(.+))?)?$/i);
  if (match === null) return undefined;
  const action = match[1]?.toLowerCase() ?? 'status';
  const path = match[2]?.trim();
  if (action === 'status' || action === 'reset') return { action };
  if (action === 'export') return { action, path: path?.length === 0 ? undefined : path };
  return undefined;
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
