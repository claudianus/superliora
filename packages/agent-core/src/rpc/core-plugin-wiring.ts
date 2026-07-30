/**
 * Plugin session wiring — extracted from the pre-modular core-impl monolith.
 */

import { log } from '#/logging/logger';
import { mergeConfigPatch, type LioraConfig } from '../config';
import type { Agent } from '../agent';
import {
  armPluginMonitors,
  createSessionHookHost,
  PluginChannelRuntime,
  PluginHost,
  PluginLspRuntime,
  renderLspDiagnosticsReminder,
  WorkflowHost,
  type PluginDiagnostic,
  type PluginManager,
} from '../plugin';
import type { Session } from '../session';
import {
  combinePluginMcpConfig,
  managedKimiCodeEnvForPlugins,
  withManagedKimiPluginEnv,
} from './plugin-mcp-env';
import type { SessionMcpConfig } from '../mcp';

export interface CorePluginWiringContext {
  readonly homeDir: string;
  readonly projectDir: string;
  readonly channelServers: readonly string[];
  readonly config: LioraConfig;
  readonly plugins: PluginManager;
  readonly pluginHost: PluginHost;
}

export function mergePluginMcpConfigWithHost(
  context: CorePluginWiringContext,
  base: SessionMcpConfig | undefined,
): SessionMcpConfig | undefined {
  const managedEnv = managedKimiCodeEnvForPlugins(context.config);
  const pluginServers = withManagedKimiPluginEnv(context.pluginHost.mcpServers(), managedEnv);
  return combinePluginMcpConfig(base, pluginServers);
}

export async function resolvePluginSessionConfig(
  context: CorePluginWiringContext,
  config: LioraConfig,
): Promise<{
  readonly config: LioraConfig;
  readonly env: Readonly<Record<string, string>>;
}> {
  const overlay = await context.pluginHost.settingsOverlay();
  logPluginDiagnostics(overlay.diagnostics);
  logPluginDiagnostics(context.pluginHost.dependencyDiagnostics());

  const { permission: overlayPermission, ...overlayRest } = overlay.patch;
  let sessionConfig = config;
  if (Object.keys(overlayRest).length > 0) {
    try {
      sessionConfig = mergeConfigPatch(config, overlayRest);
    } catch (error) {
      log.warn('plugin settings.json overlay rejected; using base config', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const overlayRules = overlayPermission?.rules ?? [];
  if (overlayRules.length > 0) {
    sessionConfig = {
      ...sessionConfig,
      permission: {
        ...sessionConfig.permission,
        rules: [...(sessionConfig.permission?.rules ?? []), ...overlayRules],
      },
    };
  }
  return { config: sessionConfig, env: overlay.env };
}

export async function wirePluginSessionHosts(
  context: CorePluginWiringContext,
  session: Session,
  mainAgent: Agent | undefined,
): Promise<void> {
  session.hookEngine.setHost(createSessionHookHost(session));

  const pluginWorkflowDirs: { pluginId: string; dir: string }[] = [];
  for (const pkg of context.pluginHost.enabledPackages()) {
    const workflowsDir = context.plugins.get(pkg.id)?.manifest?.workflowsDir;
    if (workflowsDir !== undefined) {
      pluginWorkflowDirs.push({ pluginId: pkg.id, dir: workflowsDir });
    }
  }
  session.workflowHost = new WorkflowHost(
    {
      projectDir: context.projectDir,
      pluginWorkflowDirs,
    },
    mainAgent,
  );
  await session.workflowHost.refresh();

  const channelServerNames = new Set<string>(context.channelServers);
  for (const bundle of context.pluginHost.channels()) {
    for (const channel of bundle.channels) {
      channelServerNames.add(channel.server);
      channelServerNames.add(`plugin:${bundle.pluginId}:${channel.server}`);
    }
  }
  session.channelsOptIn = context.channelServers.length > 0;
  if (mainAgent !== undefined && channelServerNames.size > 0) {
    const runtime = new PluginChannelRuntime(
      mainAgent,
      [...channelServerNames],
      session.channelsOptIn,
    );
    session.pluginChannelRuntime = runtime;
    session.mcp.setNotificationHandler((server, method, params) => {
      runtime.handleNotification(server, method, params);
    });
  } else {
    session.pluginChannelRuntime = undefined;
    session.mcp.setNotificationHandler(undefined);
  }

  if (mainAgent !== undefined) {
    await armEnabledPluginMonitors(context, mainAgent);

    const styleReminder = await context.pluginHost.outputStylesReminder();
    if (styleReminder !== undefined) {
      mainAgent.context.appendSystemReminder(styleReminder, {
        kind: 'system_trigger',
        name: 'plugin-output-styles',
      });
    }

    const channelsReminder = await context.pluginHost.channelsReminder();
    if (channelsReminder !== undefined) {
      mainAgent.context.appendSystemReminder(channelsReminder, {
        kind: 'system_trigger',
        name: 'plugin-channels',
      });
    }

    const workflowReminder = await context.pluginHost.workflowScriptsReminder();
    if (workflowReminder !== undefined) {
      mainAgent.context.appendSystemReminder(workflowReminder, {
        kind: 'system_trigger',
        name: 'plugin-workflows',
      });
    }

    const lspBundles = await context.pluginHost.lspServers();
    for (const bundle of lspBundles) {
      logPluginDiagnostics(bundle.diagnostics);
      const reminder = renderLspDiagnosticsReminder({
        pluginId: bundle.pluginId,
        servers: bundle.servers,
      });
      if (reminder !== undefined) {
        mainAgent.context.appendSystemReminder(reminder, {
          kind: 'system_trigger',
          name: `plugin-lsp:${bundle.pluginId}`,
        });
      }
    }

    await session.pluginLspRuntime?.dispose();
    const servers = await context.pluginHost.flatLspServers();
    if (servers.length > 0) {
      const runtime = new PluginLspRuntime(servers, mainAgent.config.cwd);
      session.pluginLspRuntime = runtime;
      mainAgent.fileMutationHook = (filePath, content) =>
        runtime.collectForFile(filePath, content);
    } else {
      session.pluginLspRuntime = undefined;
      mainAgent.fileMutationHook = undefined;
    }
  }
}

function logPluginDiagnostics(diagnostics: readonly PluginDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') {
      log.error(diagnostic.message);
    } else if (diagnostic.severity === 'warn') {
      log.warn(diagnostic.message);
    } else {
      log.info(diagnostic.message);
    }
  }
}

async function armEnabledPluginMonitors(
  context: CorePluginWiringContext,
  agent: Agent,
): Promise<void> {
  const monitors = context.pluginHost.monitors();
  if (monitors.length === 0) return;
  await armPluginMonitors({
    agent,
    kaos: agent.kaos,
    monitors,
  });
}
