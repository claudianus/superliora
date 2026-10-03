import type { VerificationArtifact, VerificationHostPolicy } from '../execution/verification';

/** Registered by a trusted host, never constructed from model tool arguments. */
export interface TrustedVerificationPlan {
  readonly id: string;
  readonly hostPolicy: VerificationHostPolicy;
  readonly repoPath: string;
  readonly artifact: VerificationArtifact;
  readonly evidenceRoot: string;
  readonly currentRequirementsHash: () => string | Promise<string>;
}
