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

const SEARCH_PROVIDER_SIGNUP = [
  {
    kind: 'brave',
    title: 'Brave Search',
    env: 'BRAVE_API_KEY',
    signupUrl: 'https://api-dashboard.search.brave.com/',
    freeTier: 'free plan available',
  },
  {
    kind: 'tavily',
    title: 'Tavily',
    env: 'TAVILY_API_KEY',
    signupUrl: 'https://app.tavily.com/home',
    freeTier: 'free credits for agents',
  },
  {
    kind: 'exa',
    title: 'Exa',
    env: 'EXA_API_KEY',
    signupUrl: 'https://dashboard.exa.ai/',
    freeTier: 'free trial credits',
  },
  {
    kind: 'serper',
    title: 'Serper (Google)',
    env: 'SERPER_API_KEY',
    signupUrl: 'https://serper.dev/',
    freeTier: '2,500 free queries',
  },
] as const;

export function createContext7CredentialHandler(host: CredentialPromptHost): CredentialHandler {
  return createResearchCredentialHandler(host);
}

/** Handles Context7 + web-search provider key prompts in one place. */
export function createResearchCredentialHandler(host: CredentialPromptHost): CredentialHandler {
  return async (request: CredentialRequest): Promise<CredentialResponse | null> => {
    if (request.id === 'context7') {
      const value = await promptApiKey(
        host as SlashCommandHost,
        request.title.length > 0 ? request.title : 'Context7',
        request.subtitleLines ?? DEFAULT_CONTEXT7_SUBTITLE,
      );
      if (value === undefined) return { value: undefined };
      return { value };
    }

    const searchProvider = SEARCH_PROVIDER_SIGNUP.find(
      (entry) => request.id === `search:${entry.kind}` || request.id === entry.kind,
    );
    if (searchProvider !== undefined) {
      const value = await promptApiKey(
        host as SlashCommandHost,
        request.title.length > 0 ? request.title : searchProvider.title,
        request.subtitleLines ?? [
          `${searchProvider.freeTier} · ${searchProvider.signupUrl}`,
          `Or export ${searchProvider.env} and restart · saved to ~/.superliora/config.toml`,
        ],
      );
      if (value === undefined) return { value: undefined };
      return { value };
    }

    return null;
  };
}
