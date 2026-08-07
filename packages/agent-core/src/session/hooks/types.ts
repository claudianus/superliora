import type { ContentPart } from '@superliora/kosong';

/**
 * Hook events — Claude Code set is the canonical list.
 * SuperLiora-only aliases kept for existing config.toml / engine call sites:
 * - Interrupt (CLI cancel)
 * - PermissionResult (fires alongside PermissionDenied on deny)
 */
export const HOOK_EVENT_TYPES = [
  // Claude Code lifecycle / tools
  'SessionStart',
  'Setup',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'PreToolUse',
  'PermissionRequest',
  'PermissionDenied',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'MessageDisplay',
  'SubagentStart',
  'SubagentStop',
  // Claude Agent Teams lifecycle + Claude Code extras
  'TaskCreated',
  'TaskCompleted',
  'Stop',
  'StopFailure',
  'InstructionsLoaded',
  'ConfigChange',
  'CwdChanged',
  'FileChanged',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreCompact',
  'PostCompact',
  'Elicitation',
  'ElicitationResult',
  'SessionEnd',
  // SuperLiora host extras (stable for existing configs)
  'PermissionResult',
  'Interrupt',
] as const;

export type HookEventType = (typeof HOOK_EVENT_TYPES)[number];

/** Claude hook action kinds. TOML ingest always produces `command`. */
export type HookActionType = 'command' | 'http' | 'prompt' | 'agent' | 'mcp_tool';

export interface HookDef {
  readonly event: HookEventType;
  readonly matcher?: string;
  /**
   * Shell command for `type: "command"` (default).
   * Non-command Claude actions may leave this empty and set `type` + fields below.
   */
  readonly command: string;
  /**
   * Exec-form argv for `type: "command"` (Claude `args`).
   * When set, the hook runs without a shell: `spawn(command, args)`.
   */
  readonly args?: readonly string[];
  /**
   * Claude permission-rule filter (`if`). Only evaluated on tool events;
   * on other events a set `if` skips the handler.
   */
  readonly if?: string;
  readonly timeout?: number;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Claude action type; omitted means command. */
  readonly type?: HookActionType;
  /** http */
  readonly url?: string;
  /** mcp_tool */
  readonly server?: string;
  readonly tool?: string;
  /** prompt / agent */
  readonly prompt?: string;
}

export interface HookResult {
  readonly action: 'allow' | 'block';
  readonly message?: string;
  readonly reason?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly timedOut?: boolean;
  readonly structuredOutput?: boolean;
  /**
   * Claude JSON `{"continue": false}` — stop the teammate/swarm entirely.
   * Distinct from `action: "block"` (exit 2), which keeps the teammate working.
   */
  readonly halt?: boolean;
  readonly stopReason?: string;
  /** Claude universal JSON field — warning shown to the user. */
  readonly systemMessage?: string;
}

export interface HookBlockDecision {
  readonly block: true;
  readonly reason: string;
}

export type HookMatcherValue = string | readonly ContentPart[];

export interface HookEngineTriggerArgs {
  readonly matcherValue?: HookMatcherValue;
  readonly inputData?: Record<string, unknown>;
  readonly signal?: AbortSignal;
}

export type HookTriggeredCallback = (event: string, target: string, count: number) => void;

export type HookResolvedCallback = (
  event: string,
  target: string,
  action: string,
  reason: string | undefined,
  durationMs: number,
) => void;

export interface HookHostServices {
  /**
   * Invoke an MCP tool by server + tool name.
   * Server may be a bare plugin server name or `plugin:<id>:<server>`.
   */
  readonly callMcpTool?: (
    server: string,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  /** One-shot tools-off LLM completion for prompt/agent hooks. */
  readonly runPrompt?: (
    prompt: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<string>;
}

export interface HookEngineOptions {
  readonly cwd?: string;
  readonly sessionId?: string;
  readonly onTriggered?: HookTriggeredCallback;
  readonly onResolved?: HookResolvedCallback;
  readonly host?: HookHostServices;
}
