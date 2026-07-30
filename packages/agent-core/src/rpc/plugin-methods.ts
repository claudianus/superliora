/**
 * Plugin RPC method bodies — extracted from core-impl.ts.
 *
 * Every plugin RPC method follows the same shape: await plugin readiness,
 * assert the plugin state loaded cleanly, then delegate to `PluginManager`.
 * These functions take a small `PluginMethodsContext` view of `LioraCore`
 * instead of the whole class so they stay independently testable.
 */

import { ErrorCodes, LioraError } from '#/errors/index';
import type { PluginManager } from '#/plugin/index';

import type {
  EmptyPayload,
  GetPluginInfoPayload,
  InstallPluginPayload,
  PluginInfo,
  PluginSummary,
  ReloadPluginsResult,
  RemovePluginPayload,
  SetPluginEnabledPayload,
  SetPluginMcpServerEnabledPayload,
} from './core-api';

export interface PluginMethodsContext {
  readonly plugins: PluginManager;
  readonly homeDir: string;
  readonly pluginsReady: Promise<void>;
  pluginsLoadError: Error | undefined;
}

function assertPluginsLoaded(context: PluginMethodsContext): void {
  if (context.pluginsLoadError === undefined) return;
  throw new LioraError(
    ErrorCodes.PLUGIN_LOAD_FAILED,
    `Plugin state failed to load: ${context.pluginsLoadError.message}. ` +
      `Fix the file at ${context.homeDir}/plugins/installed.json and run /plugins reload.`,
    { cause: context.pluginsLoadError, details: { kimiHomeDir: context.homeDir } },
  );
}

export async function installPlugin(
  context: PluginMethodsContext,
  payload: InstallPluginPayload,
): Promise<PluginSummary> {
  await context.pluginsReady;
  assertPluginsLoaded(context);
  const record = await context.plugins.install(payload.source);
  return context.plugins.summaries().find((s) => s.id === record.id)!;
}

export async function listPlugins(
  context: PluginMethodsContext,
  _: EmptyPayload,
): Promise<readonly PluginSummary[]> {
  await context.pluginsReady;
  assertPluginsLoaded(context);
  return context.plugins.summaries();
}

export async function setPluginEnabled(
  context: PluginMethodsContext,
  { id, enabled }: SetPluginEnabledPayload,
): Promise<void> {
  await context.pluginsReady;
  assertPluginsLoaded(context);
  await context.plugins.setEnabled(id, enabled);
}

export async function setPluginMcpServerEnabled(
  context: PluginMethodsContext,
  { id, server, enabled }: SetPluginMcpServerEnabledPayload,
): Promise<void> {
  await context.pluginsReady;
  assertPluginsLoaded(context);
  await context.plugins.setMcpServerEnabled(id, server, enabled);
}

export async function removePlugin(
  context: PluginMethodsContext,
  { id }: RemovePluginPayload,
): Promise<void> {
  await context.pluginsReady;
  assertPluginsLoaded(context);
  await context.plugins.remove(id);
}

export async function reloadPlugins(
  context: PluginMethodsContext,
  _: EmptyPayload,
): Promise<ReloadPluginsResult> {
  try {
    const summary = await context.plugins.reload();
    context.pluginsLoadError = undefined;
    return summary;
  } catch (error) {
    context.pluginsLoadError = error instanceof Error ? error : new Error(String(error));
    throw new LioraError(
      ErrorCodes.PLUGIN_LOAD_FAILED,
      `Failed to reload plugins: ${context.pluginsLoadError.message}`,
      { cause: error, details: { kimiHomeDir: context.homeDir } },
    );
  }
}

export async function getPluginInfo(
  context: PluginMethodsContext,
  { id }: GetPluginInfoPayload,
): Promise<PluginInfo> {
  await context.pluginsReady;
  assertPluginsLoaded(context);
  const info = context.plugins.info(id);
  if (info === undefined) {
    throw new LioraError(ErrorCodes.PLUGIN_NOT_FOUND, `Plugin "${id}" is not installed`, {
      details: { id },
    });
  }
  return info;
}
