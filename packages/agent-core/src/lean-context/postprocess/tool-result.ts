import type { Agent } from '../../agent';
import type { ExecutableToolResult } from '../../loop/types';
import { archiveContent } from '../../tools/builtin/context/context-archive';
import { compressShellOutput, renderTerseRead } from '../../tools/builtin/context/context-terse';
import type { ToolStore } from '../../tools/store';
import {
  bounceRateForPath,
  recordReadAccess,
  resolvePressureMode,
  shouldSkipCompressionForRead,
} from '../gate/bounce';
import { compressionResistance } from '../gate/density';

const READ_TOKEN_THRESHOLD = 2500;
const GREP_LINE_THRESHOLD = 40;

export interface PostprocessLeanToolResultInput {
  readonly agent: Agent;
  readonly toolName: string;
  readonly args: unknown;
  readonly result: ExecutableToolResult;
}

export async function postprocessLeanToolResult(
  input: PostprocessLeanToolResultInput,
): Promise<ExecutableToolResult> {
  if (input.result.isError === true) return input.result;
  if (typeof input.result.output !== 'string') return input.result;

  const store = input.agent.tools.getStore();
  const maxContextTokens = input.agent.config.modelCapabilities.max_context_tokens;
  const contextTokens = input.agent.context.tokenCountWithPending;
  const contextUsage =
    maxContextTokens !== undefined && maxContextTokens > 0
      ? contextTokens / maxContextTokens
      : undefined;
  const pressureMode = resolvePressureMode(contextUsage);

  if (input.toolName === 'Read') {
    return postprocessRead(input, store, pressureMode);
  }
  if (input.toolName === 'Grep') {
    return postprocessGrep(input, store);
  }
  if (input.toolName === 'Bash') {
    return postprocessBash(input, store);
  }
  return input.result;
}

function postprocessRead(
  input: PostprocessLeanToolResultInput,
  store: ToolStore,
  pressureMode: ReturnType<typeof resolvePressureMode>,
): ExecutableToolResult {
  if (shouldSkipCompressionForRead(input.args)) return input.result;
  const output = input.result.output;
  if (typeof output !== 'string') return input.result;
  if (output.length < READ_TOKEN_THRESHOLD && pressureMode === 'normal') return input.result;

  const pathArg = (() => {
    if (typeof input.args !== 'object' || input.args === null) return 'unknown';
    const path = (input.args as { path?: unknown }).path;
    return typeof path === 'string' ? path : 'unknown';
  })();
  if (bounceRateForPath(store, pathArg) > 0.35) {
    recordReadAccess(store, pathArg, 'full');
    return appendHint(input.result, '[liora-gate] bounce detected — kept Read output verbatim.');
  }

  // Density-driven mode: high-surprise content (novel logic, project-specific
  // identifiers) resists compression and stays in a richer `signatures` form;
  // low-surprise boilerplate compresses to the terse `map` form. Under
  // aggressive context pressure, only very-high-surprise content keeps
  // signatures — everything else drops to `map`.
  const resistance = compressionResistance(output);
  const mode =
    pressureMode === 'aggressive'
      ? resistance > 0.7
        ? 'signatures'
        : 'map'
      : resistance > 0.5
        ? 'signatures'
        : 'map';
  const rendered = renderTerseRead({
    content: stripSystemSuffix(output),
    displayPath: pathArg,
    mode,
  });
  recordReadAccess(store, pathArg, 'compressed');
  return finalizeCompressed(input.result, rendered.text, rendered.overflow, store, pathArg);
}

function postprocessGrep(
  input: PostprocessLeanToolResultInput,
  store: ToolStore,
): ExecutableToolResult {
  const output = input.result.output;
  if (typeof output !== 'string') return input.result;
  const lines = output.split('\n');
  if (lines.length <= GREP_LINE_THRESHOLD) return input.result;
  const head = lines.slice(0, GREP_LINE_THRESHOLD - 5);
  const tail = lines.slice(-5);
  const overflow = lines.slice(GREP_LINE_THRESHOLD - 5, lines.length - 5).join('\n');
  const archived = archiveContent({
    store,
    content: overflow,
    label: 'grep:overflow',
  });
  return {
    ...input.result,
    output: [
      ...head,
      `[... ${String(lines.length - head.length - tail.length)} lines archived]`,
      ...tail,
      archived.marker,
      `recover: LioraExpand(id="${archived.id}")`,
      '[liora-compressed] Grep output compacted for context.',
    ].join('\n'),
  };
}

function postprocessBash(
  input: PostprocessLeanToolResultInput,
  store: ToolStore,
): ExecutableToolResult {
  if (typeof input.args !== 'object' || input.args === null) return input.result;
  const args = input.args as { command?: string; compress_output?: boolean };
  if (args.compress_output === false) return input.result;
  const command = args.command ?? '';
  const shouldCompress =
    args.compress_output === true ||
    /\b(?:pnpm|npm|yarn|cargo|vitest|jest|pytest|git|docker)\b/u.test(command);
  if (!shouldCompress || typeof input.result.output !== 'string') return input.result;
  const compressed = compressShellOutput({
    stdout: input.result.output,
    stderr: '',
    command,
    exitCode: input.result.isError === true ? 1 : 0,
  });
  if (compressed.savedPercent <= 0) return input.result;
  input.agent.telemetry.track('lean_context_postprocess', {
    tool: input.toolName,
    saved_percent: compressed.savedPercent,
  });
  if (compressed.overflow === undefined) {
    return {
      ...input.result,
      output: `${compressed.text}\n[liora-compressed] shell output compacted (~${String(compressed.savedPercent)}% saved).`,
    };
  }
  return finalizeCompressed(input.result, compressed.text, compressed.overflow, store, `bash:${command.slice(0, 80)}`);
}

function stripSystemSuffix(output: string): string {
  for (const marker of ['\n<system>', '\n<tool_meta']) {
    const index = output.indexOf(marker);
    if (index >= 0) return output.slice(0, index);
  }
  return output;
}

function finalizeCompressed(
  original: ExecutableToolResult,
  text: string,
  overflow: string | undefined,
  store: ToolStore,
  label: string,
): ExecutableToolResult {
  if (overflow === undefined || overflow.length === 0) {
    return appendHint({ ...original, output: text }, '[liora-compressed] recover with LioraRead(mode=lines|full).');
  }
  const archived = archiveContent({ store, content: overflow, label });
  return {
    ...original,
    output: `${text}\n${archived.marker}\nrecover: LioraExpand(id="${archived.id}")\n[liora-compressed]`,
  };
}

function appendHint(result: ExecutableToolResult, hint: string): ExecutableToolResult {
  if (typeof result.output !== 'string') return result;
  return { ...result, output: `${result.output}\n${hint}` };
}

export function extractArchiveIdFromToolOutput(output: string): string | undefined {
  const match = /\[liora-archived id=([a-f0-9]{12})\]/u.exec(output);
  return match?.[1];
}
