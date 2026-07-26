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
  /**
   * Optional catalog / division labels for this case (e.g. `Finance`, `Security`).
   * Used by offline benches to assert search covers labeled domains, not only ids.
   */
  readonly labels?: readonly string[];
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
 * Collect unique catalog/division labels from a gold seed list.
 * Empty/undefined labels are skipped.
 */
export function collectStaffingGoldLabels(
  cases: readonly StaffingGoldCase[] = STAFFING_GOLD_SEED,
): readonly string[] {
  const labels = new Set<string>();
  for (const gold of cases) {
    for (const label of gold.labels ?? []) {
      const trimmed = label.trim();
      if (trimmed.length > 0) labels.add(trimmed);
    }
  }
  return [...labels].toSorted((a, b) => a.localeCompare(b));
}

/**
 * Cases whose `labels` include the given label (case-sensitive exact match).
 */
export function staffingGoldCasesForLabel(
  label: string,
  cases: readonly StaffingGoldCase[] = STAFFING_GOLD_SEED,
): readonly StaffingGoldCase[] {
  return cases.filter((gold) => (gold.labels ?? []).includes(label));
}

/**
 * Offline domain coverage: share of required labels that appear at least once
 * on the seed. Returns 1 when `required` is empty.
 */
export function staffingGoldLabelCoverage(
  required: readonly string[],
  cases: readonly StaffingGoldCase[] = STAFFING_GOLD_SEED,
): number {
  if (required.length === 0) return 1;
  const present = new Set(collectStaffingGoldLabels(cases));
  let hit = 0;
  for (const label of required) {
    if (present.has(label)) hit += 1;
  }
  return hit / required.length;
}

/**
 * Seed gold set for regression. `relevantIds` are real catalog persona keys
 * from `catalog-personas.json` (ExpertSearchResult uses `.expert.id`).
 */
export const STAFFING_GOLD_SEED: readonly StaffingGoldCase[] = [
  {
    id: 'tui-terminal',
    query: 'TUI terminal renderer CLI engineer typescript powershell',
    relevantIds: [
      'engineering-terminal-ui-engineer',
      'volt-06-developer-experience-powershell-ui-architect',
      'volt-06-developer-experience-cli-developer',
      'volt-02-language-specialists-powershell-7-expert',
      'volt-02-language-specialists-typescript-pro',
    ],
    labels: ['Engineering', 'TUI'],
  },
  {
    id: 'security-auth',
    query: 'oauth auth security threat model credentials',
    relevantIds: [
      'security-architect',
      'security-appsec-engineer',
      'volt-03-infrastructure-security-engineer',
      'volt-04-quality-security-ad-security-reviewer',
    ],
    labels: ['Security'],
  },
  {
    id: 'code-review',
    query: 'code review pull request quality findings',
    relevantIds: [
      'engineering-code-reviewer',
      'agentcrow-compose-meta-reviewer',
      'security-ai-generated-code-auditor',
      'volt-04-quality-security-ad-security-reviewer',
    ],
    labels: ['Engineering', 'Review'],
  },
  {
    id: 'frontend-ui',
    query: 'frontend react typescript UI component developer',
    relevantIds: [
      'engineering-frontend-developer',
      'agentcrow-frontend-developer',
      'ericgrill-general-frontend-alchemist',
    ],
    labels: ['Engineering', 'Frontend'],
  },
  {
    id: 'backend-api',
    query: 'engineering backend architect api platform engineer',
    relevantIds: [
      'engineering-backend-architect',
      'volt-03-infrastructure-platform-engineer',
      'engineering-api-platform-engineer',
      'agentcrow-backend-architect',
      'volt-01-core-development-backend-developer',
      'volt-01-core-development-api-designer',
    ],
    labels: ['Engineering', 'Backend'],
  },
  {
    id: 'database-perf',
    query: 'database optimizer query performance reliability',
    relevantIds: [
      'engineering-database-optimizer',
      'volt-05-data-ai-postgres-pro',
      'volt-02-language-specialists-sql-pro',
      'engineering-database-reliability-engineer',
      'ericgrill-general-database-sage',
    ],
    labels: ['Engineering', 'Database'],
  },
  {
    id: 'devops-ci',
    query: 'devops automation CI CD pipeline infrastructure',
    relevantIds: [
      'engineering-devops-automator',
      'ericgrill-general-devops-dispatcher',
      'agentcrow-devops-automator',
      'volt-03-infrastructure-devops-engineer',
    ],
    labels: ['Engineering', 'DevOps'],
  },
  {
    id: 'testing-qa',
    query: 'test automation engineer QA testing TDD craftsman maniac',
    relevantIds: [
      'testing-test-automation-engineer',
      'volt-04-quality-security-test-automator',
      'ericgrill-general-test-driven-maniac',
      'ericgrill-general-test-driven-craftsman',
      'agentcrow-qa-engineer',
      'specialized-model-qa',
    ],
    labels: ['Testing', 'QA'],
  },
  {
    id: 'performance',
    query: 'performance reliability latency tuning',
    relevantIds: [
      'engineering-database-reliability-engineer',
      'engineering-drupal-performance',
      'volt-04-quality-security-performance-engineer',
      'testing-performance-benchmarker',
      'volt-09-meta-orchestration-performance-monitor',
      'engineering-wordpress-performance',
      'support-infrastructure-maintainer',
    ],
    labels: ['Engineering', 'Performance'],
  },
  {
    id: 'product-pm',
    query: 'product manager roadmap prioritization sprint feedback',
    relevantIds: [
      'product-manager',
      'product-sprint-prioritizer',
      'product-feedback-synthesizer',
      'volt-08-business-product-product-manager',
    ],
    labels: ['Product'],
  },
  {
    id: 'design-ui-ux',
    query: 'UI UX design visual system inclusive designer',
    relevantIds: [
      'design-ui-designer',
      'agentcrow-ui-designer',
      'volt-04-quality-security-ui-ux-tester',
    ],
    labels: ['Design'],
  },
  {
    id: 'sre-observability',
    query: 'SRE observability incident response reliability on-call',
    relevantIds: [
      'engineering-incident-response-commander',
      'volt-03-infrastructure-sre-engineer',
      'security-incident-responder',
      'ericgrill-general-incident-commander',
    ],
    labels: ['Engineering', 'SRE'],
  },
  {
    id: 'mobile-apps',
    query: 'mobile app builder mobile developer react native flutter',
    relevantIds: [
      'engineering-mobile-app-builder',
      'volt-01-core-development-mobile-developer',
      'volt-07-specialized-domains-mobile-app-developer',
      'ericgrill-general-mobile-nomad',
    ],
    labels: ['Engineering', 'Mobile'],
  },
  {
    id: 'docs-writer',
    query: 'documentation technical writer developer docs',
    relevantIds: [
      'engineering-technical-writer',
      'agentcrow-technical-writer',
      'volt-06-developer-experience-documentation-engineer',
      'specialized-developer-advocate',
    ],
    labels: ['Engineering', 'Docs'],
  },
  {
    id: 'data-pipelines',
    query: 'data engineer pipeline analytics ETL warehouse',
    relevantIds: ['engineering-data-engineer', 'agentcrow-data-pipeline-engineer'],
    labels: ['Engineering', 'Data'],
  },
  {
    id: 'ml-llm',
    query: 'machine learning ML model LLM AI engineer post-training',
    relevantIds: [
      'engineering-ai-engineer',
      'ericgrill-general-ml-model-whisperer',
      'engineering-llm-post-training-engineer',
    ],
    labels: ['Engineering', 'ML'],
  },
  {
    id: 'complexity-critic',
    query: 'complexity critic meta reviewer code quality adversarial review',
    relevantIds: ['agentcrow-complexity-critic', 'engineering-code-reviewer', 'agentcrow-compose-meta-reviewer'],
    labels: ['Engineering', 'Review'],
  },
  {
    id: 'finance-fpa',
    query: 'financial analyst FP&A bookkeeping controller payments billing',
    relevantIds: [
      'finance-fpa-analyst',
      'finance-bookkeeper-controller',
      'engineering-payments-billing-engineer',
    ],
    labels: ['Finance'],
  },
  {
    id: 'cloud-infra',
    query: 'cloud architect azure devops infrastructure cost optimizer',
    relevantIds: [
      'volt-03-infrastructure-azure-infra-engineer',
      'security-cloud-security-architect',
      'ericgrill-general-cloud-cost-optimizer',
      'support-infrastructure-maintainer',
    ],
    labels: ['Infrastructure', 'Cloud'],
  },
  {
    id: 'accessibility',
    query: 'accessibility auditor a11y inclusive visuals WCAG tester',
    relevantIds: [
      'testing-accessibility-auditor',
      'volt-04-quality-security-accessibility-tester',
      'design-inclusive-visuals-specialist',
    ],
    labels: ['Testing', 'Design', 'Accessibility'],
  },
  {
    id: 'game-dev',
    query: 'game designer Unreal GAS audio engineer gameplay developer',
    relevantIds: [
      'game-designer',
      'agentcrow-unreal-gas-specialist',
      'game-audio-engineer',
      'volt-07-specialized-domains-game-developer',
    ],
    labels: ['Game Dev'],
  },
  {
    id: 'legal-compliance',
    query: 'legal document review privacy officer compliance auditor GDPR',
    relevantIds: [
      'volt-04-quality-security-gdpr-ccpa-compliance',
      'legal-document-review',
      'data-privacy-officer',
      'volt-08-business-product-legal-advisor',
      'security-compliance-auditor',
      'support-legal-compliance-checker',
    ],
    labels: ['Legal', 'Compliance'],
  },
  {
    id: 'blockchain-web3',
    query: 'blockchain security auditor web3 smart contract developer',
    relevantIds: [
      'security-blockchain-security-auditor',
      'volt-07-specialized-domains-blockchain-developer',
    ],
    labels: ['Security', 'Blockchain'],
  },
  {
    id: 'marketing-growth',
    query: 'marketing SEO growth carousel app store optimizer campaigns',
    relevantIds: [
      'marketing-carousel-growth-engine',
      'marketing-app-store-optimizer',
      'volt-08-business-product-content-marketer',
      'marketing-growth-hacker',
    ],
    labels: ['Marketing'],
  },
  {
    id: 'sales-revenue',
    query: 'sales deal strategist offer lead gen outreach sales engineer',
    relevantIds: [
      'sales-deal-strategist',
      'sales-offer-lead-gen-strategist',
      'sales-outreach',
      'volt-08-business-product-sales-engineer',
    ],
    labels: ['Sales'],
  },
  {
    id: 'customer-support',
    query: 'customer success manager support responder service desk',
    relevantIds: [
      'customer-success-manager',
      'support-support-responder',
      'customer-service',
    ],
    labels: ['Support'],
  },
  {
    id: 'rust-systems',
    query: 'rust engineer systems embedded firmware refactoring',
    relevantIds: [
      'volt-02-language-specialists-rust-engineer',
      'engineering-rust-refactoring-specialist',
      'engineering-embedded-firmware-engineer',
    ],
    labels: ['Engineering', 'Rust'],
  },
  {
    id: 'multi-agent-systems',
    query: 'engineering multi-agent systems architect RAG pipeline',
    relevantIds: [
      'engineering-multi-agent-systems-architect',
      'volt-05-data-ai-llm-architect',
      'engineering-rag-pipeline-engineer',
      'agentic-identity-trust',
    ],
    labels: ['Engineering', 'Agents'],
  },
  {
    id: 'privacy-gdpr',
    query: 'privacy engineer data protection GDPR CCPA compliance',
    relevantIds: [
      'engineering-privacy-engineer',
      'data-privacy-officer',
      'volt-04-quality-security-gdpr-ccpa-compliance',
    ],
    labels: ['Privacy', 'Compliance'],
  },
];
