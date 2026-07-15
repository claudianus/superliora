/** Ultrawork capability coverage matrix heuristics. */

import { ULTRAWORK_VISUAL_SURFACE_PATTERN } from './ultrawork-contract';

export interface UltraworkCoverageLane {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
  readonly evidenceNeeded: readonly string[];
  readonly owner: string;
}

export function buildUltraworkCoverageMatrix(objective: string): readonly UltraworkCoverageLane[] {
  const lanes: UltraworkCoverageLane[] = [];
  const addLane = (lane: UltraworkCoverageLane): void => {
    if (lanes.some((entry) => entry.id === lane.id)) return;
    lanes.push(lane);
  };

  addLane({
    id: 'product_requirements',
    label: 'Product / requirements',
    reason: 'The UltraGoal needs explicit scope, non-goals, acceptance criteria, and user-visible completion criteria.',
    evidenceNeeded: ['UltraGoal seed', 'AC Tree', 'Acceptance Criteria', 'non-goals'],
    owner: 'main integration owner',
  });

  if (matchesAny(objective, [
    /\b(?:build|ship|implement|create|make|develop|refactor|integrate|app|game|website|api|ui|cli)\b/iu,
    /(?:구현|개발|제작|만들|완성|통합|앱|게임|웹|화면|도구|기능)/u,
  ])) {
    addLane({
      id: 'architecture_implementation',
      label: 'Architecture / implementation',
      reason: 'The work changes or creates executable behavior that needs a concrete implementation plan.',
      evidenceNeeded: ['affected files', 'implementation plan', 'focused tests or runnable checks'],
      owner: 'implementation owner',
    });
  }

  if (matchesAny(objective, [
    /\b(?:game|galaga|airplane|simulation|finance|legal|medical|health|data|ml|ai|security|payment|auth)\b/iu,
    /(?:게임|갤러그|비행기|시뮬레이션|금융|법률|의료|건강|데이터|보안|결제|인증)/u,
  ])) {
    addLane({
      id: 'domain_subject_matter',
      label: 'Domain subject matter',
      reason: 'The goal depends on domain-specific rules, terminology, or quality expectations.',
      evidenceNeeded: ['domain assumptions', 'source or observed behavior references', 'domain review verdict'],
      owner: 'domain specialist',
    });
  }

  if (ULTRAWORK_VISUAL_SURFACE_PATTERN.test(objective)) {
    addLane({
      id: 'ux_visual_content',
      label: 'UX / visual / content craft',
      reason: 'The result has a visible or subjective quality bar that cannot be proven by code inspection alone.',
      evidenceNeeded: ['screenshot or recording', 'visual target', 'reviewer verdict'],
      owner: 'UX or visual reviewer',
    });
  }

  if (matchesAny(objective, [
    /\b(?:auth|oauth|login|permission|security|privacy|secret|token|payment|compliance|legal)\b/iu,
    /(?:로그인|권한|보안|개인정보|비밀|토큰|결제|컴플라이언스|법률)/u,
  ])) {
    addLane({
      id: 'security_privacy',
      label: 'Security / privacy',
      reason: 'The work may affect credentials, permissions, privacy, payment, or compliance behavior.',
      evidenceNeeded: ['threat or privacy notes', 'secret scan', 'negative tests or permission proof'],
      owner: 'security reviewer',
    });
  }

  if (matchesAny(objective, [
    /\b(?:performance|latency|scale|throughput|reliability|realtime|real-time|benchmark)\b/iu,
    /(?:성능|지연|확장|처리량|안정성|실시간|벤치마크)/u,
  ])) {
    addLane({
      id: 'performance_reliability',
      label: 'Performance / reliability',
      reason: 'The goal includes runtime quality, stability, or performance expectations.',
      evidenceNeeded: ['benchmark or timing evidence', 'failure mode notes', 'bounded retry behavior'],
      owner: 'performance reviewer',
    });
  }

  if (matchesAny(objective, [
    /\b(?:accessibility|a11y|i18n|localization|translation|korean|english|mobile|responsive)\b/iu,
    /(?:접근성|다국어|번역|한국어|영어|모바일|반응형)/u,
  ])) {
    addLane({
      id: 'accessibility_i18n',
      label: 'Accessibility / internationalization',
      reason: 'The result may need language, accessibility, viewport, or localization checks.',
      evidenceNeeded: ['keyboard/screen-reader notes when applicable', 'language copy review', 'responsive evidence'],
      owner: 'accessibility or localization reviewer',
    });
  }

  addLane({
    id: 'testing_evidence',
    label: 'Testing / evidence',
    reason: 'Completion must be backed by mechanical checks or explicit runtime evidence.',
    evidenceNeeded: ['test output', 'typecheck/lint/build status', 'runtime observation path'],
    owner: 'verification owner',
  });

  addLane({
    id: 'integration_ownership',
    label: 'Integration ownership',
    reason: 'Specialist feedback must be merged into one coherent implementation and final verdict.',
    evidenceNeeded: ['integration notes', 'conflict resolution', 'final PASS/BLOCKED rationale'],
    owner: 'main integration owner',
  });

  if (
    lanes.length > 4
    || matchesAny(objective, [
      /\b(?:review|director|approve|confirm|visual|quality|premium|polish|full version|full-version)\b/iu,
      /(?:검수|리뷰|디렉터|컨펌|승인|품질|프리미엄|풀버전|완성도)/u,
    ])
  ) {
    addLane({
      id: 'independent_review_loop',
      label: 'Independent review loop',
      reason: 'At least one acceptance criterion requires an independent verdict before completion.',
      evidenceNeeded: ['review prompt', 'review verdict', 'fix-and-review iteration notes until PASS or explicit BLOCKED'],
      owner: 'independent reviewer',
    });
  }

  return lanes;
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

