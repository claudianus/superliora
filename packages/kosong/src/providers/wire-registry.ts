/**
 * Wire profile registry.
 *
 * A catalog provider such as OpenCode Zen or OpenCode Go serves several wire
 * protocols from one API root: the model decides whether the request goes to
 * `/chat/completions`, `/responses`, `/messages` or the Gemini endpoint. The
 * only machine-readable source for that choice is the models.dev `npm` field
 * (Vercel AI SDK package id), which is published per provider *and* per model.
 *
 * This module is the single lookup table between those package ids and the
 * {@link ProviderType} wires implemented next to it. Callers resolve a wire
 * from metadata instead of matching on model names, so a gateway that adds a
 * protocol-only model needs a catalog update — not a code change here.
 */

import type { ProviderType } from './index';

/** How one wire is selected from catalog metadata. */
export interface WireProfile {
  /** Wire implemented by `createProvider` for this profile. */
  readonly wire: ProviderType;
  /**
   * models.dev `npm` package ids that select this wire. Matched case
   * insensitively and exactly first, so `@ai-sdk/openai` (Responses API) is
   * never confused with `@ai-sdk/openai-compatible` (Chat Completions).
   */
  readonly packages: readonly string[];
  /**
   * Substrings used only when no profile claims the package id exactly —
   * for forks and scoped mirrors of a known SDK.
   */
  readonly hints?: readonly string[];
}

/**
 * Seed profiles for the wires a multi-protocol gateway can expose. Ordered so
 * that the more specific Chat Completions packages win over the bare OpenAI
 * Responses package during hint matching.
 */
const SEED_WIRE_PROFILES: readonly WireProfile[] = [
  {
    wire: 'openai',
    packages: [
      '@ai-sdk/openai-compatible',
      '@ai-sdk/azure',
      'openai-chat-completions',
      // Chat Completions gateways whose models.dev `npm` lacks the `openai`
      // substring. Without exact entries here, `resolveWireFromPackage` returns
      // undefined for per-model `provider.npm` overrides and callers drop
      // usable chat models. Kept in sync with `CHAT_COMPLETIONS_NPM` in
      // `catalog.ts`. Native non-Chat-Completions SDKs (Cohere, Bedrock,
      // plain Azure resource-name auth) stay off this list.
      '@ai-sdk/groq',
      '@ai-sdk/mistral',
      '@ai-sdk/togetherai',
      '@ai-sdk/xai',
      '@ai-sdk/cerebras',
      '@ai-sdk/perplexity',
      '@ai-sdk/gateway',
      '@ai-sdk/vercel',
      '@ai-sdk/deepseek',
      '@ai-sdk/deepinfra',
      '@openrouter/ai-sdk-provider',
      '@qvac/ai-sdk-provider',
      '@qvac/sdk',
      'venice-ai-sdk-provider',
      '@aihubmix/ai-sdk-provider',
      'merge-gateway-ai-sdk-provider',
    ],
    hints: ['openai-compatible', 'openai-completions'],
  },
  {
    wire: 'openai_responses',
    packages: ['@ai-sdk/openai', '@openai/agents'],
    hints: ['@ai-sdk/openai'],
  },
  {
    wire: 'anthropic',
    packages: ['@ai-sdk/anthropic', '@anthropic-ai/ai-sdk'],
    hints: ['anthropic'],
  },
  {
    wire: 'google-genai',
    packages: ['@ai-sdk/google', '@google/genai', '@ai-sdk/google-vertex'],
    hints: ['genai', 'vertex'],
  },
  {
    wire: 'kimi',
    packages: ['@ai-sdk/moonshot', '@moonshot-ai/ai-sdk'],
    hints: ['moonshot', 'kimi'],
  },
  {
    wire: 'bedrock',
    packages: ['@ai-sdk/amazon/bedrock', '@aws-sdk/client-bedrock-runtime'],
    hints: ['bedrock'],
  },
];

/** npm package id (lowercased) → wire. Last registration wins. */
const exactMatches = new Map<string, ProviderType>();
/** Ordered hint → wire; longer hints are checked first to keep specificity. */
let hintMatches: readonly (readonly [string, ProviderType])[] = [];
/** Registered profiles by wire, so the snapshot reflects runtime additions. */
const profilesByWire = new Map<ProviderType, { packages: string[]; hints: string[] }>();

function indexProfile(profile: WireProfile): void {
  const registered = profilesByWire.get(profile.wire) ?? { packages: [], hints: [] };
  for (const pkg of profile.packages) {
    const key = pkg.trim().toLowerCase();
    if (key.length === 0) continue;
    exactMatches.set(key, profile.wire);
    if (!registered.packages.includes(key)) registered.packages.push(key);
  }
  for (const hint of profile.hints ?? []) {
    const key = hint.trim().toLowerCase();
    if (key.length === 0 || registered.hints.includes(key)) continue;
    registered.hints.push(key);
  }
  profilesByWire.set(profile.wire, registered);
  hintMatches = [...profilesByWire.entries()]
    .flatMap(([wire, entry]): readonly (readonly [string, ProviderType])[] =>
      entry.hints.map((hint): readonly [string, ProviderType] => [hint, wire]),
    )
    .toSorted((a, b) => b[0].length - a[0].length);
}

/**
 * Adds or overrides a wire profile at runtime. Integrators that ship a custom
 * gateway SDK use this instead of teaching the catalog their package name.
 */
export function registerWireProfile(profile: WireProfile): void {
  indexProfile(profile);
}

for (const profile of SEED_WIRE_PROFILES) {
  indexProfile(profile);
}

/** Snapshot of the registered profiles, for diagnostics and `/status`-style views. */
export function wireProfiles(): readonly WireProfile[] {
  return [...profilesByWire.entries()]
    .map(([wire, entry]): WireProfile => ({
      wire,
      packages: [...entry.packages].toSorted(),
      ...(entry.hints.length > 0 ? { hints: [...entry.hints] } : {}),
    }))
    .toSorted((a, b) => a.wire.localeCompare(b.wire));
}

/**
 * Resolves the wire for a models.dev `npm` value. Returns `undefined` for a
 * missing or unknown package so callers keep their provider-level fallback
 * instead of guessing a protocol.
 */
export function resolveWireFromPackage(npm: string | undefined): ProviderType | undefined {
  const key = npm?.trim().toLowerCase();
  if (key === undefined || key.length === 0) return undefined;
  const exact = exactMatches.get(key);
  if (exact !== undefined) return exact;
  for (const [hint, wire] of hintMatches) {
    if (hint.length > 0 && key.includes(hint)) return wire;
  }
  return undefined;
}

/** The canonical models.dev package id for a wire; used when synthesizing catalog rows. */
export function packageForWire(wire: ProviderType): string | undefined {
  return profilesByWire.get(wire)?.packages[0];
}
