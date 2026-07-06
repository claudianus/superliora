import type { CredentialHandler, CredentialRequest, CredentialResponse } from '@superliora/sdk';

import { promptApiKey } from '#/tui/commands/prompts';
import type { SlashCommandHost } from '#/tui/commands/dispatch';

export interface CredentialPromptHost {
  mountEditorReplacement(panel: import('#/tui/renderer').Component & import('#/tui/renderer').Focusable): void;
  restoreEditor(): void;
}

const DEFAULT_CONTEXT7_SUBTITLE = [
  'Free API keys: https://context7.com/dashboard',
  'Saved to ~/.superliora/config.toml',
] as const;

export function createContext7CredentialHandler(host: CredentialPromptHost): CredentialHandler {
  return async (request: CredentialRequest): Promise<CredentialResponse | null> => {
    if (request.id !== 'context7') return null;

    const value = await promptApiKey(
      host as SlashCommandHost,
      request.title.length > 0 ? request.title : 'Context7',
      request.subtitleLines ?? DEFAULT_CONTEXT7_SUBTITLE,
    );
    if (value === undefined) return { value: undefined };
    return { value };
  };
}
