/**
 * AskUserQuestionTool — structured user question tool.
 *
 * The LLM calls this tool when it needs structured input from the user
 * (multiple-choice, preference selection, disambiguation). The tool
 * delegates to the SDK reverse-RPC question handler, which owns the
 * actual UI interaction.
 *
 * Permission policy decides whether this tool is available for the
 * current mode. Once executed, it dispatches through `requestQuestion`
 * and awaits the user's answer.
 */

import { basename } from 'node:path';
import { z } from 'zod';

import type { Agent } from '../../../agent/index';
import { QuestionBackgroundTask } from '../../../agent/background';
import type { BuiltinTool } from '../../../agent/tool';
import { ErrorCodes, LioraError } from '../../../errors';
import { errorMessage, isAbortError } from '../../../loop/errors';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { isQuestionResponse } from '../../../rpc/question-result';
import type {
  QuestionAnswers,
  QuestionAnswerMethod,
  QuestionResult,
} from '../../../rpc/sdk-api';
import type { TelemetryPropertyValue } from '../../../telemetry';
import { toInputJsonSchema } from '../../support/input-schema';
import {
  questionsIncludeScopeEscape,
  SCOPE_ESCAPE_QUESTION_BLOCKED_MESSAGE,
  shouldBlockScopeEscapeQuestion,
} from '../../support/scope-escape-question';
import { raiseJobNeedsUserForWorker } from '../job/job-worker-ledger-bridge';
import {
  pauseActiveChildDeadline,
  resumeActiveChildDeadline,
} from '../../../session/subagent/subagent-run-lifecycle';
import DESCRIPTION from './ask-user.md?raw';

// ── Input schema ─────────────────────────────────────────────────────

const QuestionOptionSchema = z.object({
  label: z
    .string()
    .describe("Concise display text (1-5 words). If recommended, append '(Recommended)'."),
  description: z.string().default('').describe('Brief explanation of trade-offs or implications.'),
});

const QuestionItemSchema = z.object({
  question: z.string().describe("A specific, actionable question. End with '?'."),
  header: z
    .string()
    .default('')
    .describe("Short category tag (max 12 chars, e.g. 'Auth', 'Style')."),
  options: z
    .array(QuestionOptionSchema)
    .default([])
    .describe(
      "Meaningful, distinct options. Prefer 2-4 for real choices; use 1 only for explicit confirmation. For open-ended questions, omit options and let the built-in Other/custom answer handle free text. Do NOT include an 'Other' option — the system adds one automatically.",
    ),
  multi_select: z
    .boolean()
    .default(false)
    .describe('Whether the user can select multiple options.'),
});

export interface AskUserQuestionInput {
  background?: boolean;
  questions: Array<{
    question: string;
    header?: string | undefined;
    options?: Array<{ label: string; description?: string | undefined }> | undefined;
    multi_select?: boolean | undefined;
  }>;
}

interface NormalizedAskUserQuestionInput {
  readonly background?: boolean | undefined;
  readonly questions: Array<{
    readonly question: string;
    readonly header: string;
    readonly options: Array<{ readonly label: string; readonly description: string }>;
    readonly multi_select: boolean;
  }>;
}

const AskUserQuestionInputBaseSchema = z.object({
  questions: z
    .array(QuestionItemSchema)
    .min(1)
    .max(4)
    .describe('The questions to ask the user (1-4 questions).'),
});

const AskUserQuestionInputSchemaWithBackground = AskUserQuestionInputBaseSchema.extend({
  background: z
    .boolean()
    .default(false)
    .describe(
      'Set true to ask in the background and return immediately with a background task_id. Use TaskOutput to read the answer later.',
    ),
});

export const AskUserQuestionInputSchema: z.ZodType<AskUserQuestionInput> =
  AskUserQuestionInputBaseSchema;

const QUESTION_DISMISSED_MESSAGE = 'User dismissed the question without answering.';

const QUESTION_UNSUPPORTED_FAILURE_MESSAGE =
  'The connected client does not support interactive questions. Do NOT call this tool again. Ask the user directly in your text response instead.';

// ── Implementation ───────────────────────────────────────────────────

export class AskUserQuestionTool implements BuiltinTool<AskUserQuestionInput> {
  readonly name = 'AskUserQuestion' as const;
  readonly description: string;
  readonly parameters: Record<string, unknown>;

  constructor(private readonly agent: Agent) {
    this.description = `${DESCRIPTION}- Set background=true when you can keep working without the answer. This starts a background question task and returns a task_id immediately. The answer arrives automatically in a later turn — you do not need to poll, sleep, or check on it. Continue with other work; never fabricate or predict the answer.`;
    this.parameters = toInputJsonSchema(this.inputSchema());
  }

  resolveExecution(args: AskUserQuestionInput): ToolExecution {
    const normalizedArgs = normalizeAskUserQuestionInput(args);
    const isBackground = normalizedArgs.background === true;
    return {
      accesses: ToolAccesses.all(),
      description: isBackground
        ? `Starting background question: ${questionDescription(normalizedArgs.questions)}`
        : 'Asking user questions',
      approvalRule: this.name,
      execute: (ctx) => this.execution(normalizedArgs, ctx),
    };
  }

  private async execution(
    args: NormalizedAskUserQuestionInput,
    {
      toolCallId,
      signal,
      turnId,
    }: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    if (args.background === true) {
      return this.executeInBackground(args, { toolCallId, turnId, signal });
    }

    return this.executeQuestion(args, { toolCallId, turnId, signal });
  }

  private inputSchema(): z.ZodType<AskUserQuestionInput> {
    return AskUserQuestionInputSchemaWithBackground;
  }

  private async executeQuestion(
    args: NormalizedAskUserQuestionInput,
    {
      toolCallId,
      signal,
      turnId,
    }: Pick<ExecutableToolContext, 'toolCallId' | 'signal' | 'turnId'>,
  ): Promise<ExecutableToolResult> {
    const workerDeadlineChildId = workerAgentIdForDeadline(this.agent);
    try {
      if (this.shouldRejectScopeEscape(args)) {
        this.agent.telemetry.track('question_scope_escape_blocked', {
          questions: args.questions.length,
        });
        return {
          isError: true,
          output: SCOPE_ESCAPE_QUESTION_BLOCKED_MESSAGE,
        };
      }

      // Ask mode exists to collect human judgment — never auto-fill the question
      // dialog even when permission mode is auto.
      const autoAnswer = this.agent.askMode?.isActive
        ? undefined
        : tryAutoAnswerQuestions(args, this.agent.permission?.mode);
      if (autoAnswer !== undefined) {
        await this.recordUltraInterviewAnswers(args.questions, autoAnswer.answers, 'auto');
        this.agent.telemetry.track('question_answered', {
          answered: Object.keys(autoAnswer.answers).length,
          method: 'auto',
          auto_decisions: autoAnswer.decisions.length,
        });
        return {
          isError: false,
          output: JSON.stringify({
            answers: autoAnswer.answers,
            method: 'auto',
            decisions: autoAnswer.decisions,
          }),
        };
      }

      // Plan Desk / Job workers: surface needs_user on the parent Job ledger
      // so Conductor JobInbox sees the interview card while the shared RPC
      // question UI still collects the answer. Freezes the wall-clock deadline
      // for the interview wait so 30m/45m does not burn on the question UI.
      maybeRaiseJobNeedsUser(this.agent, args.questions);
      if (workerDeadlineChildId !== undefined) {
        pauseActiveChildDeadline(workerDeadlineChildId);
      }

      try {
        const result = await this.agent.rpc!.requestQuestion!(
          {
            turnId: numericTurnId(turnId),
            toolCallId,
            questions: args.questions.map((q) => ({
              question: q.question,
              header: q.header,
              options: q.options.map((o) => ({
                label: o.label,
                description: o.description,
              })),
              multiSelect: q.multi_select,
            })),
          },
          { signal },
        );

        const normalized = normalizeQuestionResult(result);
        if (normalized === null || Object.keys(normalized.answers).length === 0) {
          this.agent.telemetry.track('question_dismissed');
          return dismissedQuestionResult();
        }
        await this.recordUltraInterviewAnswers(args.questions, normalized.answers, 'user');

        const properties: Record<string, TelemetryPropertyValue> = {
          answered: Object.keys(normalized.answers).length,
        };
        if (normalized.method !== undefined) properties['method'] = normalized.method;
        this.agent.telemetry.track('question_answered', properties);
        return {
          isError: false,
          output: JSON.stringify({ answers: normalized.answers }),
        };
      } finally {
        if (workerDeadlineChildId !== undefined) {
          resumeActiveChildDeadline(workerDeadlineChildId);
        }
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw error;

      if (error instanceof LioraError && error.code === ErrorCodes.NOT_IMPLEMENTED) {
        return {
          isError: true,
          output: QUESTION_UNSUPPORTED_FAILURE_MESSAGE,
        };
      }

      return dismissedQuestionResult();
    }
  }

  private executeInBackground(
    args: NormalizedAskUserQuestionInput,
    {
      toolCallId,
      signal,
      turnId,
    }: Pick<ExecutableToolContext, 'toolCallId' | 'signal' | 'turnId'>,
  ): ExecutableToolResult {
    if (signal.aborted) {
      signal.throwIfAborted();
    }
    const backgroundManager = this.agent.background;

    const description = questionDescription(args.questions);
    let taskId: string;
    try {
      taskId = backgroundManager.registerTask(
        new QuestionBackgroundTask(
          (taskSignal) => this.executeQuestion(args, { toolCallId, turnId, signal: taskSignal }),
          description,
          {
            questionCount: args.questions.length,
            toolCallId,
          },
        ),
      );
    } catch (error) {
      return {
        isError: true,
        output: errorMessage(error),
      };
    }

    const status = backgroundManager.getTask(taskId)?.status ?? 'running';
    return {
      isError: false,
      output:
        `task_id: ${taskId}\n` +
        `description: ${description}\n` +
        `status: ${status}\n` +
        `automatic_notification: true\n` +
        'next_step: Continue your current work; the answer will arrive automatically when the user responds.\n' +
        'next_step: Use TaskOutput with this task_id for a non-blocking status/answer snapshot.\n' +
        'next_step: Use TaskStop only if the question should be cancelled.\n' +
        'human_shell_hint: The pending question is also visible in /tasks.',
      message: `Started ${taskId}`,
    };
  }

  private async recordUltraInterviewAnswers(
    questions: NormalizedAskUserQuestionInput['questions'],
    answers: QuestionAnswers,
    origin: 'user' | 'auto' = 'user',
  ): Promise<void> {
    const planMode = (this.agent as Partial<Pick<Agent, 'planMode'>>).planMode;
    if (planMode?.isUltraMode !== true || planMode.phase !== 'interview') return;
    try {
      await planMode.recordUltraInterviewAnswers(questions, answers, origin);
    } catch {
      // Recording interview context must not turn a valid user answer into a dismissal.
    }
  }

  private shouldRejectScopeEscape(args: NormalizedAskUserQuestionInput): boolean {
    if (!questionsIncludeScopeEscape(args.questions)) return false;
    const planMode = (this.agent as Partial<Pick<Agent, 'planMode'>>).planMode;
    const goalStatus = this.agent.goal?.getGoal()?.goal?.status ?? null;
    return shouldBlockScopeEscapeQuestion({
      askModeActive: this.agent.askMode?.isActive === true,
      permissionMode: this.agent.permission?.mode,
      goalStatus,
      ultraPlanInterview:
        planMode?.isUltraMode === true && planMode.phase === 'interview',
    });
  }
}

function normalizeAskUserQuestionInput(args: AskUserQuestionInput): NormalizedAskUserQuestionInput {
  return {
    background: args.background === true ? true : undefined,
    questions: args.questions.map((question) => ({
      question: question.question,
      header: question.header ?? '',
      options: (question.options ?? []).map((option) => ({
        label: option.label,
        description: option.description ?? '',
      })),
      multi_select: question.multi_select ?? false,
    })),
  };
}

function dismissedQuestionResult(): ExecutableToolResult {
  return {
    isError: false,
    output: JSON.stringify({
      answers: {},
      note: QUESTION_DISMISSED_MESSAGE,
    }),
  };
}

function numericTurnId(turnId: string): number | undefined {
  if (turnId.trim().length === 0) return undefined;
  const parsed = Number(turnId);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function questionDescription(questions: NormalizedAskUserQuestionInput['questions']): string {
  const first = questions[0]?.question.trim();
  const label = first === undefined || first.length === 0 ? 'Ask user question' : first;
  if (questions.length <= 1) return label;
  return `${label} (+${String(questions.length - 1)} more)`;
}

function normalizeQuestionResult(
  result: QuestionResult,
): { readonly answers: QuestionAnswers; readonly method?: QuestionAnswerMethod | undefined } | null {
  if (result === null) return null;
  if (isQuestionResponse(result)) {
    return {
      answers: result.answers,
      method: result.method,
    };
  }
  return { answers: result };
}

const AUTO_ANSWER_ASSUMPTION =
  'Assumption: proceed toward a higher quality bar (tests, visual proof, complete scope); refine if blocked.';

/**
 * Destructive / irreversible question signals: auto mode must never silently
 * approve these — a wrong auto-pick is data loss or a public irreversible
 * action. Matched against question text, header, and option labels.
 * ponytail: heuristic on free text — false positives only fall through to the
 * human RPC, false negatives are the real risk, so patterns err inclusive.
 */
const DESTRUCTIVE_QUESTION_PATTERNS = [
  /\bdelete[sd]?\b/i,
  /\bremove[sd]?\b/i,
  /\bdrop\b/i,
  /\bdestroy(?:ing)?\b/i,
  /\berase\b/i,
  /\bwipe[sd]?\b/i,
  /\breset\s+--hard\b/i,
  /\bforce[-\s]?push\b/i,
  /\bpush\b[^\n]*\b(?:--force|--force-with-lease|-f)\b/i,
  /\boverwrite[sd]?\b/i,
  /\bdiscard(?:ing)?\b/i,
  /\brevert\b/i,
  /\brollback\b/i,
  /\birreversible\b/i,
  /\bpermanent(?:ly)?\b/i,
  /\bcannot\s+be\s+undone\b/i,
  // merge/land are NOT listed: MergeJob trust (+ auto permission waive) is the
  // land gate. Matching "merge" here forced a human RPC even in auto mode.
  /\bdeploy(?:ing|ment|s)?\b/i,
  /\bpublish(?:ing|es)?\b/i,
  /\brelease[sd]?\b/i,
  /\bshare[sd]?\b[^\n]*\b(?:private|secret|credential|token|api[-\s]?key|password)\b/i,
  /\b(?:private|secret|credential|token|api[-\s]?key|password)\b[^\n]*\bshare[sd]?\b/i,
] as const;

function isDestructiveQuestion(
  question: NormalizedAskUserQuestionInput['questions'][number],
): boolean {
  const text = [
    question.question,
    question.header,
    ...question.options.flatMap((option) => [option.label, option.description]),
  ].join('\n');
  return DESTRUCTIVE_QUESTION_PATTERNS.some((pattern) => pattern.test(text));
}

export interface AutoInterviewDecision {
  readonly answers: QuestionAnswers;
  /** Structured decision records for Mission interview quality. */
  readonly decisions: readonly AutoInterviewDecisionRecord[];
}

export interface AutoInterviewDecisionRecord {
  readonly question: string;
  readonly chosen: string;
  readonly reason: string;
  readonly confidence: number;
  readonly source: 'recommended' | 'baseline' | 'upgrade' | 'quality' | 'open_assumption';
  readonly options: readonly string[];
}

/**
 * Auto intent: full autopilot — the agent (via this helper) picks the best
 * contextual option itself. This is deliberate auto-fill, not "skip the question".
 * YOLO mode still asks the human; manual mode also waits for a real user answer.
 *
 * Mission quality: after the destructive gate, pick the highest-quality non-destructive
 * option (visual proof / complete scope / tests) rather than blindly accepting
 * "(Recommended)" or the first baseline shortcut. Record reason + confidence so
 * interview findings seed a verifiable goal without click-spam.
 */
function tryAutoAnswerQuestions(
  args: NormalizedAskUserQuestionInput,
  mode: string | undefined,
): AutoInterviewDecision | undefined {
  if (mode !== 'auto') return undefined;
  // Never auto-approve destructive or irreversible decisions — even full
  // autopilot falls through to the human RPC for these.
  if (args.questions.some(isDestructiveQuestion)) return undefined;

  const answers: QuestionAnswers = {};
  const decisions: AutoInterviewDecisionRecord[] = [];
  for (const question of args.questions) {
    const key = question.question;
    if (question.options.length === 0) {
      const chosen = AUTO_ANSWER_ASSUMPTION;
      answers[key] = formatAutoDecisionAnswer(chosen, {
        reason:
          'Open question under auto mode — proceed toward higher quality (tests, visual proof, complete scope); refine if blocked',
        confidence: 0.6,
        source: 'open_assumption',
      });
      decisions.push({
        question: key,
        chosen,
        reason:
          'Open question under auto mode — proceed toward higher quality (tests, visual proof, complete scope); refine if blocked',
        confidence: 0.6,
        source: 'open_assumption',
        options: [],
      });
      continue;
    }

    const pick = pickAutoInterviewOption(question.options);
    answers[key] = formatAutoDecisionAnswer(pick.label, {
      reason: pick.reason,
      confidence: pick.confidence,
      source: pick.source,
    });
    decisions.push({
      question: key,
      chosen: pick.label,
      reason: pick.reason,
      confidence: pick.confidence,
      source: pick.source,
      options: question.options.map((o) => o.label),
    });
  }
  return { answers, decisions };
}

function formatAutoDecisionAnswer(
  chosen: string,
  meta: { readonly reason: string; readonly confidence: number; readonly source: string },
): string {
  return [
    chosen,
    `[auto decision] source=${meta.source}; confidence=${meta.confidence.toFixed(2)}; reason=${meta.reason}`,
  ].join('\n');
}

function pickAutoInterviewOption(
  options: ReadonlyArray<{ readonly label: string; readonly description: string }>,
): {
  readonly label: string;
  readonly reason: string;
  readonly confidence: number;
  readonly source: AutoInterviewDecisionRecord['source'];
} {
  // Score every option for quality signals. "(Recommended)" is only a weak tie
  // boost — auto mode upgrades toward proof/complete scope, not the author hint.
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestBoost = 0;
  let bestPenalty = 0;
  for (let index = 0; index < options.length; index++) {
    const option = options[index]!;
    const scored = scoreAutoInterviewOption(option);
    const wins =
      scored.score > bestScore ||
      (scored.score === bestScore &&
        (isRecommendedLabel(option.label) ||
          (!isRecommendedLabel(options[bestIndex]!.label) && index < bestIndex)));
    if (wins) {
      bestIndex = index;
      bestScore = scored.score;
      bestBoost = scored.boost;
      bestPenalty = scored.penalty;
    }
  }

  const chosen = options[bestIndex]!;
  const source = classifyAutoInterviewSource(chosen, bestBoost, bestPenalty);
  const reason = buildAutoInterviewPickReason(chosen, source, bestBoost, bestPenalty);
  const confidence = confidenceForAutoInterviewSource(source, bestBoost, bestPenalty);
  return {
    label: chosen.label,
    reason,
    confidence,
    source,
  };
}

/** Positive quality signals — prefer proof, complete scope, and polish. */
const QUALITY_BOOST_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly weight: number }> =
  [
    { pattern: /\bverifysurface\b/i, weight: 14 },
    { pattern: /\bvisual\s+rubric\b/i, weight: 14 },
    { pattern: /\bcinematic\b/i, weight: 12 },
    { pattern: /\bvisual\s+proof\b/i, weight: 12 },
    { pattern: /\bcomplete\s+scope\b/i, weight: 12 },
    { pattern: /\bfull\s+scope\b/i, weight: 11 },
    { pattern: /\bhigher\s+quality\b|\bquality\s+bar\b|\bquality\s+upgrade\b/i, weight: 11 },
    { pattern: /\bproduction[- ]?ready\b/i, weight: 9 },
    { pattern: /\bpremium\b/i, weight: 8 },
    { pattern: /\bend[- ]to[- ]end\b|\be2e\b/i, weight: 8 },
    { pattern: /\bwith\s+tests?\b|\bfull\s+tests?\b|\btest\s+coverage\b|\badd\s+tests?\b/i, weight: 8 },
    { pattern: /\bthorough\b/i, weight: 7 },
    { pattern: /\bscreenshot\b/i, weight: 7 },
    { pattern: /\bupgrade\b/i, weight: 7 },
    { pattern: /\bpolish(?:ed)?\b/i, weight: 6 },
    { pattern: /\ba11y\b|\baccessibility\b/i, weight: 6 },
    { pattern: /\bevidence\b|\bproof\b/i, weight: 5 },
    { pattern: /\bfull\s+version\b|\bcomplete\s+version\b/i, weight: 5 },
  ];

/** Shortcut / defer signals — auto mode should not pick these when better exists. */
const QUALITY_PENALTY_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly weight: number }> =
  [
    { pattern: /\bskip\b/i, weight: 12 },
    { pattern: /\bbug[- ]?only\b/i, weight: 12 },
    { pattern: /\bminimal\b/i, weight: 10 },
    { pattern: /\blater\b|\bdefer(?:red)?\b|\bpostpone\b/i, weight: 9 },
    { pattern: /\bstub\b|\bplaceholder\b/i, weight: 9 },
    { pattern: /\bshortcut\b|\bcheapest\b|\bsmallest\b/i, weight: 9 },
    { pattern: /\bno\s+tests?\b|\bwithout\s+tests?\b|\bskip\s+tests?\b/i, weight: 9 },
    { pattern: /\bbaseline\b/i, weight: 7 },
    { pattern: /\bpartial\b|\bquick[- ]?fix\b/i, weight: 7 },
    { pattern: /\bmvp\b|\bbare\b|\btemp(?:orary)?\b/i, weight: 6 },
    { pattern: /\bdraft\b|\brough\b/i, weight: 5 },
  ];

const RECOMMENDED_LABEL_RE = /\(Recommended\)/i;

function isRecommendedLabel(label: string): boolean {
  return RECOMMENDED_LABEL_RE.test(label);
}

function scoreAutoInterviewOption(option: {
  readonly label: string;
  readonly description: string;
}): { readonly score: number; readonly boost: number; readonly penalty: number } {
  const text = `${option.label}\n${option.description}`;
  let boost = 0;
  for (const { pattern, weight } of QUALITY_BOOST_PATTERNS) {
    if (pattern.test(text)) boost += weight;
  }
  let penalty = 0;
  for (const { pattern, weight } of QUALITY_PENALTY_PATTERNS) {
    if (pattern.test(text)) penalty += weight;
  }
  // Weak authoring hint only — never enough to beat a real quality upgrade.
  const recommendedBoost = isRecommendedLabel(option.label) ? 2 : 0;
  return {
    score: boost - penalty + recommendedBoost,
    boost,
    penalty,
  };
}

function classifyAutoInterviewSource(
  option: { readonly label: string; readonly description: string },
  boost: number,
  penalty: number,
): AutoInterviewDecisionRecord['source'] {
  if (boost > 0 && boost >= penalty) {
    if (/\bupgrade\b/i.test(`${option.label}\n${option.description}`)) return 'upgrade';
    return 'quality';
  }
  if (isRecommendedLabel(option.label)) return 'recommended';
  if (/\bbaseline\b/i.test(option.label)) return 'baseline';
  if (/\bupgrade\b/i.test(option.label)) return 'upgrade';
  return 'baseline';
}

function buildAutoInterviewPickReason(
  option: { readonly label: string; readonly description: string },
  source: AutoInterviewDecisionRecord['source'],
  boost: number,
  penalty: number,
): string {
  const description = option.description.trim();
  if (source === 'quality') {
    return description.length > 0
      ? `Quality upgrade over shortcuts: ${description}`
      : 'Quality-aware auto pick (visual proof / complete scope / tests over skip-minimal)';
  }
  if (source === 'upgrade') {
    return description.length > 0
      ? `Upgrade option: ${description}`
      : 'Upgrade option preferred for higher payoff under auto mode';
  }
  if (source === 'recommended') {
    return description.length > 0
      ? `Recommended option: ${description}`
      : 'Explicit (Recommended) option authored for interview';
  }
  if (penalty > boost && penalty > 0) {
    // Only shortcut-like options remained — still document the pick.
    return description.length > 0
      ? `Best available option under auto mode: ${description}`
      : 'Best available option under auto mode (no higher-quality alternative)';
  }
  return description.length > 0
    ? `First option as baseline: ${description}`
    : 'First option treated as baseline under auto interview';
}

function confidenceForAutoInterviewSource(
  source: AutoInterviewDecisionRecord['source'],
  boost: number,
  penalty: number,
): number {
  if (source === 'quality') return Math.min(0.92, 0.8 + Math.min(boost, 20) * 0.005);
  if (source === 'upgrade') return 0.84;
  if (source === 'recommended') return 0.88;
  if (penalty > boost) return 0.62;
  return 0.7;
}

/** Exported for unit tests — pure auto interview picker. */
export function buildAutoInterviewDecisionForTest(
  args: NormalizedAskUserQuestionInput,
  mode: string | undefined,
): AutoInterviewDecision | undefined {
  return tryAutoAnswerQuestions(args, mode);
}

function workerAgentIdForDeadline(agent: Agent): string | undefined {
  if (agent.type !== 'sub' || agent.homedir === undefined) return undefined;
  return basename(agent.homedir);
}

function maybeRaiseJobNeedsUser(
  agent: Agent,
  questions: NormalizedAskUserQuestionInput['questions'],
): void {
  if (agent.type !== 'sub' || agent.homedir === undefined) return;
  const workerAgentId = basename(agent.homedir);
  const question = questions[0]?.question?.trim() || 'User input needed';
  raiseJobNeedsUserForWorker(workerAgentId, { question });
}

