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

import { z } from 'zod';

import type { Agent } from '../../../agent';
import { QuestionBackgroundTask } from '../../../agent/background';
import type { BuiltinTool } from '../../../agent/tool';
import { ErrorCodes, LioraError } from '../../../errors';
import { errorMessage, isAbortError } from '../../../loop/errors';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import type {
  QuestionAnswers,
  QuestionAnswerMethod,
  QuestionResponse,
  QuestionResult,
} from '../../../rpc';
import type { TelemetryPropertyValue } from '../../../telemetry';
import { toInputJsonSchema } from '../../support/input-schema';
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
      await this.recordUltraInterviewAnswers(args.questions, normalized.answers);

      const properties: Record<string, TelemetryPropertyValue> = {
        answered: Object.keys(normalized.answers).length,
      };
      if (normalized.method !== undefined) properties['method'] = normalized.method;
      this.agent.telemetry.track('question_answered', properties);
      return {
        isError: false,
        output: JSON.stringify({ answers: normalized.answers }),
      };
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
  ): Promise<void> {
    const planMode = (this.agent as Partial<Pick<Agent, 'planMode'>>).planMode;
    if (planMode?.isUltraMode !== true || planMode.phase !== 'interview') return;
    try {
      await planMode.recordUltraInterviewAnswers(questions, answers);
    } catch {
      // Recording interview context must not turn a valid user answer into a dismissal.
    }
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

function isQuestionResponse(result: Exclude<QuestionResult, null>): result is QuestionResponse {
  if (typeof result !== 'object' || result === null) return false;
  if (!Object.hasOwn(result, 'answers')) return false;
  const answers = (result as { readonly answers?: unknown }).answers;
  return typeof answers === 'object' && answers !== null && !Array.isArray(answers);
}
