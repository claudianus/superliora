/**
 * Client-owned preferences.
 *
 * Agent/runtime settings live in core's `config.toml`; this file owns
 * kimi-code client preferences such as terminal UI and update behavior.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parse as parseToml } from 'smol-toml';
import { z } from 'zod';

import { getDataDir } from '#/utils/paths';

export const INVALID_TUI_CONFIG_MESSAGE =
  'Invalid TUI config in ~/.superliora/tui.toml; using defaults.';

export const TuiThemeSchema = z.string();

export const NotificationConditionSchema = z.enum(['unfocused', 'always']);

export const NotificationsConfigSchema = z.object({
  enabled: z.boolean(),
  condition: NotificationConditionSchema,
});

export const UpgradePreferencesSchema = z.object({
  autoInstall: z.boolean(),
});

export const AppearanceProfileSchema = z.enum(['auto', 'off', 'subtle', 'premium']);
export const AppearanceDensitySchema = z.enum(['auto', 'compact', 'comfortable', 'spacious']);
export const AppearanceParticlesSchema = z.enum(['auto', 'off', 'ambient', 'events', 'premium']);
export const TerminalBackgroundSchema = z.enum(['off', 'session']);

export const AppearancePreferencesSchema = z.object({
  profile: AppearanceProfileSchema,
  density: AppearanceDensitySchema,
  particles: AppearanceParticlesSchema,
  animationFps: z.number().int().min(1).max(60),
  canvasBackground: z.boolean(),
  terminalBackground: TerminalBackgroundSchema,
  terminalPalette: z.boolean(),
});

export const TuiConfigFileSchema = z.object({
  theme: TuiThemeSchema.optional(),
  permission_mode: z.enum(['yolo', 'manual', 'auto']).optional(),
  disable_paste_burst: z.boolean().optional(),
  editor: z
    .object({
      command: z.string().optional(),
    })
    .optional(),
  notifications: z
    .object({
      enabled: z.boolean().optional(),
      notification_condition: NotificationConditionSchema.optional(),
    })
    .optional(),
  upgrade: z
    .object({
      auto_install: z.boolean().optional(),
    })
    .optional(),
    appearance: z
    .object({
      profile: AppearanceProfileSchema.optional(),
      density: AppearanceDensitySchema.optional(),
      particles: AppearanceParticlesSchema.optional(),
      animation_fps: z.number().int().min(1).max(60).optional(),
      canvas_background: z.boolean().optional(),
      terminal_background: TerminalBackgroundSchema.optional(),
      terminal_palette: z.boolean().optional(),
    })
    .optional(),
});

export const TuiConfigSchema = z.object({
  theme: TuiThemeSchema,
  permissionMode: z.enum(['yolo', 'manual', 'auto']),
  disablePasteBurst: z.boolean(),
  editorCommand: z.string().nullable(),
  notifications: NotificationsConfigSchema,
  upgrade: UpgradePreferencesSchema,
  appearance: AppearancePreferencesSchema.optional(),
});

export type TuiConfigFileShape = z.infer<typeof TuiConfigFileSchema>;
export type TuiConfig = z.infer<typeof TuiConfigSchema>;
export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;
export type UpgradePreferences = z.infer<typeof UpgradePreferencesSchema>;
export type AppearancePreferences = z.infer<typeof AppearancePreferencesSchema>;

export const DEFAULT_NOTIFICATIONS_CONFIG: NotificationsConfig = {
  enabled: true,
  condition: 'unfocused',
};

export const DEFAULT_UPGRADE_PREFERENCES: UpgradePreferences = {
  autoInstall: true,
};

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  profile: 'premium',
  density: 'spacious',
  particles: 'premium',
  animationFps: 60,
  canvasBackground: true,
  terminalBackground: 'off',
  terminalPalette: false,
};

export const DEFAULT_TUI_CONFIG: TuiConfig = TuiConfigSchema.parse({
  theme: 'superliora-ash',
  permissionMode: 'yolo',
  disablePasteBurst: false,
  editorCommand: null,
  notifications: DEFAULT_NOTIFICATIONS_CONFIG,
  upgrade: DEFAULT_UPGRADE_PREFERENCES,
  appearance: DEFAULT_APPEARANCE_PREFERENCES,
});

/**
 * Thrown by `loadTuiConfig` when the on-disk TOML cannot be parsed.
 * Carries `fallback` so the caller can recover without re-running the
 * I/O, and use `message` (== `INVALID_TUI_CONFIG_MESSAGE`) as a
 * user-facing notice.
 */
export class TuiConfigParseError extends Error {
  override readonly name = 'TuiConfigParseError';
  readonly fallback: TuiConfig;
  constructor(fallback: TuiConfig) {
    super(INVALID_TUI_CONFIG_MESSAGE);
    this.fallback = fallback;
  }
}

export function getTuiConfigPath(): string {
  return join(getDataDir(), 'tui.toml');
}

export async function loadTuiConfig(filePath: string = getTuiConfigPath()): Promise<TuiConfig> {
  if (!existsSync(filePath)) {
    await saveTuiConfig(DEFAULT_TUI_CONFIG, filePath);
    return DEFAULT_TUI_CONFIG;
  }

  try {
    const text = await readFile(filePath, 'utf-8');
    return parseTuiConfig(text);
  } catch {
    throw new TuiConfigParseError(DEFAULT_TUI_CONFIG);
  }
}

export function parseTuiConfig(tomlText: string): TuiConfig {
  if (tomlText.trim().length === 0) {
    return DEFAULT_TUI_CONFIG;
  }
  const raw = parseToml(tomlText) as Record<string, unknown>;
  const parsed = TuiConfigFileSchema.parse(raw);
  return normalizeTuiConfig(parsed);
}

export async function saveTuiConfig(
  config: TuiConfig,
  filePath: string = getTuiConfigPath(),
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, renderTuiConfig(config), 'utf-8');
}

export function normalizeTuiConfig(config: TuiConfigFileShape): TuiConfig {
  const command = config.editor?.command?.trim();
  return TuiConfigSchema.parse({
    theme: config.theme ?? DEFAULT_TUI_CONFIG.theme,
    permissionMode: config.permission_mode ?? DEFAULT_TUI_CONFIG.permissionMode,
    disablePasteBurst: config.disable_paste_burst ?? DEFAULT_TUI_CONFIG.disablePasteBurst,
    editorCommand: command === undefined || command.length === 0 ? null : command,
    notifications: {
      enabled: config.notifications?.enabled ?? DEFAULT_NOTIFICATIONS_CONFIG.enabled,
      condition:
        config.notifications?.notification_condition ?? DEFAULT_NOTIFICATIONS_CONFIG.condition,
    },
    upgrade: {
      autoInstall: config.upgrade?.auto_install ?? DEFAULT_UPGRADE_PREFERENCES.autoInstall,
    },
    appearance: {
      profile: config.appearance?.profile ?? DEFAULT_APPEARANCE_PREFERENCES.profile,
      density: config.appearance?.density ?? DEFAULT_APPEARANCE_PREFERENCES.density,
      particles: config.appearance?.particles ?? DEFAULT_APPEARANCE_PREFERENCES.particles,
      animationFps:
        config.appearance?.animation_fps ?? DEFAULT_APPEARANCE_PREFERENCES.animationFps,
      canvasBackground:
        config.appearance?.canvas_background ?? DEFAULT_APPEARANCE_PREFERENCES.canvasBackground,
      terminalBackground:
        config.appearance?.terminal_background ?? DEFAULT_APPEARANCE_PREFERENCES.terminalBackground,
      terminalPalette:
        config.appearance?.terminal_palette ?? DEFAULT_APPEARANCE_PREFERENCES.terminalPalette,
    },
  });
}

export function renderTuiConfig(config: TuiConfig): string {
  const appearance = config.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
  return `# ~/.superliora/tui.toml
# Client preferences for kimi-code.
# Agent/runtime settings stay in ~/.superliora/config.toml.

theme = "${escapeTomlBasicString(config.theme)}" # "auto" | "dark" | "light" | custom theme name
permission_mode = "${config.permissionMode}" # "yolo" | "manual" | "auto"
disable_paste_burst = ${String(config.disablePasteBurst)} # true disables non-bracketed paste-burst fallback

[editor]
command = "${escapeTomlBasicString(config.editorCommand ?? '')}" # Empty uses $VISUAL / $EDITOR

[notifications]
enabled = ${String(config.notifications.enabled)} # true | false
notification_condition = "${config.notifications.condition}" # "unfocused" | "always"

[upgrade]
auto_install = ${String(config.upgrade.autoInstall)} # true | false

[appearance]
profile = "${appearance.profile}" # "auto" | "off" | "subtle" | "premium"
density = "${appearance.density}" # "auto" | "compact" | "comfortable" | "spacious"
particles = "${appearance.particles}" # "auto" | "off" | "ambient" | "events" | "premium"
animation_fps = ${String(appearance.animationFps)} # 1..60
canvas_background = ${String(appearance.canvasBackground)} # Fill TUI-owned cells with theme background
terminal_background = "${appearance.terminalBackground}" # "off" | "session"
terminal_palette = ${String(appearance.terminalPalette)} # true applies terminal palette until exit
`;
}

function escapeTomlBasicString(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\b', '\\b')
    .replaceAll('\t', '\\t')
    .replaceAll('\n', '\\n')
    .replaceAll('\f', '\\f')
    .replaceAll('\r', '\\r');
}
