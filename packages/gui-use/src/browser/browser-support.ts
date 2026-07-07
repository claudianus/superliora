import type { SetupCommandResult } from '../install';
import type { BrowserStatus } from '../types';

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Browser use call was aborted.');
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function actionableLaunchError(error: unknown, runtimeLabel: string): string {
  return (
    `${describeError(error)}. Use BrowserStatus or \`liora browser-use doctor\` before ` +
    `installing Playwright or Chrome manually. Runtime: ${runtimeLabel}.`
  );
}

export function statusFromSetupResult(
  result: SetupCommandResult,
  ok: boolean,
  provider: string,
): BrowserStatus {
  return {
    platform: process.platform,
    provider,
    installed: ok,
    ready: ok,
    version: firstNonEmpty(result.stdout, result.stderr) || undefined,
    command: result.command,
    error: ok ? undefined : setupResultDetail(result),
  };
}

export function setupResultDetail(result: SetupCommandResult): string {
  return firstNonEmpty(
    result.error,
    result.stderr,
    result.stdout,
    result.code === null ? undefined : `exit code ${String(result.code)}`,
    'unknown error',
  );
}

export function firstNonEmpty(...values: readonly (string | undefined)[]): string {
  return values.map((value) => value?.trim() ?? '').find((value) => value.length > 0) ?? '';
}

export function isLightpandaPlatformSupported(): boolean {
  return process.platform === 'darwin' || process.platform === 'linux';
}

export function lightpandaUnsupportedStatus(): BrowserStatus {
  return {
    platform: process.platform,
    provider: 'lightpanda',
    installed: false,
    ready: false,
    error:
      'Lightpanda has no native Windows binary. Use WSL or set browser_use.provider = "cloakbrowser".',
  };
}

export async function findFreePort(host: string): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export function unsafeEvalReason(expression: string): string | undefined {
  const patterns: readonly [RegExp, string][] = [
    [/\bdocument\s*\.\s*cookie\b/i, 'document.cookie access'],
    [/\blocalStorage\b/i, 'localStorage access'],
    [/\bsessionStorage\b/i, 'sessionStorage access'],
    [/\bindexedDB\b/i, 'indexedDB access'],
    [/\bfetch\s*\(/i, 'network fetch'],
    [/\bXMLHttpRequest\b/i, 'XMLHttpRequest'],
    [/\bquerySelector(?:All)?\s*\([^)]*(?:input|textarea|password)[^)]*\).*\.value\b/is, 'form value extraction'],
  ];
  return patterns.find(([pattern]) => pattern.test(expression))?.[1];
}
