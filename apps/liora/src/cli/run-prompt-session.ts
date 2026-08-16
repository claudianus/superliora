import chalk from 'chalk';
import type { LioraHarness, Session, SessionStatus } from '@superliora/sdk';
import { resolve } from 'pathe';

import { tln } from '#/cli/i18n';
import type { CLIOptions } from './options';
import type { PromptOutput } from './run-prompt-io';

export interface ResolvedPromptSession {
  readonly session: Session;
  readonly resumed: boolean;
  readonly restorePermission: () => Promise<void>;
  readonly telemetryModel?: string;
  readonly goalModel?: string;
}

export async function resolvePromptSession(
  harness: LioraHarness,
  opts: CLIOptions,
  workDir: string,
  defaultModel: string | undefined,
  stderr: PromptOutput,
  setRestorePermission: (restorePermission: () => Promise<void>) => void,
  sessionMetadata?: import('@superliora/sdk').JsonObject,
): Promise<ResolvedPromptSession> {
  if (opts.session !== undefined) {
    const sessions = await harness.listSessions({ sessionId: opts.session, workDir });
    const target = sessions[0];
    if (target === undefined) {
      throw new Error(`Session "${opts.session}" not found.`);
    }
    if (resolve(target.workDir) !== resolve(workDir)) {
      stderr.write(
        `${chalk.hex('#E8A838')(
          `Session "${opts.session}" was created under a different directory.\n` +
            `  cd "${target.workDir}" && liora -r ${opts.session}`,
        )}\n\n`,
      );
      throw new Error(
        `Session "${opts.session}" was created under a different directory.`,
      );
    }
    const session = await harness.resumeSession({
      id: opts.session,
      additionalDirs: opts.addDirs?.length ? opts.addDirs : undefined,
    });
    const status = await session.getStatus();
    const restorePermission = await forcePromptPermission(
      session,
      status.permission,
      setRestorePermission,
    );
    if (opts.model !== undefined) {
      await session.setModel(opts.model);
    }
    installHeadlessHandlers(session);
    return {
      session,
      resumed: true,
      restorePermission,
      telemetryModel: configuredModel(opts.model, status.model, defaultModel),
      goalModel: configuredModel(opts.model, status.model),
    };
  }

  if (opts.continue) {
    const sessions = await harness.listSessions({ workDir });
    const previous = sessions[0];
    if (previous !== undefined) {
      const session = await harness.resumeSession({
        id: previous.id,
        additionalDirs: opts.addDirs?.length ? opts.addDirs : undefined,
      });
      const status = await session.getStatus();
      const restorePermission = await forcePromptPermission(
        session,
        status.permission,
        setRestorePermission,
      );
      if (opts.model !== undefined) {
        await session.setModel(opts.model);
      }
      installHeadlessHandlers(session);
      return {
        session,
        resumed: true,
        restorePermission,
        telemetryModel: configuredModel(opts.model, status.model, defaultModel),
        goalModel: configuredModel(opts.model, status.model),
      };
    }
    stderr.write(tln('cli.runtime.prompt.noSessionsContinue', { workDir }));
  }

  const model = requireConfiguredModel(opts.model, defaultModel);
  const sandboxMeta =
    opts.sandbox === 'off' || opts.sandbox === 'workspace' || opts.sandbox === 'read-only'
      ? { sandboxProfile: opts.sandbox }
      : undefined;
  const session = await harness.createSession({
    workDir,
    model,
    permission: 'auto',
    additionalDirs: opts.addDirs?.length ? opts.addDirs : undefined,
    drainAgentTasksOnStop: true,
    metadata: {
      ...(sessionMetadata ?? {}),
      ...(sandboxMeta ?? {}),
    },
  });
  installHeadlessHandlers(session);
  return {
    session,
    resumed: false,
    restorePermission: async () => {},
    telemetryModel: model,
    goalModel: model,
  };
}

async function forcePromptPermission(
  session: Session,
  previousPermission: SessionStatus['permission'],
  setRestorePermission: (restorePermission: () => Promise<void>) => void,
): Promise<() => Promise<void>> {
  let overridePermission: Promise<void> | undefined;
  const restorePermission = async () => {
    await overridePermission?.catch(() => {});
    if (previousPermission !== 'auto') {
      await session.setPermission(previousPermission);
    }
  };
  setRestorePermission(restorePermission);
  if (previousPermission !== 'auto') {
    overridePermission = session.setPermission('auto');
    await overridePermission;
  }
  return restorePermission;
}

export function requireConfiguredModel(...models: readonly (string | undefined)[]): string {
  const model = configuredModel(...models);
  if (model === undefined) {
    throw new Error(
      'No model configured. Run `liora` and use /login to sign in, then retry; or set default_model in config.toml.',
    );
  }
  return model;
}

function configuredModel(...models: readonly (string | undefined)[]): string | undefined {
  return models.find((model) => model !== undefined && model.trim().length > 0);
}

function installHeadlessHandlers(session: Session): void {
  session.setApprovalHandler(() => ({ decision: 'approved' }));
  session.setQuestionHandler(() => null);
  session.setCredentialHandler(() => null);
}
