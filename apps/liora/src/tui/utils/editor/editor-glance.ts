/**
 * Editor settings glance — live TUI input mode + external editor (SSOT §9.2).
 */

import { resolveEditorCommand } from '#/utils/process/external-editor';

export const EDITOR_EXTERNAL_TIP =
  'External editor: /editor picker or /editor <command> · Ctrl+G opens the buffer ($VISUAL / $EDITOR).';

export const EDITOR_BASH_TIP =
  'TUI input: ! at prompt start enters bash mode · Esc returns to prompt.';

export const EDITOR_PERSIST_TIP =
  'Persisted in tui.toml [editor] command · inputMode reads appState on toggle.';

export interface EditorGlanceInput {
  readonly inputMode: 'prompt' | 'bash';
  readonly editorCommand: string | null;
  readonly resolvedEditor?: string;
  readonly visualEnv?: string;
  readonly editorEnv?: string;
}

function firstNonBlankEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value !== undefined && value.length > 0 ? value : undefined;
}

export function loadEditorGlance(input: {
  readonly inputMode: 'prompt' | 'bash';
  readonly editorCommand: string | null;
  readonly env?: NodeJS.ProcessEnv;
}): EditorGlanceInput {
  const env = input.env ?? process.env;
  return {
    inputMode: input.inputMode,
    editorCommand: input.editorCommand,
    resolvedEditor: resolveEditorCommand(input.editorCommand),
    visualEnv: firstNonBlankEnv(env, 'VISUAL') ?? firstNonBlankEnv(env, 'visual'),
    editorEnv: firstNonBlankEnv(env, 'EDITOR') ?? firstNonBlankEnv(env, 'editor'),
  };
}

/** Live in-TUI editor mode from appState.inputMode. */
export function formatInputModeLine(inputMode: 'prompt' | 'bash'): string {
  if (inputMode === 'bash') {
    return 'TUI input: bash (! shell-command mode · Esc returns to prompt)';
  }
  return 'TUI input: prompt (default · type ! for shell mode)';
}

/** Saved tui.toml command + effective $VISUAL/$EDITOR resolution. */
export function formatExternalEditorLine(glance: EditorGlanceInput): string {
  const saved =
    glance.editorCommand !== null && glance.editorCommand.trim().length > 0
      ? glance.editorCommand.trim()
      : 'auto-detect ($VISUAL / $EDITOR)';
  if (glance.resolvedEditor !== undefined) {
    return `External editor: ${saved} · resolved ${glance.resolvedEditor}`;
  }
  return `External editor: ${saved} · (none resolved — set /editor or env)`;
}

function formatEnvLine(name: string, value: string | undefined): string {
  return value !== undefined ? `${name}=${value}` : `${name}: unset`;
}

export function buildEditorSettingsLines(glance: EditorGlanceInput): readonly string[] {
  return [
    '── Editor (read-only) ───────────────────────',
    'In-TUI prompt vs external editor — Sovereign Reform §9.2.',
    '',
    '── Session (live) ───────────────────────────',
    formatInputModeLine(glance.inputMode),
    formatExternalEditorLine(glance),
    formatEnvLine('VISUAL', glance.visualEnv),
    formatEnvLine('EDITOR', glance.editorEnv),
    '',
    '── Change external editor ───────────────────',
    '  /editor                       picker (code · vim · nvim · auto)',
    '  /editor <command>             e.g. vim, nvim, code --wait',
    '  tui.toml [editor] command     persisted preference',
    '',
    '── TUI input tips ───────────────────────────',
    '· ! at prompt start — bash/shell mode (runs via host shell)',
    '· Esc in bash mode — return to normal prompt',
    '· Ctrl+G — open buffer in external editor ($VISUAL / $EDITOR)',
    '· inputMode reads appState; editor syncs on mode toggle',
    '',
    'External editor is not vim keybindings inside the TUI — only Ctrl+G spawn.',
  ];
}
