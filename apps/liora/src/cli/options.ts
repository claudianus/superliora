import { t } from '#/cli/i18n';

export type UIMode = 'shell' | 'print';
export type PromptOutputFormat = 'text' | 'stream-json';

export interface CLIOptions {
  session: string | undefined;
  continue: boolean;
  yolo: boolean;
  auto: boolean;
  plan: boolean;
  model: string | undefined;
  outputFormat: PromptOutputFormat | undefined;
  showThinking?: boolean;
  prompt: string | undefined;
  skillsDirs: string[];
  pluginDirs: string[];
  /** Opt-in Claude channel server names (`--channels`). */
  channelServers: string[];
  addDirs?: string[];
  /**
   * Path-sandbox profile for file tools (`off` | `workspace` | `read-only`).
   * Lexical guard only — not OS isolation.
   */
  sandbox?: string;
  /** How hard to enforce the path sandbox (`lexical` | `process`). */
  sandboxEnforcement?: string;
  /** Skip Docker / Job Object wrap even when enforcement is process. */
  noProcessSandbox?: boolean;
  /** Automatically resume the first goal in the queue on startup. */
  resumeGoal?: boolean;
  /**
   * Shell command gating goal completion (`--autonomous-gate`): every
   * completion attempt runs it and a non-zero exit keeps the goal loop going.
   * Headless `-p "/goal ..."` runs only.
   */
  autonomousGate?: string;
  /** Main agent tool profile override (sets SUPERLIORA_PROFILE for this process). */
  profile?: string;
  /**
   * Create a git worktree for this session (opt-in).
   * - `true`: auto-generated name
   * - `string`: explicit worktree name/slug
   */
  worktree?: boolean | string;
}

export interface ValidatedOptions {
  options: CLIOptions;
  uiMode: UIMode;
}

export class OptionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptionConflictError';
  }
}

export function sandboxSessionMetadata(opts: CLIOptions): Record<string, string> {
  const meta: Record<string, string> = {};
  if (opts.sandbox === 'off' || opts.sandbox === 'workspace' || opts.sandbox === 'read-only') {
    meta['sandboxProfile'] = opts.sandbox;
  }
  if (opts.sandboxEnforcement === 'lexical' || opts.sandboxEnforcement === 'process') {
    meta['sandboxEnforcement'] = opts.sandboxEnforcement;
  }
  return meta;
}

export function applyNoProcessSandboxFlag(opts: CLIOptions): void {
  if (opts.noProcessSandbox === true) {
    process.env['SUPERLIORA_NO_PROCESS_SANDBOX'] = '1';
  }
}

export function validateOptions(opts: CLIOptions): ValidatedOptions {
  const prompt = opts.prompt;
  const promptMode = prompt !== undefined;
  if (promptMode && prompt.trim().length === 0) {
    throw new OptionConflictError(t('cli.runtime.options.promptEmpty'));
  }
  if (opts.model !== undefined && opts.model.trim().length === 0) {
    throw new OptionConflictError(t('cli.runtime.options.modelEmpty'));
  }
  if (!promptMode && opts.outputFormat !== undefined) {
    throw new OptionConflictError(t('cli.runtime.options.outputFormatPromptOnly'));
  }
  if (!promptMode && opts.showThinking === true) {
    throw new OptionConflictError(t('cli.runtime.options.showThinkingPromptOnly'));
  }
  if (promptMode && opts.yolo) {
    throw new OptionConflictError(t('cli.runtime.options.promptWithYolo'));
  }
  if (promptMode && opts.auto) {
    throw new OptionConflictError(t('cli.runtime.options.promptWithAuto'));
  }
  if (promptMode && opts.plan) {
    throw new OptionConflictError(t('cli.runtime.options.promptWithPlan'));
  }
  if (promptMode && opts.session === '') {
    throw new OptionConflictError(t('cli.runtime.options.sessionNoIdPrompt'));
  }
  if (opts.continue && opts.session !== undefined) {
    throw new OptionConflictError(t('cli.runtime.options.continueWithSession'));
  }
  if (opts.yolo && opts.auto) {
    throw new OptionConflictError(t('cli.runtime.options.yoloWithAuto'));
  }
  if (opts.worktree !== undefined && opts.worktree !== false) {
    if (opts.session !== undefined || opts.continue) {
      throw new OptionConflictError(t('cli.runtime.options.worktreeWithResume'));
    }
  }
  if (opts.autonomousGate !== undefined) {
    const goalPrompt = promptMode && /^\/goal(\s|$)/.test(prompt.trim());
    if (!goalPrompt) {
      throw new OptionConflictError(t('cli.runtime.options.autonomousGateNeedsGoal'));
    }
  }
  return { options: opts, uiMode: promptMode ? 'print' : 'shell' };
}
