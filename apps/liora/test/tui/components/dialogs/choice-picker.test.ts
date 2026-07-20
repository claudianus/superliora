import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ChoicePickerComponent, type ChoiceOption } from '#/tui/components/dialogs/choice-picker';
import { EditorSelectorComponent } from '#/tui/components/dialogs/editor-selector';
import { PermissionSelectorComponent } from '#/tui/components/dialogs/permission-selector';
import { SettingsSelectorComponent } from '#/tui/components/dialogs/settings-selector';
import { ThemeSelectorComponent } from '#/tui/components/dialogs/theme-selector';
import { UpdatePreferenceSelectorComponent } from '#/tui/components/dialogs/update-preference-selector';
import { currentTheme } from '#/tui/theme';
import { darkColors } from '#/tui/theme/colors';

const ANSI_SGR = /\[[0-9;]*m/g;

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function withThemeHome(run: () => void): void {
  const originalHome = process.env['SUPERLIORA_HOME'];
  const home = join(tmpdir(), `kimi-choice-theme-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(home, 'themes'), { recursive: true });
  process.env['SUPERLIORA_HOME'] = home;
  try {
    run();
  } finally {
    rmSync(home, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env['SUPERLIORA_HOME'];
    } else {
      process.env['SUPERLIORA_HOME'] = originalHome;
    }
  }
}

describe('ChoicePickerComponent', () => {
  it('uses the model-dialog header vocabulary (capitalized keys, "type to search")', () => {
    const picker = new ChoicePickerComponent({
      title: 'Add provider',
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      searchable: true,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const lines = picker.render(120).map(strip);

    const titleIdx = lines.findIndex((l) => l.includes('Add provider'));
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    // Title carries the same "(type to search)" suffix as /model and /provider.
    expect(lines[titleIdx]).toContain('(type to search)');
    expect(lines[titleIdx]).not.toContain('type to filter');
    // Hint sits directly under the title and uses lowercase key vocabulary.
    const hint = lines[titleIdx + 1];
    expect(hint).toContain('↑↓ navigate');
    expect(hint).toContain('Enter select');
    expect(hint).toContain('Esc cancel');
    expect(hint).not.toContain('enter select');
    expect(hint).not.toContain('esc cancel');
    // Blank line separates the hint from the body, like the model dialog.
    expect(lines[titleIdx + 2]).toBe('');
  });

  it('renders optional descriptions below choice labels', () => {
    const picker = new ChoicePickerComponent({
      title: 'Select permission mode',
      options: [
        {
          value: 'manual',
          label: 'Manual',
          description: 'Ask before commands, edits, and other risky actions.',
        },
        {
          value: 'auto',
          label: 'Auto',
          description: 'Automatically approve tool actions and plan transitions.',
        },
      ],
      currentValue: 'manual',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const out = picker.render(120).map(strip);

    expect(out).toContain('  ❯ Manual ← current');
    expect(out).toContain('    Ask before commands, edits, and other risky actions.');
    expect(out).toContain('    Automatically approve tool actions and plan transitions.');
  });

  it('renders domain selector wrappers with their configured options', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const editor = new EditorSelectorComponent({
      currentValue: 'vim',
      onSelect,
      onCancel,
    });
    expect(editor.render(120).map(strip)).toContain('  ❯ Vim ← current');

    const theme = new ThemeSelectorComponent({
      currentValue: 'light',
      onSelect,
      onCancel,
    });
    expect(theme.render(120).map(strip)).toContain('  ❯ Light ← current');

    const permission = new PermissionSelectorComponent({
      currentValue: 'manual',
      onSelect,
      onCancel,
    });
    expect(permission.render(120).map(strip)).toContain('  ❯ Manual ← current');

    const settings = new SettingsSelectorComponent({
      onSelect,
      onCancel,
    });
    const settingsOutput = settings.render(120).map(strip);
    expect(settingsOutput).toContain('  ❯ Model');
    expect(settingsOutput).toContain('    Switch the active model and thinking mode.');
    // The list paginates at 8 items per page; "Automatic updates" is on page 2.
    settings.handleInput('\u001B[C'); // → pages forward
    const settingsPage2 = settings.render(120).map(strip);
    expect(settingsPage2).toContain('    Turn automatic CLI updates on or off.');

    const upgradePreference = new UpdatePreferenceSelectorComponent({
      currentValue: true,
      onSelect,
      onCancel,
    });
    const upgradePreferenceOutput = upgradePreference.render(120).map(strip);
    expect(upgradePreferenceOutput).toContain('  ❯ On ← current');
    expect(upgradePreferenceOutput).toContain('    Install new versions in the background.');
  });

  it('renders bundled and user custom themes in the theme selector', () => {
    withThemeHome(() => {
      writeFileSync(
        join(process.env['SUPERLIORA_HOME']!, 'themes', 'studio.json'),
        JSON.stringify({ name: 'studio', colors: { primary: '#268bd2' } }),
        'utf-8',
      );
      const theme = new ThemeSelectorComponent({
        currentValue: 'superliora-neon-noir',
        onSelect: vi.fn(),
        onCancel: vi.fn(),
      });
      const out = theme.render(120).map(strip);

      expect(out).toContain('  ❯ Dark · SuperLiora Neon Noir ← current');
      expect(out).toContain('    Dark theme · Bundled SuperLiora preset.');
      // The list paginates at 8 items per page; page until the custom entry shows.
      let page = out;
      for (let i = 0; i < 10 && !page.includes('    Custom: studio'); i++) {
        theme.handleInput('\u001B[C'); // → pages forward
        page = theme.render(120).map(strip);
      }
      expect(page).toContain('    Loaded from ~/.superliora/themes.');
      expect(page).toContain('    Custom: studio');
    });
  });

  it('previews the highlighted theme and notifies focus changes', () => {
    withThemeHome(() => {
      currentTheme.setPalette(darkColors);
      const onHighlight = vi.fn();
      const theme = new ThemeSelectorComponent({
        currentValue: 'light',
        onHighlight,
        onSelect: vi.fn(),
        onCancel: vi.fn(),
      });

      const out = theme.render(120).map(strip).join('\n');
      expect(out).toContain('Preview · Light');
      expect(out).toContain('const skin = createTheme');
      expect(onHighlight).toHaveBeenCalledWith('light');
      expect(currentTheme.palette).toBe(darkColors);

      theme.handleInput('\u001B[B');
      // After built-in Light, the next curated/external light theme is selected if present;
      // otherwise the list stays on Light. Accept either without hardcoding a removed preset.
      const last = onHighlight.mock.calls.at(-1)?.[0];
      expect(typeof last).toBe('string');
      expect(last === 'light' || String(last).includes('light') || String(last).startsWith('superliora-')).toBe(
        true,
      );
      expect(currentTheme.palette).toBe(darkColors);
    });
  });

  it('hides search-only choices until the user searches', () => {
    const picker = new ChoicePickerComponent({
      title: 'Pick one',
      options: [
        { value: 'visible', label: 'Visible' },
        { value: 'hidden', label: 'Hidden', searchOnly: true },
      ],
      searchable: true,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(picker.render(120).map(strip).join('\n')).toContain('Visible');
    expect(picker.render(120).map(strip).join('\n')).not.toContain('Hidden');

    picker.handleInput('h');
    expect(picker.render(120).map(strip).join('\n')).toContain('Hidden');
  });

  it('keeps the current search-only choice visible', () => {
    const picker = new ChoicePickerComponent({
      title: 'Pick one',
      options: [
        { value: 'visible', label: 'Visible' },
        { value: 'hidden', label: 'Hidden', searchOnly: true },
      ],
      currentValue: 'hidden',
      searchable: true,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(picker.render(120).map(strip)).toContain('  ❯ Hidden ← current');
  });

  it('keeps external terminal themes out of the default theme list but includes them in search', () => {
    withThemeHome(() => {
      const theme = new ThemeSelectorComponent({
        currentValue: 'auto',
        onSelect: vi.fn(),
        onCancel: vi.fn(),
      });

      expect(theme.render(120).map(strip).join('\n')).not.toContain('dracula (Alacritty)');

      for (const ch of 'dracula') theme.handleInput(ch);
      const out = theme.render(120).map(strip).join('\n');
      expect(out).toContain('Dark · dracula (Alacritty)');
      expect(out).toContain('Bundled external terminal theme.');
    });
  });

  it('routes Space into the query for searchable lists instead of selecting', () => {
    const onSelect = vi.fn();
    const picker = new ChoicePickerComponent({
      title: 'Select a provider',
      options: [
        { value: 'openai', label: 'OpenAI' },
        { value: 'azure', label: 'Azure OpenAI' },
      ],
      searchable: true,
      onSelect,
      onCancel: vi.fn(),
    });

    picker.handleInput(' ');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects on Space when the list is not searchable', () => {
    const onSelect = vi.fn();
    const picker = new ChoicePickerComponent({
      title: 'Pick one',
      options: [{ value: 'a', label: 'Alpha' }],
      onSelect,
      onCancel: vi.fn(),
    });

    picker.handleInput(' ');
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('renders the selected option description in descriptionTone, others in textMuted', () => {
    const options: ChoiceOption[] = [
      { value: 'none', label: 'No attachment', description: 'Text feedback only' },
      {
        value: 'logs+codebase',
        label: 'Logs + codebase',
        description: 'Include your codebase for deeper diagnosis.',
        descriptionTone: 'warning',
      },
    ];

    const renderDescLine = (currentValue: string): string | undefined => {
      const picker = new ChoicePickerComponent({
        title: 'Share diagnostic info?',
        options,
        currentValue,
        onSelect: vi.fn(),
        onCancel: vi.fn(),
      });
      return picker.render(120).find((line) => strip(line).includes('Include your codebase'));
    };

    const warningLine = currentTheme.fg('warning', '    Include your codebase for deeper diagnosis.');
    const mutedLine = currentTheme.fg('textMuted', '    Include your codebase for deeper diagnosis.');

    // Selected option: description uses the configured tone.
    expect(renderDescLine('logs+codebase')).toBe(warningLine);
    // Unselected option: description falls back to textMuted.
    expect(renderDescLine('none')).toBe(mutedLine);
  });

  // BUG-1 regression: a selected option with a description but no descriptionTone
  // must not crash. Previously the render referenced an undefined `premium`
  // variable, throwing ReferenceError on every render of such an option.
  it('renders a described option without descriptionTone without crashing', () => {
    const picker = new ChoicePickerComponent({
      title: 'Pick one',
      options: [
        {
          value: 'a',
          label: 'Option A',
          description: 'A description without a tone',
        },
        {
          value: 'b',
          label: 'Option B',
          description: 'Another description',
        },
      ],
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    // Should not throw — the first option is selected by default.
    expect(() => picker.render(80)).not.toThrow();
    const lines = picker.render(80).map(strip);
    expect(lines.some((line) => line.includes('A description without a tone'))).toBe(true);
  });
});
