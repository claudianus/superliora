/**
 * Staffing gold-set bench (MVP): offline nDCG-style scoring for expert retrieval.
 *
 * Not a full IR benchmark harness — small pure helpers so CI/scripts can score
 * ranked id lists against labeled gold without network.
 */

export interface StaffingGoldCase {
  readonly id: string;
  readonly query: string;
  /** Ordered preferred expert ids (rank 1 first). */
  readonly relevantIds: readonly string[];
}

export function dcgAtK(rankedIds: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  let score = 0;
  const limit = Math.min(k, rankedIds.length);
  for (let i = 0; i < limit; i += 1) {
    const id = rankedIds[i];
    if (id === undefined || !relevant.has(id)) continue;
    // graded relevance: higher if earlier in gold list — binary for MVP
    const rel = 1;
    score += rel / Math.log2(i + 2);
  }
  return score;
}

export function ndcgAtK(
  rankedIds: readonly string[],
  goldRelevantOrdered: readonly string[],
  k: number,
): number {
  const relevant = new Set(goldRelevantOrdered);
  if (relevant.size === 0) return 0;
  const actual = dcgAtK(rankedIds, relevant, k);
  const ideal = dcgAtK(goldRelevantOrdered, relevant, k);
  if (ideal <= 0) return 0;
  return actual / ideal;
}

export function meanNdcgAtK(
  cases: readonly { rankedIds: readonly string[]; gold: StaffingGoldCase }[],
  k: number,
): number {
  if (cases.length === 0) return 0;
  let sum = 0;
  for (const item of cases) {
    sum += ndcgAtK(item.rankedIds, item.gold.relevantIds, k);
  }
  return sum / cases.length;
}

/**
 * Seed gold set for regression. `relevantIds` are real catalog persona keys
 * from `catalog-personas.json` (ExpertSearchResult uses `.expert.id`).
 */
export const STAFFING_GOLD_SEED: readonly StaffingGoldCase[] = [
  {
    id: 'tui-terminal',
    query: 'terminal TUI renderer component typescript',
    relevantIds: ['terminal-integration-specialist'],
  },
  {
    id: 'security-auth',
    query: 'oauth auth security threat model credentials',
    relevantIds: [
      'security-appsec-engineer',
      'security-architect',
      'security-secrets-credential-engineer',
      'ericgrill-general-security-sentinel',
    ],
  },
  {
    id: 'code-review',
    query: 'code review pull request quality findings',
    relevantIds: ['engineering-code-reviewer', 'agentcrow-compose-meta-reviewer'],
  },
  {
    id: 'frontend-ui',
    query: 'frontend react typescript UI component developer',
    relevantIds: [
      'engineering-frontend-developer',
      'agentcrow-frontend-developer',
      'ericgrill-general-frontend-alchemist',
    ],
  },
  {
    id: 'backend-api',
    query: 'backend API platform service architecture',
    relevantIds: [
      'engineering-backend-architect',
      'engineering-api-platform-engineer',
      'agentcrow-backend-architect',
    ],
  },
  {
    id: 'database-perf',
    query: 'database optimizer query performance reliability',
    relevantIds: [
      'engineering-database-optimizer',
      'engineering-database-reliability-engineer',
      'ericgrill-general-database-sage',
    ],
  },
  {
    id: 'devops-ci',
    query: 'devops automation CI CD pipeline infrastructure',
    relevantIds: ['engineering-devops-automator', 'agentcrow-devops-automator'],
  },
  {
    id: 'testing-qa',
    query: 'test driven development QA engineer automated tests',
    relevantIds: [
      'ericgrill-general-test-driven-craftsman',
      'agentcrow-qa-engineer',
      'ericgrill-general-test-driven-maniac',
    ],
  },
  {
    id: 'performance',
    query: 'performance reliability latency tuning',
    relevantIds: [
      'ericgrill-general-performance-tuner',
      'engineering-wordpress-performance',
    ],
  },
  {
    id: 'product-pm',
    query: 'product manager roadmap prioritization sprint feedback',
    relevantIds: ['product-manager', 'product-sprint-prioritizer', 'product-feedback-synthesizer'],
  },
  {
    id: 'design-ui-ux',
    query: 'UI UX design visual system inclusive designer',
    relevantIds: ['design-ui-designer', 'agentcrow-ui-designer', 'design-brand-guardian'],
  },
  {
    id: 'sre-observability',
    query: 'SRE observability incident response reliability on-call',
    relevantIds: [
      'engineering-sre',
      'ericgrill-general-observability-oracle',
      'engineering-incident-response-commander',
    ],
  },
  {
    id: 'mobile-apps',
    query: 'mobile app builder iOS Android release engineer',
    relevantIds: ['engineering-mobile-app-builder', 'ericgrill-general-mobile-nomad'],
  },
  {
    id: 'docs-writer',
    query: 'technical writer API documentation developer experience docs',
    relevantIds: ['engineering-technical-writer', 'agentcrow-technical-writer'],
  },
  {
    id: 'data-pipelines',
    query: 'data engineer pipeline analytics ETL warehouse',
    relevantIds: ['engineering-data-engineer', 'agentcrow-data-pipeline-engineer'],
  },
  {
    id: 'ml-llm',
    query: 'machine learning ML model LLM AI engineer post-training',
    relevantIds: [
      'engineering-ai-engineer',
      'ericgrill-general-ml-model-whisperer',
      'engineering-llm-post-training-engineer',
    ],
  },
  {
    id: 'complexity-critic',
    query: 'complexity critic meta reviewer code quality adversarial review',
    relevantIds: ['agentcrow-complexity-critic', 'engineering-code-reviewer', 'agentcrow-compose-meta-reviewer'],
  },
];
