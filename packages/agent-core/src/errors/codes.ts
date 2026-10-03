/**
 * Error codes for Kimi Core's public error protocol.
 *
 * `ErrorCodes` is the source of truth for every code Kimi Core may emit.
 * Downstream consumers (SDK, RPC clients, telemetry, agent-facing docs)
 * should depend on these string values rather than on class identity.
 *
 * Codes follow `domain.reason`. Adding a code is a minor change; renaming
 * or removing one is a major change.
 */
export const ErrorCodes = {
  CONFIG_INVALID: 'config.invalid',

  SESSION_NOT_FOUND: 'session.not_found',
  SESSION_ALREADY_EXISTS: 'session.already_exists',
  SESSION_ID_INVALID: 'session.id_invalid',
  SESSION_ID_REQUIRED: 'session.id_required',
  SESSION_ID_EMPTY: 'session.id_empty',
  SESSION_TITLE_EMPTY: 'session.title_empty',
  SESSION_STATE_NOT_FOUND: 'session.state_not_found',
  SESSION_STATE_INVALID: 'session.state_invalid',
  SESSION_FORK_ACTIVE_TURN: 'session.fork_active_turn',
  SESSION_EXPORT_NOT_FOUND: 'session.export_not_found',
  SESSION_EXPORT_MISSING_VERSION: 'session.export_missing_version',
  SESSION_CLOSED: 'session.closed',
  SESSION_PERMISSION_MODE_INVALID: 'session.permission_mode_invalid',
  SESSION_THINKING_EMPTY: 'session.thinking_empty',
  SESSION_MODEL_EMPTY: 'session.model_empty',
  SESSION_APPROVAL_HANDLER_ERROR: 'session.approval_handler_error',
  SESSION_QUESTION_HANDLER_ERROR: 'session.question_handler_error',
  SESSION_CREDENTIAL_HANDLER_ERROR: 'session.credential_handler_error',
  SESSION_INIT_FAILED: 'session.init_failed',

  WORKTREE_NOT_A_GIT_REPO: 'worktree.not_a_git_repo',
  WORKTREE_NAME_INVALID: 'worktree.name_invalid',
  WORKTREE_NAME_AMBIGUOUS: 'worktree.name_ambiguous',
  WORKTREE_ALREADY_EXISTS: 'worktree.already_exists',
  WORKTREE_CREATE_FAILED: 'worktree.create_failed',
  WORKTREE_NOT_FOUND: 'worktree.not_found',

  AGENT_NOT_FOUND: 'agent.not_found',
  TURN_AGENT_BUSY: 'turn.agent_busy',

  MODEL_NOT_CONFIGURED: 'model.not_configured',
  MODEL_CONFIG_INVALID: 'model.config_invalid',
  AUTH_LOGIN_REQUIRED: 'auth.login_required',

  CONTEXT_OVERFLOW: 'context.overflow',
  LOOP_MAX_STEPS_EXCEEDED: 'loop.max_steps_exceeded',
  PROVIDER_API_ERROR: 'provider.api_error',
  PROVIDER_RATE_LIMIT: 'provider.rate_limit',
  PROVIDER_AUTH_ERROR: 'provider.auth_error',
  PROVIDER_CONNECTION_ERROR: 'provider.connection_error',

  RECORDS_WRITE_FAILED: 'records.write_failed',
  STORAGE_DISK_FULL: 'storage.disk_full',
  COMPACTION_FAILED: 'compaction.failed',
  COMPACTION_UNABLE: 'compaction.unable',

  BACKGROUND_TASK_ID_EMPTY: 'background.task_id_empty',
  REQUEST_INVALID: 'request.invalid',
  REQUEST_WORK_DIR_REQUIRED: 'request.work_dir_required',
  REQUEST_PROMPT_INPUT_EMPTY: 'request.prompt_input_empty',

  SHELL_GIT_BASH_NOT_FOUND: 'shell.git_bash_not_found',

  NOT_IMPLEMENTED: 'not_implemented',
  INTERNAL: 'internal',
} as const;

export type LioraErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface LioraErrorInfo {
  readonly title: string;
  readonly retryable: boolean;
  /**
   * Whether the code is a stable public contract. `false` reserves the
   * right to rename or remove without a major version bump.
   */
  readonly public: boolean;
  readonly action?: string;
}

export const KIMI_ERROR_INFO = {
  'config.invalid': {
    title: 'Invalid configuration',
    retryable: false,
    public: true,
    action: 'Check config.toml and provider/model settings.',
  },

  'session.not_found': {
    title: 'Session not found',
    retryable: false,
    public: true,
    action: 'Check the session id or list available sessions.',
  },
  'session.already_exists': {
    title: 'Session already exists',
    retryable: false,
    public: true,
    action: 'Use a different session id or remove the existing session first.',
  },
  'session.id_invalid': {
    title: 'Invalid session id',
    retryable: false,
    public: true,
    action: 'Use a session id without path-traversal characters.',
  },
  'session.id_required': {
    title: 'Session id required',
    retryable: false,
    public: true,
    action: 'Provide a session id when calling this method.',
  },
  'session.id_empty': {
    title: 'Session id is empty',
    retryable: false,
    public: true,
    action: 'Provide a non-empty session id.',
  },
  'session.title_empty': {
    title: 'Session title is empty',
    retryable: false,
    public: true,
    action: 'Provide a non-empty session title.',
  },
  'session.state_not_found': {
    title: 'Session state missing',
    retryable: false,
    public: true,
    action: 'The session directory is corrupted or missing state.json.',
  },
  'session.state_invalid': {
    title: 'Session state invalid',
    retryable: false,
    public: true,
    action: 'The session state.json is corrupted; remove the session or repair the file.',
  },
  'session.fork_active_turn': {
    title: 'Cannot fork session during active turn',
    retryable: true,
    public: true,
    action: 'Wait for the active turn to complete before forking.',
  },
  'session.export_not_found': {
    title: 'Session export directory missing',
    retryable: false,
    public: true,
    action: 'The session has not been persisted to disk yet.',
  },
  'session.export_missing_version': {
    title: 'Export version is missing',
    retryable: false,
    public: true,
    action: 'Provide a version when exporting the session.',
  },
  'session.closed': {
    title: 'Session is closed',
    retryable: false,
    public: true,
    action: 'Create a new session.',
  },

  'worktree.not_a_git_repo': {
    title: 'Not a git repository',
    retryable: false,
    public: true,
    action: 'Run from inside a git checkout, or pass a path that is a git repository.',
  },
  'worktree.name_invalid': {
    title: 'Invalid worktree name',
    retryable: false,
    public: true,
    action: 'Use a short name without path separators (e.g. fix-auth).',
  },
  'worktree.name_ambiguous': {
    title: 'Ambiguous worktree name',
    retryable: false,
    public: true,
    action: 'Pass the full worktree path, or filter by repository root.',
  },
  'worktree.already_exists': {
    title: 'Worktree already exists',
    retryable: false,
    public: true,
    action: 'Choose a different name or remove the existing worktree first.',
  },
  'worktree.create_failed': {
    title: 'Failed to create worktree',
    retryable: true,
    public: true,
    action: 'Check git status, branch name conflicts, and disk permissions.',
  },
  'worktree.not_found': {
    title: 'Worktree not found',
    retryable: false,
    public: true,
    action: 'List worktrees with `liora worktree list` and use a known name or path.',
  },
  'session.permission_mode_invalid': {
    title: 'Invalid permission mode',
    retryable: false,
    public: true,
    action: 'Use one of: yolo / manual / auto.',
  },
  'session.thinking_empty': {
    title: 'Thinking value is empty',
    retryable: false,
    public: true,
    action: 'Provide a non-empty thinking option.',
  },
  'session.model_empty': {
    title: 'Model is empty',
    retryable: false,
    public: true,
    action: 'Provide a non-empty model identifier.',
  },
  'session.approval_handler_error': {
    title: 'Approval handler threw',
    retryable: false,
    public: true,
    action: 'Inspect the SDK approval handler for an unhandled exception.',
  },
  'session.question_handler_error': {
    title: 'Question handler threw',
    retryable: false,
    public: true,
    action: 'Inspect the SDK question handler for an unhandled exception.',
  },
  'session.credential_handler_error': {
    title: 'Credential handler threw',
    retryable: false,
    public: true,
    action: 'Inspect the SDK credential handler for an unhandled exception.',
  },
  'session.init_failed': {
    title: 'Session init failed',
    retryable: false,
    public: false,
    action: 'Review the init failure details and try again.',
  },

  'agent.not_found': {
    title: 'Agent not found',
    retryable: false,
    public: true,
    action: 'Check the agent id or list available agents.',
  },
  'turn.agent_busy': {
    title: 'Agent is busy',
    retryable: true,
    public: true,
    action: 'Wait for the current turn to finish or steer it.',
  },

  'model.not_configured': {
    title: 'No model configured',
    retryable: false,
    public: true,
    action: 'Set a default model in config.toml or via setModel.',
  },
  'model.config_invalid': {
    title: 'Invalid model configuration',
    retryable: false,
    public: true,
    action: 'Check the model and provider entries in config.toml.',
  },
  'auth.login_required': {
    title: 'Login required',
    retryable: false,
    public: true,
    action: 'Run the login flow for the provider before retrying.',
  },

  'context.overflow': {
    title: 'Context window overflow',
    retryable: true,
    public: true,
    action: 'Compact the conversation or start a new session.',
  },
  'loop.max_steps_exceeded': {
    title: 'Turn exceeded max steps',
    retryable: false,
    public: true,
    action: 'Increase loop_control.max_steps_per_turn in config.toml or split the task.',
  },
  'provider.api_error': {
    title: 'Provider API error',
    retryable: false,
    public: true,
    action: 'Inspect details.statusCode / details.requestId; check provider status.',
  },
  'provider.rate_limit': {
    title: 'Provider rate limit',
    retryable: true,
    public: true,
    action: 'Retry after a delay or reduce request frequency.',
  },
  'provider.auth_error': {
    title: 'Provider authentication error',
    retryable: false,
    public: true,
    action: 'Re-authenticate with the provider.',
  },
  'provider.connection_error': {
    title: 'Provider connection error',
    retryable: true,
    public: true,
    action: 'Check network connectivity and retry.',
  },

  'records.write_failed': {
    title: 'Failed to write records',
    retryable: true,
    public: true,
    action: 'Check disk space and permissions on the session directory.',
  },
  'storage.disk_full': {
    title: 'Disk is full',
    retryable: true,
    public: true,
    action: 'Stop large writes. The harness will reclaim cache/tmp/logs, then ask before deleting idle sessions.',
  },
  'compaction.failed': {
    title: 'Compaction failed',
    retryable: false,
    public: true,
    action: 'Inspect logs and consider increasing compaction limits.',
  },
  'compaction.unable': {
    title: 'Unable to compact',
    retryable: false,
    public: true,
    action: 'The current history has no prefix that can be compacted (e.g. only a pending user message). Start a new turn or session instead.',
  },

  'background.task_id_empty': {
    title: 'Background task id is empty',
    retryable: false,
    public: true,
    action: 'Provide a non-empty task id.',
  },
  'request.invalid': {
    title: 'Invalid request',
    retryable: false,
    public: true,
    action: 'Check the input shape matches the API contract.',
  },
  'request.work_dir_required': {
    title: 'workDir is required',
    retryable: false,
    public: true,
    action: 'Provide workDir in the request payload.',
  },
  'request.prompt_input_empty': {
    title: 'Prompt input is empty',
    retryable: false,
    public: true,
    action: 'Provide non-empty prompt input.',
  },

  'shell.git_bash_not_found': {
    title: 'Git Bash not found',
    retryable: false,
    public: true,
    action: 'Install Git for Windows from https://gitforwindows.org/ or set LIORA_SHELL_PATH (legacy: KIMI_SHELL_PATH) to a bash.exe.',
  },

  not_implemented: {
    title: 'Not implemented',
    retryable: false,
    public: true,
    action: 'This feature is not implemented yet.',
  },
  internal: {
    title: 'Internal error',
    retryable: false,
    public: true,
    action: 'Inspect logs or report the issue with diagnostics.',
  },
} as const satisfies Record<LioraErrorCode, LioraErrorInfo>;
