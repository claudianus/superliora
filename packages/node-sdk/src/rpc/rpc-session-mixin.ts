/**
 * Session lifecycle RPC delegation for `SDKRpcClientBase` — extracted from rpc.ts.
 */

import type { Kaos } from '@superliora/kaos';

import type {
  CreateSessionOptions,
  ExportSessionInput,
  ExportSessionResult,
  ForkSessionInput,
  ListSessionsOptions,
  RenameSessionInput,
  ResumeSessionInput,
  ResumedSessionSummary,
  SessionSummary,
} from '#/session/types';

import type {
  ReloadSessionRpcInput,
  SessionIdRpcInput,
} from './rpc-types';
import { SDKRpcClientPluginsMixin } from './rpc-plugins-mixin';

export abstract class SDKRpcClientSessionMixin extends SDKRpcClientPluginsMixin {
  async createSession(input: CreateSessionOptions): Promise<SessionSummary> {
    const rpc = await this.getRpc();
    const { planMode, ...coreInput } = input;
    void planMode;
    return rpc.createSession(coreInput);
  }

  /**
   * Create a session with a custom execution environment (Kaos).
   *
   * The base implementation ignores `kaos` and `persistenceKaos` because
   * remote transports (e.g. WebSocket-backed RPC) cannot serialize a Kaos
   * instance across the wire. In-process transports ({@link SDKRpcClient})
   * override this to pass the overrides directly to the core.
   */
  async createSessionWithKaos(
    input: CreateSessionOptions,
    kaos: Kaos,
    persistenceKaos?: Kaos,
  ): Promise<SessionSummary> {
    void kaos;
    void persistenceKaos;
    return this.createSession(input);
  }

  async resumeSession(input: ResumeSessionInput): Promise<ResumedSessionSummary> {
    const rpc = await this.getRpc();
    return rpc.resumeSession({ ...input, sessionId: input.id });
  }

  /**
   * Resume a session with a custom execution environment (Kaos).
   *
   * Same transport limitation as {@link createSessionWithKaos}: the base
   * implementation ignores `kaos` / `persistenceKaos`.
   */
  async resumeSessionWithKaos(
    input: ResumeSessionInput,
    kaos: Kaos,
    persistenceKaos?: Kaos,
  ): Promise<ResumedSessionSummary> {
    void kaos;
    void persistenceKaos;
    return this.resumeSession(input);
  }

  async reloadSession(input: ReloadSessionRpcInput): Promise<ResumedSessionSummary> {
    const rpc = await this.getRpc();
    return rpc.reloadSession({
      sessionId: input.sessionId,
      forcePluginSessionStartReminder: input.forcePluginSessionStartReminder,
    });
  }

  async forkSession(input: ForkSessionInput): Promise<SessionSummary> {
    const rpc = await this.getRpc();
    return rpc.forkSession({
      sessionId: input.id,
      id: input.forkId,
      title: input.title,
      metadata: input.metadata,
      worktree: input.worktree,
    });
  }

  async closeSession(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.closeSession({ sessionId: input.sessionId });
  }

  async listSessions(input: ListSessionsOptions = {}): Promise<readonly SessionSummary[]> {
    const rpc = await this.getRpc();
    return rpc.listSessions(input);
  }

  async renameSession(input: RenameSessionInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.renameSession({
      sessionId: input.id,
      title: input.title,
    });
  }

  /**
   * Patch session metadata (e.g. custom.sandboxProfile). Merges `custom` keys.
   * When sandboxProfile is set, the live agent rebuilds file-tool path policy.
   */
  async updateSessionMetadata(input: {
    readonly sessionId: string;
    readonly metadata: {
      readonly custom?: Readonly<Record<string, unknown>>;
      readonly [key: string]: unknown;
    };
  }): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.updateSessionMetadata({
      sessionId: input.sessionId,
      metadata: input.metadata,
    });
  }

  async exportSession(input: ExportSessionInput): Promise<ExportSessionResult> {
    const rpc = await this.getRpc();
    return rpc.exportSession({
      sessionId: input.id,
      outputPath: input.outputPath,
      includeGlobalLog: input.includeGlobalLog,
      version: input.version,
      installSource: input.installSource,
      shellEnv: input.shellEnv,
    });
  }
}
