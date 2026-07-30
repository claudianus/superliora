import { resolveMcpServerRef } from '../../plugin/mcp-names';
import { runHook, hookResultFromOutput, type RunHookOptions } from './runner';
import type { HookActionType, HookDef, HookHostServices, HookResult } from './types';

export interface DispatchHookOptions extends RunHookOptions {
  /** Injectable for tests; defaults to global fetch. */
  readonly fetch?: typeof globalThis.fetch;
  readonly host?: HookHostServices;
}

/**
 * Dispatch a Claude-shaped hook action. TOML ingest always produces
 * `type: "command"` (or omitted type), so existing configs keep the shell path.
 */
export async function dispatchHook(
  hook: HookDef,
  input: Record<string, unknown>,
  options: DispatchHookOptions,
): Promise<HookResult> {
  const type: HookActionType = hook.type ?? 'command';
  switch (type) {
    case 'command':
      return runHook(hook.command, input, { ...options, args: hook.args ?? options.args });
    case 'http':
      return runHttpHook(hook, input, options);
    case 'mcp_tool':
      return runMcpToolHook(hook, input, options);
    case 'prompt':
    case 'agent':
      return runPromptLikeHook(type, hook, input, options);
    default: {
      const _exhaustive: never = type;
      return {
        action: 'allow',
        stderr: `Unknown hook type: ${String(_exhaustive)}`,
      };
    }
  }
}

async function runMcpToolHook(
  hook: HookDef,
  input: Record<string, unknown>,
  options: DispatchHookOptions,
): Promise<HookResult> {
  const server = hook.server?.trim() ?? '';
  const tool = hook.tool?.trim() ?? '';
  if (server.length === 0 || tool.length === 0) {
    return { action: 'allow', stderr: 'mcp_tool hook requires "server" and "tool"' };
  }
  const call = options.host?.callMcpTool;
  if (call === undefined) {
    return {
      action: 'allow',
      stderr: 'mcp_tool hook has no MCP host; skipped',
    };
  }
  const aliases = resolveMcpServerRef(server);
  const resolved = aliases[0] ?? server;
  try {
    let lastError: unknown;
    for (const alias of aliases.length > 0 ? aliases : [resolved]) {
      try {
        const result = await call(alias, tool, input, options.signal);
        const stdout = typeof result === 'string' ? result : JSON.stringify(result ?? {});
        return hookResultFromOutput(0, stdout, '');
      } catch (error) {
        lastError = error;
      }
    }
    return {
      action: 'allow',
      stderr: lastError instanceof Error ? lastError.message : String(lastError),
    };
  } catch (error) {
    return {
      action: 'allow',
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runPromptLikeHook(
  type: 'prompt' | 'agent',
  hook: HookDef,
  input: Record<string, unknown>,
  options: DispatchHookOptions,
): Promise<HookResult> {
  const prompt = hook.prompt?.trim() ?? '';
  if (prompt.length === 0) {
    return { action: 'allow', stderr: `${type} hook is missing "prompt"` };
  }
  const run = options.host?.runPrompt;
  if (run === undefined) {
    return {
      action: 'allow',
      stderr: `${type} hook has no LLM host; skipped`,
    };
  }
  try {
    const stdout = await run(prompt, input, options.signal);
    return hookResultFromOutput(0, stdout, '');
  } catch (error) {
    return {
      action: 'allow',
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runHttpHook(
  hook: HookDef,
  input: Record<string, unknown>,
  options: DispatchHookOptions,
): Promise<HookResult> {
  const url = hook.url?.trim() ?? '';
  if (url.length === 0) {
    return {
      action: 'allow',
      stderr: 'http hook is missing "url"',
    };
  }

  const timeoutMs =
    (Number.isFinite(options.timeout) && options.timeout > 0 ? options.timeout : 30) * 1000;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted === true) {
    onAbort();
  }
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      const structured = hookResultFromOutput(0, body, '');
      if (structured.action === 'block') {
        return {
          ...structured,
          stderr: `http ${response.status}: ${body}`.trim(),
        };
      }
      return {
        action: 'allow',
        stdout: body,
        stderr: `http ${response.status}`,
        exitCode: response.status,
      };
    }
    return hookResultFromOutput(0, body, '');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = controller.signal.aborted && options.signal?.aborted !== true;
    return {
      action: 'allow',
      stderr: message,
      timedOut: timedOut || undefined,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** Stable identity for deduping matched hooks in HookEngine. */
export function hookDedupeKey(hook: HookDef): string {
  const type = hook.type ?? 'command';
  switch (type) {
    case 'command':
      return `${hook.cwd ?? ''}\0command\0${hook.command}`;
    case 'http':
      return `${hook.cwd ?? ''}\0http\0${hook.url ?? ''}`;
    case 'mcp_tool':
      return `${hook.cwd ?? ''}\0mcp_tool\0${hook.server ?? ''}\0${hook.tool ?? ''}`;
    case 'prompt':
      return `${hook.cwd ?? ''}\0prompt\0${hook.prompt ?? ''}`;
    case 'agent':
      return `${hook.cwd ?? ''}\0agent\0${hook.prompt ?? ''}`;
    default: {
      const _exhaustive: never = type;
      return `${hook.cwd ?? ''}\0${String(_exhaustive)}`;
    }
  }
}
