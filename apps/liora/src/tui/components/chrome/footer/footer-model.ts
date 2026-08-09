import type { AppState } from '#/tui/types';
import type { FooterLabels } from '#/tui/config';
import { formatThinkingLevelSuffix } from '#/tui/utils/model/thinking-effort';
import {
  isSameEffectiveModel,
  modelRouteDisplayName,
  resolveModelRouteIdentity,
} from '#/tui/utils/model/model-route-notice';
import { labelModelRoute } from '#/tui/components/chrome/footer/footer-labels';

export function modelDisplayName(state: AppState): string {
  if (state.model.trim().toLowerCase() === 'auto') return 'Smart Auto';
  const model = state.availableModels[state.model];
  return model?.displayName ?? model?.model ?? state.model;
}

/** Effective step model when the provider route differs from the session model. */
export function effectiveRouteModelLabel(state: AppState): string | undefined {
  const selection = state.lastProviderRouteSelection;
  if (selection === undefined || selection === null) return undefined;
  if (selection.modelAlias === state.model) return undefined;
  // Same underlying model under a different alias — do not dual-label the footer.
  if (
    state.model.length > 0 &&
    isSameEffectiveModel(
      resolveModelRouteIdentity(state.model, state.availableModels),
      resolveModelRouteIdentity(selection.modelAlias, state.availableModels, selection),
    )
  ) {
    return undefined;
  }
  return modelRouteDisplayName(selection.modelAlias, state.availableModels);
}

export function formatModelRouteBadge(
  state: AppState,
  labels: FooterLabels = 'plain',
): string | undefined {
  const notice = state.lastModelRouteNotice;
  if (notice === undefined || notice === null) return undefined;
  // Keep the badge fresh for ~45s so operators can still read it after a switch.
  if (Date.now() - notice.atMs > 45_000) return undefined;
  const toLabel = modelRouteDisplayName(notice.toAlias, state.availableModels);
  const reasonSuffix =
    notice.reason !== undefined && notice.reason.length > 0 && notice.reason.includes('/')
      ? ` (${notice.reason.split('·').at(-1)?.trim() ?? notice.reason})`
      : '';
  // Only surface true failovers here. Other routes already paint on cards/headers.
  if (notice.kind === 'failover' && notice.fromAlias !== undefined) {
    // Defensive: never badge a same-effective-model rename as failover.
    if (
      isSameEffectiveModel(
        resolveModelRouteIdentity(notice.fromAlias, state.availableModels),
        resolveModelRouteIdentity(notice.toAlias, state.availableModels, {
          providerModel: notice.providerModel ?? '',
          providerName: notice.providerName,
        }),
      )
    ) {
      return undefined;
    }
    const fromLabel = modelRouteDisplayName(notice.fromAlias, state.availableModels);
    if (fromLabel === toLabel) return undefined;
    return `${labelModelRoute(labels, 'failover', fromLabel, toLabel)}${reasonSuffix}`;
  }
  // Smart-auto / selection notices: show when reason carries role/intensity.
  if (notice.kind === 'selection' && reasonSuffix.length > 0) {
    const fromLabel =
      notice.fromAlias !== undefined
        ? modelRouteDisplayName(notice.fromAlias, state.availableModels)
        : state.model === 'auto'
          ? 'Smart Auto'
          : undefined;
    if (fromLabel !== undefined && fromLabel !== toLabel) {
      return `${fromLabel} → ${toLabel}${reasonSuffix}`;
    }
    return `${toLabel}${reasonSuffix}`;
  }
  return undefined;
}

/** Suffix for the footer model badge: effective effort (shows clamp as max→high). */
export function thinkingLevelLabel(state: AppState): string {
  return formatThinkingLevelSuffix(state.thinkingLevel, {
    thinking: state.thinking,
    model: state.availableModels[state.model],
  });
}
