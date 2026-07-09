/**
 * Context-density scoring.
 *
 * Absorbed from lean-ctx: rank context by how information-dense it is per
 * token, and approximate how "surprising" it is to the model. Dense,
 * surprising content (project-specific logic, novel identifiers) should be
 * preserved verbatim; sparse, predictable content (boilerplate, generated
 * output, long repetitive stretches) is a better candidate for compression.
 *
 * Three signals, all cheap (no extra model call):
 *   - `gzipDensityScore`: gzip compression ratio as a Kolmogorov-complexity
 *     proxy. The less a text compresses (high entropy, varied), the higher
 *     its score. Repetitive boilerplate compresses well → low score.
 *   - `tokenNormalizedDensity`: density scaled by a token factor so short
 *     dense snippets and long sparse files compare on a shared scale.
 *   - `surpriseScore`: a 0–1 proxy for "how unexpected is this to the model".
 *     Low compressibility (high entropy) plus project-specific identifiers
 *     pushes the score up; boilerplate pushes it down.
 *
 * Compression-ratio semantics: `ratio = compressed / original`.
 *   - Highly compressible text (repetition) → small `ratio` → LOW density.
 *   - Incompressible text (high entropy) → large `ratio` → HIGH density.
 * So density/surprise is monotonic in `ratio` (not `1 - ratio`).
 */

import { gzipSync } from 'node:zlib';

import { estimateTokens } from '../../utils/tokens';

/**
 * Gzip compression ratio as an information-density proxy.
 *
 * Returns a value in [0, 1]: 1 means the text barely compresses (high
 * information density / high entropy), values near 0 mean it compresses to
 * almost nothing (pure repetition / boilerplate). Empty input returns 0.
 */
export function gzipDensityScore(text: string): number {
  if (text.length === 0) return 0;
  const originalBytes = Buffer.byteLength(text, 'utf8');
  const compressed = gzipSync(Buffer.from(text, 'utf8'), { level: 6 });
  // ratio = compressed / original. High ratio (little compression) ⇒ dense.
  const ratio = compressed.length / originalBytes;
  return Math.max(0, Math.min(1, ratio));
}

/**
 * Density scaled to compare across different lengths.
 *
 * Multiplies raw density by a token factor so a short dense snippet can
 * outrank a long sparse file. Returns a value roughly in [0, 1].
 */
export function tokenNormalizedDensity(text: string): number {
  const tokens = estimateTokens(text);
  if (tokens === 0) return 0;
  const density = gzipDensityScore(text);
  // Token factor: more tokens ⇒ more absolute information potential.
  // sqrt dampens so a 10x-longer file isn't 10x the score.
  const tokenFactor = Math.min(1, Math.sqrt(tokens / 500));
  return density * tokenFactor;
}

/**
 * Approximate conditional "surprise" — how unexpected the text is relative
 * to what a model already knows.
 *
 * High score (→ 1): preserve verbatim. Low score (→ 0): safe to compress.
 *
 * Heuristic blend of two cheap signals:
 *   1. Gzip density: low-compressibility text is more likely novel.
 *   2. Project-specific identifiers: `camelCase`/`PascalCase`/`SCREAMING_SNAKE`
 *      tokens that are long and not common English words hint at
 *      project-specific naming the model cannot reconstruct from priors.
 *
 * `repoBaselineDensity` anchors the score to the workspace average. Text
 * denser than the baseline scores higher; sparser text scores lower. When
 * omitted, a fixed reference (0.45) is used.
 */
export function surpriseScore(text: string, repoBaselineDensity?: number): number {
  const density = gzipDensityScore(text);
  const baseline = repoBaselineDensity ?? DEFAULT_REPO_BASELINE_DENSITY;
  // Density above the baseline raises surprise; below lowers it. Clamp to [0,1].
  const densitySignal = clamp01(0.5 + (density - baseline) * 2);

  const identifierSignal = projectIdentifierSignal(text);
  // Weighted blend: density is the primary signal; identifiers refine it.
  return clamp01(densitySignal * 0.7 + identifierSignal * 0.3);
}

/**
 * Classify a chunk into a compression-pressure multiplier. High-surprise
 * content (→ 1.0) should resist compression; low-surprise content (→ 0.0)
 * compresses eagerly.
 */
export function compressionResistance(text: string, repoBaselineDensity?: number): number {
  return surpriseScore(text, repoBaselineDensity);
}

const DEFAULT_REPO_BASELINE_DENSITY = 0.45;

/**
 * Estimate the fraction of "project-specific identifier" characters in the
 * text. Long camelCase / PascalCase / SCREAMING_SNAKE tokens that are not
 * common English words hint at naming the model would not predict.
 *
 * Returns a value in [0, 1].
 */
function projectIdentifierSignal(text: string): number {
  if (text.length === 0) return 0;
  const identifiers = text.match(/[A-Za-z_$][A-Za-z0-9_$]{5,}/g);
  if (identifiers === null) return 0;
  let projectish = 0;
  for (const id of identifiers) {
    // camelCase / PascalCase with an internal case transition, or a long
    // SCREAMING_SNAKE token — both hint at a coined name.
    if (/[a-z][A-Z]/.test(id) || /[A-Z][a-z]/.test(id) || /^[A-Z0-9_]{6,}$/.test(id)) {
      projectish += id.length;
    }
  }
  // Scale down: even identifier-heavy source rarely exceeds ~0.3 fraction.
  return clamp01((projectish / text.length) * 3);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
