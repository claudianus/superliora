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
  /**
   * Optional attached draft body (diff / design / failure log).
   * Prefer this over artifactSummary when building citation context.
   */
  readonly draftExcerpt?: string;
}

const PHASE_ORDER: readonly DebatePhase[] = ['critic', 'rebuttal', 'counter-critique', 'consensus'];

export { PHASE_ORDER };

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

/**
 * Attach a draft excerpt to the debate state so later `buildDebateContext`
 * calls cite it (participants must reference the draft, not only stance).
 * Empty / whitespace drafts are ignored (state unchanged).
 */
export function attachDraftToDebate(state: DebateState, draft: string): DebateState {
  const trimmed = draft.trim();
  if (trimmed.length === 0) return state;
  return {
    ...state,
    draftExcerpt: trimmed,
  };
}

export interface BuildDebateContextOptions {
  /**
   * Optional excerpt of the attached draft (diff, design paragraph, failure log).
   * Multiagent-debate style: participants must cite this text, not only stance.
   * Prefer `attachDraftToDebate(state, draft)` when the draft is known up front.
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
  // Priority: explicit option → state.draftExcerpt (attachDraftToDebate) → artifact.
  const fromOption = explicit?.trim();
  if (fromOption !== undefined && fromOption.length > 0) return fromOption;
  const fromState = state.draftExcerpt?.trim();
  if (fromState !== undefined && fromState.length > 0) return fromState;
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


export type { ConsensusResult, ConsensusVerdict, DebateParticipant, RiskAssessmentInput, RiskLevel, RunDebateCycleOptions } from './ultra-swarm-debate-cycle';
export {
  assessRisk,
  debatePhasesForRisk,
  parseConsensusVerdict,
  runDebateCycle,
} from './ultra-swarm-debate-cycle';
