import {
  type Catalog,
  type ModelAlias,
} from '@superliora/sdk';

import { ApiKeyInputDialogComponent, type ApiKeyInputResult } from '../components/dialogs/api-key-input-dialog';
import {
  OAuthCallbackInputDialogComponent,
  type OAuthCallbackInputResult,
} from '../components/dialogs/oauth-callback-input-dialog';
import { ChoicePickerComponent, type ChoiceOption } from '../components/dialogs/choice-picker';
import { ModelSelectorComponent } from '../components/dialogs/model-selector';
import { ProviderCatalogPickerComponent } from '../components/dialogs/provider-catalog-picker';
import {
  buildProviderCatalogOptions,
  type ProviderCatalogOption,
  type ProviderCatalogSelection,
} from '#/tui/utils/provider-catalog-options';
import type { SlashCommandHost } from './dispatch';

/**
 * Opens the unified provider picker built from the models.dev catalog and the
 * managed Kimi account. Resolves the structured selection, or `undefined`
 * when the user cancels. The caller dispatches the matching login flow
 * (Kimi OAuth, catalog API-key, custom endpoint/registry).
 */
export function promptProviderCatalog(
  host: SlashCommandHost,
  catalog: Catalog,
  currentValue?: string,
): Promise<ProviderCatalogSelection | undefined> {
  return new Promise((resolve) => {
    const options = buildProviderCatalogOptions(catalog);
    const picker = new ProviderCatalogPickerComponent({
      options,
      currentValue,
      onSelect: ({ selection }) => {
        host.restoreEditor();
        resolve(selection);
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(picker);
  });
}

export function promptLogoutProviderSelection(
  host: SlashCommandHost,
  options: readonly ChoiceOption[],
  currentValue: string | undefined,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const picker = new ChoicePickerComponent({
      title: 'Select a provider to log out',
      options,
      currentValue,
      onSelect: (value) => {
        host.restoreEditor();
        resolve(value);
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(picker);
  });
}

export function promptApiKey(
  host: SlashCommandHost,
  platformName: string,
  subtitleLines: readonly string[] = ['Your key will be saved to ~/.superliora/config.toml'],
  options: { readonly prefill?: string } = {},
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const dialog = new ApiKeyInputDialogComponent(
      platformName,
      subtitleLines,
      (result: ApiKeyInputResult) => {
        host.restoreEditor();
        resolve(result.kind === 'ok' ? result.value : undefined);
      },
      { prefill: options.prefill },
    );
    host.mountEditorReplacement(dialog);
  });
}

/**
 * Prompts for a manually pasted OAuth callback URL / authorization code.
 * Used as a fallback when the browser cannot redirect back to the local
 * loopback server (remote SSH, blocked port, etc.).
 */
export function promptOAuthCallback(
  host: SlashCommandHost,
  options: {
    readonly title?: string;
    readonly subtitleLines?: readonly string[];
    readonly errorHint?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      host.restoreEditor();
      resolve(value);
    };
    const onAbort = (): void => {
      finish(undefined);
    };
    if (options.signal?.aborted === true) {
      resolve(undefined);
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const dialog = new OAuthCallbackInputDialogComponent(
      (result: OAuthCallbackInputResult) => {
        finish(result.kind === 'ok' ? result.value : undefined);
      },
      {
        title: options.title,
        subtitleLines: options.subtitleLines,
        errorHint: options.errorHint,
      },
    );
    host.mountEditorReplacement(dialog);
  });
}

/**
 * Prompts for an API key, surfacing the catalog provider's env-var names and
 * documentation URL as hints. When one of the catalog's declared env vars is
 * already set in the environment, its value is pre-filled so the user can
 * confirm with Enter instead of pasting the key manually.
 */
export function promptApiKeyForCatalogProvider(
  host: SlashCommandHost,
  option: ProviderCatalogOption,
): Promise<string | undefined> {
  const subtitleLines: string[] = ['Your key will be saved to ~/.superliora/config.toml'];
  let prefill: string | undefined;
  if (option.envVars !== undefined && option.envVars.length > 0) {
    const detected = option.envVars.find((name) => {
      const value = process.env[name];
      return typeof value === 'string' && value.length > 0;
    });
    if (detected !== undefined) {
      prefill = process.env[detected];
      subtitleLines.push(`Detected $${detected} — press Enter to use it.`);
    } else {
      subtitleLines.push(`Or set the ${option.envVars.join(' / ')} env var.`);
    }
  }
  if (option.docUrl !== undefined && option.docUrl.length > 0) {
    subtitleLines.push(`Get a key: ${option.docUrl}`);
  }
  return promptApiKey(host, option.label, subtitleLines, { prefill });
}

export function runModelSelector(
  host: SlashCommandHost,
  modelDict: Record<string, ModelAlias>,
): Promise<{ alias: string; thinking: boolean } | undefined> {
  return new Promise((resolve) => {
    const firstAlias = Object.keys(modelDict)[0] ?? '';
    const caps = modelDict[firstAlias]?.capabilities ?? [];
    const initialThinking = caps.includes('always_thinking') || caps.includes('thinking');
    const selector = new ModelSelectorComponent({
      models: modelDict,
      currentValue: firstAlias,
      currentThinking: initialThinking,
      searchable: true,
      onSelect: ({ alias, thinking }) => {
        host.restoreEditor();
        resolve({ alias, thinking });
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(selector);
  });
}
