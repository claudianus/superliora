import { emitKeypressEvents } from 'node:readline';

import chalk from 'chalk';

import { PRODUCT_NAME } from '#/constant/app';
import { t } from '#/cli/i18n';
import { HIDE_CURSOR, SHOW_CURSOR } from '#/constant/terminal';
import { SELECT_POINTER } from '#/tui/constant/symbols';
import { darkColors } from '#/tui/theme/colors';
import { truncateToWidth, visibleWidth } from '#/tui/renderer';

import { SUPERLIORA_CHANGELOG_URL } from './changelog';
import { type InstallSource, type UpdateTarget } from './types';
import { TtyFramePainter, frameColumns, type TtyFrameOutput } from './tty-frame';

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
  /** When true, install will force-reset a dirty git checkout. */
  readonly dirty?: boolean;
  readonly input?: NodeJS.ReadStream;
  readonly output?: NodeJS.WriteStream;
}

const INSTALL_HINT = () => t('cli.runtime.update.prompt.installHint');
const SKIP_HINT = () => t('cli.runtime.update.prompt.skipHint');

const MAX_CARD_WIDTH = 78;
const COMPACT_COLUMNS = 48;

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

function hyperlink(url: string, label: string): string {
  return `\u001B]8;;${url}\u001B\\${label}\u001B]8;;\u001B\\`;
}

interface PromptRows {
  readonly title: string;
  readonly hints: string;
  readonly body: readonly string[];
}

function buildPromptRows(
  options: InstallPromptOptions,
  choices: readonly InstallPromptChoice[],
  selectedIndex: number,
  contentWidth: number,
): PromptRows {
  const label = chalk.hex(darkColors.textDim);
  const currentVersion = chalk.hex(darkColors.warning).bold(options.currentVersion);
  const targetVersion = chalk.hex(darkColors.success).bold(options.target.version);
  const arrow = chalk.hex(darkColors.textMuted)('→');

  const changelogPlain = truncateToWidth(
    t('cli.runtime.update.prompt.changelog', { url: CHANGELOG_URL }),
    contentWidth,
    '…',
  );
  const changelog = hyperlink(
    CHANGELOG_URL,
    chalk.hex(darkColors.primary).underline(changelogPlain),
  );

  const sourceLabel = t('cli.runtime.update.prompt.labelSource').trim();
  const commandLabel = t('cli.runtime.update.prompt.labelCommand').trim();
  const labelWidth = Math.max(visibleWidth(sourceLabel), visibleWidth(commandLabel));
  const padLabel = (text: string): string =>
    label(text + ' '.repeat(Math.max(0, labelWidth - visibleWidth(text))));

  const body: string[] = [
    chalk.hex(darkColors.textMuted)(
      t('cli.runtime.update.prompt.subtitle', { product: PRODUCT_NAME }),
    ),
    changelog,
    '',
    `${currentVersion}  ${arrow}  ${targetVersion}`,
    `${padLabel(sourceLabel)}  ${chalk.hex(darkColors.primary).bold(options.installSource)}`,
    `${padLabel(commandLabel)}  ${chalk.hex(darkColors.textDim)(options.installCommand)}`,
    '',
  ];
  if (options.dirty === true) {
    body.push(
      chalk.hex(darkColors.warning)(`⚠ ${t('cli.runtime.update.prompt.dirtyWarning')}`),
      '',
    );
  }

  const pointerPad = ' '.repeat(visibleWidth(SELECT_POINTER));
  for (let i = 0; i < choices.length; i++) {
    const choice = choices[i];
    if (choice === undefined) continue;
    if (i === selectedIndex) {
      body.push(chalk.hex(darkColors.primary).bold(`${SELECT_POINTER} ${choice.label}`));
      continue;
    }
    body.push(chalk.hex(darkColors.textDim)(`${pointerPad} ${choice.label}`));
  }

  return {
    title: t('cli.runtime.update.prompt.title', { product: PRODUCT_NAME }),
    hints: t('cli.runtime.update.prompt.hints'),
    body,
  };
}

function buildBorderRow(
  corner: [string, string],
  embedded: string | undefined,
  width: number,
  border: (text: string) => string,
): string {
  const innerWidth = width - 2;
  if (embedded === undefined || visibleWidth(embedded) + 4 > innerWidth) {
    return border(`${corner[0]}${'─'.repeat(Math.max(0, innerWidth))}${corner[1]}`);
  }
  const fill = Math.max(0, innerWidth - visibleWidth(embedded) - 3);
  return `${border(`${corner[0]}─`)} ${embedded} ${border('─'.repeat(fill) + corner[1])}`;
}

function renderInstallPrompt(
  options: InstallPromptOptions,
  choices: readonly InstallPromptChoice[],
  selectedIndex: number,
  columns: number,
): readonly string[] {
  const compact = columns < COMPACT_COLUMNS;
  const cardWidth = Math.min(Math.max(columns - 2, 24), MAX_CARD_WIDTH);
  const contentWidth = compact ? Math.max(20, columns - 1) : cardWidth - 4;
  const rows = buildPromptRows(options, choices, selectedIndex, contentWidth);

  if (compact) {
    return [
      chalk.hex(darkColors.primary).bold(rows.title),
      ...rows.body,
      '',
      chalk.hex(darkColors.textMuted)(rows.hints),
    ];
  }

  const border = chalk.hex(darkColors.border);
  const emptyRow = border(`│${' '.repeat(cardWidth - 2)}│`);
  const lines: string[] = [
    buildBorderRow(
      ['╭', '╮'],
      `${chalk.hex(darkColors.accent)('◆')} ${chalk.hex(darkColors.primary).bold(rows.title)}`,
      cardWidth,
      border,
    ),
    emptyRow,
  ];
  for (const row of rows.body) {
    if (row === '') {
      lines.push(emptyRow);
      continue;
    }
    lines.push(`${border('│')} ${truncateToWidth(row, contentWidth, '…', true)} ${border('│')}`);
  }
  lines.push(emptyRow);
  lines.push(
    buildBorderRow(['╰', '╯'], chalk.hex(darkColors.textMuted)(rows.hints), cardWidth, border),
  );
  return lines;
}

export async function promptForInstallChoice(
  options: InstallPromptOptions,
): Promise<InstallPromptChoiceValue> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const choices = createInstallPromptChoices(options.target);
  let selectedIndex = getDefaultInstallPromptSelection(choices);

  return new Promise<InstallPromptChoiceValue>((resolve) => {
    const painter = new TtyFramePainter(output as TtyFrameOutput);
    const hadRawMode = 'isRaw' in input ? input.isRaw : false;
    const canSetRawMode = typeof input.setRawMode === 'function';
    const canObserveResize =
      typeof (output as Partial<NodeJS.WriteStream>).on === 'function' &&
      typeof (output as Partial<NodeJS.WriteStream>).off === 'function';

    const render = (): void => {
      painter.paint(
        renderInstallPrompt(options, choices, selectedIndex, frameColumns(output)),
      );
    };

    const cleanup = (): void => {
      input.off('keypress', onKeypress);
      if (canObserveResize) output.off('resize', render);
      if (canSetRawMode) {
        input.setRawMode(hadRawMode);
      }
      painter.finish();
      output.write(SHOW_CURSOR);
    };

    const finish = (choice: InstallPromptChoiceValue): void => {
      cleanup();
      resolve(choice);
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
    if (canObserveResize) output.on('resize', render);
    output.write(HIDE_CURSOR);
    render();
  });
}
