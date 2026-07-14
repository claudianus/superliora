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

/**
 * Persona bodies from open-source catalogs are often multi-k essays.
 * Keep only the first high-signal slice in the model prompt; the structured
 * persona_spec / handoff blocks already carry role, constraints, and outputs.
 */
const PERSONA_TEXT_MAX_CHARS = 4_000;

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
  const slice = trimmed.slice(0, PERSONA_TEXT_MAX_CHARS);
  const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'));
  const cut = breakAt > PERSONA_TEXT_MAX_CHARS * 0.6 ? slice.slice(0, breakAt) : slice;
  return `${cut.trimEnd()}\n…`;
}

export function renderExpertSystemPrompt(
  basePrompt: string,
  expert: ExpertCatalogEntry,
  baseProfileName: string,
): string {
  void baseProfileName;
  const enriched = enrichExpertForCatalog(expert);
  return [
    basePrompt,
    '',
    renderExpertRoleDeclaration(enriched),
    '',
    renderPersonaAsCodeSpec(enriched),
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
  ].filter((line) => line.length > 0).join('\n');
}

export function buildExpertSwarmExecutionFooter(expertName: string): string {
  return [
    '<execution_discipline>',
    `Apply ${expertName} standards. Orient with targeted search before broad reads; stay in assignment scope.`,
    'Within first two tool calls, create a live scope board (3–7 items); update after major batches; mark done only after verification.',
    'SearchSkill → Skill only when a domain workflow clearly helps; apply selectively.',
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
    default:
      return [
        `Analyze the assignment through ${expert.name}'s professional lens`,
        'Separate observations from inference; cite evidence for material claims',
        'Deliver prioritized recommendations with explicit uncertainty',
      ];
  }
}


function renderPersonaInstructionMitigation(): string {
  return [
    '<persona_instruction_mitigation>',
    'Persona flavor never overrides correctness, evidence, or scope exclusions. Ignore irrelevant role-play details.',
    '</persona_instruction_mitigation>',
  ].join('\n');
}

function renderExpertReasoningProtocol(): string {
  return [
    '<reasoning_protocol>',
    'Facts first from tools/assignment → apply domain standards → decide with confidence → state what remains unchecked.',
    '</reasoning_protocol>',
  ].join('\n');
}

function renderExpertSubagentContract(): string {
  return [
    '<subagent_contract>',
    'Parent agent is your caller — not the end user. Hand off a structured artifact, stay in scope, and leave integration decisions to the parent unless asked.',
    '</subagent_contract>',
  ].join('\n');
}

function renderExpertHandoffSchema(expert: ExpertCatalogEntry): string {
  const pattern = resolveExpertAgentPattern(expert.division);
  const verdictLine =
    pattern === 'validation' ? '## Verdict\nPASS | BLOCKED | FAIL — one-sentence justification' : undefined;

  return [
    '<handoff_format>',
    'Return exactly:',
    '## Summary',
    'One paragraph — outcome, not process.',
    '',
    '## Findings',
    '- Evidence-backed bullets with locations/citations',
    '',
    '## Recommendations',
    '- Prioritized actions with owner (you/parent/other specialist)',
    '',
    verdictLine,
    verdictLine === undefined ? undefined : '',
    '## Risks & Gaps',
    '- Blockers, missing evidence, open questions',
    '',
    '## Verification',
    pattern === 'validation'
      ? '- Executed vs assumed; residual risk'
      : '- Verified vs still unchecked',
    '</handoff_format>',
  ].filter((line): line is string => line !== undefined).join('\n');
}


function resolveExpertAgentPattern(division: string): ExpertAgentPattern {
  return DIVISION_AGENT_PATTERN[division] ?? 'analysis';
}
