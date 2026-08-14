import {
  createProvider,
  UNKNOWN_CAPABILITY,
  type ChatProvider,
  type LayeredSystemPrompt,
  type ModelCapability,
  type ProviderConfig,
} from '@superliora/kosong';

import { applyKimiEnvSamplingParams, applyKimiEnvThinkingKeep } from '#/config/kimi-env-params';

import type { Agent } from '..';
import { ErrorCodes, LioraError } from '../../errors';
import type { AgentConfigData, AgentConfigUpdateData } from './types';
import type { SystemPromptMeta } from '../context/types';
import {
  resolveThinkingEffort,
  type ThinkingEffort,
  type ThinkingModelDefaults,
} from './thinking';
import type {
  ResolvedRuntimeProvider,
  ResolvedRuntimeProviderRoute,
} from '../../session/provider/provider-manager';

export * from './types';
export { resolveThinkingEffort, type ThinkingEffort } from './thinking';

export class ConfigState {
  private _cwd: string;
  private _modelAlias: string | undefined;
  /**
   * When `_modelAlias` is the virtual `auto` pin, this holds the concrete
   * alias resolved for the current turn / last resolve.
   */
  private _smartRouteAlias: string | undefined;
  private _profileName: string | undefined;
  private _thinkingLevel: ThinkingEffort = 'off';
  private _systemPrompt: string = '';
  private _layeredSystemPrompt: LayeredSystemPrompt | undefined;
  private _systemPromptMeta: SystemPromptMeta | undefined;
  /** Memoized runtime provider; keyed by serialized config + thinking level. */
  private providerCache: { key: string; provider: ChatProvider } | null = null;

  constructor(protected readonly agent: Agent) {
    this._cwd = agent.kaos.getcwd();
    this._modelAlias = agent.modelProvider?.defaultModel;
  }

  update(changed: AgentConfigUpdateData): void {
    if (Object.keys(changed).length === 0) return;

    this.agent.records.logRecord({
      type: 'config.update',
      ...changed,
    });
    this.agent.replayBuilder.push({
      type: 'config_updated',
      config: changed,
    });
    if (changed.cwd) {
      this.applyCwd(changed.cwd);
    }
    if (changed.modelAlias) {
      this._modelAlias = changed.modelAlias;
      this._smartRouteAlias = undefined;
      this.providerCache = null;
    }
    if (changed.profileName) {
      this._profileName = changed.profileName;
    }
    if (changed.thinkingLevel !== undefined) {
      this._thinkingLevel = resolveThinkingEffort(
        changed.thinkingLevel,
        this.agent.runtimeConfig?.thinking,
        this.currentThinkingDefaults,
      );
    }
    if (changed.systemPrompt !== undefined) {
      this._systemPrompt = changed.systemPrompt;
    }
    if (changed.layeredSystemPrompt !== undefined) {
      this._layeredSystemPrompt = changed.layeredSystemPrompt;
    }
    if (this.hasProvider && (changed.cwd !== undefined || changed.modelAlias)) {
      this.agent.tools.initializeBuiltinTools();
    }
    this.agent.emitStatusUpdated();
  }

  data(): AgentConfigData {
    const resolved = this.tryResolvedProviderConfig();
    const loopControl = this.agent.runtimeConfig?.loopControl;
    return {
      cwd: this.cwd,
      provider: resolved?.provider,
      modelAlias: this._modelAlias,
      modelCapabilities: resolved?.modelCapabilities ?? UNKNOWN_CAPABILITY,
      profileName: this.profileName,
      thinkingLevel: this.thinkingLevel,
      systemPrompt: this.systemPrompt,
      layeredSystemPrompt: this._layeredSystemPrompt,
      roleModels: {
        compaction: loopControl?.compactionModel,
        completion: loopControl?.completionModel,
        exploration: loopControl?.explorationModel,
        coding: loopControl?.codingModel,
        planning: loopControl?.planningModel,
        debugging: loopControl?.debuggingModel,
      },
    };
  }

  /**
   * Pin `config.cwd` and the agent Kaos instance to `cwd`.
   *
   * Restore must stay in-memory (no `stat`/`chdir`): a deleted Conductor
   * worktree would otherwise reject the fire-and-forget `chdir` and crash
   * session resume. Live updates still `chdir` so relative I/O stays honest,
   * but a missing directory falls back to the last valid cwd instead of
   * becoming an unhandled rejection.
   */
  private applyCwd(cwd: string): void {
    this._cwd = cwd;
    if (this.agent.records.restoring !== null) {
      this.agent.setKaos(this.agent.kaos.withCwd(cwd));
      return;
    }
    void this.syncLiveCwd(cwd);
  }

  private async syncLiveCwd(cwd: string): Promise<void> {
    const previous = this.agent.kaos.getcwd();
    try {
      await this.agent.kaos.chdir(cwd);
    } catch (error) {
      this._cwd = previous;
      const detail = error instanceof Error ? error.message : String(error);
      this.agent.log.warn('config cwd missing; stayed in last valid directory', {
        cwd,
        fallback: previous,
        error: detail,
      });
      this.agent.emitEvent({
        type: 'warning',
        message: `Working directory is gone (${cwd}); staying in ${previous}.`,
        code: 'cwd-missing',
        details: { cwd, fallback: previous },
      });
    }
  }

  get cwd(): string {
    return this._cwd;
  }

  get hasModel(): boolean {
    return this._modelAlias !== undefined;
  }

  get hasProvider(): boolean {
    return this.tryResolvedProviderConfig() !== undefined;
  }

  get providerConfig(): ProviderConfig {
    const provider = this.resolvedProviderConfig?.provider;
    if (provider === undefined) {
      throw new LioraError(ErrorCodes.MODEL_NOT_CONFIGURED, 'Provider not set');
    }
    return provider;
  }

  get provider(): ChatProvider {
    const resolved = this.resolvedProviderConfig;
    const providerConfig = resolved?.provider;
    if (providerConfig === undefined) {
      throw new LioraError(ErrorCodes.MODEL_NOT_CONFIGURED, 'Provider not set');
    }
    // Reuse one instance per identical (config, thinking) pair: HTTP client
    // reuse cuts per-step setup latency, and stateful provider internals
    // (e.g. OpenAI Responses chain state) survive across steps.
    const cacheKey = `${JSON.stringify(providerConfig)}::${this.thinkingLevel}`;
    if (this.providerCache !== null && this.providerCache.key === cacheKey) {
      return this.providerCache.provider;
    }
    const provider = this.createRuntimeProvider(resolved);
    this.providerCache = { key: cacheKey, provider };
    return provider;
  }

  get providerRoute(): ResolvedRuntimeProviderRoute | undefined {
    const alias = this.effectiveModelAlias;
    if (alias === undefined || alias.trim().toLowerCase() === 'auto') return undefined;
    return this.agent.modelProvider?.resolveProviderRoute?.(alias);
  }

  createRuntimeProvider(resolved: ResolvedRuntimeProvider | undefined): ChatProvider {
    const providerConfig = resolved?.provider;
    if (providerConfig === undefined) {
      throw new LioraError(ErrorCodes.MODEL_NOT_CONFIGURED, 'Provider not set');
    }
    const provider = createProvider(providerConfig).withThinking(this.thinkingLevel);
    return applyKimiEnvThinkingKeep(applyKimiEnvSamplingParams(provider), this.thinkingLevel);
  }

  get model(): string {
    if (this._modelAlias === undefined) {
      throw new LioraError(ErrorCodes.MODEL_NOT_CONFIGURED, 'Model not set');
    }
    return this._modelAlias;
  }

  get modelAlias(): string | undefined {
    return this._modelAlias;
  }

  /**
   * Concrete alias used for provider resolution. Equals `modelAlias` unless
   * the session is pinned to virtual smart-auto `auto`.
   */
  get effectiveModelAlias(): string | undefined {
    if (this._modelAlias?.trim().toLowerCase() === 'auto') {
      return this._smartRouteAlias ?? this._modelAlias;
    }
    return this._modelAlias;
  }

  /** Pin the concrete alias for a smart-auto session turn. */
  setSmartRouteAlias(alias: string | undefined): void {
    if (this._smartRouteAlias === alias) return;
    this._smartRouteAlias = alias;
    this.providerCache = null;
  }

  get thinkingLevel(): ThinkingEffort {
    // Always-thinking models cannot run with thinking disabled. Clamping in
    // the getter (rather than in update()) keeps the request builder, status
    // events, and subagent inheritance consistent, and re-applies after a
    // later model switch onto an always-thinking alias.
    if (this._thinkingLevel === 'off' && this.alwaysThinkingModel) {
      return resolveThinkingEffort(
        'on',
        this.agent.runtimeConfig?.thinking,
        this.currentThinkingDefaults,
      );
    }
    return this._thinkingLevel;
  }

  private get alwaysThinkingModel(): boolean {
    return this.tryResolvedProviderConfig()?.alwaysThinking === true;
  }

  private get currentThinkingDefaults(): ThinkingModelDefaults | undefined {
    const alias = this.effectiveModelAlias;
    if (alias === undefined || alias.trim().toLowerCase() === 'auto') return undefined;
    const configured = this.agent.runtimeConfig?.models?.[alias];
    if (configured !== undefined) return configured;
    const resolved = this.tryResolvedProviderConfig();
    if (resolved === undefined) return undefined;
    return {
      supportEfforts: resolved.supportEfforts,
      defaultEffort: resolved.defaultEffort,
    };
  }

  get profileName(): string | undefined {
    return this._profileName;
  }

  get systemPrompt(): string {
    return this._systemPrompt;
  }

  get layeredSystemPrompt(): LayeredSystemPrompt | undefined {
    return this._layeredSystemPrompt;
  }

  get systemPromptMeta(): SystemPromptMeta | undefined {
    return this._systemPromptMeta;
  }

  setSystemPromptMeta(meta: SystemPromptMeta): void {
    this._systemPromptMeta = meta;
  }

  get modelCapabilities(): ModelCapability {
    return this.tryResolvedProviderConfig()?.modelCapabilities ?? UNKNOWN_CAPABILITY;
  }

  get maxOutputSize(): number | undefined {
    return this.tryResolvedProviderConfig()?.maxOutputSize;
  }

  private get resolvedProviderConfig(): ResolvedRuntimeProvider | undefined {
    const alias = this.effectiveModelAlias;
    if (alias === undefined || alias.trim().toLowerCase() === 'auto') return undefined;
    return this.agent.modelProvider?.resolveProviderConfig(alias);
  }

  private tryResolvedProviderConfig(): ResolvedRuntimeProvider | undefined {
    try {
      return this.resolvedProviderConfig;
    } catch {
      return undefined;
    }
  }
}
