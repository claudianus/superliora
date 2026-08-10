import { z } from 'zod';

export type ProviderRouteFailureKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'model_unavailable'
  | 'server'
  | 'connection'
  | 'timeout'
  | 'empty';

export interface ProviderRouteCandidateStatus {
  readonly modelAlias: string;
  readonly providerName: string;
  readonly credentialLabel?: string;
  readonly providerModel: string;
  readonly baseUrl?: string;
  readonly preferred?: boolean;
  readonly pinned?: boolean;
  readonly weight?: number;
  readonly rateLimits?: ProviderRouteRateLimitStatus[];
  readonly rateLimitHeadroom?: number;
  readonly cooldownUntil?: number;
  readonly cooldownKind?: ProviderRouteFailureKind;
  readonly lastSuccessAt?: number;
  readonly lastLatencyMs?: number;
  readonly avgLatencyMs?: number;
  readonly lastFailureKind?: ProviderRouteFailureKind;
  readonly lastFailureAt?: number;
  readonly successCount?: number;
  readonly failureCount?: number;
}

export interface ProviderRouteRateLimitStatus {
  readonly name: string;
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetAt?: number;
}

export interface ProviderRouteStatus {
  readonly modelAlias: string;
  readonly strategy:
    | 'auto'
    | 'fallback'
    | 'fill_first'
    | 'round_robin'
    | 'weighted_round_robin'
    | 'least_used'
    | 'lowest_latency'
    | 'rate_limit_aware'
    | 'random';
  readonly sessionAffinity?: boolean;
  readonly preferredCredential?: string;
  readonly candidates: ProviderRouteCandidateStatus[];
}

export interface ProviderRouteSelection {
  readonly modelAlias: string;
  readonly providerName?: string;
  readonly credentialLabel?: string;
  readonly providerModel: string;
  readonly baseUrl?: string;
}

export const providerRouteFailureKindSchema = z.enum([
  'auth',
  'quota',
  'rate_limit',
  'model_unavailable',
  'server',
  'connection',
  'timeout',
  'empty',
]) satisfies z.ZodType<ProviderRouteFailureKind>;

export const providerRouteCandidateStatusSchema = z.object({
  modelAlias: z.string(),
  providerName: z.string(),
  credentialLabel: z.string().optional(),
  providerModel: z.string(),
  baseUrl: z.string().optional(),
  preferred: z.boolean().optional(),
  pinned: z.boolean().optional(),
  weight: z.number().int().min(1).optional(),
  rateLimits: z
    .array(
      z.object({
        name: z.string().min(1),
        limit: z.number().optional(),
        remaining: z.number().optional(),
        resetAt: z.number().optional(),
      }) satisfies z.ZodType<ProviderRouteRateLimitStatus>,
    )
    .optional(),
  rateLimitHeadroom: z.number().min(0).max(1).optional(),
  cooldownUntil: z.number().optional(),
  cooldownKind: providerRouteFailureKindSchema.optional(),
  lastSuccessAt: z.number().optional(),
  lastLatencyMs: z.number().int().nonnegative().optional(),
  avgLatencyMs: z.number().int().nonnegative().optional(),
  lastFailureKind: providerRouteFailureKindSchema.optional(),
  lastFailureAt: z.number().optional(),
  successCount: z.number().int().nonnegative().optional(),
  failureCount: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<ProviderRouteCandidateStatus>;

export const providerRouteStatusSchema = z.object({
  modelAlias: z.string(),
  strategy: z.enum([
    'auto',
    'fallback',
    'fill_first',
    'round_robin',
    'weighted_round_robin',
    'least_used',
    'lowest_latency',
    'rate_limit_aware',
    'random',
  ]),
  sessionAffinity: z.boolean().optional(),
  preferredCredential: z.string().optional(),
  candidates: z.array(providerRouteCandidateStatusSchema),
}) satisfies z.ZodType<ProviderRouteStatus>;

export const providerRouteSelectionSchema = z.object({
  modelAlias: z.string(),
  providerName: z.string().optional(),
  credentialLabel: z.string().optional(),
  providerModel: z.string(),
  baseUrl: z.string().optional(),
}) satisfies z.ZodType<ProviderRouteSelection>;
