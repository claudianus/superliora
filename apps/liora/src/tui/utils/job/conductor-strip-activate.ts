/**
 * Footer Conductor jobs strip activation (F07).
 * Unread inbox → Inbox; otherwise Job Deck.
 */

export interface ConductorStripActivateHost {
  readonly unreadInbox: number;
  openInbox(): void;
  openDeck(): void;
}

export function activateConductorJobsStrip(host: ConductorStripActivateHost): 'inbox' | 'deck' {
  if (host.unreadInbox > 0) {
    host.openInbox();
    return 'inbox';
  }
  host.openDeck();
  return 'deck';
}

/** Compact progress chip for strip / mini-board cards. */
export function formatJobProgressChip(progress: {
  readonly phase?: string;
  readonly recentTools?: readonly string[];
}): string {
  const parts: string[] = [];
  if (progress.phase !== undefined && progress.phase.trim().length > 0) {
    parts.push(progress.phase.trim());
  }
  const tools = progress.recentTools ?? [];
  if (tools.length > 0) {
    parts.push(tools.slice(-2).join('→'));
  }
  return parts.join(' · ');
}
