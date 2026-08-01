import type { FooterBadge } from '#/tui/components/chrome/footer/footer-badges';
import { labelSearchCascade } from '#/tui/components/chrome/footer/footer-labels';
import type { FooterLabels } from '#/tui/config';
import type { AppState } from '#/tui/types';

export const SEARCH_CASCADE_BADGE_TTL_MS = 30_000;

const SEARCH_CASCADE_TOOLS = new Set(['WebSearch', 'DeepResearch']);

type ChannelMatchRule = {
  readonly re: RegExp;
  readonly id: (match: RegExpMatchArray) => string;
};

const CHANNEL_MATCH_RULES: readonly ChannelMatchRule[] = [
  { re: /\bch\s*([1-5])\b/gi, id: (m) => `ch${m[1] ?? ''}`.toLowerCase() },
  { re: /\bsearxng\b|\bch\s*2\b|\bmeta(?:\s*search)?\b/gi, id: () => 'ch2' },
  { re: /\bbrowser\b/gi, id: () => 'ch4' },
  { re: /\bchrome(?:\s+ext(?:ension)?(?:\s+bridge)?)?\b/gi, id: () => 'ch5' },
  {
    re: /\bfree fallback\b|\bddg\b|\bduckduckgo\b/gi,
    id: () => 'ch3',
  },
];

/** Extract ordered unique channel ids (ch1–ch5) from free-form search text. */
export function parseSearchChannelsFromText(text: string): readonly string[] {
  const hits: Array<{ readonly index: number; readonly id: string }> = [];
  for (const rule of CHANNEL_MATCH_RULES) {
    for (const match of text.matchAll(rule.re)) {
      const index = match.index;
      if (index === undefined) continue;
      hits.push({ index, id: rule.id(match) });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { id } of hits) {
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function parseSearchChannelsFromTexts(
  ...texts: Array<string | undefined>
): readonly string[] {
  return parseSearchChannelsFromText(texts.filter((t) => t !== undefined && t.length > 0).join('\n'));
}

export function parseDeepResearchHops(text: string): number | null {
  const match = /^hops:\s*(\d+)\s*$/m.exec(text);
  if (match?.[1] === undefined) return null;
  const hops = Number(match[1]);
  return Number.isFinite(hops) ? hops : null;
}

/** Parse explicit `channelsTried:` line from DeepResearch output. */
export function parseDeepResearchChannelsTried(text: string): readonly string[] {
  const match = /^channelsTried:\s*(.+)$/m.exec(text);
  if (match?.[1] === undefined) return [];
  const raw = match[1].trim();
  if (raw.length === 0 || raw === '(none)') return [];
  return raw
    .split(/\s*[|,]\s*/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export type SearchCascadeState = NonNullable<AppState['searchCascade']>;

/** True while cascade snapshot is within the footer/Ops TTL window. */
export function isSearchCascadeActive(
  cascade: AppState['searchCascade'],
  nowMs: number = Date.now(),
): cascade is SearchCascadeState {
  if (cascade === undefined || cascade === null) return false;
  if (nowMs - cascade.atMs >= SEARCH_CASCADE_BADGE_TTL_MS) return false;
  return cascade.channelsTried.length > 0 || (cascade.hops ?? 0) > 0;
}

/** Active cascade snapshot, or null when absent or expired. */
export function activeSearchCascade(
  cascade: AppState['searchCascade'],
  nowMs: number = Date.now(),
): SearchCascadeState | null {
  return isSearchCascadeActive(cascade, nowMs) ? cascade : null;
}

/** Patch to clear expired searchCascade from AppState; null when no update needed. */
export function staleSearchCascadeClearPatch(
  cascade: AppState['searchCascade'],
  nowMs: number = Date.now(),
): Pick<AppState, 'searchCascade'> | null {
  if (cascade === undefined || cascade === null) return null;
  if (isSearchCascadeActive(cascade, nowMs)) return null;
  return { searchCascade: null };
}

export function searchCascadeAppStatePatch(
  channels: readonly string[],
  nowMs: number = Date.now(),
  hops?: number,
): Pick<AppState, 'searchCascade'> | null {
  const normalizedHops = hops ?? 0;
  if (channels.length === 0 && normalizedHops <= 0) return null;
  return {
    searchCascade: {
      channelsTried: [...channels],
      ...(normalizedHops > 0 ? { hops: normalizedHops } : {}),
      atMs: nowMs,
    },
  };
}

export function searchCascadePatchFromDegraded(
  scope: string,
  reason: string,
  hint: string | undefined,
  atMs: number = Date.now(),
): Pick<AppState, 'searchCascade'> | null {
  if (scope !== 'search') return null;
  return searchCascadeAppStatePatch(parseSearchChannelsFromTexts(reason, hint), atMs);
}

export function searchCascadePatchFromToolResult(
  toolName: string,
  output: string,
  nowMs: number = Date.now(),
): Pick<AppState, 'searchCascade'> | null {
  if (!SEARCH_CASCADE_TOOLS.has(toolName)) return null;
  const degraded = /\bdegraded:\s*true\b/.test(output);
  if (toolName === 'WebSearch' && !degraded) return null;

  const hintMatch = /^hint:\s*(.+)$/m.exec(output);
  const hops = toolName === 'DeepResearch' ? parseDeepResearchHops(output) : null;
  const explicitChannels = parseDeepResearchChannelsTried(output);
  const channels =
    explicitChannels.length > 0
      ? explicitChannels
      : parseSearchChannelsFromTexts(output, hintMatch?.[1]);
  if (toolName === 'DeepResearch') {
    return searchCascadeAppStatePatch(channels, nowMs, hops ?? undefined);
  }
  if (channels.length === 0) return null;
  return searchCascadeAppStatePatch(channels, nowMs);
}

/** Footer badge when a search channel cascade was recently observed. */
export function formatSearchCascadeFooterBadge(
  cascade: AppState['searchCascade'],
  nowMs: number = Date.now(),
  labels: FooterLabels = 'plain',
): FooterBadge | null {
  if (cascade === undefined || cascade === null) return null;
  if (!isSearchCascadeActive(cascade, nowMs)) return null;
  return { text: labelSearchCascade(labels), severity: 'info' };
}

/** Ops health line, e.g. `Cascade: ch1→ch4` or `Cascade: ch1→ch4 · hops 3`. */
export function formatSearchCascadeOpsLine(
  channels: readonly string[],
  hops?: number,
): string | null {
  if (channels.length === 0 && (hops === undefined || hops <= 0)) return null;
  const path = channels.length > 0 ? channels.join('→') : 'tried';
  const hopsPart = hops !== undefined && hops > 0 ? ` · hops ${String(hops)}` : '';
  return `Cascade: ${path}${hopsPart}`;
}

/** Ops stub when search is degraded but no recent cascade snapshot exists. */
export function formatSearchCascadeOpsFallbackLine(searchDegraded: boolean): string | null {
  if (!searchDegraded) return null;
  return 'Cascade: never-empty · Ch4 browser · Ch5 chrome-ext';
}

/** Ops health line for DeepResearch hop count, e.g. `Research hops: 3`. */
export function formatResearchHopsOpsLine(hops: number | undefined): string | null {
  if (hops === undefined || hops <= 0) return null;
  return `Research hops: ${String(hops)}`;
}

export type SearchCascadeOpsHealthLines = {
  readonly cascadeLine: string | null;
  readonly researchHopsLine: string | null;
};

/** Ops Runtime Health SSOT — AppState.searchCascade → cascade + hops rows within TTL. */
export function resolveSearchCascadeOpsHealthLines(
  cascade: AppState['searchCascade'],
  nowMs: number = Date.now(),
): SearchCascadeOpsHealthLines {
  const active = activeSearchCascade(cascade, nowMs);
  if (active === null) {
    return { cascadeLine: null, researchHopsLine: null };
  }
  const cascadeLine =
    active.channelsTried.length > 0
      ? formatSearchCascadeOpsLine(active.channelsTried, active.hops)
      : null;
  const researchHopsLine =
    active.channelsTried.length === 0 ? formatResearchHopsOpsLine(active.hops) : null;
  return { cascadeLine, researchHopsLine };
}

export const SEARCH_CASCADE_SESSION_STUB_TIP =
  'Cascade channelsTried: live after WebSearch/DeepResearch degrade (~30s · footer research↻ + /ops)';

/** Settings Session (live) — recent channelsTried from AppState when within TTL (SSOT). */
export function formatSearchCascadeSessionGlance(
  cascade: AppState['searchCascade'],
  nowMs: number = Date.now(),
): string | null {
  const active = activeSearchCascade(cascade, nowMs);
  if (active === null) return null;
  return formatSearchCascadeOpsLine(active.channelsTried, active.hops);
}

/** Settings Session (live) block — cascade path from AppState.searchCascade. */
export function buildSearchCascadeSessionLiveLines(
  cascade: AppState['searchCascade'],
  nowMs: number = Date.now(),
): readonly string[] {
  const live = formatSearchCascadeSessionGlance(cascade, nowMs);
  return [
    '── Session (live) ───────────────────────────',
    live ?? `· ${SEARCH_CASCADE_SESSION_STUB_TIP}`,
  ];
}
