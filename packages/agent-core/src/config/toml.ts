import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'pathe';

import { ErrorCodes, LioraError } from '#/errors/index';
import { applyEnvModelConfig, stripEnvModelConfig } from './env-model';
import {
  LioraConfigSchema,
  formatConfigValidationError,
  getDefaultConfig,
  type LioraConfig,
  validateConfig,
} from '#/config/schema';
import { atomicWrite } from '#/utils/fs';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { camelToSnake } from './toml-keys';
import { configToTomlData } from './toml-serialize';
import { transformTomlData } from './toml-transform';
import {
  cloneRecord,
  describeTomlSyntaxError,
  describeUnknownError,
  isFileExistsError,
  isPlainObject,
} from './toml-utils';

export { configToTomlData } from './toml-serialize';
export { transformTomlData } from './toml-transform';

const DEFAULT_CONFIG_FILE_TEXT = `# ~/.superliora/config.toml
# Runtime settings for SuperLiora.
# This file starts empty so built-in defaults can apply.
# Login will populate managed Kimi provider and model entries.
#
# Product telemetry is off by default (ZDR-friendly).
# Set telemetry = true only if you want usage analytics.
# telemetry = false
`;

export async function ensureConfigFile(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, 'wx', 0o600);
    await handle.writeFile(DEFAULT_CONFIG_FILE_TEXT, 'utf-8');
  } catch (error) {
    if (isFileExistsError(error)) return;
    throw error;
  } finally {
    await handle?.close();
  }
}

export function readConfigFile(filePath: string): LioraConfig {
  if (!existsSync(filePath)) {
    return getDefaultConfig();
  }
  const text = readFileSync(filePath, 'utf-8');
  return parseConfigString(text, filePath);
}

/**
 * Strict read for write paths (read-merge-write must never use a salvaged
 * config as its base, or the rewrite would drop the user's broken-but-fixable
 * sections). Re-throws validation failures with a short actionable message —
 * UIs surface it directly — instead of the raw validation details.
 */
export function readConfigFileForUpdate(filePath: string): LioraConfig {
  try {
    return readConfigFile(filePath);
  } catch (error) {
    if (error instanceof LioraError && error.code === ErrorCodes.CONFIG_INVALID) {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        `Cannot change settings while ${filePath} is invalid — fix it first (run \`liora doctor\` for details).`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Load the config for runtime consumption: the on-disk config plus any model
 * synthesized from `KIMI_MODEL_*` environment variables. Use this everywhere a
 * value is assigned to the live runtime config; use the raw `readConfigFile`
 * for write-back paths so the synthesized model is never persisted.
 */
export function loadRuntimeConfig(
  filePath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): LioraConfig {
  return applyEnvModelConfig(readConfigFile(filePath), env);
}

export interface RuntimeConfigLoadResult {
  readonly config: LioraConfig;
  /** Problems in config.toml itself; non-empty means parts (or all) of the file were ignored. */
  readonly fileWarnings: readonly string[];
  /** Problems applying KIMI_MODEL_* env overrides; the overlay was skipped. */
  readonly envWarnings: readonly string[];
  /**
   * Set when the file is entirely unusable (unreadable, TOML syntax error, or
   * nothing salvageable) and `config` is pure defaults. Startup fails fast on
   * this — defaults-only means the user looks logged out, which is worse than
   * an actionable parse error. Mid-run reloads ignore it and keep the last
   * good config instead.
   */
  readonly fileError?: LioraError;
}

/**
 * Lenient variant of `loadRuntimeConfig` that never throws: schema errors
 * drop only the offending sections (whole entry for `providers`/`models`,
 * whole top-level section otherwise) and a bad KIMI_MODEL_* env overlay is
 * skipped, each reported as a warning. A file that cannot be used at all
 * additionally sets `fileError` so startup can fail fast while mid-run
 * reloads degrade. Runtime read paths use this; write paths must keep using
 * the strict readers so a broken file is never silently rewritten.
 */
export function loadRuntimeConfigSafe(
  filePath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeConfigLoadResult {
  const fileWarnings: string[] = [];
  let fileError: LioraError | undefined;
  let config = getDefaultConfig();

  let text: string | undefined;
  try {
    text = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined;
  } catch (error) {
    fileError = new LioraError(
      ErrorCodes.CONFIG_INVALID,
      `Failed to read ${filePath}: ${describeUnknownError(error)}`,
      { cause: error },
    );
    fileWarnings.push(`Failed to read ${filePath}: ${describeUnknownError(error)}.`);
  }

  if (text !== undefined && text.trim().length > 0) {
    let data: Record<string, unknown> | undefined;
    try {
      data = parseToml(text) as Record<string, unknown>;
    } catch (error) {
      // Same message as the strict parser, code frame included, so failing
      // startup points straight at the offending line.
      fileError = new LioraError(
        ErrorCodes.CONFIG_INVALID,
        `Invalid TOML in ${filePath}: ${describeUnknownError(error)}`,
        { cause: error },
      );
      fileWarnings.push(`Invalid TOML in ${filePath}: ${describeTomlSyntaxError(error)}.`);
    }
    if (data !== undefined) {
      const raw = cloneRecord(data);
      const transformed = transformTomlData(data);
      transformed['raw'] = raw;
      const salvaged = salvageConfigData(transformed);
      if (salvaged.config === undefined) {
        fileError = new LioraError(
          ErrorCodes.CONFIG_INVALID,
          `Invalid configuration in ${filePath}: ${formatConfigValidationError(salvaged.error)}`,
          { cause: salvaged.error },
        );
        fileWarnings.push(
          `Invalid configuration in ${filePath}: ${formatConfigValidationError(salvaged.error)}.`,
        );
      } else {
        config = salvaged.config;
        if (salvaged.dropped.length > 0) {
          fileWarnings.push(
            `Ignored invalid config in ${filePath}: ${salvaged.dropped.join(', ')}. Run \`liora doctor\` for details.`,
          );
        }
      }
    }
  }

  const envWarnings: string[] = [];
  try {
    config = applyEnvModelConfig(config, env);
  } catch (error) {
    envWarnings.push(
      `Ignoring KIMI_MODEL_* environment overrides: ${describeUnknownError(error)}`,
    );
  }

  return { config, fileWarnings, envWarnings, fileError };
}

/** Sections keyed by user-chosen names where single entries can be dropped. */
const ENTRY_KEYED_SECTIONS = new Set(['providers', 'models']);

interface SalvageResult {
  readonly config: LioraConfig | undefined;
  readonly dropped: readonly string[];
  readonly error?: unknown;
}

function salvageConfigData(transformed: Record<string, unknown>): SalvageResult {
  const dropped: string[] = [];
  for (;;) {
    const result = LioraConfigSchema.safeParse(transformed);
    if (result.success) {
      return { config: result.data, dropped };
    }
    let deletedAny = false;
    for (const issue of result.error.issues) {
      const [section, entry] = issue.path;
      if (typeof section !== 'string' || !(section in transformed)) continue;
      const sectionValue = transformed[section];
      if (
        ENTRY_KEYED_SECTIONS.has(section) &&
        typeof entry === 'string' &&
        isPlainObject(sectionValue)
      ) {
        // Issues on entry-keyed sections only ever drop that entry. An entry
        // with several issues is deleted by the first one; later issues are
        // no-ops and must not escalate to deleting the whole section.
        if (entry in sectionValue) {
          delete sectionValue[entry];
          dropped.push(`${camelToSnake(section)}.${entry}`);
          deletedAny = true;
        }
        continue;
      }
      delete transformed[section];
      dropped.push(camelToSnake(section));
      deletedAny = true;
    }
    if (!deletedAny) {
      return { config: undefined, dropped, error: result.error };
    }
  }
}

export function parseConfigString(tomlText: string, filePath = 'config.toml'): LioraConfig {
  if (tomlText.trim().length === 0) {
    return getDefaultConfig();
  }

  let data: Record<string, unknown>;
  try {
    data = parseToml(tomlText) as Record<string, unknown>;
  } catch (error) {
    throw new LioraError(ErrorCodes.CONFIG_INVALID, `Invalid TOML in ${filePath}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  return parseConfigData(data, filePath);
}

function parseConfigData(data: Record<string, unknown>, filePath: string): LioraConfig {
  const raw = cloneRecord(data);
  const transformed = transformTomlData(data);
  transformed['raw'] = raw;

  try {
    return LioraConfigSchema.parse(transformed);
  } catch (error) {
    throw new LioraError(ErrorCodes.CONFIG_INVALID, `Invalid configuration in ${filePath}: ${formatConfigValidationError(error)}`, {
      cause: error,
    });
  }
}

export async function writeConfigFile(filePath: string, config: LioraConfig): Promise<void> {
  // Final guard: never persist the env-synthesized model/provider to disk,
  // even if a caller passes back the runtime config as a patch (see
  // stripEnvModelConfig / the getConfig -> setConfig round-trip).
  const validated = validateConfig(stripEnvModelConfig(config));
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await atomicWrite(filePath, `${stringifyToml(configToTomlData(validated))}\n`);
}
