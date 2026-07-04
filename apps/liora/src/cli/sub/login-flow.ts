/**
 * Shared device-code login flow used by both `liora login` (top-level
 * subcommand) and `liora acp --login` (the first-class ACP terminal-auth
 * entry point). Exiting the process is part of the contract — callers
 * MUST treat the returned promise as `Promise<never>`.
 */

import { createLioraHarness } from '@superliora/sdk';

import { createLioraHostIdentity } from '#/cli/version';
import { openUrl } from '#/utils/open-url';

export interface LoginFlowOptions {
  readonly oauthKey?: string | undefined;
  readonly oauthHost?: string | undefined;
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
    const oauthKey = nonEmptyString(options.oauthKey);
    const oauthHost = nonEmptyString(options.oauthHost);
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
        // Print the manual fallback before attempting to open the user's
        // browser so headless/browser-opener failures never hide the URL
        // and code needed to complete login.
        process.stderr.write(
          [
            '',
            `Opening browser for managed API device login: ${url}`,
            `If the browser did not open, paste the URL above and enter code: ${data.userCode}`,
            data.expiresIn !== null && data.expiresIn !== undefined
              ? `Code expires in ${data.expiresIn}s.`
              : undefined,
            'Waiting for authorization to complete...',
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
    process.stderr.write(`Logged in to ${result.providerName}.\n`);
    process.exit(0);
  } catch (error) {
    if (controller.signal.aborted) {
      process.stderr.write('Login cancelled.\n');
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Login failed: ${message}\n`);
    }
    process.exit(1);
  }
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
