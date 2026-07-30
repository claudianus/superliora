/**
 * ExitPlanMode / approved-plan string protocol parsers for ToolCallComponent.
 * Core-side templates live in
 * `packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts`.
 */

const APPROVED_PLAN_MARKER = '## Approved Plan:';

export function extractApprovedPlan(output: string): string {
  const markerIndex = output.indexOf(APPROVED_PLAN_MARKER);
  if (markerIndex < 0) return '';
  return output.slice(markerIndex + APPROVED_PLAN_MARKER.length).trim();
}

interface ExitPlanModeOutcome {
  readonly kind: 'approved' | 'rejected';
  readonly chosen?: string;
  readonly feedback?: string;
  readonly path?: string;
}

const REJECT_PREFIX = 'User rejected the plan.';
const REJECT_FEEDBACK_PREFIX = 'User rejected the plan. Feedback:';
const APPROVED_OPTION_RE = /^User approved option "([^"]+)"\./;
const PLAN_REJECT_PREFIX = 'Plan rejected by user.';
const SELECTED_APPROACH_RE = /^Exited plan mode\. Selected approach: ([^\n]+)\n/;
const PLAN_SAVED_TO_RE = /\nPlan saved to: ([^\n]+)\n/;

/**
 * Parses the ExitPlanMode result content string to recover the approval outcome
 * and optional plan path. Core-side templates live in
 * `packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts`:
 *   - Approved output starts with 'Exited plan mode.' and selected options
 *     are reported as 'Selected approach: <label>'. Older outputs may start
 *     with 'User approved option "<label>".' Plan-file mode may include
 *     'Plan saved to: <path>'.
 *   - Rejected output starts with 'Plan rejected by user.' or older
 *     'User rejected the plan.'; feedback uses 'User rejected the plan.
 *     Feedback:\n\n<text>'.
 * This is a string protocol rather than a structured payload. Prefer a
 * structured event payload if core starts emitting one.
 */
export function interpretExitPlanModeOutcome(output: string): ExitPlanModeOutcome {
  if (output.startsWith(REJECT_PREFIX)) {
    if (output.startsWith(REJECT_FEEDBACK_PREFIX)) {
      const feedback = output.slice(REJECT_FEEDBACK_PREFIX.length).trimStart();
      return { kind: 'rejected', feedback };
    }
    return { kind: 'rejected' };
  }
  if (output.startsWith(PLAN_REJECT_PREFIX)) {
    return { kind: 'rejected' };
  }
  const pathMatch = PLAN_SAVED_TO_RE.exec(output);
  const path = pathMatch?.[1]?.trim();
  const optionMatch = SELECTED_APPROACH_RE.exec(output) ?? APPROVED_OPTION_RE.exec(output);
  if (optionMatch !== null) {
    return path !== undefined && path.length > 0
      ? { kind: 'approved', chosen: optionMatch[1], path }
      : { kind: 'approved', chosen: optionMatch[1] };
  }
  return path !== undefined && path.length > 0 ? { kind: 'approved', path } : { kind: 'approved' };
}

export function isExitPlanModeOutcomeOutput(output: string): boolean {
  return (
    output.startsWith(REJECT_PREFIX) ||
    output.startsWith(PLAN_REJECT_PREFIX) ||
    output.startsWith('Exited plan mode.') ||
    APPROVED_OPTION_RE.test(output) ||
    output.includes(APPROVED_PLAN_MARKER)
  );
}
