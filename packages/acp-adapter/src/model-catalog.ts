/** Configured native model aliases and their declared thinking capabilities. */

import type { LioraHarness, ModelAlias } from '@superliora/sdk';

/**
 * One catalog row per configured model alias, suitable for an ACP
 * picker. `description` is left optional so the harness can populate it
 * later without breaking callers; ACP UIs treat it as a flavour-text
 * subtitle.
 */
export interface AcpModelEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly thinkingSupported: boolean;
  /** Declared 'always_thinking' capability — thinking cannot be turned off. */
  readonly alwaysThinking?: boolean;
}

export function deriveThinkingSupported(alias: ModelAlias): boolean {
  const declared = alias.capabilities ?? [];
  return declared.includes('thinking') || declared.includes('always_thinking');
}

/**
 * Whether the alias declares the 'always_thinking' capability — the model
 * cannot run with thinking disabled, so the ACP toggle must lock to on.
 * Only explicit metadata may remove the off option from the client.
 */
export function deriveAlwaysThinking(alias: ModelAlias): boolean {
  return (alias.capabilities ?? []).includes('always_thinking');
}

/**
 * Project `harness.getConfig().models` into a flat catalog. Returns an
 * empty array when the harness has no models configured, when
 * `getConfig` is missing on the harness (partial test stubs), or when
 * `getConfig` throws — letting the caller decide how to surface a
 * degenerate config without forcing every test stub to provide every
 * field.
 */
export async function listModelsFromHarness(
  harness: LioraHarness,
): Promise<readonly AcpModelEntry[]> {
  if (typeof harness.getConfig !== 'function') return [];
  let models: Record<string, ModelAlias> | undefined;
  try {
    const config = await harness.getConfig();
    models = config.models;
  } catch {
    return [];
  }
  if (models === undefined) return [];
  const out: AcpModelEntry[] = [];
  for (const [id, alias] of Object.entries(models)) {
    out.push({
      id,
      name: alias.displayName ?? alias.model ?? id,
      thinkingSupported: deriveThinkingSupported(alias),
      alwaysThinking: deriveAlwaysThinking(alias),
    });
  }
  return out;
}
