import { ErrorCodes, KIMI_ERROR_INFO, isKimiError } from '@moonshot-ai/kimi-code-sdk';
import { chalkStderr } from 'chalk';

import { STARTUP_ERROR_COLOR } from '#/constant/startup-error';

export interface StartupErrorFormatOptions {
  readonly errorStyle?: (text: string) => string;
  readonly operation?: string;
}

function formatUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatStartupError(
  error: unknown,
  options: StartupErrorFormatOptions = {},
): string {
  const errorStyle = options.errorStyle ?? chalkStderr.hex(STARTUP_ERROR_COLOR);

  if (!isKimiError(error)) {
    const operation = options.operation ?? 'start shell';
    const message = formatUnknownErrorMessage(error);
    const lines = [errorStyle(`error: failed to ${operation}: ${message}`)];
    const nextSteps = authNextStepsFromMessage(message);
    if (nextSteps.length > 0) {
      lines.push('', errorStyle('next steps:'));
      for (const step of nextSteps) {
        lines.push(errorStyle(`- ${step}`));
      }
    }
    return `${lines.join('\n')}\n`;
  }

  const info = KIMI_ERROR_INFO[error.code];
  const lines = [
    errorStyle(`error: ${info.title}`),
    '',
    errorStyle('message:'),
    errorStyle(error.message),
  ];
  const nextSteps = authNextSteps(error.code);
  if (nextSteps.length > 0) {
    lines.push('', errorStyle('next steps:'));
    for (const step of nextSteps) {
      lines.push(errorStyle(`- ${step}`));
    }
  }

  return `${lines.join('\n')}\n`;
}

function authNextSteps(code: string): readonly string[] {
  if (code === ErrorCodes.AUTH_LOGIN_REQUIRED) {
    return [
      'Run `kimi login` to refresh your Kimi Code login.',
      'Then rerun the same command.',
    ];
  }
  if (code === ErrorCodes.PROVIDER_AUTH_ERROR) {
    return [
      'Run `kimi provider` to inspect configured providers and the default model.',
      'Run `kimi provider use <model-alias>` to switch defaults, or update the API key; then rerun the same command.',
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
