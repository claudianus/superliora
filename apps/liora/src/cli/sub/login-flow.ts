/**
 * Shared device-code login flow used by both `liora login` (top-level
 * subcommand) and `liora acp --login` (the first-class ACP terminal-auth
 * entry point). Exiting the process is part of the contract — callers
 * MUST treat the returned promise as `Promise<never>`.
 */

import {
  allocateManagedKimiOAuthAccountKey,
  SUPERLIORA_PROVIDER_NAME,
} from '@superliora/oauth';
import { createLioraHarness } from '@superliora/sdk';

import { t, tln } from '#/cli/i18n';
import { createLioraHostIdentity } from '#/cli/version';
import { openUrl } from '#/utils/open-url';

export interface LoginFlowOptions {
  readonly oauthKey?: string | undefined;
  readonly oauthHost?: string | undefined;
  /** Allocate a fresh OAuth storage key and keep existing accounts as fallbacks. */
  readonly addAccount?: boolean | undefined;
  /** Friendly label used when generating `--add` storage keys. */
  readonly label?: string | undefined;
}

export async function runLoginFlow(options: LoginFlowOptions = {}): Promise<never> {
  const identity = createLioraHostIdentity();
  const harness = createLioraHarness({
    identity,
    uiMode: 'cli',
  });
  const controller = new AbortController();
  process.once('SIGINT', () => {
    controller.abort();
  });
  try {
    const oauthHost = nonEmptyString(options.oauthHost);
    const label = nonEmptyString(options.label);
    let oauthKey = nonEmptyString(options.oauthKey);

    if (options.addAccount === true) {
      if (oauthKey !== undefined) {
        process.stderr.write(tln('cli.runtime.login.addWithOAuthKeyConflict'));
        process.exit(1);
      }
      const config = await harness.getConfig({ reload: true });
      const provider = config.providers?.[SUPERLIORA_PROVIDER_NAME];
      const allocated = allocateManagedKimiOAuthAccountKey(provider, {
        oauthHost,
        baseUrl: typeof provider?.baseUrl === 'string' ? provider.baseUrl : undefined,
        label,
      });
      oauthKey = allocated.key;
      process.stderr.write(
        tln('cli.runtime.login.addingAccount', {
          fingerprint: fingerprintOAuthKey(oauthKey),
        }),
      );
    }

    const result = await harness.auth.login(undefined, {
      signal: controller.signal,
      ...(oauthKey === undefined
        ? {}
        : {
            oauthRef: {
              key: oauthKey,
              ...(oauthHost === undefined ? {} : { oauthHost }),
            },
          }),
      ...(oauthKey === undefined && oauthHost !== undefined ? { oauthHost } : {}),
      onDeviceCode: (data) => {
        const url = data.verificationUriComplete || data.verificationUri;
        process.stderr.write(
          [
            '',
            t('cli.runtime.login.openingBrowser', { url }),
            t('cli.runtime.login.manualFallback', { code: data.userCode }),
            data.expiresIn !== null && data.expiresIn !== undefined
              ? t('cli.runtime.login.codeExpires', { seconds: String(data.expiresIn) })
              : undefined,
            t('cli.runtime.login.waiting'),
            '',
          ]
            .filter((line): line is string => line !== undefined)
            .join('\n'),
        );
        try {
          openUrl(url);
        } catch {
          // Best effort only: the manual fallback has already been printed.
        }
      },
    });
    process.stderr.write(tln('cli.runtime.login.success', { provider: result.providerName }));
    if (options.addAccount === true && oauthKey !== undefined) {
      process.stderr.write(
        tln('cli.runtime.login.accountPoolHint', {
          fingerprint: fingerprintOAuthKey(oauthKey),
        }),
      );
    }
    process.exit(0);
  } catch (error) {
    if (controller.signal.aborted) {
      process.stderr.write(tln('cli.runtime.login.cancelled'));
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(tln('cli.runtime.login.failed', { message }));
    }
    process.exit(1);
  }
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function fingerprintOAuthKey(key: string): string {
  if (key.length <= 18) return key;
  return `${key.slice(0, 12)}…${key.slice(-4)}`;
}
