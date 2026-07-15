import type { PlanFilePath } from '../plan';
import type { Agent } from '..';
import { isRealUserPromptOrigin } from '../context/types';
import { buildResponseLanguageDirective } from './response-language';
import { DynamicInjector } from './injector';
import {
  NO_AI_SLOP_SKILL_MANDATE_COMPACT,
} from '../../anti-slop/contract';
import {
  phaseReminder,
  phaseSparseReminder,
} from './plan-mode-phases';

const PLAN_MODE_DEDUP_MIN_TURNS = 2;
/** Non-ultra periodic full refresh. Ultra Plan uses phase-stable sparse instead (see getUltraVariant). */
const PLAN_MODE_FULL_REFRESH_TURNS = 5;

/**
 * Plan-mode reminder variants.
 *
 * `reentry` is used once when a restored planning session already has plan
 * content. `full` is used for the first reminder and periodic refreshes.
 * `sparse` keeps the read-only invariant visible between full reminders.
 * `ultra` is used when ultra plan mode is active.
 */
export type PlanModeVariant = 'full' | 'sparse' | 'reentry' | 'ultra';

export class PlanModeInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'plan_mode';
  private wasActive = false;
  /** Last Ultra Plan phase that received a full injection; phase-stable turns stay sparse. */
  private lastUltraPhase: string | null = null;

  override onContextClear(): void {
    super.onContextClear();
    this.wasActive = this.agent.planMode.isActive;
    this.lastUltraPhase = null;
  }

  override async getInjection(): Promise<string | undefined> {
    const { isActive, planFilePath, isUltraMode, phase } = this.agent.planMode;
    if (!isActive) {
      if (!this.wasActive) {
        return undefined;
      }
      this.wasActive = false;
      this.injectedAt = null;
      this.lastUltraPhase = null;
      return exitReminder();
    }
    if (!this.wasActive) {
      this.injectedAt = null;
      this.wasActive = true;
      if (isUltraMode) {
        this.lastUltraPhase = phase;
        return withResponseLanguage(await phaseReminder(planFilePath, phase, this.agent), this.agent);
      }
      if (await this.hasCurrentPlanContent()) {
        return withResponseLanguage(reentryReminder(planFilePath), this.agent);
      }
    }

    if (isUltraMode) {
      // Phase change always re-sends full phase contracts.
      if (this.lastUltraPhase !== phase) {
        this.lastUltraPhase = phase;
        this.injectedAt = null;
        return withResponseLanguage(await phaseReminder(planFilePath, phase, this.agent), this.agent);
      }
      const ultraVariant = this.getUltraVariant();
      if (ultraVariant === null) return undefined;
      return ultraVariant === 'full'
        ? withResponseLanguage(await phaseReminder(planFilePath, phase, this.agent), this.agent)
        : withResponseLanguage(await phaseSparseReminder(planFilePath, phase, this.agent), this.agent);
    }

    const variant = this.getVariant();
    if (variant === null) return undefined;

    return variant === 'full'
      ? withResponseLanguage(fullReminder(planFilePath), this.agent)
      : variant === 'sparse'
        ? withResponseLanguage(sparseReminder(planFilePath), this.agent)
        : withResponseLanguage(reentryReminder(planFilePath), this.agent);
  }

  protected getVariant(): PlanModeVariant | null {
    if (this.injectedAt === null) return 'full';
    const history = this.agent.context.history;
    let assistantTurnsSince = 0;
    for (let i = this.injectedAt + 1; i < history.length; i++) {
      const msg = history[i];
      if (msg === undefined) continue;
      if (msg.role === 'assistant') {
        assistantTurnsSince += 1;
        continue;
      }
      if (msg.role === 'user' && isRealUserPromptOrigin(msg.origin)) {
        return 'full';
      }
    }
    if (assistantTurnsSince >= PLAN_MODE_FULL_REFRESH_TURNS) return 'full';
    if (assistantTurnsSince >= PLAN_MODE_DEDUP_MIN_TURNS) return 'sparse';
    return null;
  }

  /**
   * Ultra Plan: full only on first inject of a phase or real user prompt.
   * Periodic cadence stays sparse so multi-k phase text is not re-flooded every 5 turns.
   */
  private getUltraVariant(): 'full' | 'sparse' | null {
    if (this.injectedAt === null) return 'full';
    const history = this.agent.context.history;
    let assistantTurnsSince = 0;
    for (let i = this.injectedAt + 1; i < history.length; i++) {
      const msg = history[i];
      if (msg === undefined) continue;
      if (msg.role === 'assistant') {
        assistantTurnsSince += 1;
        continue;
      }
      if (msg.role === 'user' && isRealUserPromptOrigin(msg.origin)) {
        return 'full';
      }
    }
    if (assistantTurnsSince >= PLAN_MODE_DEDUP_MIN_TURNS) return 'sparse';
    return null;
  }

  private async hasCurrentPlanContent(): Promise<boolean> {
    try {
      const data = await this.agent.planMode.data();
      return data !== null && data.content.trim().length > 0;
    } catch {
      return false;
    }
  }
}
function withPlanFileFooter(body: string, planFilePath: PlanFilePath): string {
  if (planFilePath === null || planFilePath.length === 0) return body;
  return `${body}\n\nPlan file: ${planFilePath}`;
}

function withResponseLanguage(body: string, agent: Agent): string {
  const preference = agent.getResponseLanguagePreference?.();
  if (preference === undefined) return body;
  return `${body}\n\n${buildResponseLanguageDirective(preference, { wrapped: false })}`;
}

const PLAN_MODE_BLOCKED_TOOLS =
  'TaskStop, CronCreate, and CronDelete are blocked in plan mode — call ExitPlanMode first if you need them.';

const PLAN_READ_ONLY_WITH_FILE = `Plan mode is active. You MUST NOT make any edits (except the current plan file) or change the system unless a tool request is explicitly approved. Prefer read-only tools. Bash only when needed; Bash follows normal permission rules. This supersedes other instructions. ${PLAN_MODE_BLOCKED_TOOLS}`;

const PLAN_READ_ONLY_NO_FILE = `Plan mode is active. You MUST NOT make any edits or change the system unless a tool request is explicitly approved. Prefer read-only tools. Bash only when needed; Bash follows normal permission rules. This supersedes other instructions.`;

const PLAN_WORKFLOW = `Workflow:
  1. Understand — Glob, Grep, Read; Context7Resolve/Docs for library docs; WebSearch/FetchURL when external evidence matters.
  2. Design — one best approach; trade-offs only when they matter.
  3. Review — re-read key files.
  4. Write Plan — Write or Edit the plan file (Write if missing). ${NO_AI_SLOP_SKILL_MANDATE_COMPACT}
  5. Exit — ExitPlanMode for approval.

TodoList is the live execution board during planning — durable plan content goes in the plan file only.`;

const PLAN_MULTI_APPROACH = `## Multiple approaches
At most 2–3 meaningfully different options; do not pad minor variants. If preference matters, AskUserQuestion first.
Multiple approaches in the plan → pass \`options\` to ExitPlanMode so the user can choose.
NEVER write multiple approaches and call ExitPlanMode without \`options\`.

AskUserQuestion: missing requirements/preferences only — never plan approval (user cannot see the plan until ExitPlanMode).
End every turn with AskUserQuestion (clarify) or ExitPlanMode (approve).`;

function fullReminder(planFilePath: PlanFilePath): string {
  if (planFilePath === null || planFilePath.length === 0) {
    return inlineFullReminder();
  }

  const body = `${PLAN_READ_ONLY_WITH_FILE}

${PLAN_WORKFLOW}

${PLAN_MULTI_APPROACH}`;
  return withPlanFileFooter(body, planFilePath);
}

function sparseReminder(planFilePath: PlanFilePath): string {
  if (planFilePath === null || planFilePath.length === 0) {
    return inlineSparseReminder();
  }

  const body = `Plan mode still active (see full instructions earlier). Read-only except the plan file — Write/Edit it (Write if missing). Bash when needed. AskUserQuestion for user preferences; pass \`options\` to ExitPlanMode when multiple approaches exist. End with AskUserQuestion or ExitPlanMode — never ask plan approval via text.`;
  return withPlanFileFooter(body, planFilePath);
}

function reentryReminder(planFilePath: PlanFilePath): string {
  if (planFilePath === null || planFilePath.length === 0) {
    return inlineReentryReminder();
  }

  const body = `${PLAN_READ_ONLY_WITH_FILE}

## Re-entering Plan Mode
A plan file from a prior session exists. Before proceeding:
  1. Read the existing plan file.
  2. Compare to the current request — new task: replace; same task: update.
  3. Write/Edit the plan file (Write if missing).
  4. AskUserQuestion for missing preferences; edit before ExitPlanMode.

End with AskUserQuestion or ExitPlanMode.`;
  return withPlanFileFooter(body, planFilePath);
}

function inlineFullReminder(): string {
  return `${PLAN_READ_ONLY_NO_FILE}

${PLAN_WORKFLOW.replace('Write or Edit the plan file (Write if missing).', 'Wait for the host to provide a plan file path, write there, then ExitPlanMode.')}

${PLAN_MULTI_APPROACH}`;
}

function inlineSparseReminder(): string {
  return `Plan mode still active (see full instructions earlier). Read-only; no plan file path in this host — wait for the host to provide a plan file path before ExitPlanMode. AskUserQuestion for preferences; pass \`options\` when multiple approaches exist. End with AskUserQuestion or ExitPlanMode.`;
}

function inlineReentryReminder(): string {
  return `${PLAN_READ_ONLY_NO_FILE}

## Re-entering Plan Mode
No plan file path in this host. Re-evaluate the request, AskUserQuestion for gaps, wait for the host path, write the plan, ExitPlanMode. End with AskUserQuestion or ExitPlanMode.`;
}

function exitReminder(): string {
  return `Plan mode is no longer active. The read-only and plan-file-only restrictions from plan mode no longer apply. Continue with the approved plan using the normal tool and permission rules.`;
}

