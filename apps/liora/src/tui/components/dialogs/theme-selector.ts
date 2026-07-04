import { visibleWidth } from '#/tui/renderer';

import { highlightLines } from '#/tui/components/media/code-highlight';
import {
  currentTheme,
  getBuiltInPalette,
  loadCustomThemeMergedSync,
  Theme,
  type ColorPalette,
} from '#/tui/theme';
import {
  listAvailableThemeEntriesSync,
  type ThemeListEntry,
} from '#/tui/theme/custom-theme-loader';
import type { ThemeName } from '#/tui/theme/index';
import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

interface ThemeChoiceOption extends ChoiceOption {
  readonly previewPalette: ColorPalette;
  readonly base?: 'dark' | 'light';
  readonly source?: ThemeListEntry['source'];
}

export interface ThemeSelectorOptions {
  readonly currentValue: ThemeName;
  readonly onSelect: (theme: ThemeName) => void;
  readonly onHighlight?: (theme: ThemeName) => void;
  readonly onCancel: () => void;
}

export class ThemeSelectorComponent extends ChoicePickerComponent {
  constructor(opts: ThemeSelectorOptions) {
    const options = buildThemeOptions(currentTheme.palette);
    super({
      title: 'Select theme',
      options,
      currentValue: opts.currentValue,
      searchable: true,
      pageSize: 10,
      onHighlight: (value) => {
        opts.onHighlight?.(value);
      },
      renderPreview: renderThemePreview,
      onSelect: (value) => {
        opts.onSelect(value);
      },
      onCancel: opts.onCancel,
    });
  }
}

function buildThemeOptions(autoPalette: ColorPalette): ThemeChoiceOption[] {
  const entries = listAvailableThemeEntriesSync().map(themeEntryToOption);
  const curatedDark = entries.filter(
    (entry) => entry.source !== 'custom' && entry.source !== 'bundled-external' && entry.base !== 'light',
  );
  const custom = entries.filter((entry) => entry.source === 'custom');
  const curatedLight = entries.filter(
    (entry) => entry.source !== 'custom' && entry.source !== 'bundled-external' && entry.base === 'light',
  );
  const externalDark = entries.filter((entry) => entry.source === 'bundled-external' && entry.base !== 'light');
  const externalLight = entries.filter((entry) => entry.source === 'bundled-external' && entry.base === 'light');

  return [
    {
      value: 'auto',
      label: 'Auto (match terminal)',
      description: 'Follows the detected terminal background.',
      previewPalette: autoPalette,
    },
    {
      value: 'dark',
      label: 'Dark',
      description: 'Built-in dark theme.',
      previewPalette: getBuiltInPalette('dark'),
      base: 'dark',
    },
    ...curatedDark,
    ...custom,
    {
      value: 'light',
      label: 'Light',
      description: 'Built-in light theme.',
      previewPalette: getBuiltInPalette('light'),
      base: 'light',
    },
    ...curatedLight,
    ...externalDark,
    ...externalLight,
  ];
}

function themeEntryToOption(entry: ThemeListEntry): ThemeChoiceOption {
  const label = formatThemeLabel(entry);
  const baseDescription = themeBaseDescription(entry);
  const previewPalette = loadCustomThemeMergedSync(entry.name) ?? getBuiltInPalette(entry.base ?? 'dark');
  if (entry.source === 'bundled') {
    return {
      value: entry.name,
      label,
      description: `${baseDescription} · Bundled SuperLiora preset.`,
      previewPalette,
      base: entry.base,
      source: entry.source,
    };
  }
  if (entry.source === 'bundled-external') {
    return {
      value: entry.name,
      label,
      description: `${baseDescription} · Bundled external terminal theme.`,
      previewPalette,
      base: entry.base,
      source: entry.source,
      searchOnly: true,
    };
  }
  return {
    value: entry.name,
    label: entry.overridesBundled === true
      ? `Custom: ${entry.name} (overrides bundled)`
      : `Custom: ${entry.name}`,
    description: 'Loaded from ~/.superliora/themes.',
    previewPalette,
    base: entry.base,
    source: entry.source,
  };
}

function formatThemeLabel(entry: ThemeListEntry): string {
  const name =
    entry.displayName ?? (entry.source === 'bundled' ? `SuperLiora: ${entry.name}` : entry.name);
  if (entry.base === 'dark') return `Dark · ${name}`;
  if (entry.base === 'light') return `Light · ${name}`;
  return name;
}

function themeBaseDescription(entry: ThemeListEntry): string {
  if (entry.base === 'light') return 'Light theme';
  return 'Dark theme';
}

function renderThemePreview(option: ChoiceOption, width: number): readonly string[] {
  const previewTheme = new Theme((option as ThemeChoiceOption).previewPalette ?? currentTheme.palette);
  const innerWidth = Math.max(1, width - 4);
  const rows = [
    previewTheme.boldFg('primary', ` Preview · ${option.label}`),
    swatches(previewTheme, innerWidth),
    previewTheme.fg('text', ' ● Assistant reply ') +
      previewTheme.fg('textDim', 'with ') +
      previewTheme.fg('primary', 'inline code') +
      previewTheme.fg('textDim', ' and ') +
      previewTheme.fg('success', 'success') +
      previewTheme.fg('textDim', ' / ') +
      previewTheme.fg('warning', 'warning') +
      previewTheme.fg('textDim', ' / ') +
      previewTheme.fg('error', 'error'),
    previewTheme.fg('roleUser', ' ✨ User prompt') +
      previewTheme.fg('textDim', '   ') +
      previewTheme.fg('shellMode', '$ pnpm test'),
    ...highlightLines(
      'const skin = createTheme("premium", { particles: true });\nreturn skin.syntax.keyword;',
      'typescript',
      previewTheme.palette,
    ).map((line) => `   ${line}`),
  ];
  return rows.map((row) => paintPreviewRow(previewTheme, row, innerWidth));
}

function swatches(theme: Theme, width: number): string {
  const labels = [
    ['primary', theme.color('primary')],
    ['accent', theme.color('accent')],
    ['surface', theme.color('surface')],
    ['syntax', theme.color('syntaxKeyword')],
  ] as const;
  const row = labels
    .map(
      ([label, color]) =>
        theme.bg('surfaceRaised', ` ${label} `) +
        ' ' +
        theme.fg('textMuted', color),
    )
    .join(theme.fg('textMuted', '  '));
  return visibleWidth(row) > width ? row : row + ' '.repeat(width - visibleWidth(row));
}

function paintPreviewRow(theme: Theme, row: string, width: number): string {
  const padded = row + ' '.repeat(Math.max(0, width - visibleWidth(row)));
  return '  ' + theme.bg('background', padded);
}
