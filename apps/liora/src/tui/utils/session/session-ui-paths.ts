import { join } from 'node:path';

/** Session-local TUI sidecars live under `<sessionDir>/ui/`. */
export const SESSION_UI_DIR = 'ui';

export const PROMPT_INPUT_STATE_FILE = join(SESSION_UI_DIR, 'draft.json');
export const GOAL_QUEUE_FILE = join(SESSION_UI_DIR, 'goals.json');
export const TUI_SESSION_STATE_FILE = join(SESSION_UI_DIR, 'prefs.json');

export const LEGACY_PROMPT_INPUT_STATE_FILE = 'prompt-input-state.json';
export const LEGACY_GOAL_QUEUE_FILE = 'upcoming-goals.json';
export const LEGACY_TUI_SESSION_STATE_FILE = 'tui-session.json';

export function trimSessionDir(sessionDir: string): string {
  return sessionDir.replace(/[/\\]+$/, '');
}

export function sessionUiFilePath(sessionDir: string, relative: string): string {
  return join(trimSessionDir(sessionDir), relative);
}
