import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { HookDefSchema } from '../config/schema';
import {
  HOOK_EVENT_TYPES,
  type HookActionType,
  type HookDef,
  type HookEventType,
} from '../session/hooks/types';
import { expandPluginPlaceholders } from './expand';
import { isFile, isObject, resolvePluginPath } from './paths';
import type { PluginDiagnostic } from './types';

const SUPPORTED_EVENTS = new Set<string>(HOOK_EVENT_TYPES);
const ACTION_TYPES = new Set<string>(['command', 'http', 'prompt', 'agent', 'mcp_tool']);

type ExpandVars = {
  readonly pluginRoot: string;
  readonly pluginData: string;
  readonly projectDir: string;
};

/**
 * Load Claude nested hooks (inline object, path string/array, or default
 * `hooks/hooks.json`) and flatten to runtime {@link HookDef}s.
 * TOML `[[hooks]]` stays on {@link HookDefSchema} (command-only).
 */
export async function loadClaudeHooks(input: {
  readonly pluginRoot: string;
  readonly raw: unknown;
  readonly vars: ExpandVars;
  readonly diagnostics: PluginDiagnostic[];
  /** When true, also try default `./hooks/hooks.json` if raw is undefined. */
  readonly useDefault: boolean;
}): Promise<readonly HookDef[]> {
  const sources: unknown[] = [];

  if (input.raw === undefined) {
    if (input.useDefault) {
      const defaultPath = path.join(input.pluginRoot, 'hooks', 'hooks.json');
      if (await isFile(defaultPath)) {
        sources.push(await readJsonFile(defaultPath, input.diagnostics));
      }
    }
  } else if (typeof input.raw === 'string' || Array.isArray(input.raw)) {
    const entries =
      typeof input.raw === 'string'
        ? [input.raw]
        : input.raw.every((e) => typeof e === 'string')
          ? (input.raw as string[])
          : undefined;
    if (entries === undefined) {
      input.diagnostics.push({
        severity: 'warn',
        message: '"hooks" path list must be a string or string[]',
      });
    } else {
      for (const entry of entries) {
        const resolved = await resolvePluginPath({
          pluginRoot: input.pluginRoot,
          field: 'hooks',
          value: entry,
          diagnostics: input.diagnostics,
        });
        if (resolved === undefined) continue;
        if (!(await isFile(resolved))) {
          input.diagnostics.push({
            severity: 'warn',
            message: `"hooks" path is not a file (${entry})`,
          });
          continue;
        }
        sources.push(await readJsonFile(resolved, input.diagnostics));
      }
    }
  } else if (isObject(input.raw)) {
    sources.push(input.raw);
  } else {
    input.diagnostics.push({
      severity: 'warn',
      message: '"hooks" must be an object, path string, or string[]',
    });
  }

  const out: HookDef[] = [];
  for (const source of sources) {
    if (source === undefined) continue;
    out.push(...flattenClaudeHooks(source, input.vars, input.diagnostics));
  }
  return out;
}

function flattenClaudeHooks(
  raw: unknown,
  vars: ExpandVars,
  diagnostics: PluginDiagnostic[],
): HookDef[] {
  if (!isObject(raw)) {
    diagnostics.push({ severity: 'warn', message: 'hooks config must be a JSON object' });
    return [];
  }

  // Accept either `{ hooks: { Event: [...] } }` or bare `{ Event: [...] }`.
  const table = isObject(raw['hooks']) ? (raw['hooks'] as Record<string, unknown>) : raw;
  const out: HookDef[] = [];

  for (const [event, matchers] of Object.entries(table)) {
    if (event === '$schema') continue;
    if (!SUPPORTED_EVENTS.has(event)) {
      diagnostics.push({
        severity: 'info',
        message: `Unknown hook event "${event}"; ignored`,
      });
      continue;
    }
    if (!Array.isArray(matchers)) {
      diagnostics.push({
        severity: 'warn',
        message: `hooks.${event} must be an array`,
      });
      continue;
    }
    for (const matcherEntry of matchers) {
      if (!isObject(matcherEntry)) continue;
      const matcher =
        typeof matcherEntry['matcher'] === 'string' ? matcherEntry['matcher'] : undefined;
      const hooks = matcherEntry['hooks'];
      if (!Array.isArray(hooks)) {
        // Flat SuperLiora-style entry inside Claude file — try TOML schema.
        const flat = HookDefSchema.safeParse({ ...matcherEntry, event });
        if (flat.success) {
          out.push(expandCommandHook(flat.data, vars));
        }
        continue;
      }
      for (const hook of hooks) {
        if (!isObject(hook)) continue;
        const parsed = parseClaudeActionHook(event as HookEventType, matcher, hook, vars, diagnostics);
        if (parsed !== undefined) {
          out.push(parsed);
        }
      }
    }
  }
  return out;
}

function parseClaudeActionHook(
  event: HookEventType,
  matcher: string | undefined,
  hook: Record<string, unknown>,
  vars: ExpandVars,
  diagnostics: PluginDiagnostic[],
): HookDef | undefined {
  const typeRaw = typeof hook['type'] === 'string' ? hook['type'] : 'command';
  if (!ACTION_TYPES.has(typeRaw)) {
    diagnostics.push({
      severity: 'info',
      message: `Unknown hook type "${typeRaw}" on ${event}; ignored`,
    });
    return undefined;
  }
  const type = typeRaw as HookActionType;
  const timeout =
    typeof hook['timeout'] === 'number' && Number.isFinite(hook['timeout'])
      ? hook['timeout']
      : undefined;
  const ifRule = typeof hook['if'] === 'string' ? hook['if'] : undefined;
  const args = Array.isArray(hook['args'])
    ? hook['args'].filter((v): v is string => typeof v === 'string')
    : undefined;

  switch (type) {
    case 'command': {
      const command = typeof hook['command'] === 'string' ? hook['command'] : undefined;
      if (command === undefined || command.trim() === '') {
        diagnostics.push({
          severity: 'warn',
          message: `hooks.${event} command hook is missing "command"`,
        });
        return undefined;
      }
      return {
        event,
        matcher,
        type: 'command',
        command: expandPluginPlaceholders(command, vars),
        args: args?.map((a) => expandPluginPlaceholders(a, vars)),
        if: ifRule,
        timeout,
      };
    }
    case 'http': {
      const url = typeof hook['url'] === 'string' ? hook['url'] : undefined;
      if (url === undefined || url.trim() === '') {
        diagnostics.push({
          severity: 'warn',
          message: `hooks.${event} http hook is missing "url"`,
        });
        return undefined;
      }
      return {
        event,
        matcher,
        type: 'http',
        command: '',
        url: expandPluginPlaceholders(url, vars),
        if: ifRule,
        timeout,
      };
    }
    case 'mcp_tool': {
      const server = typeof hook['server'] === 'string' ? hook['server'] : undefined;
      const tool = typeof hook['tool'] === 'string' ? hook['tool'] : undefined;
      if (server === undefined || server.trim() === '' || tool === undefined || tool.trim() === '') {
        diagnostics.push({
          severity: 'warn',
          message: `hooks.${event} mcp_tool hook requires "server" and "tool"`,
        });
        return undefined;
      }
      return {
        event,
        matcher,
        type: 'mcp_tool',
        command: '',
        server: expandPluginPlaceholders(server, vars),
        tool: expandPluginPlaceholders(tool, vars),
        if: ifRule,
        timeout,
      };
    }
    case 'prompt':
    case 'agent': {
      const prompt = typeof hook['prompt'] === 'string' ? hook['prompt'] : undefined;
      if (prompt === undefined || prompt.trim() === '') {
        diagnostics.push({
          severity: 'warn',
          message: `hooks.${event} ${type} hook is missing "prompt"`,
        });
        return undefined;
      }
      return {
        event,
        matcher,
        type,
        command: '',
        prompt: expandPluginPlaceholders(prompt, vars),
        if: ifRule,
        timeout,
      };
    }
    default: {
      const _exhaustive: never = type;
      diagnostics.push({
        severity: 'info',
        message: `Unknown hook type "${String(_exhaustive)}" on ${event}; ignored`,
      });
      return undefined;
    }
  }
}

function expandCommandHook(
  hook: { event: HookEventType; matcher?: string; command: string; timeout?: number },
  vars: ExpandVars,
): HookDef {
  return {
    event: hook.event,
    matcher: hook.matcher,
    type: 'command',
    command: expandPluginPlaceholders(hook.command, vars),
    timeout: hook.timeout,
  };
}

async function readJsonFile(
  filePath: string,
  diagnostics: PluginDiagnostic[],
): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    diagnostics.push({
      severity: 'warn',
      message: `Failed to parse ${path.basename(filePath)}: ${(error as Error).message}`,
    });
    return undefined;
  }
}
