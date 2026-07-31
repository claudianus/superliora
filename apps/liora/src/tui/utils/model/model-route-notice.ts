/**
 * Helpers for provider-route / model-failover notices.
 *
 * The TUI surfaces route changes for transparency, but alias strings often differ
 * from display names or provider model ids for the *same* underlying model
 * (e.g. session alias "Grok 4.5" vs route alias "grok-4.5"). Those must not
 * spam "Model failover" on every step.
 */

import type { ModelAlias } from '@superliora/sdk';

export interface ModelRouteIdentity {
  readonly alias: string;
  /** Normalized underlying model id (provider model or alias model field). */
  readonly modelId: string;
  /** Normalized provider name when known. */
  readonly provider?: string;
}

export interface ProviderRouteSelectionLike {
  readonly modelAlias: string;
  readonly providerName?: string;
  readonly credentialLabel?: string;
  readonly providerModel: string;
}

/** Collapse display/id noise: "Grok 4.5" / "grok-4.5" / "grok_4_5" → "grok45". */
export function normalizeModelToken(value: string): string {
  return value.trim().toLowerCase().replaceAll(/[\s._\-:/]+/g, '');
}

export function resolveModelRouteIdentity(
  alias: string,
  availableModels: Readonly<Record<string, ModelAlias>>,
  selection?: Pick<ProviderRouteSelectionLike, 'providerModel' | 'providerName'>,
): ModelRouteIdentity {
  const entry = availableModels[alias];
  const rawModelId =
    selection?.providerModel !== undefined && selection.providerModel.length > 0
      ? selection.providerModel
      : (entry?.model ?? alias);
  const rawProvider = selection?.providerName ?? entry?.provider;
  return {
    alias,
    modelId: normalizeModelToken(rawModelId),
    provider:
      rawProvider !== undefined && rawProvider.length > 0
        ? normalizeModelToken(rawProvider)
        : undefined,
  };
}

/**
 * True when two aliases/selections refer to the same effective model.
 * Alias string equality is sufficient but not required — matching model ids
 * (and matching providers when both are known) also counts.
 */
export function isSameEffectiveModel(
  left: ModelRouteIdentity,
  right: ModelRouteIdentity,
): boolean {
  if (left.alias === right.alias) return true;
  if (normalizeModelToken(left.alias) === normalizeModelToken(right.alias)) return true;
  if (left.modelId.length === 0 || right.modelId.length === 0) return false;
  if (left.modelId !== right.modelId) return false;
  if (
    left.provider !== undefined &&
    right.provider !== undefined &&
    left.provider !== right.provider
  ) {
    return false;
  }
  return true;
}

export function modelRouteDisplayName(
  alias: string,
  availableModels: Readonly<Record<string, ModelAlias>>,
): string {
  const entry = availableModels[alias];
  return entry?.displayName ?? entry?.model ?? alias;
}

export type ModelRouteSurfaceKind = 'none' | 'failover' | 'selection';

export interface ModelRouteSurfaceDecision {
  readonly kind: ModelRouteSurfaceKind;
  /** Alias to show on the left of "from → to", when meaningful. */
  readonly fromAlias?: string;
  readonly toAlias: string;
  /** Whether credential / provider endpoint changed for the same model. */
  readonly credentialChanged: boolean;
}

/**
 * Decide whether a step-level provider route selection should surface a notice.
 *
 * Rules:
 * - Always silent when the effective model (and credential) did not change vs the
 *   previous step selection.
 * - Do not treat session-alias vs route-alias naming differences as failover when
 *   they resolve to the same underlying model.
 * - Failover only when the *previous step route* (or, on first selection, a truly
 *   different session model) moves to a different effective model.
 * - Credential-only changes surface as selection, not failover.
 */
export function decideModelRouteSurface(input: {
  readonly selection: ProviderRouteSelectionLike;
  readonly previous: ProviderRouteSelectionLike | null;
  readonly sessionModel: string;
  readonly availableModels: Readonly<Record<string, ModelAlias>>;
}): ModelRouteSurfaceDecision {
  const { selection, previous, sessionModel, availableModels } = input;
  const toAlias = selection.modelAlias;
  const toIdentity = resolveModelRouteIdentity(toAlias, availableModels, selection);

  const credentialChanged =
    previous !== null &&
    (previous.credentialLabel !== selection.credentialLabel ||
      previous.providerName !== selection.providerName ||
      previous.providerModel !== selection.providerModel);

  // Stable repeat of the same route — never re-notify (this is the main spam path).
  if (previous !== null) {
    const prevIdentity = resolveModelRouteIdentity(previous.modelAlias, availableModels, previous);
    if (isSameEffectiveModel(prevIdentity, toIdentity) && !credentialChanged) {
      return { kind: 'none', toAlias, credentialChanged: false };
    }

    if (!isSameEffectiveModel(prevIdentity, toIdentity)) {
      return {
        kind: 'failover',
        fromAlias: previous.modelAlias,
        toAlias,
        credentialChanged,
      };
    }

    // Same model, credential/endpoint rotated.
    return {
      kind: 'selection',
      fromAlias: previous.modelAlias !== toAlias ? previous.modelAlias : undefined,
      toAlias,
      credentialChanged: true,
    };
  }

  // First observed selection in this session.
  if (sessionModel.length === 0) {
    return { kind: 'none', toAlias, credentialChanged: false };
  }

  const sessionIdentity = resolveModelRouteIdentity(sessionModel, availableModels);
  if (isSameEffectiveModel(sessionIdentity, toIdentity)) {
    // Same effective model as the session alias — keep quiet (alias/display mismatch).
    return { kind: 'none', toAlias, credentialChanged: false };
  }

  // First step landed on a genuinely different model than the session alias.
  return {
    kind: 'failover',
    fromAlias: sessionModel,
    toAlias,
    credentialChanged: false,
  };
}
