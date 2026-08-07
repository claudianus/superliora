/**
 * Client-owned preferences.
 *
 * Agent/runtime settings live in core's `config.toml`; this file owns
 * kimi-code client preferences such as terminal UI and update behavior.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { parse as parseToml } from 'smol-toml';
import { z } from 'zod';

import { getDataDir } from '#/utils/paths';

export const INVALID_TUI_CONFIG_MESSAGE =
  'Invalid TUI config in ~/.superliora/tui.toml; using defaults.';

export const TuiThemeSchema = z.string();
export const DEFAULT_TUI_THEME = 'superliora-neon-noir';

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

/**
 * How much detail the transcript shows for tool activity:
 * - `minimal`: collapse each tool chain into one live summary line until the
 *   assistant replies; on turn end it becomes a `Worked for …` line.
 * - `compact`: one line per tool (name · target · ±stats), input/output hidden.
 * - `standard`: per-tool preview (up to 5 lines) with highlighting — default.
 * - `full`: no truncation, equivalent to the Ctrl+O expanded state.
 */
export const TranscriptDetailSchema = z.enum(['minimal', 'compact', 'standard', 'full']);

/**
 * Coding-only syntax theme for transcript / code previews.
 * Independent of the UI chrome theme. `auto` picks GitHub Dimmed/Light
 * from canvas luminance; `palette` binds to UI ColorPalette (legacy).
 */
export const SyntaxThemeSchema = z.enum([
  'auto',
  'palette',
  'github-dark-dimmed',
  'github-light',
  'one-dark-pro',
  'catppuccin-mocha',
  'nord',
  'solarized-dark',
  'solarized-light',
]);

/**
 * Status-bar (footer) slot visibility.
 * - `auto`: Layered defaults (show when useful / content exists)
 * - `always`: force show whenever data exists
 * - `off`: never show
 */
export const FooterSlotSchema = z.enum(['auto', 'always', 'off']);
export const FooterLabelsSchema = z.enum(['plain', 'compact']);

export const FooterPreferencesSchema = z.object({
  /** plain = human words (default); compact = denser short tokens */
  labels: FooterLabelsSchema,
  modes: FooterSlotSchema,
  model: FooterSlotSchema,
  cwd: FooterSlotSchema,
  git: FooterSlotSchema,
  context: FooterSlotSchema,
  goal: FooterSlotSchema,
  menu: FooterSlotSchema,
  background: FooterSlotSchema,
  tips: FooterSlotSchema,
  nextAction: FooterSlotSchema,
  workingSet: FooterSlotSchema,
  quota: FooterSlotSchema,
  mediaReady: FooterSlotSchema,
  index: FooterSlotSchema,
  mcp: FooterSlotSchema,
  cache: FooterSlotSchema,
  pulseGoalProgress: z.boolean(),
  pulseFleetComplete: z.boolean(),
  pulsePermission: z.boolean(),
  pulseGitChurn: z.boolean(),
  pulseOpsCombo: z.boolean(),
  pulseExtensionsReload: z.boolean(),
  pulseRuntimeDegraded: z.boolean(),
  pulseSearchCascade: z.boolean(),
  pulseModelRoute: z.boolean(),
  showCompact: z.boolean(),
  showPromptIntelligence: z.boolean(),
});

export const AppearancePreferencesSchema = z.object({
  profile: AppearanceProfileSchema,
  density: AppearanceDensitySchema,
  particles: AppearanceParticlesSchema,
  animationFps: z.number().int().min(1).max(60),
  canvasBackground: z.boolean(),
  terminalBackground: TerminalBackgroundSchema,
  terminalPalette: z.boolean(),
  showTimestamps: z.boolean(),
  transcriptDetail: TranscriptDetailSchema,
  /**
   * Mission Control dock visibility: `auto` appears while background workers
   * exist, `pinned` keeps the panel mounted even when idle, `hidden` disables
   * every Mission Control surface.
   */
  missionControl: z.enum(['auto', 'pinned', 'hidden']),
  /**
   * Structured-first tool rendering. Orthogonal to {@link transcriptDetail}:
   * density picks how many rows a result gets, neat picks whether those rows
   * are a structured card or the raw output body.
   */
  neat: z.boolean(),
  /** Coding syntax theme — independent of UI chrome palette. */
  syntaxTheme: SyntaxThemeSchema,
});

const FooterConfigFileFieldsSchema = z.object({
  labels: FooterLabelsSchema.optional(),
  modes: FooterSlotSchema.optional(),
  model: FooterSlotSchema.optional(),
  cwd: FooterSlotSchema.optional(),
  git: FooterSlotSchema.optional(),
  context: FooterSlotSchema.optional(),
  goal: FooterSlotSchema.optional(),
  menu: FooterSlotSchema.optional(),
  background: FooterSlotSchema.optional(),
  tips: FooterSlotSchema.optional(),
  next_action: FooterSlotSchema.optional(),
  working_set: FooterSlotSchema.optional(),
  quota: FooterSlotSchema.optional(),
  media_ready: FooterSlotSchema.optional(),
  index: FooterSlotSchema.optional(),
  mcp: FooterSlotSchema.optional(),
  cache: FooterSlotSchema.optional(),
  pulse_goal_progress: z.boolean().optional(),
  pulse_fleet_complete: z.boolean().optional(),
  pulse_permission: z.boolean().optional(),
  pulse_git_churn: z.boolean().optional(),
  pulse_ops_combo: z.boolean().optional(),
  pulse_extensions_reload: z.boolean().optional(),
  pulse_runtime_degraded: z.boolean().optional(),
  pulse_search_cascade: z.boolean().optional(),
  pulse_model_route: z.boolean().optional(),
  show_compact: z.boolean().optional(),
  show_prompt_intelligence: z.boolean().optional(),
});

const FooterConfigFileSchema = FooterConfigFileFieldsSchema.optional();

const AppearanceConfigFileFieldsSchema = z.object({
  profile: AppearanceProfileSchema.optional(),
  density: AppearanceDensitySchema.optional(),
  particles: AppearanceParticlesSchema.optional(),
  animation_fps: z.number().int().min(1).max(60).optional(),
  canvas_background: z.boolean().optional(),
  terminal_background: TerminalBackgroundSchema.optional(),
  terminal_palette: z.boolean().optional(),
  show_timestamps: z.boolean().optional(),
  transcript_detail: TranscriptDetailSchema.optional(),
  mission_control: z.enum(['auto', 'pinned', 'hidden']).optional(),
  neat: z.boolean().optional(),
  syntax_theme: SyntaxThemeSchema.optional(),
});

const EditorConfigFileSchema = z
  .object({
    command: z.string().optional(),
  })
  .optional();

const NotificationsConfigFileSchema = z
  .object({
    enabled: z.boolean().optional(),
    notification_condition: NotificationConditionSchema.optional(),
  })
  .optional();

const UpgradeConfigFileSchema = z
  .object({
    auto_install: z.boolean().optional(),
  })
  .optional();

const OnboardingConfigFileSchema = z
  .object({
    hub_intro_seen: z.boolean().optional(),
  })
  .optional();

const PermissionModeFileSchema = z.enum(['yolo', 'manual', 'auto']).optional();

export const TuiConfigFileSchema = z.object({
  theme: TuiThemeSchema.optional(),
  permission_mode: PermissionModeFileSchema,
  disable_paste_burst: z.boolean().optional(),
  editor: EditorConfigFileSchema,
  notifications: NotificationsConfigFileSchema,
  upgrade: UpgradeConfigFileSchema,
  appearance: AppearanceConfigFileFieldsSchema.optional(),
  footer: FooterConfigFileSchema,
  onboarding: OnboardingConfigFileSchema,
});

export const OnboardingPreferencesSchema = z.object({
  hubIntroSeen: z.boolean(),
});

export const TuiConfigSchema = z.object({
  theme: TuiThemeSchema,
  permissionMode: z.enum(['yolo', 'manual', 'auto']),
  disablePasteBurst: z.boolean(),
  editorCommand: z.string().nullable(),
  notifications: NotificationsConfigSchema,
  upgrade: UpgradePreferencesSchema,
  appearance: AppearancePreferencesSchema.optional(),
  footer: FooterPreferencesSchema.optional(),
  onboarding: OnboardingPreferencesSchema.optional(),
});

export type TuiConfigFileShape = z.infer<typeof TuiConfigFileSchema>;
export type TuiConfig = z.infer<typeof TuiConfigSchema>;
export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;
export type UpgradePreferences = z.infer<typeof UpgradePreferencesSchema>;
export type AppearancePreferences = z.infer<typeof AppearancePreferencesSchema>;
export type FooterPreferences = z.infer<typeof FooterPreferencesSchema>;
export type FooterSlot = z.infer<typeof FooterSlotSchema>;
export type FooterLabels = z.infer<typeof FooterLabelsSchema>;
export type OnboardingPreferences = z.infer<typeof OnboardingPreferencesSchema>;

export const DEFAULT_NOTIFICATIONS_CONFIG: NotificationsConfig = {
  enabled: true,
  condition: 'unfocused',
};

export const DEFAULT_ONBOARDING_PREFERENCES: OnboardingPreferences = {
  hubIntroSeen: false,
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
  showTimestamps: true,
  transcriptDetail: 'standard',
  missionControl: 'auto',
  neat: true,
  syntaxTheme: 'auto',
};

/** Layered status-bar defaults — plain labels, essentials on, ops opt-in. */
export const DEFAULT_FOOTER_PREFERENCES: FooterPreferences = {
  labels: 'plain',
  modes: 'auto',
  model: 'auto',
  cwd: 'auto',
  git: 'auto',
  context: 'auto',
  goal: 'auto',
  menu: 'auto',
  background: 'auto',
  tips: 'auto',
  nextAction: 'auto',
  workingSet: 'auto',
  quota: 'auto',
  mediaReady: 'auto',
  index: 'off',
  mcp: 'auto',
  cache: 'auto',
  pulseGoalProgress: true,
  pulseFleetComplete: true,
  pulsePermission: true,
  pulseGitChurn: true,
  pulseOpsCombo: true,
  pulseExtensionsReload: true,
  pulseRuntimeDegraded: true,
  pulseSearchCascade: true,
  pulseModelRoute: true,
  showCompact: false,
  showPromptIntelligence: true,
};

export const DEFAULT_TUI_CONFIG: TuiConfig = TuiConfigSchema.parse({
  theme: DEFAULT_TUI_THEME,
  permissionMode: 'yolo',
  disablePasteBurst: false,
  editorCommand: null,
  notifications: DEFAULT_NOTIFICATIONS_CONFIG,
  upgrade: DEFAULT_UPGRADE_PREFERENCES,
  appearance: DEFAULT_APPEARANCE_PREFERENCES,
  footer: DEFAULT_FOOTER_PREFERENCES,
  onboarding: DEFAULT_ONBOARDING_PREFERENCES,
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

  const text = await readFile(filePath, 'utf-8');
  try {
    return parseTuiConfig(text);
  } catch {
    throw new TuiConfigParseError(fallbackTuiConfigFromSalvage(text));
  }
}

export function parseTuiConfig(tomlText: string): TuiConfig {
  if (tomlText.trim().length === 0) {
    return DEFAULT_TUI_CONFIG;
  }
  const raw = parseToml(tomlText) as Record<string, unknown>;
  return normalizeTuiConfig(coerceTuiConfigFile(raw));
}

/**
 * Strict on-disk shape check for `liora doctor`.
 * Runtime load uses {@link parseTuiConfig} (section-tolerant); doctor still
 * surfaces invalid nested fields so operators can fix them.
 */
export function assertTuiConfigFile(tomlText: string): void {
  if (tomlText.trim().length === 0) return;
  const raw = parseToml(tomlText) as Record<string, unknown>;
  TuiConfigFileSchema.parse(raw);
}

export async function saveTuiConfig(
  config: TuiConfig,
  filePath: string = getTuiConfigPath(),
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await writeFile(tmpPath, renderTuiConfig(config), 'utf-8');
    await rename(tmpPath, filePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

/**
 * Section-tolerant coerce: one invalid nested section falls back to
 * "missing" so {@link normalizeTuiConfig} fills defaults without discarding
 * a valid top-level `theme` (or other healthy keys).
 */
function coerceTuiConfigFile(raw: Record<string, unknown>): TuiConfigFileShape {
  return {
    theme: softParse(TuiThemeSchema.optional(), raw['theme']),
    permission_mode: softParse(PermissionModeFileSchema, raw['permission_mode']),
    disable_paste_burst: softParse(z.boolean().optional(), raw['disable_paste_burst']),
    editor: softParse(EditorConfigFileSchema, raw['editor']),
    notifications: softParse(NotificationsConfigFileSchema, raw['notifications']),
    upgrade: softParse(UpgradeConfigFileSchema, raw['upgrade']),
    appearance: softParse(AppearanceConfigFileFieldsSchema.optional(), raw['appearance']),
    footer: softParse(FooterConfigFileSchema, raw['footer']),
    onboarding: softParse(OnboardingConfigFileSchema, raw['onboarding']),
  };
}

function softParse<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Best-effort theme recovery when TOML itself is unparseable. */
function salvageThemePreference(tomlText: string): string | undefined {
  const doubleQuoted = /^\s*theme\s*=\s*"((?:\\.|[^"\\])*)"/m.exec(tomlText);
  const singleQuoted = /^\s*theme\s*=\s*'((?:\\.|[^'\\])*)'/m.exec(tomlText);
  const raw = doubleQuoted?.[1] ?? singleQuoted?.[1];
  if (raw === undefined) return undefined;
  const unescaped = unescapeTomlBasicString(raw);
  const parsed = TuiThemeSchema.safeParse(unescaped);
  return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
}

function fallbackTuiConfigFromSalvage(tomlText: string): TuiConfig {
  const theme = salvageThemePreference(tomlText);
  if (theme === undefined) return DEFAULT_TUI_CONFIG;
  return { ...DEFAULT_TUI_CONFIG, theme };
}

function unescapeTomlBasicString(value: string): string {
  return value
    .replaceAll('\\"', '"')
    .replaceAll('\\n', '\n')
    .replaceAll('\\r', '\r')
    .replaceAll('\\t', '\t')
    .replaceAll('\\f', '\f')
    .replaceAll('\\b', '\b')
    .replaceAll('\\\\', '\\');
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
      showTimestamps:
        config.appearance?.show_timestamps ?? DEFAULT_APPEARANCE_PREFERENCES.showTimestamps,
      transcriptDetail:
        config.appearance?.transcript_detail ?? DEFAULT_APPEARANCE_PREFERENCES.transcriptDetail,
      missionControl:
        config.appearance?.mission_control ?? DEFAULT_APPEARANCE_PREFERENCES.missionControl,
      neat: config.appearance?.neat ?? DEFAULT_APPEARANCE_PREFERENCES.neat,
      syntaxTheme:
        config.appearance?.syntax_theme ?? DEFAULT_APPEARANCE_PREFERENCES.syntaxTheme,
    },
    footer: normalizeFooterPreferences(config.footer),
    onboarding: {
      hubIntroSeen:
        config.onboarding?.hub_intro_seen ?? DEFAULT_ONBOARDING_PREFERENCES.hubIntroSeen,
    },
  });
}

function normalizeFooterPreferences(
  raw: TuiConfigFileShape['footer'],
): FooterPreferences {
  const d = DEFAULT_FOOTER_PREFERENCES;
  if (raw === undefined) return { ...d };
  return {
    labels: raw.labels ?? d.labels,
    modes: raw.modes ?? d.modes,
    model: raw.model ?? d.model,
    cwd: raw.cwd ?? d.cwd,
    git: raw.git ?? d.git,
    context: raw.context ?? d.context,
    goal: raw.goal ?? d.goal,
    menu: raw.menu ?? d.menu,
    background: raw.background ?? d.background,
    tips: raw.tips ?? d.tips,
    nextAction: raw.next_action ?? d.nextAction,
    workingSet: raw.working_set ?? d.workingSet,
    quota: raw.quota ?? d.quota,
    mediaReady: raw.media_ready ?? d.mediaReady,
    index: raw.index ?? d.index,
    mcp: raw.mcp ?? d.mcp,
    cache: raw.cache ?? d.cache,
    pulseGoalProgress: raw.pulse_goal_progress ?? d.pulseGoalProgress,
    pulseFleetComplete: raw.pulse_fleet_complete ?? d.pulseFleetComplete,
    pulsePermission: raw.pulse_permission ?? d.pulsePermission,
    pulseGitChurn: raw.pulse_git_churn ?? d.pulseGitChurn,
    pulseOpsCombo: raw.pulse_ops_combo ?? d.pulseOpsCombo,
    pulseExtensionsReload: raw.pulse_extensions_reload ?? d.pulseExtensionsReload,
    pulseRuntimeDegraded: raw.pulse_runtime_degraded ?? d.pulseRuntimeDegraded,
    pulseSearchCascade: raw.pulse_search_cascade ?? d.pulseSearchCascade,
    pulseModelRoute: raw.pulse_model_route ?? d.pulseModelRoute,
    showCompact: raw.show_compact ?? d.showCompact,
    showPromptIntelligence: raw.show_prompt_intelligence ?? d.showPromptIntelligence,
  };
}

export function renderTuiConfig(config: TuiConfig): string {
  const appearance = config.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
  const footer = config.footer ?? DEFAULT_FOOTER_PREFERENCES;
  const onboarding = config.onboarding ?? DEFAULT_ONBOARDING_PREFERENCES;
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
show_timestamps = ${String(appearance.showTimestamps)} # true shows HH:MM on user messages
transcript_detail = "${appearance.transcriptDetail}" # "minimal" | "compact" | "standard" | "full"
mission_control = "${appearance.missionControl}" # "auto" | "pinned" | "hidden"
neat = ${String(appearance.neat)} # true renders structured tool cards; false shows raw output
syntax_theme = "${appearance.syntaxTheme}" # "auto" | "github-dark-dimmed" | "one-dark-pro" | "palette" | …

[footer]
# Status bar — "auto" | "always" | "off" for slots; labels = "plain" | "compact"
labels = "${footer.labels}"
modes = "${footer.modes}"
model = "${footer.model}"
cwd = "${footer.cwd}"
git = "${footer.git}"
context = "${footer.context}"
goal = "${footer.goal}"
menu = "${footer.menu}"
background = "${footer.background}"
tips = "${footer.tips}"
next_action = "${footer.nextAction}"
working_set = "${footer.workingSet}"
quota = "${footer.quota}"
media_ready = "${footer.mediaReady}"
index = "${footer.index}"
mcp = "${footer.mcp}"
cache = "${footer.cache}"
pulse_goal_progress = ${String(footer.pulseGoalProgress)}
pulse_fleet_complete = ${String(footer.pulseFleetComplete)}
pulse_permission = ${String(footer.pulsePermission)}
pulse_git_churn = ${String(footer.pulseGitChurn)}
pulse_ops_combo = ${String(footer.pulseOpsCombo)}
pulse_extensions_reload = ${String(footer.pulseExtensionsReload)}
pulse_runtime_degraded = ${String(footer.pulseRuntimeDegraded)}
pulse_search_cascade = ${String(footer.pulseSearchCascade)}
pulse_model_route = ${String(footer.pulseModelRoute)}
show_compact = ${String(footer.showCompact)}
show_prompt_intelligence = ${String(footer.showPromptIntelligence)}

[onboarding]
hub_intro_seen = ${String(onboarding.hubIntroSeen)} # true skips the first-run Command Hub intro
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
