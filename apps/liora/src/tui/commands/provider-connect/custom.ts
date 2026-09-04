import {
  applyCustomRegistryEntries,
  fetchCustomRegistry,
  type CustomRegistrySource,
  type ManagedKimiConfigShape,
} from '@superliora/oauth';

import {
  CustomEndpointImportDialogComponent,
  type CustomEndpointImportResult,
  type CustomEndpointImportValue,
  type CustomEndpointInitialValues,
} from '../../components/dialogs/provider/custom-endpoint-import';
import {
  CustomRegistryImportDialogComponent,
  type CustomRegistryImportResult,
} from '../../components/dialogs/provider/custom-registry-import';
import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import { formatErrorMessage } from '../../utils/event-payload';
import { ttui } from '../../utils/tui-i18n';
import { loadCatalog } from '#/utils/catalog-cache';
import {
  applyCustomEndpointProvider,
  lookupModelCapability,
  probeModelsEndpoint,
  verifyCustomEndpointConnection,
  type ListedEndpointModel,
} from '#/utils/custom-provider';
import type { SlashCommandHost } from '../hub/dispatch';

import type { CustomEndpointPreset } from '#/tui/utils/model/custom-endpoint-presets';

/** Connects a custom OpenAI-compatible endpoint. Returns `false` on cancel. */
export async function connectCustomEndpoint(
  host: SlashCommandHost,
  preset?: CustomEndpointPreset | undefined,
): Promise<boolean> {
  const value = await promptCustomEndpointImport(host, preset);
  if (value === undefined) return false;

  // Verify-before-save: catch a rejected key or a dead endpoint now (with a
  // precise message) instead of at the first failed prompt. 401 blocks the
  // save; anything else stays fail-soft so offline local servers and
  // non-OpenAI wires (no `/models` API) can still be configured.
  const spinner = host.showProgressSpinner(ttui('tui.provider.customVerifying'));
  const verification = await verifyCustomEndpointConnection(
    value.baseUrl,
    value.apiKey,
    value.modelId,
    fetch,
    value.customHeaders === undefined ? {} : { headers: value.customHeaders },
  );
  if (!verification.ok && verification.reason === 'env-missing') {
    spinner.stop({ ok: false, label: ttui('tui.provider.customKeyRejected') });
    host.showError(ttui('tui.provider.customEnvMissing', { message: verification.detail }));
    return false;
  }
  if (!verification.ok && verification.reason === 'unauthorized' && verification.status !== 403) {
    spinner.stop({ ok: false, label: ttui('tui.provider.customKeyRejected') });
    host.showError(
      ttui('tui.provider.customKeyRejectedHint', {
        base: value.baseUrl,
        message: verification.detail,
      }),
    );
    return false;
  }
  spinner.stop({ ok: true, label: ttui('tui.provider.customVerified') });

  try {
    const config = await host.harness.getConfig();
    const existingProvider = config.providers[value.providerId];
    if (existingProvider?.oauth !== undefined) {
      host.showError(ttui('tui.provider.oauthProvider', { id: value.providerId }));
      return false;
    }
    // A late-arriving discovery hint upgrades the dialog result (adds
    // capability, never removes a user choice).
    let modelId = value.modelId;
    let hint = verification.ok ? verification.hint : undefined;
    let modelListed = verification.ok && verification.modelListed;
    if (verification.ok && !verification.modelListed) {
      const listed = verification.availableModels ?? [];
      if (listed.length > 0) {
        // The typed id isn't advertised — offer the endpoint's own list
        // instead of failing on a typo. Esc keeps the typed id (fail-soft,
        // same as before the picker existed).
        const picked = await promptCustomEndpointModel(host, value.modelId, listed);
        if (picked !== undefined) {
          modelId = picked.id;
          hint = { thinking: picked.thinking, toolUse: true, ...(picked.supportEfforts === undefined ? {} : { supportEfforts: picked.supportEfforts }) };
          modelListed = true;
        }
      }
    }
    const supportEfforts = value.supportEfforts ?? hint?.supportEfforts;
    const applied = applyCustomEndpointProvider(config, {
      providerId: value.providerId,
      baseUrl: value.baseUrl,
      modelId,
      apiKey: value.apiKey ?? 'no-key-required',
      providerType: value.providerType,
      maxContextSize: value.maxContextSize,
      ...(value.maxOutputSize === undefined ? {} : { maxOutputSize: value.maxOutputSize }),
      ...(value.customHeaders === undefined ? {} : { customHeaders: value.customHeaders }),
      thinking: hint?.thinking === true ? true : value.thinking,
      ...(supportEfforts !== undefined ? { supportEfforts: [...supportEfforts] } : {}),
      setDefault: true,
    });
    await host.harness.setConfig({
      providers: config.providers,
      models: config.models,
      defaultModel: config.defaultModel,
    });
    await host.authFlow.refreshConfigAfterLogin();
    host.track('connect', { provider: applied.providerId, method: 'custom_endpoint' });
    if (!verification.ok && verification.reason === 'unauthorized') {
      // 403 with a provided key: scoped keys may still chat fine.
      host.showNotice(
        ttui('tui.provider.customKeyForbidden', { base: value.baseUrl }),
      );
    } else if (!verification.ok) {
      host.showNotice(
        ttui('tui.provider.customUnverified', {
          alias: applied.modelAlias,
          message: verification.detail,
        }),
      );
    } else if (!modelListed) {
      const listed = verification.ok ? (verification.availableModels ?? []) : [];
      host.showNotice(
        ttui('tui.provider.customModelNotListed', {
          alias: applied.modelAlias,
          model: modelId,
          models: listed.length === 0 ? '' : ` (${listed.map((entry) => entry.id).join(', ')})`,
        }),
      );
    }
    host.showStatus(ttui('tui.provider.customAdded', { alias: applied.modelAlias }), 'success');
    return true;
  } catch (error) {
    host.showError(ttui('tui.provider.customAddFailed', { message: formatErrorMessage(error) }));
    return false;
  }
}

/** Connects a custom api.json registry. Returns `false` on cancel. */
export async function connectCustomRegistry(host: SlashCommandHost): Promise<boolean> {
  const value = await promptCustomRegistryImport(host);
  if (value === undefined) return false;

  const source: CustomRegistrySource = {
    kind: 'apiJson',
    url: value.url,
    apiKey: value.apiKey,
  };

  let entries: Awaited<ReturnType<typeof fetchCustomRegistry>>;
  try {
    entries = await fetchCustomRegistry(source);
  } catch (error) {
    host.showError(ttui('tui.provider.registryImportFailed', { message: formatErrorMessage(error) }));
    return false;
  }

  try {
    const config = await host.harness.getConfig();
    const result = applyCustomRegistryEntries(
      config as unknown as ManagedKimiConfigShape,
      entries,
      source,
    );
    await host.harness.setConfig({
      providers: config.providers,
      models: config.models,
    });
    await host.authFlow.refreshConfigAfterLogin();
    for (const skipped of result.skippedOAuthCollisions) {
      host.showNotice(ttui('tui.provider.registrySkippedOAuth', { id: skipped }));
    }
    const count = result.applied.length;
    if (count === 0) {
      host.showStatus(ttui('tui.provider.registryNoProviders'));
      return false;
    }
    host.showStatus(
      count === 1
        ? ttui('tui.provider.registryImportedOne')
        : ttui('tui.provider.registryImported', { count }),
      'success',
    );
    return true;
  } catch (error) {
    host.showError(ttui('tui.provider.registryApplyFailed', { message: formatErrorMessage(error) }));
    return false;
  }
}

function promptCustomRegistryImport(
  host: SlashCommandHost,
): Promise<{ readonly url: string; readonly apiKey: string } | undefined> {
  return new Promise((resolve) => {
    const dialog = new CustomRegistryImportDialogComponent(
      (result: CustomRegistryImportResult) => {
        host.restoreEditor();
        resolve(result.kind === 'ok' ? result.value : undefined);
      },
    );
    host.mountEditorReplacement(dialog);
  });
}

function promptCustomEndpointImport(
  host: SlashCommandHost,
  preset?: CustomEndpointPreset | undefined,
): Promise<CustomEndpointImportValue | undefined> {
  return new Promise((resolve) => {
    const initial: CustomEndpointInitialValues | undefined =
      preset === undefined
        ? undefined
        : {
            providerId: preset.providerId,
            baseUrl: preset.baseUrl,
            providerType: preset.wire,
          };
    const dialog = new CustomEndpointImportDialogComponent(
      (result: CustomEndpointImportResult) => {
        host.restoreEditor();
        resolve(result.kind === 'ok' ? result.value : undefined);
      },
      initial,
    );

    // Auto-detect thinking support: load the models.dev catalog in the
    // background and wire up a hint request handler on the dialog.
    const catalogPromise = loadCatalog().catch(() => undefined);
    dialog.onModelHintRequest = (info) => {
      void (async () => {
        // 1. Try the models.dev catalog first (fast, cached).
        const catalog = await catalogPromise;
        if (catalog !== undefined) {
          const hint = lookupModelCapability(catalog, info.providerId, info.modelId);
          if (hint !== undefined) {
            dialog.setThinkingDefault(hint.thinking, hint.supportEfforts);
            return;
          }
        }
        // 2. Fallback: probe the endpoint's /models API (best-effort, 3s timeout).
        if (info.baseUrl.length > 0) {
          const probed = await probeModelsEndpoint(
            info.baseUrl,
            info.apiKey.length > 0 ? info.apiKey : undefined,
            info.modelId,
          );
          if (probed !== undefined) {
            dialog.setThinkingDefault(probed.thinking, probed.supportEfforts);
          }
        }
      })();
    };

    host.mountEditorReplacement(dialog);
  });
}

/**
 * Model picker over the endpoint's advertised list, offered when the typed id
 * isn't listed (typo or a renamed id). The trailing row keeps the typed id;
 * Esc does the same — the save stays fail-soft, exactly as before.
 */
function promptCustomEndpointModel(
  host: SlashCommandHost,
  typedModelId: string,
  listed: readonly ListedEndpointModel[],
): Promise<ListedEndpointModel | undefined> {
  return new Promise((resolve) => {
    const picker = new ChoicePickerComponent({
      title: ttui('tui.provider.customModelPickerTitle'),
      searchable: true,
      options: [
        ...listed.map((entry) => ({
          value: entry.id,
          label: entry.id,
          description:
            entry.thinking
              ? ttui('tui.provider.customModelPickerThinking')
              : ttui('tui.provider.customModelPickerStandard'),
        })),
        {
          value: '',
          label: ttui('tui.provider.customModelPickerKeepTyped', { model: typedModelId }),
          description: ttui('tui.provider.customModelPickerKeepTypedDesc'),
        },
      ],
      onSelect: (value) => {
        host.restoreEditor();
        resolve(listed.find((entry) => entry.id === value));
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(picker);
  });
}
