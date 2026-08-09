/**
 * Settings → Appearance — live glance + real preference pickers (SSOT §9.2).
 * Persist via handleAppearanceCommand so tui.toml, appState, and live
 * transcript projection share one code path.
 */

import { currentTheme } from '#/tui/theme';
import {
  APPEARANCE_BACKGROUND_TIP,
  APPEARANCE_CHANGE_TIP,
  APPEARANCE_MOTION_TIP,
  APPEARANCE_THEME_TIP,
  buildAppearanceSettingsLines,
  loadAppearanceSettingsGlance,
} from '#/tui/utils/appearance/appearance-glance';
import {
  TRANSCRIPT_DETAIL_LEVELS,
} from '#/tui/features/transcript/transcript-density';
import type { TranscriptDetailLevel } from '#/tui/types';
import { SYNTAX_THEME_CATALOG } from '#/tui/theme/syntax-theme';
import { ChoicePickerComponent, type ChoiceOption } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { saveTuiConfig, type AppearancePreferences } from '#/tui/config';
import {
  APPEARANCE_PRESETS,
  matchAppearancePresetId,
} from '#/tui/utils/settings/appearance-presets';
import { SETTINGS_PRESETS_ROW, showSettingPresetsPicker } from '#/tui/utils/settings/show-setting-presets';
import { formatErrorMessage } from '#/tui/utils/event-payload';
import { handleAppearanceCommand } from './appearance';
import { currentAppearance, tuiConfigFromHost } from './tui-persist';
import { showThemeSettings } from './theme-settings';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export { APPEARANCE_BACKGROUND_TIP, APPEARANCE_CHANGE_TIP, APPEARANCE_MOTION_TIP, APPEARANCE_THEME_TIP };

const TRANSCRIPT_LEVEL_HINTS: Record<TranscriptDetailLevel, string> = {
  minimal: 'Chain-only tools · thinking/tools/answer groups',
  compact: 'Tool headers only · phase tints; click to expand',
  standard: 'Default detail (preview cards · phase tints)',
  full: 'Every tool card expanded',
};

const PROFILE_OPTIONS = ['auto', 'off', 'subtle', 'premium'] as const;
const DENSITY_OPTIONS = ['auto', 'compact', 'comfortable', 'spacious'] as const;
const PARTICLE_OPTIONS = ['auto', 'off', 'ambient', 'events', 'premium'] as const;
const FPS_OPTIONS = ['15', '30', '45', '60'] as const;

export function showAppearanceSettings(host: SlashCommandHost): void {
  const appearance = currentAppearance(host);
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.appearance.title'),
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        SETTINGS_PRESETS_ROW,
        {
          value: 'status',
          label: 'Appearance status',
          description:
            'Live theme palette · saved motion prefs · canvas / terminal / transcript.',
        },
        {
          value: 'theme',
          label: 'Theme…',
          description: 'Open Settings → Theme palette picker.',
        },
        {
          value: 'profile',
          label: `Motion profile · ${appearance.profile}`,
          description: 'auto | off | subtle | premium — ambient motion budget.',
        },
        {
          value: 'density',
          label: `Layout density · ${appearance.density}`,
          description: 'auto | compact | comfortable | spacious — chrome spacing.',
        },
        {
          value: 'transcript-detail',
          label: `Transcript detail · ${appearance.transcriptDetail}`,
          description: 'minimal | compact | standard | full — live tool card density.',
        },
        {
          value: 'neat',
          label: `Neat cards · ${appearance.neat ? 'on' : 'off'}`,
          description: 'Structured tool result cards instead of raw output dumps.',
        },
        {
          value: 'syntax-theme',
          label: `Syntax theme · ${appearance.syntaxTheme}`,
          description: 'Coding colors independent of UI skin (GitHub Dimmed, One Dark, …).',
        },
        {
          value: 'particles',
          label: `Particles · ${appearance.particles}`,
          description: 'auto | off | ambient | events | premium.',
        },
        {
          value: 'animation-fps',
          label: `Animation FPS · ${String(appearance.animationFps)}`,
          description: '1–60 · shared animation clock (common presets).',
        },
        {
          value: 'timestamps',
          label: `Timestamps · ${appearance.showTimestamps ? 'on' : 'off'}`,
          description: 'HH:MM on user messages.',
        },
        {
          value: 'canvas-background',
          label: `Canvas background · ${appearance.canvasBackground ? 'on' : 'off'}`,
          description: 'Fill TUI-owned cells with theme background.',
        },
        {
          value: 'terminal-background',
          label: `Terminal background · ${appearance.terminalBackground}`,
          description: 'off | session — OSC terminal background while running.',
        },
        {
          value: 'terminal-palette',
          label: `Terminal palette · ${appearance.terminalPalette ? 'on' : 'off'}`,
          description: 'Inject theme palette into the terminal until exit.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        switch (value) {
          case 'presets':
            showAppearancePresets(host);
            return;
          case 'status':
            showAppearanceSettingsPanel(host);
            return;
          case 'theme':
            showThemeSettings(host);
            return;
          case 'profile':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.motionProfile'),
              key: 'profile',
              current: appearance.profile,
              choices: PROFILE_OPTIONS.map((option) => ({
                value: option,
                label: option,
                description:
                  option === 'premium'
                    ? 'Full ambient motion (default premium profile)'
                    : option === 'subtle'
                      ? 'Reduced motion accents'
                      : option === 'off'
                        ? 'Motion effects off'
                        : 'Follow Visual Quality / environment',
              })),
            });
            return;
          case 'density':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.layoutDensity'),
              key: 'density',
              current: appearance.density,
              choices: DENSITY_OPTIONS.map((option) => ({
                value: option,
                label: option,
                description:
                  option === 'spacious'
                    ? 'Roomier chrome (default)'
                    : option === 'compact'
                      ? 'Tighter spacing'
                      : option === 'comfortable'
                        ? 'Balanced spacing'
                        : 'Auto from terminal size / prefs',
              })),
            });
            return;
          case 'transcript-detail':
            showTranscriptDetailPicker(host);
            return;
          case 'syntax-theme':
            showSyntaxThemePicker(host);
            return;
          case 'particles':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.particles'),
              key: 'particles',
              current: appearance.particles,
              choices: PARTICLE_OPTIONS.map((option) => ({
                value: option,
                label: option,
              })),
            });
            return;
          case 'animation-fps':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.animationFps'),
              key: 'animation-fps',
              current: String(appearance.animationFps),
              choices: FPS_OPTIONS.map((option) => ({
                value: option,
                label: `${option} fps`,
              })),
            });
            return;
          case 'timestamps':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.timestamps'),
              key: 'timestamps',
              current: appearance.showTimestamps ? 'on' : 'off',
              choices: [
                { value: 'on', label: 'on', description: 'Show HH:MM on user messages' },
                { value: 'off', label: 'off', description: 'Hide message timestamps' },
              ],
            });
            return;
          case 'neat':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.neatCards'),
              key: 'neat',
              current: appearance.neat ? 'on' : 'off',
              choices: [
                { value: 'on', label: 'on', description: 'Structured cards for tool results' },
                { value: 'off', label: 'off', description: 'Raw tool output' },
              ],
            });
            return;
          case 'canvas-background':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.canvasBg'),
              key: 'canvas-background',
              current: appearance.canvasBackground ? 'on' : 'off',
              choices: [
                { value: 'on', label: 'on' },
                { value: 'off', label: 'off' },
              ],
            });
            return;
          case 'terminal-background':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.terminalBg'),
              key: 'terminal-background',
              current: appearance.terminalBackground,
              choices: [
                { value: 'off', label: 'off', description: 'Leave host terminal background alone' },
                {
                  value: 'session',
                  label: 'session',
                  description: 'Apply theme background for this session',
                },
              ],
            });
            return;
          case 'terminal-palette':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.terminalPalette'),
              key: 'terminal-palette',
              current: appearance.terminalPalette ? 'on' : 'off',
              choices: [
                { value: 'on', label: 'on' },
                { value: 'off', label: 'off' },
              ],
            });
            return;
          default:
            return;
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.appearance.title') },
  );
}

/** Public entry for Settings → Appearance → Syntax theme. */
export function showSyntaxThemePicker(host: SlashCommandHost): void {
  const current = currentAppearance(host).syntaxTheme;
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.appearance.syntaxTheme'),
      hint: '↑↓ · Enter · Esc · coding colors only',
      searchable: true,
      layout: 'grid',
      currentValue: current,
      options: SYNTAX_THEME_CATALOG.map((entry) => ({
        value: entry.id,
        label: entry.label,
        description: entry.description,
      })),
      onSelect: (value) => {
        dismissPickerDialog(host);
        void handleAppearanceCommand(host, `syntax-theme ${value}`);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.appearance.syntaxTheme') },
  );
}

/** Public entry for /transcript with no args and Settings → Appearance. */
export function showTranscriptDetailPicker(host: SlashCommandHost): void {
  const current = currentAppearance(host).transcriptDetail;
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.appearance.transcriptDetail'),
      hint: '↑↓ · Enter · Esc · live tool-card density',
      searchable: true,
      currentValue: current,
      options: TRANSCRIPT_DETAIL_LEVELS.map((level) => ({
        value: level,
        label: level,
        description: TRANSCRIPT_LEVEL_HINTS[level],
      })),
      onSelect: (value) => {
        dismissPickerDialog(host);
        void handleAppearanceCommand(host, `transcript-detail ${value}`);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.appearance.transcriptDetail') },
  );
}

function showAppearanceEnumPicker(
  host: SlashCommandHost,
  opts: {
    readonly title: string;
    readonly key: string;
    readonly current: string;
    readonly choices: readonly ChoiceOption[];
  },
): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: opts.title,
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      currentValue: opts.current,
      options: opts.choices.map((choice) => ({ ...choice })),
      onSelect: (value) => {
        dismissPickerDialog(host);
        void handleAppearanceCommand(host, `${opts.key} ${value}`);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: opts.title },
  );
}

function showAppearanceSettingsPanel(host: SlashCommandHost): void {
  const glance = loadAppearanceSettingsGlance({
    savedTheme: host.state.appState.theme,
    palette: currentTheme.palette,
    canvasBackgroundEnabled: currentTheme.canvasBackgroundEnabled,
    appearance: currentAppearance(host),
  });
  const lines = buildAppearanceSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.appearance.panelTitle'),
    enterBeatSeed: 'appearance-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

function showAppearancePresets(host: SlashCommandHost): void {
  const current = currentAppearance(host);
  showSettingPresetsPicker(host, {
    title: ttui('tui.settings.pane.appearance.presets'),
    catalog: APPEARANCE_PRESETS,
    currentId: matchAppearancePresetId(current),
    onApply: async (preset) => {
      const next: AppearancePreferences = { ...current, ...preset.patch };
      try {
        await saveTuiConfig(tuiConfigFromHost(host, { appearance: next }));
      } catch (error) {
        host.showStatus(ttui('tui.appearance.saveFailed', { message: formatErrorMessage(error) }), 'error');
        return;
      }
      host.setAppState({ appearance: next });
      host.setTranscriptDetail(next.transcriptDetail);
      host.setNeatMode(next.neat);
      host.showStatus(ttui('tui.appearance.presetApplied', { label: preset.label }), 'success');
    },
  });
}
