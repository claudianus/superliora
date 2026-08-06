/**
 * ScriptTool — programmatic tool calling (prime's PTC, 80/20 port).
 *
 * The agent writes one JS snippet; the snippet calls read/write/glob/exec/
 * agent as plain functions and processes results in code, so bulk work
 * (read 100 files, aggregate, fan out subagents over items) no longer pays
 * one LLM round-trip per item and never floods the context with raw dumps.
 * The vm context persists per agent: the `store` object carries state
 * across calls within the session.
 *
 * node:vm is NOT a security boundary and doesn't need to be: the agent
 * already holds Bash. The value is persistence and structured I/O.
 */

import vm from 'node:vm';

import { z } from 'zod';
import type { Kaos } from '@superliora/kaos';

import type { Agent } from '../../../agent/index';
import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './script.md?raw';

export const ScriptToolInputSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .describe(
        'JavaScript to run (async). Available: read(path), write(path, text), glob(pattern), exec(command), agent(prompt, profile?), sleep(ms), store (persistent object), console.log. `return` the final summary.',
      ),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .max(600_000)
      .default(120_000)
      .describe('Wall-clock budget for the whole script.'),
  })
  .strict();

export type ScriptToolInput = z.infer<typeof ScriptToolInputSchema>;

const OUTPUT_MAX_CHARS = 8_000;
const EXEC_OUTPUT_MAX_CHARS = 32_000;
const GLOB_MAX_RESULTS = 1_000;

export class ScriptTool implements BuiltinTool<ScriptToolInput> {
  readonly name = 'Script' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ScriptToolInputSchema);

  private context: vm.Context | null = null;
  private logBuffer: string[] = [];
  // Script runs share the persistent context, so serialize them per agent —
  // concurrent runs would clobber each other's console buffer and `store`.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly agent: Agent,
    private readonly kaos: Kaos,
  ) {}

  resolveExecution(args: ScriptToolInput): ToolExecution {
    return {
      accesses: ToolAccesses.all(),
      description: 'Running a script',
      approvalRule: this.name,
      execute: async (ctx) => {
        const run = this.queue.then(async () => this.runGuarded(args, ctx));
        this.queue = run.catch(() => {});
        return run;
      },
    };
  }

  private async runGuarded(
    args: ScriptToolInput,
    ctx: ExecutableToolContext,
  ): Promise<{ readonly output: string; readonly isError?: boolean }> {
    try {
      return { output: await this.run(args.code, args.timeout_ms, ctx) };
    } catch (error) {
      return {
        output: `Script error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  private async run(
    code: string,
    timeoutMs: number,
    ctx: ExecutableToolContext,
  ): Promise<string> {
    if (this.context === null) {
      this.context = vm.createContext(this.buildSandbox(ctx));
    }
    const context = this.context;
    this.logBuffer = [];
    const wrapped = `(async () => {\n${code}\n})()`;
    const script = new vm.Script(wrapped, { filename: 'script-tool.js' });
    const result: unknown = script.runInContext(context, { timeout: timeoutMs });
    // Cross-realm: the async wrapper returns the CONTEXT's Promise, so
    // instanceof checks fail — thenable check is the honest test.
    if (typeof (result as { then?: unknown } | null)?.then !== 'function') {
      throw new TypeError('internal: wrapped script did not return a promise');
    }
    let timer: NodeJS.Timeout | undefined;
    let abortReject: ((error: Error) => void) | undefined;
    const onAbort = (): void => abortReject?.(new Error('script aborted'));
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const value = await Promise.race([
        result as Promise<unknown>,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`script timed out after ${String(timeoutMs)}ms`));
          }, timeoutMs);
        }),
        new Promise((_, reject) => {
          abortReject = reject;
        }),
      ]);
      return this.renderOutput(value);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      ctx.signal.removeEventListener('abort', onAbort);
    }
  }

  private renderOutput(value: unknown): string {
    const parts = [...this.logBuffer];
    if (value !== undefined) {
      parts.push(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    }
    const text = parts.length > 0 ? parts.join('\n') : '(script completed with no output)';
    if (text.length <= OUTPUT_MAX_CHARS) return text;
    return `${text.slice(0, OUTPUT_MAX_CHARS)}\n…[output truncated at ${String(OUTPUT_MAX_CHARS)} chars]`;
  }

  private buildSandbox(ctx: ExecutableToolContext): Record<string, unknown> {
    const kaos = this.kaos;
    const cwd = this.agent.config.cwd;
    const resolvePath = (path: string): string => {
      return path.startsWith('/') ? path : `${cwd}/${path}`;
    };
    const pushLog = (...values: unknown[]): void => {
      this.logBuffer.push(
        values
          .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
          .join(' '),
      );
    };
    const sandbox: Record<string, unknown> = {
      store: {},
      console: { log: pushLog, info: pushLog, warn: pushLog, error: pushLog },
      sleep: async (ms: number): Promise<void> => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, ms);
        });
      },
      read: async (path: string): Promise<string> => kaos.readText(resolvePath(path)),
      write: async (path: string, content: string): Promise<void> => {
        await kaos.writeText(resolvePath(path), content);
      },
      glob: async (pattern: string): Promise<string[]> => {
        const out: string[] = [];
        for await (const match of kaos.glob(cwd, pattern)) {
          out.push(match);
          if (out.length >= GLOB_MAX_RESULTS) break;
        }
        return out;
      },
      exec: async (command: string): Promise<{ stdout: string; stderr: string; code: number }> => {
        const proc = await kaos.exec('bash', '-lc', command);
        const [stdout, stderr, code] = await Promise.all([
          collectStream(proc.stdout, EXEC_OUTPUT_MAX_CHARS),
          collectStream(proc.stderr, EXEC_OUTPUT_MAX_CHARS),
          proc.wait(),
        ]);
        await proc.dispose();
        return { stdout, stderr, code };
      },
    };
    const host = this.agent.type === 'main' ? this.agent.subagentHost : undefined;
    if (host != null) {
      sandbox['agent'] = async (prompt: string, profile?: string): Promise<string> => {
        const handle = await host.spawn({
          profileName: profile ?? 'coder',
          parentToolCallId: ctx.toolCallId,
          prompt,
          description: prompt.replaceAll('\n', ' ').slice(0, 80),
          runInBackground: false,
          signal: ctx.signal,
        });
        const completion = await handle.completion;
        return completion.result;
      };
    }
    return sandbox;
  }
}

async function collectStream(stream: NodeJS.ReadableStream, cap: number): Promise<string> {
  let text = '';
  for await (const chunk of stream) {
    if (text.length < cap) text += String(chunk as Buffer | string);
  }
  return text.length <= cap ? text : `${text.slice(0, cap)}\n…[truncated]`;
}
