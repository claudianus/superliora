import { ultraSwarmDecision } from '#/agent/plan/ultra-swarm-decision';

interface FieldRequirement {
  readonly label: string;
  readonly aliases: readonly string[];
}

/**
 * Trailing boundary for heading patterns. JS `\b` only recognizes ASCII word
 * characters, which breaks Korean headings (e.g. `## 평가 계획` at end of
 * line). This negative lookahead works for both scripts under the `u` flag.
 */
const UNICODE_WORD_BOUNDARY = '(?![\\p{L}\\p{N}_])';

const WORK_GRAPH_HEADING_ALIASES = ['WorkGraph', '워크그래프', '워크 그래프'] as const;

const ALL_ULTRA_PLAN_FIELD_LABELS = [
  'Seed Spec',
  'AC Tree',
  'WorkGraph',
  'WorkGraph Nodes',
  'Node ID',
  'AC ID',
  'Stage',
  'Owner',
  'Lane',
  'Dependencies',
  'Required Evidence',
  'Ontology',
  'Swarm Decision',
  'Evaluation Plan',
  'Execution Plan',
  'Verifiable UltraGoal',
  'Completion Criterion',
  'Actors',
  'Inputs',
  'Outputs',
  'Constraints',
  'Non-goals',
  'Acceptance Criteria',
  'Verification Plan',
  'Failure Modes',
  'Runtime Context',
  'Decision',
  'Reason',
  'Specialist value',
  'Verification owner',
  'Swarm DEFER waiver',
  'Swarm defer waiver',
  'DEFER waiver',
  // Korean aliases — the response language lock may localize plan headings.
  '시드 사양',
  '시드 스펙',
  'AC 트리',
  'AC트리',
  '인수 기준 트리',
  '워크그래프',
  '워크 그래프',
  '평가 계획',
  '실행 계획',
  '스웜 결정',
  '검증 가능한 목표',
  '검증 가능 목표',
  '완료 기준',
  '참여자',
  '액터',
  '입력',
  '출력',
  '산출물',
  '제약',
  '제약 조건',
  '비목표',
  '비-목표',
  '인수 기준',
  '수용 기준',
  '검증 계획',
  '실패 모드',
  '런타임 컨텍스트',
];

export function missingUltraPlanSections(plan: string): string[] {
  const missing: string[] = [];
  // Heading requirements accept English and Korean aliases; the response
  // language lock may force localized headings in the plan file.
  const requiredHeadingGroups: readonly FieldRequirement[] = [
    { label: 'Seed Spec', aliases: ['Seed Spec', '시드 사양', '시드 스펙'] },
    {
      label: 'AC Tree',
      aliases: ['AC Tree', 'AC 트리', 'AC트리', '인수 기준 트리'],
    },
    { label: 'WorkGraph', aliases: WORK_GRAPH_HEADING_ALIASES },
    { label: 'Evaluation Plan', aliases: ['Evaluation Plan', '평가 계획'] },
    { label: 'Execution Plan', aliases: ['Execution Plan', '실행 계획'] },
  ];
  const fieldRequirements: readonly FieldRequirement[] = [
    {
      label: 'Verifiable UltraGoal',
      aliases: ['Verifiable UltraGoal', '검증 가능한 목표', '검증 가능 목표'],
    },
    { label: 'Completion Criterion', aliases: ['Completion Criterion', '완료 기준'] },
    { label: 'Actors', aliases: ['Actors', '참여자', '액터'] },
    { label: 'Inputs', aliases: ['Inputs', '입력'] },
    { label: 'Outputs', aliases: ['Outputs', '출력', '산출물'] },
    { label: 'Constraints', aliases: ['Constraints', '제약', '제약 조건'] },
    { label: 'Non-goals', aliases: ['Non-goals', 'Non goals', '비목표', '비-목표'] },
    {
      label: 'Acceptance Criteria',
      aliases: ['Acceptance Criteria', '인수 기준', '수용 기준'],
    },
    { label: 'Verification Plan', aliases: ['Verification Plan', '검증 계획'] },
    { label: 'Failure Modes', aliases: ['Failure Modes', '실패 모드'] },
    { label: 'Runtime Context', aliases: ['Runtime Context', '런타임 컨텍스트'] },
  ];

  for (const group of requiredHeadingGroups) {
    if (!group.aliases.some((alias) => hasHeading(plan, alias))) missing.push(group.label);
  }
  if (
    !hasHeading(plan, 'Swarm Decision') &&
    !hasHeading(plan, '스웜 결정') &&
    !hasSwarmDecisionLine(plan)
  ) {
    missing.push('Swarm Decision');
  }
  for (const requirement of fieldRequirements) {
    if (!hasFieldContent(plan, requirement.aliases)) missing.push(requirement.label);
  }
  if (!hasSwarmDecisionLine(plan)) missing.push('Swarm decision audit line');
  if (!hasSwarmDecisionField(plan, 'Decision')) missing.push('Decision');
  if (!hasSwarmDecisionField(plan, 'Reason')) missing.push('Reason');
  if (!hasSwarmDecisionField(plan, 'Specialist value')) missing.push('Specialist value');
  if (!hasSwarmDecisionField(plan, 'Verification owner')) missing.push('Verification owner');
  if (ultraSwarmDecision(plan) === 'DEFER' && !hasSwarmDeferWaiver(plan)) {
    missing.push('Swarm DEFER waiver');
  }
  missing.push(...missingWorkGraphRequirements(plan));
  return missing;
}

/**
 * Verify that the approved plan covers the five Seed Spec sections:
 * Goal, Constraints, Acceptance (Criteria), Ontology, and Evaluation.
 * This is a second-layer guard applied after drift validation succeeds.
 */
export function enforceSeedCoverage(plan: string): string[] {
  const missing: string[] = [];
  const seedSections: readonly { readonly name: string; readonly aliases: readonly string[] }[] = [
    {
      name: 'Goal',
      aliases: ['Verifiable UltraGoal', 'Goal / UltraGoal', 'UltraGoal', '검증 가능한 목표', '검증 가능 목표'],
    },
    { name: 'Constraints', aliases: ['Constraints', '제약', '제약 조건'] },
    { name: 'Acceptance', aliases: ['Acceptance Criteria', '인수 기준', '수용 기준'] },
    { name: 'Ontology', aliases: ['Ontology', 'WorkGraph', 'AC Tree', '워크그래프', 'AC 트리', 'AC트리'] },
    { name: 'Evaluation', aliases: ['Evaluation Plan', 'Evaluation', '평가 계획'] },
  ];
  for (const section of seedSections) {
    if (!section.aliases.some((alias) => hasFieldContent(plan, [alias]))) {
      missing.push(`Missing section: ${section.name}`);
    }
  }
  return missing;
}

function missingWorkGraphRequirements(plan: string): string[] {
  const section = WORK_GRAPH_HEADING_ALIASES.map((alias) => headingSection(plan, alias)).find(
    (text) => text.length > 0,
  );
  if (section === undefined) return [];
  const requirements: readonly { readonly label: string; readonly pattern: RegExp }[] = [
    {
      label: 'WorkGraph node id',
      pattern: workGraphFieldPattern('node\\s*id|node|id|노드\\s*id|노드'),
    },
    {
      label: 'WorkGraph AC id',
      pattern: workGraphFieldPattern(
        'ac(?:\\s*id)?|acceptance\\s+criterion(?:\\s+id)?|acceptanceCriterionId|인수\\s*기준(?:\\s*id)?',
      ),
    },
    { label: 'WorkGraph stage', pattern: workGraphFieldPattern('stage|단계') },
    {
      label: 'WorkGraph owner/lane',
      pattern: workGraphFieldPattern('owner|lane|owner\\s*/\\s*lane|소유자|담당'),
    },
    {
      label: 'WorkGraph dependencies',
      pattern: workGraphFieldPattern('dependencies|dependency|dependsOn|depends\\s+on|의존|의존성'),
    },
    {
      label: 'WorkGraph required evidence',
      pattern: workGraphFieldPattern(
        'required\\s+evidence|requiredEvidence|required_evidence|evidence\\s+required|필요\\s*증거|요구\\s*증거|필수\\s*증거',
      ),
    },
  ];
  return requirements
    .filter((requirement) => !requirement.pattern.test(section))
    .map((requirement) => requirement.label);
}

/**
 * Unicode-aware word boundary for alternations that may contain Korean
 * labels: JS `\b` only sees ASCII word characters, so Korean alternatives
 * would never match at a `\b` edge.
 */
function workGraphFieldPattern(alternation: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${alternation})(?![\\p{L}\\p{N}_])`,
    'iu',
  );
}

function headingSection(plan: string, heading: string): string {
  const lines = plan.split(/\r?\n/);
  const headingPattern = new RegExp(
    `^\\s*#{2,}\\s+${escapeRegExp(heading)}${UNICODE_WORD_BOUNDARY}`,
    'iu',
  );
  let start = -1;
  for (let index = 0; index < lines.length; index++) {
    if (headingPattern.test(lines[index] ?? '')) {
      start = index + 1;
      break;
    }
  }
  if (start === -1) return '';
  const section: string[] = [];
  for (let index = start; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (/^\s*#{2,}\s+\S/.test(line)) break;
    section.push(line);
  }
  return section.join('\n');
}

function hasHeading(plan: string, heading: string): boolean {
  return new RegExp(`^\\s*#{2,}\\s+${escapeRegExp(heading)}${UNICODE_WORD_BOUNDARY}`, 'imu').test(
    plan,
  );
}

function hasFieldContent(plan: string, labels: readonly string[]): boolean {
  const lines = plan.split(/\r?\n/);
  const labelPattern = fieldLabelPattern(labels);
  const anyFieldPattern = fieldLabelPattern(ALL_ULTRA_PLAN_FIELD_LABELS);
  const headingPattern = headingLabelPattern(labels);
  const anyHeadingPattern = headingLabelPattern(ALL_ULTRA_PLAN_FIELD_LABELS);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const match = labelPattern.exec(line);
    if (match === null) continue;
    if ((match.groups?.['value'] ?? '').trim().length > 0) return true;
    if (hasFollowingFieldContent(lines, index, anyFieldPattern, anyHeadingPattern)) return true;
  }
  for (let index = 0; index < lines.length; index++) {
    if (!headingPattern.test(lines[index] ?? '')) continue;
    if (hasFollowingFieldContent(lines, index, anyFieldPattern, anyHeadingPattern)) return true;
  }
  return false;
}

function hasSwarmDecisionLine(plan: string): boolean {
  return /\bswarm decision\s*:\s*(?:ENGAGE|ADAPTIVE|DEFER)\b/i.test(plan);
}

function hasSwarmDeferWaiver(plan: string): boolean {
  return (
    hasMeaningfulFieldContent(plan, ['Swarm DEFER waiver', 'Swarm defer waiver', 'DEFER waiver']) ||
    hasMeaningfulHeadingContent(plan, ['Swarm DEFER Waiver', 'Swarm defer waiver', 'DEFER waiver'])
  );
}

function hasMeaningfulFieldContent(plan: string, labels: readonly string[]): boolean {
  const lines = plan.split(/\r?\n/);
  const labelPattern = fieldLabelPattern(labels);
  const anyFieldPattern = fieldLabelPattern(ALL_ULTRA_PLAN_FIELD_LABELS);
  const anyHeadingPattern = headingLabelPattern(ALL_ULTRA_PLAN_FIELD_LABELS);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const match = labelPattern.exec(line);
    if (match === null) continue;
    const inline = (match.groups?.['value'] ?? '').trim();
    if (isMeaningfulWaiverText(inline)) return true;
    const following = followingFieldContent(lines, index, anyFieldPattern, anyHeadingPattern);
    if (isMeaningfulWaiverText(following)) return true;
  }
  return false;
}

function hasMeaningfulHeadingContent(plan: string, headings: readonly string[]): boolean {
  const lines = plan.split(/\r?\n/);
  const headingPattern = headingLabelPattern(headings);
  const anyFieldPattern = fieldLabelPattern(ALL_ULTRA_PLAN_FIELD_LABELS);
  const anyHeadingPattern = headingLabelPattern(ALL_ULTRA_PLAN_FIELD_LABELS);
  for (let index = 0; index < lines.length; index++) {
    if (!headingPattern.test(lines[index] ?? '')) continue;
    const following = followingFieldContent(lines, index, anyFieldPattern, anyHeadingPattern);
    if (isMeaningfulWaiverText(following)) return true;
  }
  return false;
}

function followingFieldContent(
  lines: readonly string[],
  startIndex: number,
  anyFieldPattern: RegExp,
  anyHeadingPattern: RegExp,
): string | undefined {
  for (let next = startIndex + 1; next < lines.length; next++) {
    const line = lines[next] ?? '';
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (anyFieldPattern.test(line) || anyHeadingPattern.test(line)) break;
    return trimmed;
  }
  return undefined;
}

function isMeaningfulWaiverText(value: string | undefined): boolean {
  if (value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed.length < 12) return false;
  return !/^(?:none|n\/a|na|not applicable|not needed|no|없음|불필요|해당 없음)[.。!！\s]*$/i.test(
    trimmed,
  );
}

function hasSwarmDecisionField(plan: string, label: string): boolean {
  if (hasFieldContent(plan, [label])) return true;
  switch (label) {
    case 'Decision':
      return /\bswarm decision\s*:\s*(?:ENGAGE|ADAPTIVE|DEFER)\b/i.test(plan);
    case 'Reason':
      return /\bswarm decision\s*:\s*(?:ENGAGE|ADAPTIVE|DEFER)\s*(?:[.:\-—]\s*\S|.*\breason\s*:)/i.test(plan);
    case 'Specialist value':
      return /\bvalue\s*:\s*\S/i.test(plan);
    case 'Verification owner':
      return /\bowner\s*:\s*\S/i.test(plan);
    default:
      return false;
  }
}

function hasFollowingFieldContent(
  lines: readonly string[],
  startIndex: number,
  anyFieldPattern: RegExp,
  anyHeadingPattern: RegExp,
): boolean {
  for (let next = startIndex + 1; next < lines.length; next++) {
    const line = lines[next] ?? '';
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (anyFieldPattern.test(line) || anyHeadingPattern.test(line)) break;
    return true;
  }
  return false;
}

function fieldLabelPattern(labels: readonly string[]): RegExp {
  const labelAlternation = labels.map(escapeRegExp).join('|');
  return new RegExp(
    `^\\s*(?:[-*+•]|\\d+[.)])?\\s*(?:\\*\\*)?(?:${labelAlternation})(?:\\*\\*)?\\s*:\\s*(?<value>.*)$`,
    'i',
  );
}

function headingLabelPattern(labels: readonly string[]): RegExp {
  const labelAlternation = labels.map(escapeRegExp).join('|');
  return new RegExp(
    `^\\s*#{2,}\\s+(?:${labelAlternation})${UNICODE_WORD_BOUNDARY}`,
    'iu',
  );
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
