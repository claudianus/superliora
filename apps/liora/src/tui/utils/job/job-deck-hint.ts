/**
 * First-running-Job Alt+J Deck hint (Conductor UX v2 Phase 5).
 * Pure helpers — host wires persist via onboarding.jobDeckHintSeen.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export function shouldShowJobDeckHint(input: {
  readonly conductorUxV2: boolean;
  readonly jobDeckHintSeen: boolean;
  readonly runningJobs: number;
}): boolean {
  return input.conductorUxV2 && !input.jobDeckHintSeen && input.runningJobs > 0;
}

export function jobDeckHintNotice(): { readonly title: string; readonly detail: string } {
  return {
    title: ttui('tui.notice.jobDeckHint'),
    detail: ttui('tui.notice.jobDeckHintDetail'),
  };
}
