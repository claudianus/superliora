import { hookIfMatches } from '../../plugin/hook-if';
import { dispatchHook, hookDedupeKey } from './dispatch';
import type {
  HookBlockDecision,
  HookDef,
  HookEngineOptions,
  HookEngineTriggerArgs,
  HookHostServices,
  HookMatcherValue,
  HookResult,
} from './types';

const DEFAULT_HOOK_TIMEOUT_SECONDS = 30;
const TOOL_EVENTS_FOR_IF = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
]);

/**
 * Claude Agent Teams events ignore matchers and always fire.
 * (Keep UserPromptSubmit/Stop matcher filtering — SuperLiora configs rely on it.)
 */
const MATCHERLESS_EVENTS = new Set(['TaskCreated', 'TaskCompleted']);

export class HookEngine {
  private readonly byEvent = new Map<string, HookDef[]>();
  private readonly pendingTriggers = new Set<Promise<HookResult[]>>();
  private host: HookHostServices | undefined;

  constructor(
    hooks: readonly HookDef[] = [],
    private readonly options: HookEngineOptions = {},
  ) {
    this.host = options.host;
    for (const hook of hooks) {
      const entries = this.byEvent.get(hook.event) ?? [];
      entries.push(hook);
      this.byEvent.set(hook.event, entries);
    }
  }

  /** Attach/replace session-backed hosts for mcp_tool / prompt / agent hooks. */
  setHost(host: HookHostServices | undefined): void {
    this.host = host;
  }

  get summary(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [event, hooks] of this.byEvent.entries()) {
      result[event] = hooks.length;
    }
    return result;
  }

  trigger(event: string, args: HookEngineTriggerArgs = {}): Promise<HookResult[]> {
    try {
      return this.triggerInner(event, args).catch((): HookResult[] => []);
    } catch {
      return Promise.resolve([]);
    }
  }

  async triggerBlock(
    event: string,
    args: HookEngineTriggerArgs = {},
  ): Promise<HookBlockDecision | undefined> {
    return blockDecision(event, await this.trigger(event, args));
  }

  fireAndForgetTrigger(
    event: string,
    args: HookEngineTriggerArgs = {},
  ): Promise<HookResult[]> {
    let promise: Promise<HookResult[]>;
    try {
      promise = this.trigger(event, args).catch((): HookResult[] => []);
    } catch {
      promise = Promise.resolve([]);
    }
    this.pendingTriggers.add(promise);
    void promise.finally(() => {
      this.pendingTriggers.delete(promise);
    });
    return promise;
  }

  private async triggerInner(
    event: string,
    args: HookEngineTriggerArgs,
  ): Promise<HookResult[]> {
    const matcherValue = matcherValueText(args.matcherValue);
    const inputData = toHookInputData({
      hookEventName: event,
      sessionId: this.options.sessionId ?? '',
      cwd: this.options.cwd ?? '',
      ...args.inputData,
    });
    const matched = this.matchingHooks(event, matcherValue, inputData);
    if (matched.length === 0) return [];

    this.emitTriggered(event, matcherValue, matched.length);
    const startedAt = Date.now();
    const results = await Promise.all(
      matched.map((hook) =>
        dispatchHook(hook, inputData, {
          timeout: hook.timeout ?? DEFAULT_HOOK_TIMEOUT_SECONDS,
          cwd: hook.cwd ?? (this.options.cwd === '' ? undefined : this.options.cwd),
          env: hook.env,
          signal: args.signal,
          host: this.host,
          args: hook.args,
        }),
      ),
    );
    const { action, reason } = aggregateResults(event, results);
    this.emitResolved(event, matcherValue, action, reason, Date.now() - startedAt);
    return results;
  }

  private matchingHooks(
    event: string,
    matcherValue: string,
    inputData: Record<string, unknown>,
  ): HookDef[] {
    const seen = new Set<string>();
    const matched: HookDef[] = [];
    const ignoreMatcher = MATCHERLESS_EVENTS.has(event);
    const toolName =
      typeof inputData['tool_name'] === 'string'
        ? inputData['tool_name']
        : typeof inputData['toolName'] === 'string'
          ? inputData['toolName']
          : matcherValue;

    for (const hook of this.byEvent.get(event) ?? []) {
      if (!ignoreMatcher && !matches(hook.matcher ?? '', matcherValue)) continue;
      if (hook.if !== undefined && hook.if.trim() !== '') {
        if (!TOOL_EVENTS_FOR_IF.has(event)) continue;
        if (
          !hookIfMatches(hook.if, {
            toolName,
            toolInput: inputData['tool_input'] ?? inputData['toolInput'] ?? inputData,
          })
        ) {
          continue;
        }
      }
      const key = hookDedupeKey(hook);
      if (seen.has(key)) continue;
      seen.add(key);
      matched.push(hook);
    }

    return matched;
  }

  private emitTriggered(event: string, target: string, count: number): void {
    try {
      this.options.onTriggered?.(event, target, count);
    } catch {}
  }

  private emitResolved(
    event: string,
    target: string,
    action: string,
    reason: string | undefined,
    durationMs: number,
  ): void {
    try {
      this.options.onResolved?.(event, target, action, reason, durationMs);
    } catch {}
  }
}

function matches(pattern: string, value: string): boolean {
  if (pattern.length === 0) return true;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function matcherValueText(value: HookMatcherValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return value
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ');
}

function aggregateResults(
  event: string,
  results: readonly HookResult[],
): {
  readonly action: 'allow' | 'block' | 'halt';
  readonly reason?: string;
} {
  const halt = results.find((result) => result.halt === true);
  if (halt !== undefined) {
    return {
      action: 'halt',
      reason:
        (halt.stopReason?.trim() ??
          halt.reason?.trim() ??
          halt.message?.trim()) ||
        `Halted by ${event} hook`,
    };
  }
  const block = blockDecision(event, results);
  if (block !== undefined) {
    return { action: 'block', reason: block.reason };
  }
  return { action: 'allow' };
}

function blockDecision(
  event: string,
  results: readonly HookResult[],
): HookBlockDecision | undefined {
  const block = results.find((result) => result.action === 'block');
  if (block === undefined) return undefined;
  const reason = block.reason?.trim();
  return {
    block: true,
    reason: reason === undefined || reason.length === 0 ? `Blocked by ${event} hook` : reason,
  };
}

function toHookInputData(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    result[camelToSnake(key)] = value;
  }
  return result;
}

function camelToSnake(value: string): string {
  return value.replaceAll(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}
