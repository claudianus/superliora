import { uniq } from '@antfu/utils';
import picomatch from 'picomatch';

import type { ExecutableTool } from '../../loop';
import { resolveActivePremiumDensity } from '../injection/premium-quality';
import { CACHE_GATED_TOOLS, VISUAL_DENSITY_HYSTERESIS } from './constants';
import type { McpToolEntry } from './mcp-registration';
import type { BuiltinTool } from './types';
import type { Agent } from '..';

export interface LoopToolsHost {
  readonly loopToolsOverride: readonly ExecutableTool[] | undefined;
  readonly enabledTools: ReadonlySet<string>;
  readonly mcpTools: ReadonlyMap<string, McpToolEntry>;
  readonly mcpAccessPatterns: readonly string[];
  readonly userTools: ReadonlyMap<string, ExecutableTool>;
  readonly ephemeralBuiltinTools: ReadonlyMap<string, BuiltinTool>;
  readonly builtinTools: ReadonlyMap<string, BuiltinTool>;
  readonly agent: Agent;
  lastVisualGateDensity: 'visual' | 'code' | undefined;
  pendingVisualGateDensityCount: number;
}

export function isMcpToolEnabled(host: LoopToolsHost, name: string): boolean {
  return host.mcpAccessPatterns.some((pattern) => picomatch.isMatch(name, pattern));
}

export function resolveLoopTools(host: LoopToolsHost): readonly ExecutableTool[] {
  if (host.loopToolsOverride !== undefined) return host.loopToolsOverride;
  const mcpNames = [...host.mcpTools.keys()].filter((name) => isMcpToolEnabled(host, name));
  // Cache-stability: mode-gated tools are ALWAYS included in the serialized
  // tool block regardless of active mode. Removing/adding tools between turns
  // rewrites the tool block bytes and busts the provider's prefix cache for
  // all subsequent messages. The model is guided by mode injections
  // (PlanModeInjector, GoalInjector, etc.) to avoid calling inactive tools;
  // the execution layer returns a clear error if called out-of-mode.
  // Gated tools are sorted to the tail so the stable prefix is maximized.
  return uniq([...host.enabledTools, ...mcpNames])
    .toSorted((a, b) => {
      const aGated = CACHE_GATED_TOOLS.has(a) ? 1 : 0;
      const bGated = CACHE_GATED_TOOLS.has(b) ? 1 : 0;
      if (aGated !== bGated) return aGated - bGated;
      // Byte-wise (locale-independent) sort so the serialized tool order is
      // identical across environments/ICU versions, keeping the prompt-cache
      // tools block stable instead of varying with the host locale.
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .map(
      (name) =>
        host.userTools.get(name) ??
        host.mcpTools.get(name)?.tool ??
        host.ephemeralBuiltinTools.get(name) ??
        host.builtinTools.get(name),
    )
    .filter((tool) => !!tool);
}

/**
 * Visual density hysteresis is retained for telemetry but no longer gates
 * tool inclusion — all tools are always present for cache stability.
 */
export function hideVisualDensityTools(host: LoopToolsHost): boolean {
  if (!host.agent.premiumQuality.isEnabled()) {
    host.lastVisualGateDensity = undefined;
    host.pendingVisualGateDensityCount = 0;
    return false;
  }
  const density = resolveActivePremiumDensity(host.agent);
  if (density === host.lastVisualGateDensity) {
    host.pendingVisualGateDensityCount = 0;
  } else {
    host.pendingVisualGateDensityCount += 1;
    if (host.pendingVisualGateDensityCount >= VISUAL_DENSITY_HYSTERESIS) {
      host.lastVisualGateDensity = density;
      host.pendingVisualGateDensityCount = 0;
    }
  }
  const effective = host.lastVisualGateDensity ?? density;
  return effective === 'code';
}
