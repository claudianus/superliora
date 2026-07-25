/**
 * Ultra Swarm Debate: structured adversarial critique between swarm experts,
 * streamed live to the TUI. Each work node gets a 4-phase debate cycle:
 *
 *   1. critic       — identify gaps, defects, edge cases
 *   2. rebuttal      — author defends against the critique
 *   3. counter-critique — critic challenges the rebuttal
 *   4. consensus     — both sides converge on a verdict
 *
 * Inspired by real development team code review rituals. Events are emitted as
 * `ultrawork.collaboration.debate` and rendered in the TUI theatre panel.
 *
 * User steering: `/steer <message>` injects a `ultrawork.collaboration.steer`
 * event, which the debate participants pick up in their next turn.
 */

import { randomUUID } from 'node:crypto';

import type { Agent } from '../agent';
import type {
  UltraworkCollaborationDebateEvent,
  UltraworkCollaborationSteerEvent,
} from '@superliora/protocol';

export type DebatePhase = 'critic' | 'rebuttal' | 'counter-critique' | 'consensus';

export interface DebateTurn {
  readonly debateId: string;
  readonly workNodeId: string;
  readonly phase: DebatePhase;
  readonly expertId: string;
  readonly expertName: string;
  readonly text: string;
  readonly stance: 'support' | 'oppose' | 'neutral';
  readonly parentId?: string;
}

export interface DebateConfig {
  readonly workNodeId: string;
  readonly criticExpertId: string;
  readonly criticExpertName: string;
  readonly authorExpertId: string;
  readonly authorExpertName: string;
  readonly artifactSummary: string;
}

export interface DebateState {
  readonly debateId: string;
  readonly workNodeId: string;
  readonly config: DebateConfig;
  readonly turns: readonly DebateTurn[];
  readonly currentPhase: DebatePhase;
  readonly finished: boolean;
  readonly consensusVerdict?: string;
  readonly steeringMessages: readonly string[];
}

const PHASE_ORDER: readonly DebatePhase[] = ['critic', 'rebuttal', 'counter-critique', 'consensus'];

/**
 * Create a new debate state for a work node.
 */
export function createDebate(config: DebateConfig): DebateState {
  return {
    debateId: randomUUID(),
    workNodeId: config.workNodeId,
    config,
    turns: [],
    currentPhase: 'critic',
    finished: false,
    steeringMessages: [],
  };
}

/**
 * Emit a debate turn event to the TUI via the parent agent.
 */
export function emitDebateTurn(parent: Agent, runId: string, turn: DebateTurn): void {
  const event: UltraworkCollaborationDebateEvent = {
    type: 'ultrawork.collaboration.debate',
    runId,
    debateId: turn.debateId,
    workNodeId: turn.workNodeId,
    phase: turn.phase,
    expertId: turn.expertId,
    expertName: turn.expertName,
    text: turn.text,
    stance: turn.stance,
    parentId: turn.parentId,
  };
  parent.emitEvent(event);
}

/**
 * Emit a user steering message to the debate.
 */
export function emitDebateSteer(
  parent: Agent,
  runId: string,
  debateId: string,
  text: string,
): void {
  const event: UltraworkCollaborationSteerEvent = {
    type: 'ultrawork.collaboration.steer',
    runId,
    debateId,
    text,
    fromUser: true,
  };
  parent.emitEvent(event);
}

/**
 * Advance the debate by adding a turn. Automatically progresses the phase.
 * Returns the updated debate state.
 */
export function addDebateTurn(state: DebateState, turn: DebateTurn): DebateState {
  if (state.finished) return state;

  const turns = [...state.turns, turn];
  const nextPhaseIndex = PHASE_ORDER.indexOf(state.currentPhase) + 1;

  // Consensus phase ends the debate
  if (state.currentPhase === 'consensus') {
    return {
      ...state,
      turns,
      finished: true,
      consensusVerdict: turn.text,
    };
  }

  // Stay in the same phase until both participants have spoken, then advance
  const phaseTurns = turns.filter((t) => t.phase === state.currentPhase);
  const phaseComplete = phaseTurns.length >= 2;

  return {
    ...state,
    turns,
    currentPhase: phaseComplete
      ? (PHASE_ORDER[nextPhaseIndex] ?? 'consensus')
      : state.currentPhase,
  };
}

/**
 * Inject a user steering message into the debate. The message is stored and
 * participants will see it in their next turn context.
 */
export function injectSteering(state: DebateState, message: string): DebateState {
  return {
    ...state,
    steeringMessages: [...state.steeringMessages, message],
  };
}

export interface BuildDebateContextOptions {
  /**
   * Optional excerpt of the attached draft (diff, design paragraph, failure log).
   * Multiagent-debate style: participants must cite this text, not only stance.
   */
  readonly draftExcerpt?: string;
}

/**
 * Build the prompt context for a debate participant, showing prior turns
 * and any user steering messages.
 */
export function buildDebateContext(
  state: DebateState,
  participantId: string,
  options: BuildDebateContextOptions = {},
): string {
  const priorTurns = state.turns
    .map((turn) => {
      const speaker = turn.expertName;
      const stance = turn.stance;
      return `[${turn.phase}] ${speaker} (${stance}): ${turn.text}`;
    })
    .join('\n\n');

  const steering = state.steeringMessages.length > 0
    ? '\n\n## User Steering\n\n' +
      state.steeringMessages.map((msg) => `- ${msg}`).join('\n')
    : '';

  const draftExcerpt = resolveDraftExcerpt(state, options.draftExcerpt);
  const phaseInstructions = debatePhasePrompt(state.currentPhase, participantId, state.config, {
    hasDraft: draftExcerpt !== undefined,
  });

  return [
    `<debate id="${state.debateId}" work_node="${state.workNodeId}">`,
    `<artifact>${state.config.artifactSummary}</artifact>`,
    draftExcerpt !== undefined
      ? `<draft_excerpt>\n${draftExcerpt}\n</draft_excerpt>`
      : '',
    `<current_phase>${state.currentPhase}</current_phase>`,
    phaseInstructions,
    priorTurns ? `<prior_turns>\n${priorTurns}\n</prior_turns>` : '',
    steering,
    '</debate>',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

function resolveDraftExcerpt(
  state: DebateState,
  explicit?: string,
): string | undefined {
  const fromOption = explicit?.trim();
  if (fromOption !== undefined && fromOption.length > 0) return fromOption;
  const fromArtifact = state.config.artifactSummary.trim();
  return fromArtifact.length > 0 ? fromArtifact : undefined;
}

function debatePhasePrompt(
  phase: DebatePhase,
  participantId: string,
  config: DebateConfig,
  options: { readonly hasDraft?: boolean } = {},
): string {
  const isCritic = participantId === config.criticExpertId;
  const citeDraft = options.hasDraft === true
    ? ' Cite specific lines or claims from the attached <draft_excerpt> (or artifact) — do not argue only from stance.'
    : '';

  switch (phase) {
    case 'critic':
      return isCritic
        ? `<instruction>As critic, identify concrete defects, gaps, and edge cases in the artifact.${citeDraft} Be adversarial and specific.</instruction>`
        : '<instruction>As author, wait for the critic to finish before responding.</instruction>';
    case 'rebuttal':
      return isCritic
        ? '<instruction>Wait for the author to respond to your critique.</instruction>'
        : `<instruction>As author, defend your work against the critic's points. Address each concrete gap. Cite evidence.${citeDraft}</instruction>`;
    case 'counter-critique':
      return isCritic
        ? `<instruction>As critic, challenge the author's rebuttal. Are the defenses valid? Probe deeper.${citeDraft}</instruction>`
        : '<instruction>Wait for the critic\'s counter-critique.</instruction>';
    case 'consensus':
      return `<instruction>Both sides: converge on a final verdict. State whether the work is approved, needs revision, or is blocked. Be concise.${citeDraft}</instruction>`;
    default:
      return '';
  }
}

/**
 * Determine the stance for a turn based on phase and participant role.
 */
export function stanceForPhase(
  phase: DebatePhase,
  isCritic: boolean,
): 'support' | 'oppose' | 'neutral' {
  if (phase === 'consensus') return 'neutral';
  if (phase === 'critic' || phase === 'counter-critique') {
    return isCritic ? 'oppose' : 'support';
  }
  // rebuttal
  return isCritic ? 'oppose' : 'support';
}

/**
 * Check if all debates in a batch are finished.
 */
export function allDebatesFinished(debates: readonly DebateState[]): boolean {
  return debates.every((d) => d.finished);
}

/**
 * Get the next debate that needs a turn from a specific expert.
 */
export function findPendingDebateForExpert(
  debates: readonly DebateState[],
  expertId: string,
): DebateState | undefined {
  return debates.find((d) => {
    if (d.finished) return false;
    // Check if this expert should speak in the current phase
    const isCritic = expertId === d.config.criticExpertId;
    const isAuthor = expertId === d.config.authorExpertId;
    if (!isCritic && !isAuthor) return false;

    const phaseTurns = d.turns.filter((t) => t.phase === d.currentPhase);
    const alreadySpoken = phaseTurns.some((t) => t.expertId === expertId);

    // In critic phase, critic goes first; in rebuttal, author goes first
    if (d.currentPhase === 'critic' && phaseTurns.length === 0) {
      return isCritic;
    }
    if (d.currentPhase === 'rebuttal' && phaseTurns.length === 0) {
      return isAuthor;
    }

    return !alreadySpoken && phaseTurns.length < 2;
  });
}

// ── Risk assessment for debate triggering ────────────────────────────

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