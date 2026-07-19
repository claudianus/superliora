import { clearLine, cursorTo, emitKeypressEvents, moveCursor } from 'node:readline';

import chalk from 'chalk';

import { PRODUCT_NAME } from '#/constant/app';
import { t } from '#/cli/i18n';
import { HIDE_CURSOR, SHOW_CURSOR } from '#/constant/terminal';
import { SELECT_POINTER } from '#/tui/constant/symbols';
import { darkColors } from '#/tui/theme/colors';

import { SUPERLIORA_CHANGELOG_URL } from './changelog';
import { type InstallSource, type UpdateTarget } from './types';

export const CHANGELOG_URL = SUPERLIORA_CHANGELOG_URL;

export type InstallPromptChoiceValue = 'install' | 'skip';

export interface InstallPromptChoice {
  readonly value: InstallPromptChoiceValue;
  readonly label: string;
}

export interface InstallPromptOptions {
  readonly currentVersion: string;
  readonly target: UpdateTarget;
  readonly installCommand: string;
  readonly installSource: InstallSource;
  readonly input?: NodeJS.ReadStream;
  readonly output?: NodeJS.WriteStream;
}

const INSTALL_HINT = () => t('cli.runtime.update.prompt.installHint');
const SKIP_HINT = () => t('cli.runtime.update.prompt.skipHint');

export function createInstallPromptChoices(target: UpdateTarget): readonly InstallPromptChoice[] {
  return [
    { value: 'install', label: `${INSTALL_HINT()} (${target.version})` },
    { value: 'skip', label: SKIP_HINT() },
  ];
}

export function getDefaultInstallPromptSelection(choices: readonly InstallPromptChoice[]): number {
  const installIndex = choices.findIndex((choice) => choice.value === 'install');
  return Math.max(installIndex, 0);
}

export function moveInstallPromptSelection(
  currentIndex: number,
  direction: 'up' | 'down',
  choiceCount: number,
): number {
  if (direction === 'up') {
    return Math.max(0, currentIndex - 1);
  }
  return Math.min(choiceCount - 1, currentIndex + 1);
}

function renderInstallPrompt(
  options: InstallPromptOptions,
  choices: readonly InstallPromptChoice[],
  selectedIndex: number,
): readonly string[] {
  const label = chalk.hex(darkColors.textDim).bold;
  const currentVersion = chalk.hex(darkColors.warning).bold(options.currentVersion);
  const targetVersion = chalk.hex(darkColors.success).bold(options.target.version);
  const sourceLabel = chalk.hex(darkColors.primary).bold(options.installSource);
  const command = chalk.hex(darkColors.primary)(options.installCommand);
  const changelogText = chalk.hex(darkColors.primary).underline(
    t('cli.runtime.update.prompt.changelog', { url: CHANGELOG_URL }),
  );
  const lines = [
    chalk.hex(darkColors.primary).bold(
      t('cli.runtime.update.prompt.title', { product: PRODUCT_NAME }),
    ),
    chalk.hex(darkColors.textMuted)(
      t('cli.runtime.update.prompt.subtitle', { product: PRODUCT_NAME }),
    ),
    `]8;;${CHANGELOG_URL}\\${changelogText}]8;;\\`,
    '',
    `${label(t('cli.runtime.update.prompt.labelCurrent'))}  ${currentVersion}`,
    `${label(t('cli.runtime.update.prompt.labelTarget'))}  ${targetVersion}`,
    `${label(t('cli.runtime.update.prompt.labelSource'))}  ${sourceLabel}`,
    `${label(t('cli.runtime.update.prompt.labelCommand'))}  ${command}`,
    '',
    chalk.hex(darkColors.textMuted)(t('cli.runtime.update.prompt.hints')),
    '',
  ];

  const pointerPad = ' '.repeat(SELECT_POINTER.length);
  for (let i = 0; i < choices.length; i++) {
    const choice = choices[i];
    if (choice === undefined) continue;
    const isSelected = i === selectedIndex;
    if (isSelected) {
      lines.push(chalk.hex(darkColors.primary).bold(` ${SELECT_POINTER} ${choice.label}`));
      continue;
    }
    lines.push(chalk.hex(darkColors.textDim)(` ${pointerPad} ${choice.label}`));
  }

  return lines;
}

function writePromptFrame(
  output: NodeJS.WriteStream,
  lines: readonly string[],
  previousLineCount: number,
): number {
  if (previousLineCount > 0) {
    moveCursor(output, 0, -(previousLineCount - 1));
  }

  for (let i = 0; i < lines.length; i++) {
    clearLine(output, 0);
    cursorTo(output, 0);
    output.write(lines[i] ?? '');
    if (i < lines.length - 1) {
      output.write('\n');
    }
  }

  return lines.length;
}

export async function promptForInstallChoice(
  options: InstallPromptOptions,
): Promise<InstallPromptChoiceValue> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const choices = createInstallPromptChoices(options.target);
  let selectedIndex = getDefaultInstallPromptSelection(choices);

  return new Promise<InstallPromptChoiceValue>((resolve) => {
    let lineCount = 0;
    const hadRawMode = 'isRaw' in input ? input.isRaw : false;
    const canSetRawMode = typeof input.setRawMode === 'function';

    const cleanup = (): void => {
      input.off('keypress', onKeypress);
      if (canSetRawMode) {
        input.setRawMode(hadRawMode);
      }
      output.write(SHOW_CURSOR);
      output.write('\n');
    };

    const finish = (choice: InstallPromptChoiceValue): void => {
      cleanup();
      resolve(choice);
    };

    const render = (): void => {
      lineCount = writePromptFrame(
        output,
        renderInstallPrompt(options, choices, selectedIndex),
        lineCount,
      );
    };

    const onKeypress = (_input: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.name === 'up') {
        selectedIndex = moveInstallPromptSelection(selectedIndex, 'up', choices.length);
        render();
        return;
      }
      if (key.name === 'down') {
        selectedIndex = moveInstallPromptSelection(selectedIndex, 'down', choices.length);
        render();
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        const chosen = choices[selectedIndex]?.value ?? 'skip';
        finish(chosen);
        return;
      }
      if (key.name === 'escape' || (key.ctrl === true && key.name === 'c')) {
        finish('skip');
      }
    };

    emitKeypressEvents(input);
    if (canSetRawMode) {
      input.setRawMode(true);
    }
    input.resume();
    input.on('keypress', onKeypress);
    output.write(HIDE_CURSOR);
    render();
  });
}
