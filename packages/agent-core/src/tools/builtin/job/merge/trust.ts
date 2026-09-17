export {
  declaredSensitivePaths,
  evaluateMergeTrust,
} from './trust-sync';
export type { MergeTrustInput, MergeTrustVerdict } from './trust-sync';
export {
  mergeRiskAssessmentFromClaim,
  evaluateMergeTrustAsync,
  mergeTrustInputFromLedger,
} from './trust-async';
export type { MergeTrustClaim } from './trust-async';
