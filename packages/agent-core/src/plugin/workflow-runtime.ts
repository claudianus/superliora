import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export interface WorkflowMeta {
  readonly name: string;
  readonly description?: string;
}

export interface WorkflowAgentOptions {
  readonly schema?: unknown;
  readonly label?: string;
  readonly model?: string;
}

export type WorkflowAgentFn = (
  prompt: string,
  options?: WorkflowAgentOptions,
) => Promise<unknown>;

export interface WorkflowRunResult {
  readonly meta: WorkflowMeta;
  readonly value: unknown;
  readonly agentCalls: number;
}

const MAX_CONCURRENT = 16;
const MAX_TOTAL_AGENTS = 1000;

/**
 * Execute a Claude-style dynamic workflow script in an isolated VM.
 * Scripts get `agent` / `pipeline` only — no fs/shell/require.
 */
export async function runWorkflowScript(input: {
  readonly source: string;
  readonly filePath?: string;
  readonly agent: WorkflowAgentFn;
  readonly signal?: AbortSignal;
  readonly resumeCache?: Map<string, unknown>;
}): Promise<WorkflowRunResult> {
  const meta = extractMeta(input.source) ?? {
    name: basenameFallback(input.filePath),
  };
  const body = stripExportMeta(input.source);
  let agentCalls = 0;
  let inFlight = 0;
  const cache = input.resumeCache ?? new Map<string, unknown>();

  const agent: WorkflowAgentFn = async (prompt, options) => {
    if (input.signal?.aborted) {
      throw new Error('Workflow aborted');
    }
    if (agentCalls >= MAX_TOTAL_AGENTS) {
      throw new Error(`Workflow exceeded ${MAX_TOTAL_AGENTS} agent calls`);
    }
    while (inFlight >= MAX_CONCURRENT) {
      await new Promise((r) => setTimeout(r, 10));
      if (input.signal?.aborted) throw new Error('Workflow aborted');
    }
    const cacheKey =
      options?.label !== undefined && options.label.length > 0
        ? `label:${options.label}`
        : `prompt:${prompt}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
    inFlight += 1;
    agentCalls += 1;
    try {
      const result = await input.agent(prompt, options);
      cache.set(cacheKey, result);
      return result;
    } finally {
      inFlight -= 1;
    }
  };

  const pipeline = async <T, R>(
    items: readonly T[],
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> => {
    const results: R[] = Array.from({ length: items.length });
    let next = 0;
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await fn(items[index]!, index);
      }
    });
    await Promise.all(workers);
    return results;
  };

  const context = vm.createContext({
    agent,
    pipeline,
    console: {
      log: (...args: unknown[]) => {
        void args;
      },
      warn: (...args: unknown[]) => {
        void args;
      },
      error: (...args: unknown[]) => {
        void args;
      },
    },
    meta,
  });

  const wrapped = `"use strict";\n(async () => {\n${body}\n})()`;
  const script = new vm.Script(wrapped, {
    filename: input.filePath ?? 'workflow.js',
  });
  const value = await script.runInContext(context, {
    timeout: 600_000,
    breakOnSigint: true,
  });
  return { meta, value, agentCalls };
}

export function extractMeta(source: string): WorkflowMeta | undefined {
  const match = /export\s+const\s+meta\s*=\s*(\{[\s\S]*?\n\})/.exec(source);
  if (match === null) return undefined;
  try {
    const obj = vm.runInNewContext(`(${match[1]})`, Object.create(null)) as {
      name?: unknown;
      description?: unknown;
    };
    if (typeof obj.name !== 'string' || obj.name.trim() === '') return undefined;
    return {
      name: obj.name.trim(),
      description: typeof obj.description === 'string' ? obj.description : undefined,
    };
  } catch {
    return undefined;
  }
}

function stripExportMeta(source: string): string {
  return source.replace(/export\s+const\s+meta\s*=\s*\{[\s\S]*?\n\}\s*;?\s*/, '');
}

function basenameFallback(filePath: string | undefined): string {
  if (filePath === undefined) return 'workflow';
  const base = filePath.split(/[/\\]/).pop() ?? 'workflow';
  return base.replace(/\.(m?js|cjs|ts)$/i, '');
}
