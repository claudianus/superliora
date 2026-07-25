/**
 * RunProjectChecks — discover package.json scripts and run structured checks.
 *
 * Does not invent ad-hoc test commands. Prefers declared scripts; uses
 * `pnpm -C <packageDir>` for monorepo SuperLiora-style package targeting.
 */

import type { Kaos, KaosProcess } from '@superliora/kaos';
import { join, normalize, resolve } from 'pathe';
import type { Readable } from 'node:stream';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern } from '../../support/rule-match';
import type { ToolStore } from '../../store';
import { archiveContent } from '../context/context-archive';
import DESCRIPTION from './run-project-checks.md?raw';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_LOG_CHARS = 12_000;
const STREAM_CAP_BYTES = 512 * 1024;

export const PROJECT_CHECK_KINDS = ['test', 'typecheck', 'build', 'smoke', 'lint'] as const;
export type ProjectCheckKind = (typeof PROJECT_CHECK_KINDS)[number];

export const RunProjectChecksInputSchema = z.object({
  cwd: z
    .string()
    .optional()
    .describe(
      "Working directory for discovery and commands. Defaults to the session's working directory.",
    ),
  checks: z
    .array(z.enum(PROJECT_CHECK_KINDS))
    .optional()
    .describe(
      "Checks to run. Defaults to ['test','typecheck','build'] when omitted.",
    ),
  packageDir: z
    .string()
    .optional()
    .describe(
      'Package directory relative to cwd (or absolute). Uses `pnpm -C <packageDir> run <script>` when set.',
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `Per-check timeout in milliseconds. Default ${String(DEFAULT_TIMEOUT_MS)}, max ${String(MAX_TIMEOUT_MS)}.`,
    ),
});

export type RunProjectChecksInput = z.infer<typeof RunProjectChecksInputSchema>;

export interface ProjectCheckResult {
  readonly name: ProjectCheckKind;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly command?: string | undefined;
  readonly logPath?: string | undefined;
  readonly skipped?: boolean | undefined;
  readonly reason?: string | undefined;
  readonly logPreview?: string | undefined;
}

export interface RunProjectChecksResult {
  readonly exitCode: number;
  readonly checks: readonly ProjectCheckResult[];
  readonly summary: string;
}

/** Script name candidates per check kind, first match in package.json wins. */
const SCRIPT_CANDIDATES: Record<ProjectCheckKind, readonly string[]> = {
  test: ['test', 'test:unit', 'test:ci', 'vitest'],
  typecheck: ['typecheck', 'type-check', 'check:types', 'tsc', 'types'],
  build: ['build', 'build:prod', 'compile'],
  smoke: ['smoke', 'test:smoke', 'check:smoke'],
  lint: ['lint', 'eslint', 'check:lint'],
};

const DEFAULT_CHECKS: readonly ProjectCheckKind[] = ['test', 'typecheck', 'build'];

export class RunProjectChecksTool implements BuiltinTool<RunProjectChecksInput> {
  readonly name = 'RunProjectChecks' as const;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(RunProjectChecksInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly cwd: string,
    private readonly options?: {
      readonly store?: ToolStore | undefined;
    },
  ) {}

  resolveExecution(args: RunProjectChecksInput): ToolExecution {
    const checks = args.checks ?? [...DEFAULT_CHECKS];
    const target = args.packageDir ?? args.cwd ?? this.cwd;
    return {
      description: `Running project checks: ${checks.join(', ')}`,
      display: {
        kind: 'generic',
        summary: `RunProjectChecks (${checks.join(', ')})`,
        detail: target,
      },
      approvalRule: literalRulePattern(this.name, checks.join(',')),
      execute: ({ signal }) => this.execution(args, signal),
    };
  }

  private async execution(
    args: RunProjectChecksInput,
    signal: AbortSignal,
  ): Promise<ExecutableToolResult> {
    if (signal.aborted) {
      return { isError: true, output: 'Aborted before project checks started.' };
    }

    const rootCwd = resolveCwd(args.cwd ?? this.cwd, this.kaos.getcwd());
    const packageDir = args.packageDir?.trim();
    const packageRoot = packageDir
      ? resolvePackageRoot(rootCwd, packageDir)
      : rootCwd;
    const timeoutMs = clampTimeoutMs(args.timeoutMs);
    const kinds = args.checks ?? [...DEFAULT_CHECKS];

    let scripts: Record<string, string> = {};
    try {
      scripts = await readPackageScripts(this.kaos, packageRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const payload: RunProjectChecksResult = {
        exitCode: 1,
        checks: [],
        summary: `Failed to read package.json at ${packageRoot}: ${message}`,
      };
      return { isError: true, output: JSON.stringify(payload, undefined, 2) };
    }

    const results: ProjectCheckResult[] = [];
    for (const kind of kinds) {
      if (signal.aborted) {
        results.push({
          name: kind,
          exitCode: 1,
          durationMs: 0,
          skipped: true,
          reason: 'Aborted',
        });
        continue;
      }

      const scriptName = pickScript(kind, scripts);
      if (scriptName === undefined) {
        results.push({
          name: kind,
          exitCode: 1,
          durationMs: 0,
          skipped: true,
          reason: `No package.json script for '${kind}' (tried: ${SCRIPT_CANDIDATES[kind].join(', ')})`,
        });
        continue;
      }

      const commandArgs = buildCommandArgs(packageDir, scriptName);
      const commandLabel = commandArgs.join(' ');
      const started = Date.now();
      try {
        const run = await runCommand(this.kaos, rootCwd, commandArgs, timeoutMs, signal);
        const durationMs = Date.now() - started;
        const combined = formatCombinedLog(run.stdout, run.stderr);
        const { preview, logPath } = this.capAndMaybeArchive(kind, commandLabel, combined);
        results.push({
          name: kind,
          exitCode: run.exitCode,
          durationMs,
          command: commandLabel,
          logPreview: preview,
          logPath,
        });
      } catch (error) {
        const durationMs = Date.now() - started;
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          name: kind,
          exitCode: 1,
          durationMs,
          command: commandLabel,
          reason: message,
        });
      }
    }

    const payload = buildResultPayload(results);
    // Keep output pure JSON so callers can parse without trailing error text.
    return {
      isError: payload.exitCode !== 0,
      output: JSON.stringify(payload, undefined, 2),
    };
  }

  private capAndMaybeArchive(
    kind: ProjectCheckKind,
    command: string,
    log: string,
  ): { preview: string; logPath?: string } {
    if (log.length <= MAX_LOG_CHARS) {
      return { preview: log };
    }
    const preview = `${log.slice(0, MAX_LOG_CHARS)}\n[...truncated ${String(log.length - MAX_LOG_CHARS)} chars]`;
    const store = this.options?.store;
    if (store === undefined) {
      return { preview };
    }
    const archived = archiveContent({
      store,
      content: log,
      label: `run-project-checks:${kind}:${command.slice(0, 60)}`,
    });
    return {
      preview: `${preview}\n${archived.marker}\nrecover: LioraExpand(id="${archived.id}")`,
      logPath: `archive:${archived.id}`,
    };
  }
}

export function pickScript(
  kind: ProjectCheckKind,
  scripts: Record<string, string>,
): string | undefined {
  for (const candidate of SCRIPT_CANDIDATES[kind]) {
    if (Object.hasOwn(scripts, candidate)) return candidate;
  }
  return undefined;
}

export function buildCommandArgs(
  packageDir: string | undefined,
  scriptName: string,
): string[] {
  if (packageDir !== undefined && packageDir.trim().length > 0) {
    return ['pnpm', '-C', packageDir.trim(), 'run', scriptName];
  }
  return ['pnpm', 'run', scriptName];
}

export function buildResultPayload(checks: readonly ProjectCheckResult[]): RunProjectChecksResult {
  const failed = checks.filter((check) => check.exitCode !== 0);
  const skipped = checks.filter((check) => check.skipped === true);
  const exitCode = failed.length === 0 ? 0 : 1;
  const parts: string[] = [
    `${String(checks.length)} check(s)`,
    `${String(checks.length - failed.length)} passed`,
  ];
  if (failed.length > 0) parts.push(`${String(failed.length)} failed`);
  if (skipped.length > 0) parts.push(`${String(skipped.length)} skipped`);
  const failedNames = failed.map((check) => check.name).join(', ');
  const summary =
    exitCode === 0
      ? `All project checks passed (${parts.join(', ')}).`
      : `Project checks failed (${parts.join(', ')})${failedNames.length > 0 ? `: ${failedNames}` : ''}.`;
  return { exitCode, checks, summary };
}

function resolveCwd(requested: string, fallback: string): string {
  const trimmed = requested.trim();
  if (trimmed.length === 0) return normalize(fallback);
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return normalize(trimmed);
  }
  return normalize(resolve(fallback, trimmed));
}

function resolvePackageRoot(rootCwd: string, packageDir: string): string {
  const trimmed = packageDir.trim();
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return normalize(trimmed);
  }
  return normalize(join(rootCwd, trimmed));
}

function clampTimeoutMs(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(1, value), MAX_TIMEOUT_MS);
}

async function readPackageScripts(
  kaos: Kaos,
  packageRoot: string,
): Promise<Record<string, string>> {
  const packageJsonPath = join(packageRoot, 'package.json');
  const raw = await kaos.readText(packageJsonPath);
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const scriptsValue = (parsed as { scripts?: unknown }).scripts;
  if (scriptsValue === null || typeof scriptsValue !== 'object' || Array.isArray(scriptsValue)) {
    return {};
  }
  const scripts: Record<string, string> = {};
  for (const [key, value] of Object.entries(scriptsValue as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length > 0) {
      scripts[key] = value;
    }
  }
  return scripts;
}

async function runCommand(
  kaos: Kaos,
  cwd: string,
  args: string[],
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const scoped = kaos.withCwd(cwd);
  let proc: KaosProcess;
  try {
    proc = await scoped.exec(...args);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  try {
    proc.stdin.end();
  } catch {
    /* best-effort */
  }

  const stdoutPromise = readStreamWithCap(proc.stdout, STREAM_CAP_BYTES);
  const stderrPromise = readStreamWithCap(proc.stderr, STREAM_CAP_BYTES);

  let timedOut = false;
  let abortHandler: (() => void) | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    void proc.kill('SIGTERM');
  }, timeoutMs);

  if (signal.aborted) {
    void proc.kill('SIGTERM');
  } else {
    abortHandler = () => {
      void proc.kill('SIGTERM');
    };
    signal.addEventListener('abort', abortHandler, { once: true });
  }

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.wait(),
      stdoutPromise,
      stderrPromise,
    ]);
    if (timedOut) {
      return {
        exitCode: exitCode === 0 ? 124 : exitCode,
        stdout: stdout.text,
        stderr: `${stderr.text}${stderr.text.length > 0 ? '\n' : ''}Command timed out after ${String(timeoutMs)}ms`,
      };
    }
    if (signal.aborted) {
      return {
        exitCode: exitCode === 0 ? 130 : exitCode,
        stdout: stdout.text,
        stderr: `${stderr.text}${stderr.text.length > 0 ? '\n' : ''}Aborted`,
      };
    }
    return { exitCode, stdout: stdout.text, stderr: stderr.text };
  } finally {
    clearTimeout(timeout);
    if (abortHandler !== undefined) {
      signal.removeEventListener('abort', abortHandler);
    }
    try {
      await proc.dispose();
    } catch {
      /* best-effort */
    }
  }
}

function formatCombinedLog(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.length > 0) parts.push(stdout);
  if (stderr.length > 0) parts.push(stderr);
  return parts.join('\n');
}

async function readStreamWithCap(
  stream: Readable,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  try {
    for await (const chunk of stream) {
      const buf: Buffer =
        typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer);
      if (truncated) continue;
      if (total + buf.length > maxBytes) {
        const remaining = maxBytes - total;
        if (remaining > 0) chunks.push(buf.subarray(0, remaining));
        total = maxBytes;
        truncated = true;
        continue;
      }
      chunks.push(buf);
      total += buf.length;
    }
  } catch {
    /* stream closed mid-read — return what we have */
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return {
    text: truncated ? `${text}\n[stdout/stderr truncated at ${String(maxBytes)} bytes]` : text,
    truncated,
  };
}
