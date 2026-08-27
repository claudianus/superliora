/**
 * Settings → Appearance — live glance + real preference pickers (SSOT §9.2).
 * Highlight previews via previewAppearanceChange; persist via
 * commitAppearanceChange so tui.toml, appState, and live transcript
 * projection share one code path. The commit baseline is the last saved
 * prefs, not the live preview, or an already-applied highlight looks unchanged.
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
import { settingsPresetsRow, showSettingPresetsPicker } from '#/tui/utils/settings/show-setting-presets';
import { formatErrorMessage } from '#/tui/utils/event-payload';
import { appearanceAnimationNow } from '#/tui/features/appearance/appearance-effects';
import { renderAppearanceValuePreview } from '#/tui/utils/appearance/appearance-preview';
import {
  canLivePreviewAppearanceKey,
  commitAppearanceChange,
  previewAppearanceChange,
  restoreAppearancePreview,
} from './appearance';
import { showPerformanceSettings, currentPerformanceMode } from './performance';
import { currentAppearance, tuiConfigFromHost } from './tui-persist';
import { showThemeSettings } from './theme-settings';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export { APPEARANCE_BACKGROUND_TIP, APPEARANCE_CHANGE_TIP, APPEARANCE_MOTION_TIP, APPEARANCE_THEME_TIP };

const PROFILE_OPTIONS = ['auto', 'off', 'subtle', 'premium'] as const;
const DENSITY_OPTIONS = ['auto', 'compact', 'comfortable', 'spacious'] as const;
const PARTICLE_OPTIONS = ['auto', 'off', 'ambient', 'events', 'premium'] as const;
const FPS_OPTIONS = ['15', '30', '45', '60'] as const;

export function showAppearanceSettings(host: SlashCommandHost): void {
  const appearance = currentAppearance(host);
  const performanceMode = currentPerformanceMode(host);
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.appearance.title'),
      searchable: true,
      options: [
        settingsPresetsRow(),
        {
          value: 'status',
          label: ttui('tui.settings.pane.appearance.status'),
          description: ttui('tui.settings.pane.appearance.statusDesc'),
        },
        {
          value: 'performance',
          label: `${ttui('tui.settings.pane.appearance.performance')} · ${performanceMode}`,
          description: ttui('tui.settings.pane.appearance.performanceDesc'),
        },
        {
          value: 'theme',
          label: ttui('tui.settings.pane.appearance.theme'),
          description: ttui('tui.settings.pane.appearance.themeDesc'),
        },
        {
          value: 'profile',
          label: `${ttui('tui.settings.pane.appearance.motionProfile')} · ${appearance.profile}`,
          description: ttui('tui.settings.pane.appearance.profileDesc'),
        },
        {
          value: 'density',
          label: `${ttui('tui.settings.pane.appearance.layoutDensity')} · ${appearance.density}`,
          description: ttui('tui.settings.pane.appearance.densityDesc'),
        },
        {
          value: 'transcript-detail',
          label: `${ttui('tui.settings.pane.appearance.transcriptDetail')} · ${appearance.transcriptDetail}`,
          description: ttui('tui.settings.pane.appearance.transcriptDesc'),
        },
        {
          value: 'neat',
          label: `${ttui('tui.settings.pane.appearance.neatCards')} · ${appearance.neat ? ttui('tui.settings.pane.appearance.toggle.on') : ttui('tui.settings.pane.appearance.toggle.off')}`,
          description: ttui('tui.settings.pane.appearance.neatDesc'),
        },
        {
          value: 'syntax-theme',
          label: `${ttui('tui.settings.pane.appearance.syntaxTheme')} · ${appearance.syntaxTheme}`,
          description: ttui('tui.settings.pane.appearance.syntaxDesc'),
        },
        {
          value: 'particles',
          label: `${ttui('tui.settings.pane.appearance.particles')} · ${appearance.particles}`,
          description: ttui('tui.settings.pane.appearance.particlesDesc'),
        },
        {
          value: 'animation-fps',
          label: `${ttui('tui.settings.pane.appearance.animationFps')} · ${String(appearance.animationFps)}`,
          description: ttui('tui.settings.pane.appearance.fpsDesc'),
        },
        {
          value: 'timestamps',
          label: `${ttui('tui.settings.pane.appearance.timestamps')} · ${appearance.showTimestamps ? ttui('tui.settings.pane.appearance.toggle.on') : ttui('tui.settings.pane.appearance.toggle.off')}`,
          description: ttui('tui.settings.pane.appearance.timestampsDesc'),
        },
        {
          value: 'canvas-background',
          label: `${ttui('tui.settings.pane.appearance.canvasBg')} · ${appearance.canvasBackground ? ttui('tui.settings.pane.appearance.toggle.on') : ttui('tui.settings.pane.appearance.toggle.off')}`,
          description: ttui('tui.settings.pane.appearance.canvasDesc'),
        },
        {
          value: 'terminal-background',
          label: `${ttui('tui.settings.pane.appearance.terminalBg')} · ${appearance.terminalBackground}`,
          description: ttui('tui.settings.pane.appearance.terminalBgDesc'),
        },
        {
          value: 'terminal-palette',
          label: `${ttui('tui.settings.pane.appearance.terminalPalette')} · ${appearance.terminalPalette ? ttui('tui.settings.pane.appearance.toggle.on') : ttui('tui.settings.pane.appearance.toggle.off')}`,
          description: ttui('tui.settings.pane.appearance.terminalPaletteDesc'),
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
          case 'performance':
            showPerformanceSettings(host);
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
                description: ttui(`tui.settings.pane.appearance.profile.${option}`),
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
                description: ttui(`tui.settings.pane.appearance.density.${option}`),
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
                label: ttui('tui.settings.pane.appearance.fpsLabel', { fps: option }),
              })),
            });
            return;
          case 'timestamps':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.timestamps'),
              key: 'timestamps',
              current: appearance.showTimestamps ? 'on' : 'off',
              choices: [
                {
                  value: 'on',
                  label: ttui('tui.settings.pane.appearance.toggle.on'),
                  description: ttui('tui.settings.pane.appearance.timestamps.onDesc'),
                },
                {
                  value: 'off',
                  label: ttui('tui.settings.pane.appearance.toggle.off'),
                  description: ttui('tui.settings.pane.appearance.timestamps.offDesc'),
                },
              ],
            });
            return;
          case 'neat':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.neatCards'),
              key: 'neat',
              current: appearance.neat ? 'on' : 'off',
              choices: [
                {
                  value: 'on',
                  label: ttui('tui.settings.pane.appearance.toggle.on'),
                  description: ttui('tui.settings.pane.appearance.neat.onDesc'),
                },
                {
                  value: 'off',
                  label: ttui('tui.settings.pane.appearance.toggle.off'),
                  description: ttui('tui.settings.pane.appearance.neat.offDesc'),
                },
              ],
            });
            return;
          case 'canvas-background':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.canvasBg'),
              key: 'canvas-background',
              current: appearance.canvasBackground ? 'on' : 'off',
              choices: [
                { value: 'on', label: ttui('tui.settings.pane.appearance.toggle.on') },
                { value: 'off', label: ttui('tui.settings.pane.appearance.toggle.off') },
              ],
            });
            return;
          case 'terminal-background':
            showAppearanceEnumPicker(host, {
              title: ttui('tui.settings.pane.appearance.terminalBg'),
              key: 'terminal-background',
              current: appearance.terminalBackground,
              choices: [
                {
                  value: 'off',
                  label: ttui('tui.settings.pane.appearance.toggle.off'),
                  description: ttui('tui.settings.pane.appearance.terminalBg.offDesc'),
                },
                {
                  value: 'session',
                  label: ttui('tui.settings.pane.appearance.terminalBg.session'),
                  description: ttui('tui.settings.pane.appearance.terminalBg.sessionDesc'),
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
                { value: 'on', label: ttui('tui.settings.pane.appearance.toggle.on') },
                { value: 'off', label: ttui('tui.settings.pane.appearance.toggle.off') },
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
  showAppearanceEnumPicker(host, {
    title: ttui('tui.settings.pane.appearance.syntaxTheme'),
    key: 'syntax-theme',
    current: currentAppearance(host).syntaxTheme,
    hintExtra: ttui('tui.settings.pane.appearance.hint.syntax'),
    layout: 'grid',
    choices: SYNTAX_THEME_CATALOG.map((entry) => ({
      value: entry.id,
      label: entry.label,
      description: entry.description,
    })),
  });
}

/** Public entry for /transcript with no args and Settings → Appearance. */
export function showTranscriptDetailPicker(host: SlashCommandHost): void {
  showAppearanceEnumPicker(host, {
    title: ttui('tui.settings.pane.appearance.transcriptDetail'),
    key: 'transcript-detail',
    current: currentAppearance(host).transcriptDetail,
    hintExtra: ttui('tui.settings.pane.appearance.hint.transcript'),
    choices: TRANSCRIPT_DETAIL_LEVELS.map((level) => ({
      value: level,
      label: level,
      description: ttui(`tui.settings.pane.appearance.transcript.${level}`),
    })),
  });
}

function showAppearanceEnumPicker(
  host: SlashCommandHost,
  opts: {
    readonly title: string;
    readonly key: string;
    readonly current: string;
    readonly choices: readonly ChoiceOption[];
    readonly hintExtra?: string;
    readonly layout?: 'list' | 'grid';
  },
): void {
  const committed = currentAppearance(host);
  let previewStartedAt = appearanceAnimationNow();
  let highlighted = opts.current;
  const live = canLivePreviewAppearanceKey(opts.key);

  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: opts.title,
      searchable: true,
      layout: opts.layout,
      currentValue: opts.current,
      hintExtra: opts.hintExtra,
      options: opts.choices.map((choice) => ({ ...choice })),
      onHighlight: live
        ? (value) => {
            if (value === highlighted) return;
            highlighted = value;
            previewStartedAt = appearanceAnimationNow();
            previewAppearanceChange(host, committed, opts.key, value);
          }
        : undefined,
      renderPreview: (option, width) =>
        renderAppearanceValuePreview(opts.key, option.value, width, previewStartedAt, committed),
      onSelect: (value) => {
        dismissPickerDialog(host);
        void commitAppearanceChange(host, committed, opts.key, value);
      },
      onCancel: () => {
        restoreAppearancePreview(host, committed, opts.key);
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
