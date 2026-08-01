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
import { ChoicePickerComponent, type ChoiceOption } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { handleAppearanceCommand } from './appearance';
import { currentAppearance } from './tui-persist';
import { showThemeSettings } from './theme-settings';

import type { SlashCommandHost } from '../../hub/dispatch';

export { APPEARANCE_BACKGROUND_TIP, APPEARANCE_CHANGE_TIP, APPEARANCE_MOTION_TIP, APPEARANCE_THEME_TIP };

const TRANSCRIPT_LEVEL_HINTS: Record<TranscriptDetailLevel, string> = {
  minimal: 'One-line tools + per-turn chain summary',
  compact: 'One-line tool headers; click a card to expand',
  standard: 'Default detail (5-line tool preview)',
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
      title: 'Appearance',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
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
        {
          value: 'tip-theme',
          label: 'Theme tip',
          description: 'Saved theme name vs live palette · auto tracks terminal.',
        },
        {
          value: 'tip-motion',
          label: 'Motion prefs tip',
          description: 'profile · particles · animation-fps · density · timestamps.',
        },
        {
          value: 'tip-background',
          label: 'Background tip',
          description: 'canvas · terminal-background · palette · transcript-detail.',
        },
        {
          value: 'tip-change',
          label: 'Change / persist tip',
          description: 'Menu actions persist tui.toml · /appearance · /transcript.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        switch (value) {
          case 'status':
            showAppearanceSettingsPanel(host);
            return;
          case 'theme':
            showThemeSettings(host);
            return;
          case 'profile':
            showAppearanceEnumPicker(host, {
              title: 'Motion profile',
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
              title: 'Layout density',
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
          case 'particles':
            showAppearanceEnumPicker(host, {
              title: 'Particles',
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
              title: 'Animation FPS',
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
              title: 'Timestamps',
              key: 'timestamps',
              current: appearance.showTimestamps ? 'on' : 'off',
              choices: [
                { value: 'on', label: 'on', description: 'Show HH:MM on user messages' },
                { value: 'off', label: 'off', description: 'Hide message timestamps' },
              ],
            });
            return;
          case 'canvas-background':
            showAppearanceEnumPicker(host, {
              title: 'Canvas background',
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
              title: 'Terminal background',
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
              title: 'Terminal palette',
              key: 'terminal-palette',
              current: appearance.terminalPalette ? 'on' : 'off',
              choices: [
                { value: 'on', label: 'on' },
                { value: 'off', label: 'off' },
              ],
            });
            return;
          case 'tip-theme':
            host.showStatus(APPEARANCE_THEME_TIP, 'info');
            return;
          case 'tip-motion':
            host.showStatus(APPEARANCE_MOTION_TIP, 'info');
            return;
          case 'tip-background':
            host.showStatus(APPEARANCE_BACKGROUND_TIP, 'info');
            return;
          case 'tip-change':
            host.showStatus(APPEARANCE_CHANGE_TIP, 'info');
            return;
          default:
            return;
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Appearance' },
  );
}

/** Public entry for /transcript with no args and Settings → Appearance. */
export function showTranscriptDetailPicker(host: SlashCommandHost): void {
  const current = currentAppearance(host).transcriptDetail;
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Transcript detail',
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
    { label: 'Transcript detail' },
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
    title: ' Appearance ',
    enterBeatSeed: 'appearance-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
