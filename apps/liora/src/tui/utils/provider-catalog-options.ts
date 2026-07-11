/**
 * Builds the unified provider picker option list consumed by
 * {@link ProviderCatalogPickerComponent}.
 *
 * The list merges three sources so a single search covers every way to
 * connect a provider:
 *   1. OAuth-capable providers (Kimi managed, OpenAI Codex, xAI Grok) —
 *      declared in the provider profile registry. Each appears as an
 *      "OAuth login" row alongside its catalog (API-key) counterpart.
 *   2. models.dev catalog providers — filtered to those with an inferable
 *      wire type, annotated with model count, env-var hints, and auth kind.
 *   3. Escape hatches — custom endpoint and custom registry rows.
 *
 * A small priority map mirrors opencode's ordering so the most common
 * providers (Kimi, Anthropic, OpenAI, Google, xAI, OpenRouter) surface first.
 */

import { EXPERIMENTAL_PROVIDER_PROFILES, PROVIDER_PROFILES } from '@superliora/oauth';
import {
  catalogProviderModels,
  inferWireType,
  type Catalog,
} from '@superliora/sdk';

import { isExperimentalFlagEnabled } from '#/tui/commands/experimental-flags';
import { oauthProviderCatalogId } from '#/tui/utils/oauth-catalog-id';

/** How the user will authenticate for a given entry. */
export type ProviderAuthKind = 'oauth' | 'api-key' | 'keyless' | 'cloud' | 'custom';

/**
 * A single row in the unified provider picker. `kind` discriminates between a
 * real catalog/OAuth provider and the custom escape-hatch actions.
 */
export interface ProviderCatalogOption {
  /** Stable key passed to {@link ProviderCatalogOptions.onSelect}. */
  readonly value: string;
  /** Display name (left column). */
  readonly label: string;
  readonly authKind: ProviderAuthKind;
  /** Number of usable chat models the catalog lists for the provider. */
  readonly modelCount: number;
  /** Base URL shown as secondary info, when available. */
  readonly baseUrl?: string;
  /** Env var names that may hold the API key (catalog `env` field). */
  readonly envVars?: readonly string[];
  /** Documentation / console URL where a key can be obtained. */
  readonly docUrl?: string;
  /** Provider id when the entry is backed by a catalog entry. */
  readonly catalogId?: string;
}

export type ProviderCatalogSelection =
  | { readonly kind: 'oauth'; readonly providerId: string }
  | { readonly kind: 'catalog'; readonly providerId: string }
  | { readonly kind: 'cloud'; readonly providerId: 'bedrock' | 'vertex_claude' }
  | { readonly kind: 'custom-endpoint' }
  | { readonly kind: 'custom-registry' };

// Pin the most common providers near the top (opencode-style priority).
const PROVIDER_PRIORITY: ReadonlyMap<string, number> = new Map<string, number>([
  ['anthropic', 0],
  ['openai', 1],
  ['google', 2],
  ['xai', 3],
  ['openrouter', 4],
  ['deepseek', 5],
  ['groq', 6],
  ['mistral', 7],
  // SuperLiora-curated subscription gateway (not in models.dev).
  ['clinepass', 8],
]);

export function buildProviderCatalogOptions(catalog: Catalog): readonly ProviderCatalogOption[] {
  const options: ProviderCatalogOption[] = [];

  // OAuth-capable providers from the profile registry (Kimi, OpenAI Codex, xAI).
  for (const profile of PROVIDER_PROFILES) {
    options.push({
      value: `oauth:${profile.id}`,
      label: profile.displayName,
      authKind: 'oauth',
      modelCount: 0,
      baseUrl: profile.apiBaseUrl,
      docUrl: profile.docUrl,
    });
  }

  // Experimental OAuth providers (e.g. Anthropic) — only shown when their
  // gating flag is enabled. Implemented ahead of policy/availability changes.
  for (const entry of EXPERIMENTAL_PROVIDER_PROFILES) {
    if (!isExperimentalFlagEnabled(entry.flag)) continue;
    options.push({
      value: `oauth:${entry.profile.id}`,
      label: entry.profile.displayName,
      authKind: 'oauth',
      modelCount: 0,
      baseUrl: entry.profile.apiBaseUrl,
      docUrl: entry.profile.docUrl,
    });
  }

  for (const [id, entry] of Object.entries(catalog)) {
    const wire = inferWireType(entry);
    if (wire === undefined) continue;
    const models = catalogProviderModels(entry);
    const docUrl = typeof entry.doc === 'string' && entry.doc.length > 0 ? entry.doc : undefined;
    const envVars = entry.env;
    options.push({
      value: `catalog:${id}`,
      label: entry.name ?? id,
      authKind: envVars !== undefined && envVars.length > 0 ? 'api-key' : 'keyless',
      modelCount: models.length,
      baseUrl: typeof entry.api === 'string' && entry.api.length > 0 ? entry.api : undefined,
      envVars,
      docUrl,
      catalogId: id,
    });
  }

  // Cloud-hosted Claude routes (official Anthropic-sanctioned alternatives to
  // the direct API key): Amazon Bedrock (AWS credentials) and Google Vertex AI
  // (GCP ADC). Users authenticate via their existing cloud credential chain.
  options.push({
    value: 'cloud:bedrock',
    label: 'Anthropic via Amazon Bedrock (AWS credentials)',
    authKind: 'cloud',
    modelCount: 2,
    docUrl: 'https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy',
  });
  options.push({
    value: 'cloud:vertex_claude',
    label: 'Anthropic via Google Vertex AI (GCP credentials)',
    authKind: 'cloud',
    modelCount: 2,
    docUrl: 'https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai',
  });

  options.push({
    value: 'custom-endpoint',
    label: 'Custom endpoint (OpenAI-compatible)',
    authKind: 'custom',
    modelCount: 0,
  });
  options.push({
    value: 'custom-registry',
    label: 'Custom registry (api.json URL)',
    authKind: 'custom',
    modelCount: 0,
  });

  return options.toSorted((a, b) => {
    const pa = priorityFor(a);
    const pb = priorityFor(b);
    if (pa !== pb) return pa - pb;
    return a.label.localeCompare(b.label);
  });
}

function priorityFor(option: ProviderCatalogOption): number {
  // Kimi managed OAuth always leads.
  if (option.value === 'oauth:managed:kimi-api') return -1;
  if (option.value === 'custom-endpoint' || option.value === 'custom-registry') return 200;
  // Other OAuth providers sort alongside their pinned catalog ids.
  if (option.value.startsWith('oauth:')) {
    const id = option.value.slice('oauth:'.length);
    const pinned = PROVIDER_PRIORITY.get(oauthProviderCatalogId(id));
    if (pinned !== undefined) return pinned;
    return 50;
  }
  const pinned = PROVIDER_PRIORITY.get(option.catalogId ?? '');
  if (pinned !== undefined) return pinned;
  return 100;
}

/** Resolves a picker `value` back to the structured selection. */
export function resolveProviderSelection(value: string): ProviderCatalogSelection {
  if (value.startsWith('oauth:')) return { kind: 'oauth', providerId: value.slice('oauth:'.length) };
  if (value === 'custom-endpoint') return { kind: 'custom-endpoint' };
  if (value === 'custom-registry') return { kind: 'custom-registry' };
  if (value.startsWith('cloud:')) {
    const providerId = value.slice('cloud:'.length);
    if (providerId === 'bedrock' || providerId === 'vertex_claude') {
      return { kind: 'cloud', providerId };
    }
  }
  if (value.startsWith('catalog:')) return { kind: 'catalog', providerId: value.slice('catalog:'.length) };
  return { kind: 'catalog', providerId: value };
}
