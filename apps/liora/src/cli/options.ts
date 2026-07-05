import { t } from '#/cli/i18n';

export type UIMode = 'shell' | 'print';
export type PromptOutputFormat = 'text' | 'stream-json';

export interface CLIOptions {
  session: string | undefined;
  continue: boolean;
  yolo: boolean;
  auto: boolean;
  plan: boolean;
  model: string | undefined;
  outputFormat: PromptOutputFormat | undefined;
  showThinking?: boolean;
  prompt: string | undefined;
  skillsDirs: string[];
  addDirs?: string[];
}

export interface ValidatedOptions {
  options: CLIOptions;
  uiMode: UIMode;
}

export class OptionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptionConflictError';
  }
}

export function validateOptions(opts: CLIOptions): ValidatedOptions {
  const prompt = opts.prompt;
  const promptMode = prompt !== undefined;
  if (promptMode && prompt.trim().length === 0) {
    throw new OptionConflictError(t('cli.runtime.options.promptEmpty'));
  }
  if (opts.model !== undefined && opts.model.trim().length === 0) {
    throw new OptionConflictError(t('cli.runtime.options.modelEmpty'));
  }
  if (!promptMode && opts.outputFormat !== undefined) {
    throw new OptionConflictError(t('cli.runtime.options.outputFormatPromptOnly'));
  }
  if (!promptMode && opts.showThinking === true) {
    throw new OptionConflictError(t('cli.runtime.options.showThinkingPromptOnly'));
  }
  if (promptMode && opts.yolo) {
    throw new OptionConflictError(t('cli.runtime.options.promptWithYolo'));
  }
  if (promptMode && opts.auto) {
    throw new OptionConflictError(t('cli.runtime.options.promptWithAuto'));
  }
  if (promptMode && opts.plan) {
    throw new OptionConflictError(t('cli.runtime.options.promptWithPlan'));
  }
  if (promptMode && opts.session === '') {
    throw new OptionConflictError(t('cli.runtime.options.sessionNoIdPrompt'));
  }
  if (opts.continue && opts.session !== undefined) {
    throw new OptionConflictError(t('cli.runtime.options.continueWithSession'));
  }
  if (opts.yolo && opts.auto) {
    throw new OptionConflictError(t('cli.runtime.options.yoloWithAuto'));
  }
  return { options: opts, uiMode: promptMode ? 'print' : 'shell' };
}
