import type { Agent } from '../agent';

import type {
  DebateParticipant,
  DebatePhase,
  DebateState,
  DebateTurn,
} from './ultra-swarm-debate';
import {
  PHASE_ORDER,
  addDebateTurn,
  buildDebateContext,
  emitDebateTurn,
  stanceForPhase,
} from './ultra-swarm-debate';

export type RiskLevel = 'simple' | 'medium' | 'complex';

export interface RiskAssessmentInput {
  readonly nodeTitle: string;
  readonly nodeDependsOnCount: number;
  readonly nodeRequiredEvidenceCount: number;
  readonly estimatedFileCount?: number;
}

/**
 * Assess the risk level of a work node to determine debate depth.
 *
 * Heuristic only (not an LLM judge). Tuned for cheap escalation:
 * - simple: no/low deps, few files, light evidence → skip heavy debate
 * - medium: some deps or several files → critic + rebuttal + consensus
 * - complex: many deps/files/evidence → full 4-phase debate
 *
 * Thresholds:
 * - complex if dependsOn >= 5 OR files >= 10 OR requiredEvidence >= 5
 * - medium if dependsOn >= 1 OR files >= 3 OR requiredEvidence >= 3
 * - else simple
 */
export function assessRisk(input: RiskAssessmentInput): RiskLevel {
  const fileCount = input.estimatedFileCount ?? 0;
  const depCount = input.nodeDependsOnCount;
  const evidenceCount = input.nodeRequiredEvidenceCount;

  if (depCount >= 5 || fileCount >= 10 || evidenceCount >= 5) return 'complex';
  if (depCount >= 1 || fileCount >= 3 || evidenceCount >= 3) return 'medium';
  return 'simple';
}

/**
 * Determine which debate phases to run based on risk level.
 * `simple` skips heavy debate (empty phases) — callers may still run a
 * checklist review outside the debate module.
 */
export function debatePhasesForRisk(risk: RiskLevel): readonly DebatePhase[] {
  switch (risk) {
    case 'simple':
      // Skip multi-turn debate for trivial work.
      return [];
    case 'medium':
      // 2-round design + consensus
      return ['critic', 'rebuttal', 'consensus'];
    case 'complex':
      // Full 4-phase
      return ['critic', 'rebuttal', 'counter-critique', 'consensus'];
  }
}

// ── Consensus → WorkGraph mapping ─────────────────────────────────────

export type ConsensusVerdict = 'approve' | 'revise' | 'block';

export interface ConsensusResult {
  readonly verdict: ConsensusVerdict;
  readonly text: string;
  readonly revisionNotes?: string;
}

/**
 * Parse a consensus text into a structured verdict.
 * Case-insensitive; accepts English and common Korean VERDICT variants.
 */
export function parseConsensusVerdict(text: string): ConsensusResult {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();
  // Strip optional "VERDICT:" / "판정:" prefixes and leading punctuation.
  const stripped = lower
    .replace(/^\s*(?:verdict|판정|결론)\s*[:：\-–—]?\s*/i, '')
    .replace(/^\s*[*`"'«»]+/, '')
    .trim();
  const head = stripped.length > 0 ? stripped : lower;

  if (
    /^(?:strong[-_\s]?)?approve\b/.test(head) ||
    /^(?:pass|approved|lgtm)\b/.test(head) ||
    /^(?:승인|통과|합의|찬성)\b/.test(head) ||
    head.startsWith('승인') ||
    head.startsWith('통과')
  ) {
    return { verdict: 'approve', text: normalized };
  }
  if (
    /^(?:block|reject|blocked|fail|failed)\b/.test(head) ||
    /^(?:차단|거절|반려|실패|불가)\b/.test(head) ||
    head.startsWith('차단') ||
    head.startsWith('반려')
  ) {
    return { verdict: 'block', text: normalized };
  }
  if (
    /^(?:revise|revision|needs?\s*revision|needs?\s*work)\b/.test(head) ||
    /^(?:수정|보완|재작업|개선\s*필요)/.test(head)
  ) {
    return { verdict: 'revise', text: normalized, revisionNotes: normalized };
  }

  // Embedded verdict tokens (e.g. "Final: APPROVE — looks good")
  if (/\b(?:strong[-_\s]?)?approve\b|\bpass\b|승인|통과/.test(lower) && !/\brevise\b|\bblock\b|수정|차단/.test(lower)) {
    return { verdict: 'approve', text: normalized };
  }
  if (/\b(?:block|reject|fail)\b|차단|반려|실패/.test(lower) && !/\brevise\b|수정/.test(lower)) {
    return { verdict: 'block', text: normalized };
  }

  // Everything else is "needs revision"
  return { verdict: 'revise', text: normalized, revisionNotes: normalized };
}

// ── Debate cycle runner ──────────────────────────────────────────────

export interface DebateParticipant {
  readonly expertId: string;
  readonly expertName: string;
  /** LLM generate function (from agent.generate or rawGenerate) */
  readonly generate: (prompt: string, options?: { signal?: AbortSignal }) => Promise<string>;
}

export interface RunDebateCycleOptions {
  readonly debate: DebateState;
  readonly critic: DebateParticipant;
  readonly author: DebateParticipant;
  readonly runId: string;
  readonly parent: Agent;
  readonly phases: readonly DebatePhase[];
  readonly signal?: AbortSignal;
}

/**
 * Run a complete debate cycle: iterate through the specified phases,
 * calling the appropriate participant for each turn.
 * Emits debate events to the TUI for real-time streaming.
 * Returns the final debate state with consensus verdict.
 */
export async function runDebateCycle(
  options: RunDebateCycleOptions,
): Promise<DebateState> {
  let state = options.debate;
  // Empty phases (simple risk) means skip debate entirely.
  if (options.phases.length === 0) {
    return {
      ...state,
      finished: true,
      consensusVerdict: state.consensusVerdict ?? 'approve: skipped debate (simple risk)',
    };
  }
  const phases = options.phases.length > 0 ? options.phases : PHASE_ORDER;
  const draftExcerpt = state.config.artifactSummary;

  for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
    const phase = phases[phaseIndex]!;
    // Force the debate state to the current phase (handles custom phase
    // subsets like simple risk skipping rebuttal/counter-critique).
    state = { ...state, currentPhase: phase };
    // Determine who speaks in this phase
    const turns = determinePhaseTurns(phase, options.critic, options.author, state);

    for (const turnInput of turns) {
      if (state.finished) break;

      // Emit "thinking" placeholder event
      emitDebateTurn(options.parent, options.runId, {
        debateId: state.debateId,
        workNodeId: state.workNodeId,
        phase,
        expertId: turnInput.participant.expertId,
        expertName: turnInput.participant.expertName,
        text: '',
        stance: stanceForPhase(phase, turnInput.isCritic),
      });

      // Build context with prior turns + steering + draft excerpt to cite
      const context = buildDebateContext(state, turnInput.participant.expertId, {
        draftExcerpt,
      });
      const prompt = `${context}\n\n${turnInput.instruction}`;

      // Call the participant's LLM
      const response = await turnInput.participant.generate(prompt, {
        signal: options.signal,
      });

      // Create and emit the actual turn
      const turn: DebateTurn = {
        debateId: state.debateId,
        workNodeId: state.workNodeId,
        phase,
        expertId: turnInput.participant.expertId,
        expertName: turnInput.participant.expertName,
        text: response,
        stance: stanceForPhase(phase, turnInput.isCritic),
      };
      emitDebateTurn(options.parent, options.runId, turn);
      state = addDebateTurn(state, turn);
    }
  }

  return state;
}

interface PhaseTurnInput {
  readonly participant: DebateParticipant;
  readonly isCritic: boolean;
  readonly instruction: string;
}

function determinePhaseTurns(
  phase: DebatePhase,
  critic: DebateParticipant,
  author: DebateParticipant,
  _state: DebateState,
): readonly PhaseTurnInput[] {
  switch (phase) {
    case 'critic':
      // Author proposes, critic critiques
      return [
        {
          participant: author,
          isCritic: false,
          instruction:
            'Propose your approach for this work node. Describe the implementation plan, key decisions, and potential risks. Be concise but specific.',
        },
        {
          participant: critic,
          isCritic: true,
          instruction:
            'Review the proposed approach critically. Identify concrete defects, gaps, edge cases, and risks. Be adversarial and specific. Do not rubber-stamp.',
        },
      ];
    case 'rebuttal':
      // Author defends, critic challenges
      return [
        {
          participant: author,
          isCritic: false,
          instruction:
            'Address each point raised by the critic. Defend your approach or acknowledge valid concerns and propose mitigations. Cite evidence.',
        },
        {
          participant: critic,
          isCritic: true,
          instruction:
            'Challenge the author\'s rebuttal. Are the defenses valid? Probe deeper for remaining gaps.',
        },
      ];
    case 'counter-critique':
      // Critic challenges again, author responds
      return [
        {
          participant: critic,
          isCritic: true,
          instruction:
            'Deliver your final critique. What remains unresolved? What is the risk of proceeding?',
        },
        {
          participant: author,
          isCritic: false,
          instruction:
            'Respond to the final critique. Acknowledge risks and commit to specific mitigations if proceeding.',
        },
      ];
    case 'consensus':
      // Both converge
      return [
        {
          participant: critic,
          isCritic: true,
          instruction:
            'Issue your final verdict. Start with "approve", "revise", or "block", followed by a one-line summary. Be decisive.',
        },
      ];
    default:
      return [];
  }
}