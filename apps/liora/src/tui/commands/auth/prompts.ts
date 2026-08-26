import {
  type Catalog,
  type ModelAlias,
} from '@superliora/sdk';

import { ApiKeyInputDialogComponent, type ApiKeyInputResult } from '../../components/dialogs/auth/api-key-input-dialog';
import {
  OAuthCallbackInputDialogComponent,
  type OAuthCallbackInputResult,
} from '../../components/dialogs/auth/oauth-callback-input-dialog';
import { ChoicePickerComponent, type ChoiceOption } from '../../components/dialogs/picker/choice-picker';
import { ModelSelectorComponent } from '../../components/dialogs/picker/model-selector';
import { ProviderCatalogPickerComponent } from '../../components/dialogs/picker/provider-catalog-picker';
import {
  buildProviderCatalogOptions,
  type ProviderCatalogOption,
  type ProviderCatalogSelection,
} from '#/tui/utils/model/provider-catalog-options';
import type { SlashCommandHost } from '../hub/dispatch';
import { ttui } from '../../utils/tui-i18n';

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
      title: ttui('tui.auth.logout.title'),
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
 * documentation URL as hints. When a catalog env var is already set, the
 * default is an `{env:VAR}` reference so the secret stays out of the file.
 * Pass `pasteSecret` for token-exchange flows (GitHub Copilot) that need the
 * raw value.
 */
export function promptApiKeyForCatalogProvider(
  host: SlashCommandHost,
  option: ProviderCatalogOption,
  options: { readonly pasteSecret?: boolean; readonly prefill?: string } = {},
): Promise<string | undefined> {
  const state = catalogApiKeyDialogState(option, process.env, {
    pasteSecret: options.pasteSecret === true,
    prefill: options.prefill,
  });
  return promptApiKey(host, option.label, state.subtitleLines, { prefill: state.prefill });
}

export interface CatalogApiKeyDialogState {
  readonly prefill?: string;
  readonly subtitleLines: readonly string[];
}

export function catalogApiKeyDialogState(
  option: ProviderCatalogOption,
  env: NodeJS.Dict<string> = process.env,
  options: { readonly pasteSecret?: boolean; readonly prefill?: string } = {},
): CatalogApiKeyDialogState {
  const pasteSecret = options.pasteSecret === true;
  const subtitleLines: string[] = [
    pasteSecret
      ? 'Your token will be saved to ~/.superliora/config.toml'
      : 'Detected env vars are stored as {env:VAR}; paste a key only if you want it copied into the file.',
  ];
  let prefill = options.prefill;
  if (prefill === undefined && option.envVars !== undefined && option.envVars.length > 0) {
    const detected = option.envVars.find((name) => {
      const value = env[name];
      return typeof value === 'string' && value.trim().length > 0;
    });
    if (detected !== undefined) {
      const value = env[detected]?.trim();
      if (pasteSecret) {
        prefill = value;
        subtitleLines.push(`Detected $${detected} — press Enter to use it.`);
      } else {
        prefill = `{env:${detected}}`;
        subtitleLines.push(
          `Detected $${detected} — Enter stores {env:${detected}} (the key stays out of the file).`,
        );
      }
    } else {
      subtitleLines.push(`Or set the ${option.envVars.join(' / ')} env var.`);
    }
  } else if (prefill !== undefined && pasteSecret) {
    subtitleLines.push('Prefill from gh auth token — press Enter to use it.');
  }
  if (option.docUrl !== undefined && option.docUrl.length > 0) {
    subtitleLines.push(`Get a key: ${option.docUrl}`);
  }
  return { prefill, subtitleLines };
}

export function runModelSelector(
  host: SlashCommandHost,
  modelDict: Record<string, ModelAlias>,
): Promise<{ alias: string; thinking: boolean; effort?: string } | undefined> {
  return new Promise((resolve) => {
    const firstAlias = Object.keys(modelDict)[0] ?? '';
    const caps = modelDict[firstAlias]?.capabilities ?? [];
    const initialThinking = caps.includes('always_thinking') || caps.includes('thinking');
    const selector = new ModelSelectorComponent({
      models: modelDict,
      currentValue: firstAlias,
      currentThinking: initialThinking,
      searchable: true,
      onSelect: ({ alias, thinking, effort }) => {
        host.restoreEditor();
        resolve({ alias, thinking, effort });
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(selector);
  });
}
