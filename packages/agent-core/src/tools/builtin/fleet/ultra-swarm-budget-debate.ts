import type { RiskLevel } from '../../../session/ultra-swarm-debate';
import type { UltraSwarmRenderedResult } from './ultra-swarm-phase';

// ── Budget kill + AbortSignal helpers ────────────────────────────────

/**
 * Link a child AbortController to a parent signal so budget kill can abort
 * phase work without mutating the parent tool signal.
 */
export function createLinkedAbortController(parent: AbortSignal): AbortController {
  const child = new AbortController();
  if (parent.aborted) {
    child.abort(parent.reason);
    return child;
  }
  const onAbort = (): void => {
    if (!child.signal.aborted) {
      child.abort(parent.reason);
    }
  };
  parent.addEventListener('abort', onAbort, { once: true });
  // Drop listener when child aborts first (budget kill) so we do not leak.
  child.signal.addEventListener(
    'abort',
    () => {
      parent.removeEventListener('abort', onAbort);
    },
    { once: true },
  );
  return child;
}

/** Visible handoff fragment for budget governor kill (parent + TUI). */
export function formatBudgetKillHandoff(input: {
  readonly reason: string;
  readonly phase: string;
  readonly wastedRounds: number;
  readonly killThreshold: number;
  /**
   * Optional trail of the last few rounds (newest first) so the next session
   * sees which phases were wasted vs productive without re-deriving from state.
   * At most `maxRounds` entries are rendered; defaults to 3.
   */
  readonly lastRounds?: readonly {
    readonly label?: string;
    readonly wasted: boolean;
    readonly evidenceCount: number;
    readonly toolSuccessCount: number;
  }[];
  /** Cap on rendered lastRounds trail length (default 3, hard cap 8). */
  readonly maxRounds?: number;
}): string {
  const reason = input.reason.replaceAll(/"/g, "'");
  const lines: string[] = [
    `<budget_kill reason="${reason}" phase="${input.phase}" ` +
      `wasted_rounds="${String(input.wastedRounds)}" ` +
      `threshold="${String(input.killThreshold)}" />`,
    'Budget governor stopped further UltraSwarm phases after consecutive low-signal rounds.',
    'Do not re-launch UltraSwarm for the same wasted pattern.',
    'Next: close verification gaps, attach requiredEvidence/artifactIds/fileChangeCount signal, integrate accepted handoffs, or re-scope — then re-staff only if the plan changed.',
  ];
  if (input.lastRounds !== undefined && input.lastRounds.length > 0) {
    const cap = Math.max(1, Math.min(input.maxRounds ?? 3, 8));
    const trail = input.lastRounds.slice(-cap).map((round) => {
      const verdict = round.wasted ? 'wasted' : 'productive';
      const label = round.label !== undefined && round.label.length > 0 ? round.label : 'round';
      const signals: string[] = [];
      if (round.evidenceCount > 0) signals.push(`evidence ${String(round.evidenceCount)}`);
      if (round.toolSuccessCount > 0) signals.push(`tools ${String(round.toolSuccessCount)}`);
      const sig = signals.length > 0 ? ` (${signals.join(', ')})` : '';
      return `${label}=${verdict}${sig}`;
    });
    lines.push(`Last rounds: ${trail.join(' → ')}.`);
  }
  return lines.join('\n');
}

// ── Debate risk assessment helpers ────────────────────────────────────

/**
 * phase 결과물의 위험도를 평가하여 debate 깊이를 결정.
 * - implement phase: 파일 수/의존성/증거 수 기준
 * - review phase: 모든 결과에 대해 최소 medium 토론
 * - plan phase: 토론 생략 (이미 plan 승인을 받았으므로)
 */
export function assessDebateRiskForResult(
  result: UltraSwarmRenderedResult,
  phase: string,
): RiskLevel {
  if (phase === 'plan') return 'simple';
  if (phase === 'review') return 'medium'; // review는 항상 토론

  // implement phase: 결과물 길이와 증거 수로 위험도 추정
  const text =
    result.status === 'completed' ? (result.result ?? '') : (result.error ?? '');
  const renderedLength = text.length;
  if (renderedLength > 5000) return 'complex';
  if (renderedLength > 1000) return 'medium';
  return 'simple';
}
