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
  resolveSmartRoute,
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
  LIVE_PROBE_SUCCESS_TTL_MS,
  LIVE_PROBE_TIMEOUT_MS,
  ensureSmartRouteProbed,
  invalidateLiveProbeSuccess,
  invalidateLiveProbeSuccessForProvider,
  isLiveProbeSuccessFresh,
  probeModelAlias,
  resetLiveProbeCacheForTests,
  scheduleSmartAutoLiveProbe,
  setLiveProbeRunnerForTests,
  type LiveProbeAliasResult,
  type LiveProbeRunner,
} from './live-probe';
