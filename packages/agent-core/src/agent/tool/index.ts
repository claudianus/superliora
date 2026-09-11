import type { Tool } from '@superliora/kosong';

import type { ExecutableTool } from '../../loop';
import type { ToolStore, ToolStoreData, ToolStoreKey } from '../../tools/store';
import { isMcpToolName } from '../../mcp/tool-naming';
import type { MCPClient } from '../../mcp/types';

import type { Agent } from '..';
import { buildBuiltinTools } from './builtin-tools';
import { hideVisualDensityTools, isMcpToolEnabled, resolveLoopTools } from './loop-tools';
import type { McpConnectionManager, McpServerEntry } from '../../mcp';
import {
  attachMcpTools as attachMcpToolsImpl,
  handleMcpServerStatusChange as handleMcpServerStatusChangeImpl,
  registerMcpServer as registerMcpServerImpl,
  registerNeedsAuthMcpServer as registerNeedsAuthMcpServerImpl,
  unregisterMcpServer as unregisterMcpServerImpl,
  type McpToolEntry,
} from './mcp-registration';
import { cancelShellCommand, runShellCommand } from './shell-command';
import type {
  BuiltinTool,
  McpServerRegistrationResult,
  ToolInfo,
  UserToolRegistration,
} from './types';
import { resolveToolHelpVisibility } from './help-visibility';
import { scheduleJobLedgerCrashMirror } from '../../tools/builtin/job/job-crash-mirror';
import { scheduleWorkspaceCatalogSync } from '../../tools/builtin/job/job-workspace-bind';

/**
 * Coalescing window for job_ledger `tools.update_store` wire records. The
 * ledger is written whole on every patch; patch storms (progress mirroring,
 * steer loops) only need the latest snapshot to survive.
 */
const JOB_LEDGER_WIRE_FLUSH_MS = 500;
/**
 * Hard cap on one serialized `tools.update_store` payload. Beyond this the
 * record is skipped for the wire log (in-memory store and the job-ledger
 * crash mirror remain the durable sources).
 */
const MAX_STORE_RECORD_JSON_CHARS = 512 * 1024;

export * from './types';
export {
  COMPAT_BRANDING_TOOL_HELP,
  filterToolsForPublicHelp,
  formatCompatToolHelpHint,
  isCompatBrandingTool,
  preferredPublicToolName,
  resolveToolHelpVisibility,
  shouldIncludeToolInPublicHelp,
  type CompatBrandingToolName,
} from './help-visibility';

export type { McpToolEntry };

export class ToolManager {
  builtinTools: Map<string, BuiltinTool> = new Map();
  readonly userTools: Map<string, ExecutableTool> = new Map();
  readonly mcpTools: Map<string, McpToolEntry> = new Map();
  loopToolsOverride: readonly ExecutableTool[] | undefined;
  readonly ephemeralBuiltinTools = new Map<string, BuiltinTool>();
  /** server name → list of qualified tool names registered for that server. */
  readonly mcpToolsByServer: Map<string, string[]> = new Map();
  enabledTools: Set<string> = new Set();
  /** Glob patterns (e.g. `mcp__*`, `mcp__github__*`) gating which MCP tools the profile exposes. */
  mcpAccessPatterns: string[] = [];
  protected readonly store: Partial<ToolStoreData> = {};
  private mcpToolStatusUnsubscribe: (() => void) | undefined;
  /** Deferred job_ledger wire flush (coalescing window, latest-wins). */
  private pendingLedgerWireFlush: ReturnType<typeof setTimeout> | undefined;

  /** Abort controllers for in-flight `!` shell commands, keyed by commandId so
   *  the TUI can cancel (Esc / Ctrl+C) a running command. */
  readonly shellCommandControllers = new Map<string, AbortController>();

  constructor(readonly agent: Agent) {
    this.attachMcpTools();
    if (agent.config.hasProvider) {
      this.initializeBuiltinTools();
    }
  }

  get toolStore(): ToolStore {
    return {
      get: (key) => this.store[key],
      set: (key, value) => {
        this.updateStore(key, value);
      },
    };
  }

  attachMcpTools(): void {
    const mcp = this.agent.mcp;
    if (mcp === undefined) return;
    attachMcpToolsImpl(
      this,
      mcp,
      (unsubscribe) => {
        this.mcpToolStatusUnsubscribe = unsubscribe;
      },
      this.mcpToolStatusUnsubscribe !== undefined,
    );
  }

  getStore(): ToolStore {
    return this.toolStore;
  }

  updateStore<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void {
    this.logStoreUpdateRecord(key, value);
    this.store[key] = value;
    if (key === 'todo') {
      this.agent.emitEvent({
        type: 'tools.update_store',
        key,
        value,
      });
    }
    if (key === 'job_ledger' && !this.agent.records.restoring) {
      scheduleJobLedgerCrashMirror(this.toolStore);
      scheduleWorkspaceCatalogSync(this.toolStore);
    }
  }

  /**
   * Wire-record a store update with ledger bloat guards. The job ledger is a
   * whole-store snapshot on every patch: a long notes tail (stall-steer
   * loops append to `notes` on every steer) grew one line to 2.6MB and one
   * agent's wire.jsonl to 157MB. Guards:
   * - Ledger coalescing: job_ledger patches within the window collapse to
   *   one latest-wins wire record (the crash mirror keeps full durability
   *   at its own 100ms cadence; replay only needs the final snapshot).
   * - Oversize skip: a serialized record beyond the hard cap is not
   *   recorded; the in-memory store and crash mirror stay authoritative.
   */
  private logStoreUpdateRecord<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void {
    if (key === 'job_ledger') {
      if (this.pendingLedgerWireFlush === undefined) {
        const timer = setTimeout(() => {
          this.pendingLedgerWireFlush = undefined;
          const latest = this.store['job_ledger'];
          if (latest !== undefined) {
            this.appendStoreUpdateRecord('job_ledger', latest);
          }
        }, JOB_LEDGER_WIRE_FLUSH_MS);
        timer.unref?.();
        this.pendingLedgerWireFlush = timer;
      }
      // Patch storms fall through without an immediate wire record; the
      // scheduled flush logs the freshest snapshot once per window.
      return;
    }
    this.appendStoreUpdateRecord(key, value);
  }

  private appendStoreUpdateRecord<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void {
    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) return;
      if (serialized.length > MAX_STORE_RECORD_JSON_CHARS) {
        this.agent.log.warn(
          `tools.update_store: skipped ${String(key)} wire record (serialized ${String(serialized.length)} chars > cap ${String(MAX_STORE_RECORD_JSON_CHARS)})`,
        );
        return;
      }
    } catch {
      // Unserializable values cannot be replayed anyway; the in-memory store
      // and the job-ledger crash mirror remain the sources of truth.
      return;
    }
    this.agent.records.logRecord({
      type: 'tools.update_store',
      key,
      value,
    });
  }

  /**
   * Execute a user-initiated `!` shell command. Reuses the builtin Bash tool
   * (same kaos / cwd / BackgroundManager as the agent), recording the command
   * and its output as `shell_command`-origin messages. It does NOT start a turn
   * — the model is not prompted (parity with claude-code's `shouldQuery: false`).
   */
  async runShellCommand(
    command: string,
    commandId?: string,
  ): Promise<{ stdout: string; stderr: string; isError?: boolean; backgrounded?: boolean }> {
    return runShellCommand(this, command, commandId);
  }

  cancelShellCommand(commandId: string): void {
    cancelShellCommand(this.shellCommandControllers, commandId);
  }

  registerUserTool(input: UserToolRegistration): void {
    this.agent.records.logRecord({
      type: 'tools.register_user_tool',
      ...input,
    });
    const { name, description, parameters } = input;
    const tool: ExecutableTool = {
      name,
      description,
      parameters,
      resolveExecution: (args) => {
        return {
          approvalRule: name,
          execute: async (context) => {
            return this.agent.rpc!.toolCall!(
              {
                turnId: Number(context.turnId),
                toolCallId: context.toolCallId,
                args,
              },
              { signal: context.signal },
            );
          },
        };
      },
    };
    this.userTools.set(name, tool);
    this.enabledTools.add(name);
  }

  unregisterUserTool(name: string): void {
    this.agent.records.logRecord({
      type: 'tools.unregister_user_tool',
      name,
    });
    this.userTools.delete(name);
    this.enabledTools.delete(name);
  }

  inheritUserTools(parent: ToolManager): void {
    for (const tool of parent.userTools.values()) {
      if (!parent.enabledTools.has(tool.name)) continue;
      this.registerUserTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      });
    }
  }

  registerMcpServer(
    serverName: string,
    client: MCPClient,
    tools: readonly Tool[],
    enabledTools?: ReadonlySet<string>,
  ): McpServerRegistrationResult {
    return registerMcpServerImpl(this, serverName, client, tools, enabledTools);
  }

  unregisterMcpServer(serverName: string): boolean {
    return unregisterMcpServerImpl(this, serverName);
  }

  private handleMcpServerStatusChange(mcp: McpConnectionManager, entry: McpServerEntry): void {
    handleMcpServerStatusChangeImpl(this, mcp, entry);
  }

  private registerNeedsAuthMcpServer(mcp: McpConnectionManager, entry: McpServerEntry): void {
    registerNeedsAuthMcpServerImpl(this, mcp, entry);
  }

  setActiveTools(names: readonly string[]): void {
    if (this.agent.cacheFreezeGuard.isFrozen()) {
      throw new Error(
        'Cache Sacred: enabled tools cannot change mid-turn (CacheFreezeGuard is frozen)',
      );
    }
    this.agent.records.logRecord({
      type: 'tools.set_active_tools',
      names,
    });
    // MCP entries are glob patterns gated separately; the rest are exact
    // builtin/user tool names. The split keeps every caller on one string[].
    this.enabledTools = new Set(names.filter((name) => !isMcpToolName(name)));
    this.mcpAccessPatterns = names.filter((name) => isMcpToolName(name));
    // Rebuild builtin instances for the active profile only. Default profiles
    // enable ~11 tools; instantiating the full 40+ set is wasted work/memory.
    if (this.agent.config.hasProvider) {
      this.initializeBuiltinTools();
    }
  }

  copyLoopToolsFrom(source: ToolManager): void {
    this.loopToolsOverride = source.loopTools;
  }

  attachEphemeralBuiltin(tool: BuiltinTool): void {
    // Ephemeral tools may attach mid-session; CacheFreezeGuard
    // soft-detects drift per step (Loop20a) without blocking attach.
    this.ephemeralBuiltinTools.set(tool.name, tool);
    this.enabledTools.add(tool.name);
  }

  detachEphemeralBuiltin(name: string): void {
    this.ephemeralBuiltinTools.delete(name);
    this.enabledTools.delete(name);
  }

  private isMcpToolEnabled(name: string): boolean {
    return isMcpToolEnabled(this, name);
  }

  *toolInfos(): Iterable<ToolInfo> {
    for (const tool of this.builtinTools.values()) {
      yield {
        name: tool.name,
        description: tool.description,
        active: this.enabledTools.has(tool.name),
        source: 'builtin',
        helpVisibility: resolveToolHelpVisibility(tool.name),
      };
    }
    for (const tool of this.userTools.values()) {
      yield {
        name: tool.name,
        description: tool.description,
        active: this.enabledTools.has(tool.name),
        source: 'user',
        helpVisibility: resolveToolHelpVisibility(tool.name),
      };
    }
    for (const entry of this.mcpTools.values()) {
      yield {
        name: entry.tool.name,
        description: entry.tool.description,
        active: this.isMcpToolEnabled(entry.tool.name),
        source: 'mcp',
        helpVisibility: resolveToolHelpVisibility(entry.tool.name),
      };
    }
  }

  data(): readonly ToolInfo[] {
    return Array.from(this.toolInfos());
  }

  storeData(): Readonly<Record<string, unknown>> {
    return { ...this.store };
  }

  initializeBuiltinTools() {
    this.builtinTools = buildBuiltinTools(this);
  }

  refreshBuiltinTools(): void {
    this.initializeBuiltinTools();
  }

  get loopTools(): readonly ExecutableTool[] {
    return resolveLoopTools(this);
  }

  lastVisualGateDensity: 'visual' | 'code' | undefined;
  pendingVisualGateDensityCount = 0;

  /**
   * Visual density hysteresis is retained for telemetry but no longer gates
   * tool inclusion — all tools are always present for cache stability.
   */
  private hideVisualDensityTools(): boolean {
    return hideVisualDensityTools(this);
  }
}
