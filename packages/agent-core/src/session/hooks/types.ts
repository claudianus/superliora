import type { ContentPart } from '@superliora/kosong';

export const HOOK_EVENT_TYPES = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionResult',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'Interrupt',
  'SessionStart',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  // Claude Agent Teams lifecycle (hosted by UltraSwarm)
  'TaskCreated',
  'TaskCompleted',
  'TeammateIdle',
  'PreCompact',
  'PostCompact',
  'Notification',
] as const;

export type HookEventType = (typeof HOOK_EVENT_TYPES)[number];

export interface HookDef {
  readonly event: HookEventType;
  readonly matcher?: string;
  readonly command: string;
  readonly timeout?: number;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
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

export interface HookEngineOptions {
  readonly cwd?: string;
  readonly sessionId?: string;
  readonly onTriggered?: HookTriggeredCallback;
  readonly onResolved?: HookResolvedCallback;
}
