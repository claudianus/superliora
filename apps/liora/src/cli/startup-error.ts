import { ErrorCodes, KIMI_ERROR_INFO, isKimiError } from '@superliora/sdk';
import { chalkStderr } from 'chalk';

import { t } from '#/cli/i18n';
import { STARTUP_ERROR_COLOR } from '#/constant/startup-error';

export interface StartupErrorFormatOptions {
  readonly errorStyle?: (text: string) => string;
  readonly operation?: string;
}

function formatUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function localizeStartupOperation(operation: string): string {
  switch (operation) {
    case 'run prompt':
      return t('cli.runtime.startup.operation.runPrompt');
    case 'start shell':
      return t('cli.runtime.startup.operation.startShell');
    case 'upgrade':
      return t('cli.runtime.startup.operation.upgrade');
    case 'run plugin node entry':
      return t('cli.runtime.startup.operation.pluginNode');
    default:
      return operation;
  }
}

export function formatStartupError(
  error: unknown,
  options: StartupErrorFormatOptions = {},
): string {
  const errorStyle = options.errorStyle ?? chalkStderr.hex(STARTUP_ERROR_COLOR);

  if (!isKimiError(error)) {
    const operation = localizeStartupOperation(options.operation ?? 'start shell');
    const message = formatUnknownErrorMessage(error);
    const lines = [
      errorStyle(
        t('cli.runtime.startup.failedOperation', { operation, message }),
      ),
    ];
    const nextSteps = authNextStepsFromMessage(message);
    if (nextSteps.length > 0) {
      lines.push('', errorStyle(t('cli.runtime.startup.nextStepsLabel')));
      for (const step of nextSteps) {
        lines.push(errorStyle(`- ${step}`));
      }
    }
    return `${lines.join('\n')}\n`;
  }

  const info = KIMI_ERROR_INFO[error.code];
  const lines = [
    errorStyle(t('cli.runtime.startup.errorTitle', { title: info.title })),
    '',
    errorStyle(t('cli.runtime.startup.messageLabel')),
    errorStyle(error.message),
  ];
  const nextSteps = authNextSteps(error.code);
  if (nextSteps.length > 0) {
    lines.push('', errorStyle(t('cli.runtime.startup.nextStepsLabel')));
    for (const step of nextSteps) {
      lines.push(errorStyle(`- ${step}`));
    }
  }

  return `${lines.join('\n')}\n`;
}

function authNextSteps(code: string): readonly string[] {
  if (code === ErrorCodes.AUTH_LOGIN_REQUIRED) {
    return [
      t('cli.runtime.startup.authLoginStep1'),
      t('cli.runtime.startup.authLoginStep2'),
    ];
  }
  if (code === ErrorCodes.PROVIDER_AUTH_ERROR) {
    return [
      t('cli.runtime.startup.providerAuthStep1'),
      t('cli.runtime.startup.providerAuthStep2'),
    ];
  }
  return [];
}

function authNextStepsFromMessage(message: string): readonly string[] {
  if (message.includes(ErrorCodes.AUTH_LOGIN_REQUIRED)) {
    return authNextSteps(ErrorCodes.AUTH_LOGIN_REQUIRED);
  }
  if (message.includes(ErrorCodes.PROVIDER_AUTH_ERROR)) {
    return authNextSteps(ErrorCodes.PROVIDER_AUTH_ERROR);
  }
  return [];
}
