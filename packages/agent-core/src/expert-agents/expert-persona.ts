/**
 * Expert persona composition layer.
 *
 * Design sources (2024–2026):
 * - Anthropic system prompt design & context engineering (structured sections, Goldilocks specificity)
 * - EMNLP 2024/2025 persona research (explicit behavioral constraints; ignore irrelevant persona fluff)
 * - Persona-as-Code / AgentPatterns.ai (domain, responsibilities, artifacts, constraints, scope exclusions)
 * - agency-agents CONTRIBUTING (identity vs operational sections; deliverable-focused specialists)
 */
import type { ExpertCatalogEntry } from './types';

const PERSONA_TEXT_MAX_CHARS = 12_000;

type ExpertAgentPattern = 'analysis' | 'generation' | 'validation' | 'orchestration';

const DIVISION_AGENT_PATTERN: Readonly<Record<string, ExpertAgentPattern>> = {
  engineering: 'generation',
  design: 'generation',
  testing: 'validation',
  security: 'validation',
  product: 'orchestration',
  'project-management': 'orchestration',
  sales: 'analysis',
  marketing: 'analysis',
  'paid-media': 'analysis',
  finance: 'analysis',
  support: 'analysis',
  academic: 'analysis',
  gis: 'generation',
  healthcare: 'analysis',
  'game-development': 'generation',
  'spatial-computing': 'generation',
  specialized: 'analysis',
};

const DIVISION_OPERATING_NORMS: Readonly<Record<string, string>> = {
  engineering:
    'Ship evidence, not vibes: reproduce issues, cite paths and line numbers, propose verifiable fixes, and separate root cause from symptoms.',
  design:
    'Anchor every recommendation in user goals, constraints, and measurable outcomes; show tradeoffs and rejection criteria explicitly.',
  testing:
    'Define falsifiable checks first; report pass/fail with reproduction steps; never claim verified without execution evidence.',
  security:
    'Model trust boundaries and threat paths; classify findings by severity; state residual risk for every mitigation.',
  product:
    'Translate ambiguity into testable requirements, explicit non-goals, and acceptance criteria before solutioning.',
  'project-management':
    'Make dependencies, owners, and blockers visible; prefer small verifiable milestones over broad commitments.',
  sales:
    'Ground coaching in observable deal behavior and stage discipline; distinguish controllable execution gaps from market noise.',
  marketing:
    'Tie creative and channel choices to audience, message, and measurable funnel impact; avoid vanity metrics.',
  'paid-media':
    'Optimize for unit economics and incrementality; document targeting rationale and measurement limitations.',
  finance:
    'Show assumptions, sensitivity, and reconciliation; never present projections without stating what would falsify them.',
  support:
    'Diagnose before prescribing; capture reproduction, environment, and customer impact; escalate with complete context.',
  academic:
    'Separate established findings from inference; cite sources; flag uncertainty and conflicting evidence explicitly.',
  gis:
    'Validate spatial logic (CRS, topology, scale) before aesthetics; prefer reproducible geoprocessing over one-off clicks.',
  healthcare:
    'Ground clinical and health-system claims in evidence tiers; separate guideline consensus from local policy constraints.',
  'game-development':
    'Balance player experience, performance budgets, and implementation cost; prototype risky mechanics early.',
  'spatial-computing':
    'Design for device constraints, comfort, and input modality; validate in-target hardware assumptions.',
  specialized:
    'Stay inside declared specialty; when crossing domains, name the boundary and what specialist should own the rest.',
};

const DIVISION_SCOPE_EXCLUSIONS: Readonly<Record<string, readonly string[]>> = {
  engineering: [
    'Final product positioning and roadmap prioritization → product specialist',
    'Visual brand identity and marketing copy → design / marketing specialist',
    'Penetration testing execution sign-off → security specialist',
  ],
  design: [
    'Production deployment and infrastructure → engineering specialist',
    'Legal/compliance interpretation → security / legal specialist',
    'Financial modeling → finance specialist',
  ],
  testing: [
    'Feature design and product scope → product specialist',
    'Implementation fixes → engineering specialist (you verify; they ship)',
  ],
  security: [
    'Product feature prioritization → product specialist',
    'Visual UX polish → design specialist',
  ],
  product: [
    'Low-level implementation details → engineering specialist',
    'Hands-on security audit execution → security specialist',
  ],
  sales: [
    'Code implementation → engineering specialist',
    'Marketing campaign creative → marketing specialist',
  ],
  marketing: [
    'Core software architecture → engineering specialist',
    'Financial audit and accounting → finance specialist',
  ],
  default: [
    'Work outside your division mandate → name the owning specialist explicitly',
    'End-user integration and release ownership → parent orchestrator',
  ],
};

const DIVISION_OUTPUT_ARTIFACTS: Readonly<Record<string, readonly string[]>> = {
  engineering: ['Technical findings with file:line references', 'Proposed changes or patch plan', 'Test/verification plan'],
  design: ['UX/UI rationale with tradeoffs', 'Acceptance criteria or review checklist', 'Before/after behavior description'],
  testing: ['Pass/fail matrix with reproduction steps', 'Defect reports with severity', 'Coverage gaps list'],
  security: ['Threat notes and trust-boundary map', 'Findings ranked by severity', 'Mitigation options with residual risk'],
  product: ['Problem statement and non-goals', 'Acceptance criteria', 'Prioritized next actions'],
  default: ['Evidence-backed findings', 'Prioritized recommendations', 'Open questions and verification status'],
};

export interface ExpertMissionContext {
  readonly taskDescription: string;
  readonly swarmIndex?: number;
  readonly totalExperts?: number;
  readonly coverageLane?: string;
  readonly selectionReason?: string;
  readonly phase?: string;
  readonly focus?: string;
}

export function enrichExpertForCatalog(expert: ExpertCatalogEntry): ExpertCatalogEntry {
  return {
    ...expert,
    whenToUse: resolveExpertWhenToUse(expert),
    personaText: normalizeExpertPersonaText(expert.personaText),
  };
}

export function resolveExpertWhenToUse(expert: ExpertCatalogEntry): string {
  const direct = expert.whenToUse.trim();
  if (direct.length > 0) return direct;

  const capabilityHint = expert.capabilities
    .map((capability) => capability.trim())
    .filter((capability) => capability.length > 0)
    .slice(0, 3)
    .join('; ');
  if (capabilityHint.length > 0) {
    return `Engage when the task requires ${expert.divisionLabel.toLowerCase()} depth from ${expert.name}: ${capabilityHint}.`;
  }
  return `Engage when the task requires ${expert.divisionLabel.toLowerCase()} judgment matching this mandate: ${expert.description}`;
}

export function normalizeExpertPersonaText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= PERSONA_TEXT_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, PERSONA_TEXT_MAX_CHARS).trimEnd()}…`;
}

export function renderExpertSystemPrompt(
  basePrompt: string,
  expert: ExpertCatalogEntry,
  baseProfileName: string,
): string {
  const enriched = enrichExpertForCatalog(expert);
  return [
    basePrompt,
    '',
    renderExpertRoleDeclaration(enriched),
    '',
    renderPersonaAsCodeSpec(enriched),
    '',
    renderExpertProcess(enriched),
    '',
    renderPersonaInstructionMitigation(),
    '',
    renderExpertReasoningProtocol(),
    '',
    '<expert_persona>',
    enriched.personaText,
    '</expert_persona>',
    '',
    renderExpertSubagentContract(),
    '',
    renderExpertHandoffSchema(enriched),
    '',
    renderExpertEdgeCases(enriched),
  ].join('\n');
}

export function buildExpertAssignmentPrompt(
  expert: ExpertCatalogEntry,
  context: ExpertMissionContext,
): string {
  const enriched = enrichExpertForCatalog(expert);
  const collaborationLine = context.totalExperts !== undefined && context.totalExperts > 1
    ? 'You are one specialist on a multi-expert assignment. Stay in your lane, make your contribution auditable, and assume peers handle adjacent domains.'
    : 'You are the primary specialist for this assignment. Still state boundaries where another discipline should take over.';

  return [
    renderExpertRoleDeclaration(enriched),
    '',
    renderPersonaAsCodeSpec(enriched),
    '',
    renderExpertProcess(enriched),
    '',
    renderPersonaInstructionMitigation(),
    '',
    renderExpertReasoningProtocol(),
    '',
    collaborationLine,
    '',
    '<assignment>',
    context.taskDescription.trim(),
    '</assignment>',
    context.coverageLane === undefined ? '' : `<coverage_lane>${context.coverageLane}</coverage_lane>`,
    context.selectionReason === undefined ? '' : `<selection_reason>${context.selectionReason}</selection_reason>`,
    context.phase === undefined ? '' : `<phase>${context.phase}</phase>`,
    context.focus === undefined ? '' : `<focus>${context.focus}</focus>`,
    '',
    renderExpertSubagentContract(),
    '',
    renderExpertHandoffSchema(enriched),
    '',
    renderExpertEdgeCases(enriched),
  ].filter((line) => line.length > 0).join('\n');
}

export function buildExpertSwarmExecutionFooter(expertName: string): string {
  return [
    '<execution_discipline>',
    'Orient with workspace summary and targeted search before broad reads; keep exploration bounded to your assignment.',
    `Apply ${expertName} professional standards; return an evidence-backed handoff artifact, not chat filler.`,
    'Within your first two tool calls, create a live scope board (3–7 actionable items). Update after each major batch; mark done only after verification.',
    'When a domain workflow would help, SearchSkill → Skill for task-specific guidance; apply loaded skills selectively, not blindly.',
    '</execution_discipline>',
  ].join('\n');
}

function renderExpertRoleDeclaration(expert: ExpertCatalogEntry): string {
  const emojiPrefix = expert.emoji.trim().length > 0 ? `${expert.emoji.trim()} ` : '';
  return [
    `<role_declaration>`,
    `You are ${emojiPrefix}${expert.name}, a specialist in ${expert.divisionLabel.toLowerCase()} (${expert.division}).`,
    `You think and communicate as a practicing ${expert.name}, not as a generic assistant with a costume.`,
    expert.vibe.trim().length > 0 ? `Communication stance: ${expert.vibe.trim()}` : '',
    `</role_declaration>`,
  ].filter((line) => line.length > 0).join('\n');
}

function renderPersonaAsCodeSpec(expert: ExpertCatalogEntry): string {
  const responsibilities = buildResponsibilities(expert);
  const artifacts = DIVISION_OUTPUT_ARTIFACTS[expert.division] ?? DIVISION_OUTPUT_ARTIFACTS['default']!;
  const exclusions = [
    ...(DIVISION_SCOPE_EXCLUSIONS[expert.division] ?? []),
    ...DIVISION_SCOPE_EXCLUSIONS['default']!,
  ];
  const norm = DIVISION_OPERATING_NORMS[expert.division] ?? DIVISION_OPERATING_NORMS['specialized']!;

  return [
    '<persona_spec>',
    '## Domain',
    expert.description,
    '',
    '## When To Engage',
    resolveExpertWhenToUse(expert),
    '',
    '## Core Responsibilities',
    ...responsibilities.map((item, index) => `${String(index + 1)}. ${item}`),
    '',
    '## Output Artifacts',
    ...artifacts.map((item) => `- ${item}`),
    '',
    '## Constraints',
    `- ${norm}`,
    '- Do not invent facts, test results, citations, or repository state.',
    '- Do not perform work listed under Scope Exclusions — name the owning specialist instead.',
    '',
    '## Scope Exclusions',
    ...exclusions.map((item) => `- ${item}`),
    '</persona_spec>',
  ].join('\n');
}

function buildResponsibilities(expert: ExpertCatalogEntry): string[] {
  const fromCapabilities = expert.capabilities
    .map((capability) => capability.trim())
    .filter((capability) => capability.length > 20)
    .slice(0, 3);
  if (fromCapabilities.length >= 2) return fromCapabilities;

  const pattern = resolveExpertAgentPattern(expert.division);
  switch (pattern) {
    case 'validation':
      return [
        `Validate ${expert.divisionLabel.toLowerCase()} aspects of the assignment against professional standards`,
        'Document violations with severity and reproduction steps',
        'Recommend remediations with explicit pass/fail judgment where applicable',
      ];
    case 'generation':
      return [
        `Design or implement ${expert.divisionLabel.toLowerCase()} solutions that meet the assignment constraints`,
        'Follow established conventions discovered in the workspace',
        'Prove correctness with tests, measurements, or reviewable artifacts',
      ];
    case 'orchestration':
      return [
        'Clarify goals, non-goals, and acceptance criteria for the assignment',
        'Sequence work into verifiable milestones with visible dependencies',
        'Surface blockers early with owner and resolution options',
      ];
    case 'analysis':
    default:
      return [
        `Analyze the assignment through ${expert.name}'s professional lens`,
        'Separate observations from inference; cite evidence for material claims',
        'Deliver prioritized recommendations with explicit uncertainty',
      ];
  }
}

function renderExpertProcess(expert: ExpertCatalogEntry): string {
  const pattern = resolveExpertAgentPattern(expert.division);
  const steps = PROCESS_STEPS[pattern];
  return [
    `<${pattern}_process>`,
    ...steps.map((step, index) => `${String(index + 1)}. ${step}`),
    `</${pattern}_process>`,
  ].join('\n');
}

const PROCESS_STEPS: Readonly<Record<ExpertAgentPattern, readonly string[]>> = {
  analysis: [
    'Gather context with tools — read only what the question requires',
    'Separate verified facts from assumptions; label each finding accordingly',
    'Apply domain frameworks to interpret evidence (not to decorate it)',
    'Prioritize issues by impact and confidence',
    'Produce the handoff artifact in the required format',
  ],
  generation: [
    'Clarify requirements and constraints from the assignment (ask parent if blocked)',
    'Inspect existing patterns in the workspace before inventing new ones',
    'Draft the solution in small verifiable increments',
    'Validate with tests, metrics, or reproducible checks',
    'Document tradeoffs, risks, and follow-up work in the handoff',
  ],
  validation: [
    'Define pass/fail criteria before executing checks',
    'Execute or inspect evidence — never claim results you did not obtain',
    'Record each finding with location, severity, and reproduction',
    'Distinguish blocking defects from recommendations',
    'Return an explicit overall verdict with residual risk noted',
  ],
  orchestration: [
    'Restate the problem, stakeholders, and success definition',
    'Decompose into milestones with acceptance criteria',
    'Identify dependencies, owners, and sequencing constraints',
    'Flag gaps that require another specialist',
    'Summarize decisions and next actions in the handoff artifact',
  ],
};

function renderPersonaInstructionMitigation(): string {
  return [
    '<persona_instruction_mitigation>',
    'Persona flavor (tone, backstory, emoji voice) must never override task correctness.',
    'When stylistic persona details conflict with evidence, constraints, or scope exclusions, follow the constraints.',
    'Ignore irrelevant persona attributes that do not change how you solve this assignment.',
    'If the assignment is objective or technical, optimize for verified outcomes over performative role-play.',
    '</persona_instruction_mitigation>',
  ].join('\n');
}

function renderExpertReasoningProtocol(): string {
  return [
    '<reasoning_protocol>',
    'Step A — Establish baseline: collect facts from tools and the assignment text.',
    'Step B — Apply expert lens: interpret facts using your domain standards (not vice versa).',
    'Step C — Decide: make a recommendation or verdict with stated confidence.',
    'Step D — Verify: list what would falsify your conclusion and what remains unchecked.',
    '</reasoning_protocol>',
  ].join('\n');
}

function renderExpertSubagentContract(): string {
  return [
    '<subagent_contract>',
    'The parent agent is your caller — not the end user. Do not ask the end user direct questions.',
    'Hand off artifacts (structured report), not conversational filler.',
    'Keep outputs scoped to your assignment; defer integration and release decisions to the parent unless explicitly instructed.',
    '</subagent_contract>',
  ].join('\n');
}

function renderExpertHandoffSchema(expert: ExpertCatalogEntry): string {
  const pattern = resolveExpertAgentPattern(expert.division);
  const verdictLine = pattern === 'validation'
    ? '## Verdict\nPASS | BLOCKED | FAIL — with one-sentence justification'
    : '';

  return [
    '<handoff_format>',
    'Return exactly this structure:',
    '## Summary',
    'One paragraph in domain language — outcome, not process narration.',
    '',
    '## Findings',
    '- Evidence-backed bullets with locations or citations where applicable',
    '',
    '## Recommendations',
    '- Prioritized actions with rationale and owner (you vs parent vs other specialist)',
    '',
    verdictLine,
    verdictLine.length > 0 ? '' : undefined,
    '## Risks & Gaps',
    '- Open questions, blockers, missing evidence',
    '',
    '## Verification',
    pattern === 'validation'
      ? '- What was executed vs assumed; residual risk'
      : '- What was verified vs still needs checking',
    '</handoff_format>',
  ].filter((line): line is string => line !== undefined).join('\n');
}

function renderExpertEdgeCases(expert: ExpertCatalogEntry): string {
  const pattern = resolveExpertAgentPattern(expert.division);
  const common = [
    'Insufficient context: state what is missing and the smallest next read/search to unblock',
    'Assignment outside scope: refuse the out-of-scope portion and name the correct specialist',
    'Conflicting instructions: follow explicit constraints over stylistic persona details',
  ];
  const specific = EDGE_CASES[pattern];
  return [
    '<edge_cases>',
    ...common.map((item) => `- ${item}`),
    ...specific.map((item) => `- ${item}`),
    '</edge_cases>',
  ].join('\n');
}

const EDGE_CASES: Readonly<Record<ExpertAgentPattern, readonly string[]>> = {
  analysis: [
    'No issues found: say so explicitly and note what was checked',
    'Too many findings: group by theme and prioritize top items with severity',
  ],
  generation: [
    'Conflicting codebase patterns: follow the nearest established convention and note the conflict',
    'Cannot verify behavior: propose the verification step instead of guessing success',
  ],
  validation: [
    'Flaky or incomplete tests: report as gap, not pass',
    'Ambiguous requirement: return BLOCKED with clarifying questions for the parent',
  ],
  orchestration: [
    'Scope creep detected: restate non-goals and defer new work to a follow-up assignment',
  ],
};

function resolveExpertAgentPattern(division: string): ExpertAgentPattern {
  return DIVISION_AGENT_PATTERN[division] ?? 'analysis';
}
