import type { Session } from '@superliora/sdk';
import { resolve } from 'pathe';

import { currentTheme } from '../theme';
import { combineStartupNotice, isOAuthLoginRequiredError } from '../utils/startup';
import type { MutableCreateSessionOptions, StartupLifecycleHost } from './startup-lifecycle-types';

export async function initStartupSession(host: StartupLifecycleHost): Promise<boolean> {
  const { startup } = host.options;
  const { workDir } = host.state.appState;
  let session: Session | undefined;
  let shouldReplayHistory = false;
  const isResumeStartup = startup.sessionFlag !== undefined || startup.continueLast;
  const createSessionOptions: MutableCreateSessionOptions = {
    workDir,
    model: startup.model,
    permission: startup.auto
      ? 'auto'
      : startup.yolo
        ? 'yolo'
        : host.state.appState.permissionMode,
    planMode: startup.plan,
  };
  if (host.options.sessionMetadata !== undefined) {
    createSessionOptions.metadata = host.options.sessionMetadata;
  }
  if (host.state.appState.additionalDirs.length > 0) {
    createSessionOptions.additionalDirs = [...host.state.appState.additionalDirs];
  }

  try {
    if (isResumeStartup) {
      if (startup.sessionFlag === '') {
        host.state.startupState = 'picker';
        return false;
      }

      if (startup.sessionFlag !== undefined) {
        const sessions = await host.harness.listSessions({
          sessionId: startup.sessionFlag,
          workDir,
        });
        const target = sessions[0];
        if (target === undefined) {
          throw new Error(`Session "${startup.sessionFlag}" not found.`);
        }
        if (resolve(target.workDir) !== resolve(workDir)) {
          host.state.renderer.stop();
          process.stderr.write(
            `${currentTheme.fg(
              'warning',
              `Session "${startup.sessionFlag}" was created under a different directory.\n` +
                `  cd "${target.workDir}" && liora -r ${startup.sessionFlag}`,
            )}\n\n`,
          );
          throw new Error(
            `Session "${startup.sessionFlag}" was created under a different directory.`,
          );
        }
        session = await host.harness.resumeSession({
          id: startup.sessionFlag,
          additionalDirs: createSessionOptions.additionalDirs,
        });
        shouldReplayHistory = true;
      } else {
        const sessions = await host.harness.listSessions({ workDir });
        const target = sessions[0];
        if (target !== undefined) {
          session = await host.harness.resumeSession({
            id: target.id,
            additionalDirs: createSessionOptions.additionalDirs,
          });
          shouldReplayHistory = true;
        } else {
          session = await host.harness.createSession(createSessionOptions);
          host.startupNotice = combineStartupNotice(
            host.startupNotice,
            `No sessions to continue under "${workDir}"; starting a fresh session.`,
          );
        }
      }
    } else {
      session = await host.harness.createSession(createSessionOptions);
    }
    if (session !== undefined && shouldReplayHistory) {
      await host.sessionBrowser.applyStartupModesToResumedSession(session);
      if (startup.model !== undefined) {
        await session.setModel(startup.model);
      }
    }
  } catch (error) {
    if (!isOAuthLoginRequiredError(error)) throw error;
    host.authFlow.enterLoginRequiredStartupState();
    return false;
  }

  if (session === undefined) {
    throw new Error('Startup session was not initialized.');
  }
  await host.setSession(session);
  await host.syncRuntimeState(session);
  await host.refreshDynamicSlashCommands(session);
  host.sessionBrowser.applyStartupPermissionAndPlanToAppState();
  host.state.startupState = 'ready';
  return shouldReplayHistory;
}
