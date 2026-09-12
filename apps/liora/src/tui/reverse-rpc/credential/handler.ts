import type { CredentialHandler, CredentialRequest, CredentialResponse } from '@superliora/sdk';

import { promptApiKey } from '#/tui/commands/auth/prompts';
import { ttui } from '#/tui/utils/tui-i18n';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

export interface CredentialPromptHost {
  mountEditorReplacement(panel: import('#/tui/renderer').Component & import('#/tui/renderer').Focusable): void;
  restoreEditor(): void;
}

/** Locale-neutral literal (URL / path); the prose around it is localized. */
const CONTEXT7_DASHBOARD_URL = 'https://context7.com/dashboard';
const CONFIG_TOML_PATH = '~/.superliora/config.toml';

function defaultContext7Subtitle(): string[] {
  return [
    ttui('tui.cred.freeKeys', { url: CONTEXT7_DASHBOARD_URL }),
    ttui('tui.cred.savedTo', { path: CONFIG_TOML_PATH }),
  ];
}

const SEARCH_PROVIDER_SIGNUP = [
  {
    kind: 'brave',
    title: 'Brave Search',
    env: 'BRAVE_API_KEY',
    signupUrl: 'https://api-dashboard.search.brave.com/',
    freeTierKey: 'tui.cred.freeTier.brave',
  },
  {
    kind: 'tavily',
    title: 'Tavily',
    env: 'TAVILY_API_KEY',
    signupUrl: 'https://app.tavily.com/home',
    freeTierKey: 'tui.cred.freeTier.tavily',
  },
  {
    kind: 'exa',
    title: 'Exa',
    env: 'EXA_API_KEY',
    signupUrl: 'https://dashboard.exa.ai/',
    freeTierKey: 'tui.cred.freeTier.exa',
  },
  {
    kind: 'serper',
    title: 'Serper (Google)',
    env: 'SERPER_API_KEY',
    signupUrl: 'https://serper.dev/',
    freeTierKey: 'tui.cred.freeTier.serper',
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
        request.subtitleLines ?? defaultContext7Subtitle(),
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
          ttui(searchProvider.freeTierKey, { url: searchProvider.signupUrl }),
          ttui('tui.cred.orExport', { env: searchProvider.env, path: CONFIG_TOML_PATH }),
        ],
      );
      if (value === undefined) return { value: undefined };
      return { value };
    }

    return null;
  };
}
