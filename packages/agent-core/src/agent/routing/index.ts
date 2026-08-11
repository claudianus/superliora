export {
  SMART_AUTO_SESSION_ALIAS,
  advanceSmartRoute,
  buildLocalModelMetadata,
  configuredRoleAlias,
  defaultIntensityForRole,
  escalateSmartRoute,
  isConfigAliasHealthy,
  isSmartAutoSessionAlias,
  mergeRouteFallbackAliases,
  resolveSessionSmartRoute,
  resolveSessionSmartRouteAsync,
  resolveSmartRoute,
  resolveSmartRouteAsync,
  type ResolveSmartRouteInput,
  type SmartRoute,
  type SmartRouteSource,
} from './smart-router';
export {
  classifySessionRole,
  classifyTurnRouting,
  escalateIntensity,
  type ClassifiedTurnRouting,
  type RouteIntensity,
  type TurnSignals,
} from './turn-signals';
export {
  applyOutcomeTieBreak,
  recordRouteOutcome,
  resetRouteOutcomeStoreForTests,
  routeOutcomeEma,
} from './route-outcome';
export { applySessionSmartAutoForTurn } from './session-auto';
export {
  DEFAULT_MODEL_UNAVAILABLE_COOLDOWN_MS,
  DEFAULT_PROBE_FAIL_COOLDOWN_MS,
  ModelRouteHealthStore,
  resetModelRouteHealthStoreForTests,
  sharedModelRouteHealthStore,
  type ModelRouteHealthKind,
  type ModelRouteHealthRecord,
} from './model-route-health';
export {
  LIVE_PROBE_SUCCESS_TTL_MS,
  LIVE_PROBE_TIMEOUT_MS,
  ensureSmartRouteProbed,
  invalidateLiveProbeSuccess,
  invalidateLiveProbeSuccessForProvider,
  isLiveProbeFailureFresh,
  isLiveProbeSuccessFresh,
  probeModelAlias,
  resetLiveProbeCacheForTests,
  scheduleSmartAutoLiveProbe,
  setLiveProbeRunnerForTests,
  type LiveProbeAliasResult,
  type LiveProbeRunner,
} from './live-probe';
export {
  CURSOR_OAUTH_PROVIDER_ID,
  cursorWireModelId,
  isCursorIncludedLaneModel,
  shouldMarkProviderCredential,
} from './provider-failure-scope';
export {
  assertLoopRolesMatchPresets,
  configWithoutRoleModelOverrides,
  loopRoleRoutingEntries,
  planSmartLoopRoleRoutingLive,
  type LoopRoleModelConfigKey,
  type LoopRoleRoutingClearPath,
  type SmartLoopProbeProgress,
  type SmartLoopRolePinPlan,
  type SmartLoopRoleRoutingPlan,
  type SmartLoopRoleSkipPlan,
} from './plan-smart-loop-routing';
