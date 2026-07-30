import type { ThinkingEffort } from '#/provider';

const OPUS_VERSION_RE = /opus[.-](\d+)[.-](\d{1,2})(?!\d)/;
const ADAPTIVE_MIN_VERSION = { major: 4, minor: 6 } as const;

/**
 * Per-version default output ceilings sourced from Anthropic's Messages
 * API model cards (platform.claude.com/docs/en/about-claude/models/overview).
 * Values are the documented synchronous Messages-API maximum — we send
 * the full ceiling because Claude 4 + interleaved-thinking shares this
 * budget with encrypted reasoning, so anything below the documented cap
 * can silently truncate mid-`tool_use`.
 *
 * Keys are `<family>-<major>[-<minor>]`. Lookups try the most specific
 * key first, then fall back to the family/major-only entry, so an
 * unrecognized minor version (e.g. a future `opus-4-10`) gets the
 * family's baseline rather than the generic fallback.
 */
const CEILING_BY_FAMILY_VERSION: Readonly<Record<string, number>> = {
  // Claude Fable 5 documents a 128k output ceiling.
  'fable-5': 128000,
  // Claude Opus per minor version. 4.6 and 4.7 raised the cap to 128k;
  // 4.5 ships at 64k; 4.1 and the dated 4.0 release stay at 32k.
  'opus-4-7': 128000,
  'opus-4-6': 128000,
  'opus-4-5': 64000,
  'opus-4-1': 32000,
  'opus-4-0': 32000,
  'opus-4': 32000,
  // Claude Sonnet 4.x: 4.0 / 4.5 / 4.6 all document a 64k ceiling.
  'sonnet-4-6': 64000,
  'sonnet-4-5': 64000,
  'sonnet-4-0': 64000,
  'sonnet-4': 64000,
  // Claude Haiku 4.5 is 64k; the family-only entry keeps future dated
  // 4.x Haiku releases on the same ceiling.
  'haiku-4-5': 64000,
  'haiku-4': 64000,
  // Claude 3.5 / 3.7 documented at 8192 (standard endpoint).
  'opus-3-5': 8192,
  'sonnet-3-5': 8192,
  'sonnet-3-7': 8192,
  'haiku-3-5': 8192,
  // Original Claude 3 generation.
  'opus-3': 4096,
  'sonnet-3': 4096,
  'haiku-3': 4096,
};

const FALLBACK_MAX_TOKENS = 32000;

type ClaudeFamily = 'opus' | 'sonnet' | 'haiku' | 'fable';

interface ClaudeVersion {
  family: ClaudeFamily;
  major: number;
  minor: number | null;
}

// Family-first form: "opus-4-7", "sonnet-4.6", "haiku-4-5-20251001",
// "fable-5" (single version component — Fable ids carry no minor).
// Version numbers are capped at 1–2 digits with a non-digit lookahead so
// 8-digit date suffixes (e.g. `-20251001`) don't get consumed as version
// components.
const FAMILY_FIRST_RE =
  /(opus|sonnet|haiku|fable)[-._](\d{1,2})(?!\d)(?:[-._](\d{1,2})(?!\d))?/;
// Legacy version-first form: "3-5-sonnet", "3.7.opus" — used by older
// Anthropic model ids and Bedrock variants of Claude 3.x.
const VERSION_FIRST_RE = /(\d{1,2})[-._](\d{1,2})[-._](opus|sonnet|haiku)/;
// Bare family form for base Claude 3 (no minor): "3-opus", "3.haiku".
const BARE_FAMILY_RE = /(\d{1,2})[-._](opus|sonnet|haiku)/;

/**
 * Extract Claude family + version from a model id.
 *
 * Designed to survive the naming variants we see across vendors:
 * vendor prefixes (`anthropic.`, `aws/`, `openrouter/`,
 * `online-`), suffixes (date stamps like `-20251001`, build tags
 * like `-construct`, `-v1:0`), and `.` vs `-` separators between
 * the family and version components.
 *
 * Returns `null` when the id contains no Claude marker or no
 * recognizable family/version, in which case the resolver should fall
 * back to the override or {@link FALLBACK_MAX_TOKENS}.
 */
function parseClaudeVersion(model: string): ClaudeVersion | null {
  return parseClaudeFamilyVersion(model, true);
}

function parseClaudeAliasVersion(model: string): ClaudeVersion | null {
  return parseClaudeFamilyVersion(model, false);
}

function parseClaudeFamilyVersion(model: string, requireClaudeMarker: boolean): ClaudeVersion | null {
  const normalized = model.toLowerCase();
  // Guard against false positives on non-Claude models that happen to
  // contain an `opus-4-7`-like substring (e.g. fine-tunes named after a
  // checkpoint). The Anthropic provider might still be configured for
  // non-Claude endpoints, so without this guard we'd quietly apply
  // Claude ceilings to unrelated models.
  if (requireClaudeMarker && !normalized.includes('claude')) return null;

  const familyFirst = FAMILY_FIRST_RE.exec(normalized);
  if (familyFirst !== null) {
    return {
      family: familyFirst[1] as ClaudeFamily,
      major: Number.parseInt(familyFirst[2]!, 10),
      minor: familyFirst[3] !== undefined ? Number.parseInt(familyFirst[3], 10) : null,
    };
  }
  const versionFirst = VERSION_FIRST_RE.exec(normalized);
  if (versionFirst !== null) {
    return {
      major: Number.parseInt(versionFirst[1]!, 10),
      minor: Number.parseInt(versionFirst[2]!, 10),
      family: versionFirst[3] as ClaudeFamily,
    };
  }
  const bare = BARE_FAMILY_RE.exec(normalized);
  if (bare !== null) {
    return {
      major: Number.parseInt(bare[1]!, 10),
      minor: null,
      family: bare[2] as ClaudeFamily,
    };
  }
  return null;
}

function lookupClaudeCeiling(version: ClaudeVersion): number | undefined {
  const { family, major, minor } = version;
  if (minor !== null) {
    const exact = CEILING_BY_FAMILY_VERSION[`${family}-${major}-${minor}`];
    if (exact !== undefined) return exact;
  }
  return CEILING_BY_FAMILY_VERSION[`${family}-${major}`];
}

/**
 * Resolve the default `max_tokens` for an Anthropic request.
 *
 * Precedence:
 *   1. Caller-provided `override` (e.g. `models.<alias>.maxOutputSize`
 *      from the harness config) — honored when present so users can
 *      intentionally lower the budget (handy for forcing truncation
 *      in tests) or raise it on a model we don't yet know about.
 *   2. When the model id parses to a known Claude family + version,
 *      the override is clamped to the documented Messages-API ceiling
 *      so we never send a value the server would reject.
 *   3. With no override and no recognized version, fall back to
 *      {@link FALLBACK_MAX_TOKENS}.
 */
export function resolveDefaultMaxTokens(model: string, override?: number): number {
  const parsed = parseClaudeVersion(model);
  const ceiling = parsed === null ? undefined : lookupClaudeCeiling(parsed);
  if (ceiling === undefined) {
    return override ?? FALLBACK_MAX_TOKENS;
  }
  return override === undefined ? ceiling : Math.min(override, ceiling);
}

function parseVersion(match: RegExpExecArray): { major: number; minor: number } {
  const majorRaw = match[1];
  const minorRaw = match[2];
  if (majorRaw === undefined || minorRaw === undefined) {
    throw new Error('Model version regex did not capture major and minor versions.');
  }
  return { major: Number.parseInt(majorRaw, 10), minor: Number.parseInt(minorRaw, 10) };
}

function versionAtLeast(
  version: { major: number; minor: number },
  minimum: { major: number; minor: number },
): boolean {
  return (
    version.major > minimum.major ||
    (version.major === minimum.major && version.minor >= minimum.minor)
  );
}

export function supportsAdaptiveThinking(model: string): boolean {
  const version = parseClaudeAliasVersion(model);
  if (version === null) {
    return false;
  }
  // A missing minor is a bare family-major id: "claude-fable-5" (5.0 ≥ 4.6,
  // adaptive-only) or "claude-opus-4" (4.0 < 4.6, budget-based).
  return versionAtLeast(
    { major: version.major, minor: version.minor ?? 0 },
    ADAPTIVE_MIN_VERSION,
  );
}

function isOpus47(model: string): boolean {
  const match = OPUS_VERSION_RE.exec(model.toLowerCase());
  if (match === null) {
    return false;
  }
  const version = parseVersion(match);
  return version.major === 4 && version.minor === 7;
}

export function isFableModel(model: string): boolean {
  return parseClaudeAliasVersion(model)?.family === 'fable';
}

export function supportsEffortParam(model: string, adaptive: boolean): boolean {
  if (adaptive) {
    return true;
  }
  const normalized = model.toLowerCase();
  return normalized.includes('opus-4-5') || normalized.includes('opus-4.5');
}

export function clampEffort(effort: ThinkingEffort, model: string, adaptive: boolean): ThinkingEffort {
  if (effort === 'off') {
    return effort;
  }
  if (effort === 'xhigh' && !isOpus47(model) && !isFableModel(model)) {
    return 'high';
  }
  if (effort === 'max' && !adaptive) {
    return 'high';
  }
  return effort;
}

export function budgetTokensForEffort(effort: ThinkingEffort): number {
  switch (effort) {
    case 'low':
      return 1024;
    case 'medium':
      return 4096;
    case 'high':
      return 32_000;
    case 'off':
    case 'xhigh':
    case 'max':
      throw new Error(`Unsupported budget-based thinking effort: ${effort}`);
  }
  throw new Error(`Unknown thinking effort: ${String(effort)}`);
}

/**
 * Whether unsigned `think` parts (no `encrypted` signature) should still be
 * emitted as `thinking` blocks when converting history to the wire format.
 *
 * Native Claude models reject unsigned thinking blocks, but Anthropic-compatible
 * backends running non-Claude models (e.g. Kimi) require the thinking block to
 * survive round-trips even without a signature. Detected via the same version
 * parser used for capability checks: a model id with no recognizable Claude
 * family/version is treated as non-Claude.
 */
export function shouldPreserveUnsignedThinking(model: string): boolean {
  return parseClaudeAliasVersion(model) === null;
}
