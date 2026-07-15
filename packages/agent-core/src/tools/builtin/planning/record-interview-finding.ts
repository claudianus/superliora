/**
 * RecordInterviewFindingTool — records a code or research finding during the
 * Ultra Plan interview without asking the user. This is the PATH 1 (auto-answer)
 * and PATH 3 (research) entry point of the question-routing system.
 */

import type { Agent } from '#/agent';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';

export const RecordInterviewFindingInputSchema = z.object({
  question_answered: z
    .string()
    .min(1)
    .describe('The interview question this finding answers (e.g. "What framework version is used?").'),
  finding: z
    .string()
    .min(1)
    .describe('The factual answer discovered from code or research. Be specific — cite files, versions, or sources.'),
  origin: z
    .enum(['code', 'research'])
    .describe("'code' if the finding comes from reading the codebase/config/manifests. 'research' if from external sources (web, docs)."),
}).strict();

export type RecordInterviewFindingInput = z.infer<typeof RecordInterviewFindingInputSchema>;

export class RecordInterviewFindingTool implements BuiltinTool<RecordInterviewFindingInput> {
  readonly name = 'RecordInterviewFinding' as const;
  readonly description = `Record a factual finding that answers an interview question WITHOUT asking the user.

Use when codebase/config or external research already answers the question:
- PATH 1 (code): versions, framework choices, patterns, structure — origin "code"
- PATH 3 (research): API compatibility, pricing, version support — research first, origin "research"

Do NOT use for human decisions (goals, acceptance criteria, trade-offs, visual/scope preferences) — use AskUserQuestion.

Rhythm Guard: after 3 consecutive non-user findings, you MUST AskUserQuestion next.`;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(RecordInterviewFindingInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: RecordInterviewFindingInput): ToolExecution {
    return {
      description: `Recording ${args.origin} finding: ${args.question_answered.slice(0, 80)}`,
      approvalRule: this.name,
      execute: async () => this.execution(args),
    };
  }

  private async execution(args: RecordInterviewFindingInput): Promise<ExecutableToolResult> {
    if (!this.agent.planMode.isActive || !this.agent.planMode.isUltraMode) {
      return { isError: true, output: 'RecordInterviewFinding is only available in Ultra Plan interview phase.' };
    }
    if (this.agent.planMode.phase !== 'interview') {
      return { isError: true, output: 'RecordInterviewFinding is only available during the interview phase.' };
    }
    this.agent.planMode.recordUltraInterviewFinding(args.finding, args.origin, args.question_answered);
    return {
      output: `Recorded ${args.origin} finding for: ${args.question_answered}\n\nThe finding has been added to the interview evidence. Continue with the next focus from the readiness checklist.`,
    };
  }
}
