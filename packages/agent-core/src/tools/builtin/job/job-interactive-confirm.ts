/**
 * Interactive confirms for Conductor JobCreate (UX v2).
 * Uses reverse-RPC AskUserQuestion when available; otherwise passthrough.
 */

import type { Agent } from '../../../agent/index';
import { normalizeQuestionAnswers } from '../../../rpc/question-result';
import type { SplitJobIntent } from './job-split';

export type AutoSplitConfirmDecision = 'keep' | 'merge' | 'cancel';

const SPLIT_CONFIRM_MIN = 3;

function uxV2On(agent: Agent | undefined): boolean {
  return agent?.experimentalFlags?.enabled('conductor_ux_v2') === true;
}

function canAsk(agent: Agent | undefined): agent is Agent {
  return (
    agent !== undefined &&
    uxV2On(agent) &&
    typeof agent.rpc?.requestQuestion === 'function'
  );
}

function firstAnswerLabel(answers: Record<string, string | true> | undefined): string {
  if (answers === undefined) return '';
  for (const value of Object.values(answers)) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

/**
 * When auto_split yields ≥3 intents, ask keep / merge / cancel.
 * Headless or flag-off → keep (legacy immediate create).
 */
export async function confirmAutoSplitIntents(
  agent: Agent | undefined,
  intents: readonly SplitJobIntent[],
): Promise<AutoSplitConfirmDecision> {
  if (intents.length < SPLIT_CONFIRM_MIN) return 'keep';
  if (!canAsk(agent)) return 'keep';

  const preview = intents
    .slice(0, 8)
    .map((intent, index) => `${String(index + 1)}. ${intent.title}`)
    .join('\n');
  const more =
    intents.length > 8 ? `\n…and ${String(intents.length - 8)} more` : '';

  try {
    const result = await agent.rpc!.requestQuestion!({
      questions: [
        {
          question: `Create ${String(intents.length)} Jobs from this burst?\n${preview}${more}`,
          header: 'Job split',
          options: [
            {
              label: 'Keep all (Recommended)',
              description: 'One Job per intent, scheduled in parallel',
            },
            {
              label: 'Merge into one',
              description: 'Single Job with the combined prompt',
            },
            {
              label: 'Cancel',
              description: 'Do not create Jobs',
            },
          ],
        },
      ],
    });
    const answers = normalizeQuestionAnswers(result);
    const label = firstAnswerLabel(answers).toLowerCase();
    if (label.includes('cancel')) return 'cancel';
    if (label.includes('merge')) return 'merge';
    if (label.includes('keep') || label.length === 0) return 'keep';
    return 'keep';
  } catch {
    return 'keep';
  }
}

export function mergeSplitIntents(
  intents: readonly SplitJobIntent[],
  fallbackTitle: string,
): SplitJobIntent {
  const prompts = intents.map((i) => i.prompt.trim()).filter((p) => p.length > 0);
  return {
    title: fallbackTitle.slice(0, 120) || intents[0]?.title || 'Combined task',
    prompt: prompts.join('\n\n'),
  };
}

export interface GreenfieldBriefFields {
  readonly successCriteria: readonly string[];
  readonly mustNotTouch: readonly string[];
  readonly verificationCommands: readonly string[];
}

export function greenfieldBriefMissing(
  fields: GreenfieldBriefFields,
): readonly string[] {
  const missing: string[] = [];
  if (fields.successCriteria.length === 0) {
    missing.push('success criteria (what does done look like?)');
  }
  if (fields.mustNotTouch.length === 0) {
    missing.push('must-not-touch (paths to leave alone, or "none")');
  }
  return missing;
}

/** Plain AskUserQuestion body when greenfield brief is incomplete. */
export function greenfieldBriefAskTemplate(fields: GreenfieldBriefFields): string {
  const missing = greenfieldBriefMissing(fields);
  if (missing.length === 0) return '';
  return [
    'Greenfield brief is incomplete — answer each item before staffing Jobs:',
    ...missing.map((line, i) => `${String(i + 1)}. ${line}`),
  ].join('\n');
}

/**
 * Ask the user for missing greenfield brief slots via reverse-RPC.
 * Returns filled fields, or undefined when cancelled / unavailable.
 */
export async function confirmGreenfieldBrief(
  agent: Agent | undefined,
  fields: GreenfieldBriefFields,
): Promise<GreenfieldBriefFields | undefined> {
  const missing = greenfieldBriefMissing(fields);
  if (missing.length === 0) return fields;
  if (!canAsk(agent)) return undefined;

  const questions = [];
  if (fields.successCriteria.length === 0) {
    questions.push({
      question: 'Greenfield: what does done look like? (success criteria)',
      header: 'Done when',
      options: [
        {
          label: 'Ship runnable MVP (Recommended)',
          description: 'App starts; core path works; basic tests green',
        },
        {
          label: 'Scaffold only',
          description: 'Project layout + stubs; no full behavior yet',
        },
      ],
      // free-text via Other
    });
  }
  if (fields.mustNotTouch.length === 0) {
    questions.push({
      question: 'Greenfield: what must workers not touch?',
      header: 'Fence',
      options: [
        {
          label: 'Nothing off-limits (Recommended)',
          description: 'Empty repo / full ownership — record as "none"',
        },
        {
          label: 'Leave existing packages alone',
          description: 'Do not modify packages/ or apps/ already present',
        },
      ],
    });
  }

  try {
    const result = await agent.rpc!.requestQuestion!({ questions });
    const answers = normalizeQuestionAnswers(result);
    if (answers === undefined || Object.keys(answers).length === 0) return undefined;

    let successCriteria = [...fields.successCriteria];
    let mustNotTouch = [...fields.mustNotTouch];
    const values = Object.values(answers).filter((v): v is string => typeof v === 'string');

    if (successCriteria.length === 0 && values[0] !== undefined) {
      successCriteria = [values[0]];
    }
    if (mustNotTouch.length === 0) {
      const fence = values[successCriteria.length === 0 ? 0 : 1] ?? values[0];
      if (fence !== undefined) {
        mustNotTouch = /nothing|none|off-limits/i.test(fence) ? ['none'] : [fence];
      }
    }

    if (greenfieldBriefMissing({ successCriteria, mustNotTouch, verificationCommands: fields.verificationCommands }).length > 0) {
      return undefined;
    }
    return {
      successCriteria,
      mustNotTouch,
      verificationCommands: fields.verificationCommands,
    };
  } catch {
    return undefined;
  }
}
