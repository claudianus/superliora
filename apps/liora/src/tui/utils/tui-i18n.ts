/**
 * TUI string localization wrapper.
 *
 * Reuses the CLI locale catalog (`src/cli/i18n`) — TUI keys live under the
 * `tui.*` namespace and are spread into the shared `STRINGS_EN` / `STRINGS_KO`
 * maps. The runtime locale is set once at startup via
 * `setCliLocale(detectCliLocale(process.env))`, so the TUI and CLI share the
 * same active locale.
 *
 * `ttui(key, params?)` mirrors the CLI `t()` semantics: English fallback, then
 * raw key — a missing translation never renders a placeholder. `{name}`
 * placeholders are substituted from `params`.
 */

import { t } from '#/cli/i18n';

/**
 * Looks up a localized TUI string. Falls back to English, then to the raw key.
 * `{name}` placeholders in the template are substituted from `params`.
 */
export function ttui(key: string, params?: Record<string, string | number>): string {
  return t(key, params);
}
