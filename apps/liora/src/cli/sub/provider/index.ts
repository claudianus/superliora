/**
 * `liora provider` sub-command — non-interactive provider management.
 *
 * Covers the custom-registry path so users can import an api.json document,
 * drop a provider, or inspect what is configured without launching the TUI.
 *
 * This module is the routing/registration layer only. Handler implementations
 * live in `./handlers/`, shared utilities in `./shared.ts`, credential logic
 * in `./credential.ts`, and route preview/format in `./route-utils.ts`.
 */

import { DEFAULT_CATALOG_URL } from '@superliora/sdk';
import type { Command } from 'commander';

import { t } from '#/cli/i18n';

import { handleCatalogAdd, handleCatalogList } from './handlers/catalog';
import { handleProviderCustomAdd } from './handlers/custom-add';
import { handleProviderDoctor } from './handlers/doctor';
import {
  handleProviderKeyAdd,
  handleProviderKeyClear,
  handleProviderKeyLabel,
  handleProviderKeyLimit,
  handleProviderKeyList,
  handleProviderKeyPromote,
  handleProviderKeyRemove,
  handleProviderKeyUnlabel,
} from './handlers/key';
import {
  handleProviderOAuthAdd,
  handleProviderOAuthClear,
  handleProviderOAuthLabel,
  handleProviderOAuthList,
  handleProviderOAuthPromote,
  handleProviderOAuthRemove,
  handleProviderOAuthUnlabel,
} from './handlers/oauth';
import {
  handleProviderRouteAuto,
  handleProviderRoutePreview,
  handleProviderRouteReset,
  handleProviderRouteSet,
  handleProviderRouteShow,
  handleProviderRouteStatus,
} from './handlers/route';
import { handleProviderAdd } from './handlers/add';
import { handleProviderList } from './handlers/list';
import { handleProviderRemove } from './handlers/remove';
import { handleProviderUse } from './handlers/use';
import { resolveDeps, runAction } from './shared';
import type { ProviderDeps } from './types';

import { DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE } from '#/utils/custom-provider';

/* ------------------------------------------------------------------ */
/*  Re-exports (public API consumed by tests and other modules)        */
/* ------------------------------------------------------------------ */

export type { ProviderDeps } from './types';
export { handleProviderAdd } from './handlers/add';
export { handleProviderRemove } from './handlers/remove';
export { handleProviderList } from './handlers/list';
export { handleProviderDoctor } from './handlers/doctor';
export { handleProviderUse } from './handlers/use';
export { handleProviderCustomAdd } from './handlers/custom-add';
export {
  handleProviderKeyAdd,
  handleProviderKeyClear,
  handleProviderKeyLabel,
  handleProviderKeyLimit,
  handleProviderKeyList,
  handleProviderKeyPromote,
  handleProviderKeyRemove,
  handleProviderKeyUnlabel,
} from './handlers/key';
export {
  handleProviderOAuthAdd,
  handleProviderOAuthClear,
  handleProviderOAuthLabel,
  handleProviderOAuthList,
  handleProviderOAuthPromote,
  handleProviderOAuthRemove,
  handleProviderOAuthUnlabel,
} from './handlers/oauth';
export {
  handleProviderRouteAuto,
  handleProviderRoutePreview,
  handleProviderRouteReset,
  handleProviderRouteSet,
  handleProviderRouteShow,
  handleProviderRouteStatus,
} from './handlers/route';
export { handleCatalogAdd, handleCatalogList } from './handlers/catalog';

/* ------------------------------------------------------------------ */
/*  Command registration                                               */
/* ------------------------------------------------------------------ */

export function registerProviderCommand(parent: Command, deps?: Partial<ProviderDeps>): void {
  const provider = parent
    .command('provider')
    .description(t('cli.sub.provider.description'))
    .action(async () => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderList(resolved, { json: false }));
    });

  provider
    .command('add <url>')
    .description(t('cli.sub.provider.cmd.add.desc'))
    .option('--api-key <key>', t('cli.sub.provider.cmd.add.option.apiKey'))
    .action(async (url: string, options: { apiKey?: string }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderAdd(resolved, url, { apiKey: options.apiKey }));
    });

  provider
    .command('remove <providerId>')
    .description(t('cli.sub.provider.cmd.remove.desc'))
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderRemove(resolved, providerId));
    });

  provider
    .command('list')
    .description(t('cli.sub.provider.cmd.list.desc'))
    .option('--json', t('cli.sub.provider.cmd.list.option.json'), false)
    .action(async (options: { json?: boolean }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderList(resolved, { json: options.json === true }));
    });

  provider
    .command('doctor')
    .description(t('cli.sub.provider.cmd.doctor.desc'))
    .option('--json', t('cli.sub.provider.cmd.doctor.option.json'), false)
    .action(async (options: { json?: boolean }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderDoctor(resolved, { json: options.json === true }),
      );
    });

  provider
    .command('use <modelAlias>')
    .description(t('cli.sub.provider.cmd.use.desc'))
    .action(async (modelAlias: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderUse(resolved, modelAlias));
    });

  const custom = provider
    .command('custom')
    .description(t('cli.sub.provider.cmd.custom.desc'));

  custom
    .command('add <providerId>')
    .description(t('cli.sub.provider.cmd.customAdd.desc'))
    .requiredOption('--base-url <url>', t('cli.sub.provider.cmd.customAdd.option.baseUrl'))
    .requiredOption('--model <modelId>', t('cli.sub.provider.cmd.customAdd.option.model'))
    .option('--api-key <key>', t('cli.sub.provider.cmd.customAdd.option.apiKey'))
    .option('--api-key-env <name>', t('cli.sub.provider.cmd.customAdd.option.apiKeyEnv'))
    .option(
      '--keyless',
      t('cli.sub.provider.cmd.customAdd.option.keyless'),
      false,
    )
    .option('--alias <alias>', t('cli.sub.provider.cmd.customAdd.option.alias'))
    .option('--type <type>', t('cli.sub.provider.cmd.customAdd.option.type'))
    .option(
      '--context <tokens>',
      t('cli.sub.provider.cmd.customAdd.option.context', {
        size: String(DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE),
      }),
    )
    .option('--output <tokens>', t('cli.sub.provider.cmd.customAdd.option.output'))
    .option('--display-name <name>', t('cli.sub.provider.cmd.customAdd.option.displayName'))
    .option('--thinking', t('cli.sub.provider.cmd.customAdd.option.thinking'), false)
    .option('--set-default', t('cli.sub.provider.cmd.customAdd.option.setDefault'), false)
    .action(async (providerId: string, options: Record<string, unknown>) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderCustomAdd(resolved, providerId, options as never));
    });

  const key = provider
    .command('key')
    .description(t('cli.sub.provider.cmd.key.desc'));

  key
    .command('add <providerId>')
    .description(t('cli.sub.provider.cmd.keyAdd.desc'))
    .option('--api-key <key>', t('cli.sub.provider.cmd.keyAdd.option.apiKey'))
    .option('--api-keys <keys>', t('cli.sub.provider.cmd.keyAdd.option.apiKeys'))
    .option('--api-key-env <name>', t('cli.sub.provider.cmd.keyAdd.option.apiKeyEnv'))
    .option('--api-key-envs <names>', t('cli.sub.provider.cmd.keyAdd.option.apiKeyEnvs'))
    .option('--base-url <url>', t('cli.sub.provider.cmd.keyAdd.option.baseUrl'))
    .option('--label <label>', t('cli.sub.provider.cmd.keyAdd.option.label'))
    .option('--labels <labels>', t('cli.sub.provider.cmd.keyAdd.option.labels'))
    .option('--rpm <count>', t('cli.sub.provider.cmd.keyAdd.option.rpm'))
    .option('--tpm <tokens>', t('cli.sub.provider.cmd.keyAdd.option.tpm'))
    .option('--auto-route', t('cli.sub.provider.cmd.keyAdd.option.autoRoute'))
    .action(async (providerId: string, options: Record<string, unknown>) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyAdd(resolved, providerId, options as never));
    });

  key
    .command('list <providerId>')
    .description(t('cli.sub.provider.cmd.keyList.desc'))
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyList(resolved, providerId));
    });

  key
    .command('remove <providerId> <index>')
    .description(t('cli.sub.provider.cmd.keyRemove.desc'))
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyRemove(resolved, providerId, index));
    });

  key
    .command('promote <providerId> <index>')
    .description(t('cli.sub.provider.cmd.keyPromote.desc'))
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyPromote(resolved, providerId, index));
    });

  key
    .command('label <providerId> <index> <label>')
    .description(t('cli.sub.provider.cmd.keyLabel.desc'))
    .action(async (providerId: string, index: string, label: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderKeyLabel(resolved, providerId, index, label),
      );
    });

  key
    .command('unlabel <providerId> <index>')
    .description(t('cli.sub.provider.cmd.keyUnlabel.desc'))
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyUnlabel(resolved, providerId, index));
    });

  key
    .command('limit <providerId> <index>')
    .description(t('cli.sub.provider.cmd.keyLimit.desc'))
    .option('--rpm <count>', t('cli.sub.provider.cmd.keyLimit.option.rpm'))
    .option('--tpm <tokens>', t('cli.sub.provider.cmd.keyLimit.option.tpm'))
    .option('--clear', t('cli.sub.provider.cmd.keyLimit.option.clear'), false)
    .action(async (providerId: string, index: string, options: Record<string, unknown>) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderKeyLimit(resolved, providerId, index, options as never),
      );
    });

  key
    .command('clear <providerId>')
    .description(t('cli.sub.provider.cmd.keyClear.desc'))
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyClear(resolved, providerId));
    });

  const oauth = provider
    .command('oauth')
    .description(t('cli.sub.provider.cmd.oauth.desc'));

  oauth
    .command('add <providerId>')
    .description(t('cli.sub.provider.cmd.oauthAdd.desc'))
    .requiredOption('--key <key>', t('cli.sub.provider.cmd.oauthAdd.option.key'))
    .option('--storage <storage>', t('cli.sub.provider.cmd.oauthAdd.option.storage'))
    .option('--oauth-host <host>', t('cli.sub.provider.cmd.oauthAdd.option.oauthHost'))
    .option('--label <label>', t('cli.sub.provider.cmd.oauthAdd.option.label'))
    .option('--auto-route', t('cli.sub.provider.cmd.oauthAdd.option.autoRoute'))
    .action(
      async (
        providerId: string,
        options: {
          key?: string;
          storage?: string;
          oauthHost?: string;
          label?: string;
          autoRoute?: boolean;
        },
      ) => {
        const resolved = resolveDeps(deps);
        await runAction(resolved, () =>
          handleProviderOAuthAdd(resolved, providerId, {
            ...(options.key === undefined ? {} : { key: options.key }),
            ...(options.storage === undefined ? {} : { storage: options.storage }),
            ...(options.oauthHost === undefined ? {} : { oauthHost: options.oauthHost }),
            ...(options.label === undefined ? {} : { label: options.label }),
            autoRoute: options.autoRoute,
          }),
        );
      },
    );

  oauth
    .command('list <providerId>')
    .description(t('cli.sub.provider.cmd.oauthList.desc'))
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthList(resolved, providerId));
    });

  oauth
    .command('remove <providerId> <index>')
    .description(t('cli.sub.provider.cmd.oauthRemove.desc'))
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthRemove(resolved, providerId, index));
    });

  oauth
    .command('promote <providerId> <index>')
    .description(t('cli.sub.provider.cmd.oauthPromote.desc'))
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthPromote(resolved, providerId, index));
    });

  oauth
    .command('label <providerId> <index> <label>')
    .description(t('cli.sub.provider.cmd.oauthLabel.desc'))
    .action(async (providerId: string, index: string, label: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderOAuthLabel(resolved, providerId, index, label),
      );
    });

  oauth
    .command('unlabel <providerId> <index>')
    .description(t('cli.sub.provider.cmd.oauthUnlabel.desc'))
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthUnlabel(resolved, providerId, index));
    });

  oauth
    .command('clear <providerId>')
    .description(t('cli.sub.provider.cmd.oauthClear.desc'))
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthClear(resolved, providerId));
    });

  const route = provider
    .command('route')
    .description(t('cli.sub.provider.cmd.route.desc'));

  route
    .command('show <modelAlias>')
    .description(t('cli.sub.provider.cmd.routeShow.desc'))
    .action(async (modelAlias: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderRouteShow(resolved, modelAlias));
    });

  route
    .command('preview <modelAlias>')
    .description(t('cli.sub.provider.cmd.routePreview.desc'))
    .option('--json', t('cli.sub.provider.cmd.routePreview.option.json'), false)
    .action(async (modelAlias: string, options: { json?: boolean }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderRoutePreview(resolved, modelAlias, { json: options.json === true }),
      );
    });

  route
    .command('auto <modelAlias>')
    .description(t('cli.sub.provider.cmd.routeAuto.desc'))
    .option('--fallback <aliases>', t('cli.sub.provider.cmd.routeAuto.option.fallback'))
    .option('--cooldown-ms <ms>', t('cli.sub.provider.cmd.routeAuto.option.cooldownMs'))
    .option(
      '--session-affinity <mode>',
      t('cli.sub.provider.cmd.routeAuto.option.sessionAffinity'),
    )
    .option(
      '--prefer-credential <label>',
      t('cli.sub.provider.cmd.routeAuto.option.preferCredential'),
    )
    .action(
      async (
        modelAlias: string,
        options: {
          fallback?: string;
          cooldownMs?: string;
          sessionAffinity?: string;
          preferCredential?: string;
        },
      ) => {
        const resolved = resolveDeps(deps);
        await runAction(resolved, () =>
          handleProviderRouteAuto(resolved, modelAlias, {
            fallback: options.fallback,
            cooldownMs: options.cooldownMs,
            sessionAffinity: options.sessionAffinity,
            preferredCredential: options.preferCredential,
          }),
        );
      },
    );

  route
    .command('set <modelAlias>')
    .description(t('cli.sub.provider.cmd.routeSet.desc'))
    .option('--fallback <aliases>', t('cli.sub.provider.cmd.routeSet.option.fallback'))
    .option(
      '--strategy <strategy>',
      t('cli.sub.provider.cmd.routeSet.option.strategy'),
    )
    .option('--cooldown-ms <ms>', t('cli.sub.provider.cmd.routeSet.option.cooldownMs'))
    .option('--weights <aliases>', t('cli.sub.provider.cmd.routeSet.option.weights'))
    .option(
      '--session-affinity <mode>',
      t('cli.sub.provider.cmd.routeSet.option.sessionAffinity'),
    )
    .option(
      '--prefer-credential <label>',
      t('cli.sub.provider.cmd.routeSet.option.preferCredential'),
    )
    .action(
      async (
        modelAlias: string,
        options: {
          fallback?: string;
          strategy?: string;
          cooldownMs?: string;
          weights?: string;
          sessionAffinity?: string;
          preferCredential?: string;
        },
      ) => {
        const resolved = resolveDeps(deps);
        await runAction(resolved, () =>
          handleProviderRouteSet(resolved, modelAlias, {
            fallback: options.fallback,
            strategy: options.strategy,
            cooldownMs: options.cooldownMs,
            weights: options.weights,
            sessionAffinity: options.sessionAffinity,
            preferredCredential: options.preferCredential,
          }),
        );
      },
    );

  route
    .command('reset <sessionId>')
    .description(t('cli.sub.provider.cmd.routeReset.desc'))
    .action(async (sessionId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderRouteReset(resolved, sessionId));
    });

  route
    .command('status <sessionId>')
    .description(t('cli.sub.provider.cmd.routeStatus.desc'))
    .option('--json', t('cli.sub.provider.cmd.routeStatus.option.json'), false)
    .action(async (sessionId: string, options: { json?: boolean }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderRouteStatus(resolved, sessionId, { json: options.json === true }),
      );
    });

  const catalog = provider
    .command('catalog')
    .description(t('cli.sub.provider.cmd.catalog.desc'));

  catalog
    .command('list [providerId]')
    .description(t('cli.sub.provider.cmd.catalogList.desc'))
    .option('--filter <substring>', t('cli.sub.provider.cmd.catalogList.option.filter'))
    .option('--url <url>', t('cli.sub.provider.cmd.catalogList.option.url', { url: DEFAULT_CATALOG_URL }))
    .option('--json', t('cli.sub.provider.cmd.catalogList.option.json'), false)
    .action(
      async (
        providerId: string | undefined,
        options: { filter?: string; url?: string; json?: boolean },
      ) => {
        const resolved = resolveDeps(deps);
        await runAction(resolved, () =>
          handleCatalogList(resolved, providerId, {
            json: options.json === true,
            ...(options.filter === undefined ? {} : { filter: options.filter }),
            ...(options.url === undefined ? {} : { url: options.url }),
          }),
        );
      },
    );

  catalog
    .command('add <providerId>')
    .description(t('cli.sub.provider.cmd.catalogAdd.desc'))
    .option('--api-key <key>', t('cli.sub.provider.cmd.catalogAdd.option.apiKey'))
    .option('--api-key-env <name>', t('cli.sub.provider.cmd.catalogAdd.option.apiKeyEnv'))
    .option('--default-model <modelId>', t('cli.sub.provider.cmd.catalogAdd.option.defaultModel'))
    .option('--url <url>', t('cli.sub.provider.cmd.catalogAdd.option.url', { url: DEFAULT_CATALOG_URL }))
    .action(
      async (
        providerId: string,
        options: { apiKey?: string; apiKeyEnv?: string; defaultModel?: string; url?: string },
      ) => {
        const resolved = resolveDeps(deps);
        await runAction(resolved, () =>
          handleCatalogAdd(resolved, providerId, {
            ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
            ...(options.apiKeyEnv === undefined ? {} : { apiKeyEnv: options.apiKeyEnv }),
            ...(options.defaultModel === undefined ? {} : { defaultModel: options.defaultModel }),
            ...(options.url === undefined ? {} : { url: options.url }),
          }),
        );
      },
    );
}
