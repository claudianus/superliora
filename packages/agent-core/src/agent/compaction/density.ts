/**
 * Context-density scoring for compaction decisions.
 *
 * Cheap, model-free proxy for "how information-dense is this text":
 *   - `gzipDensityScore`: gzip compression ratio as a Kolmogorov-complexity
 *     proxy. The less a text compresses (high entropy, varied), the higher
 *     its score. Repetitive boilerplate compresses well → low score.
 *   - `surpriseScore`: a 0–1 blend of gzip density and project-specific
 *     identifiers. High score → preserve verbatim; low score → safe to
 *     compress.
 *
 * Compression-ratio semantics: `ratio = compressed / original`, so density is
 * monotonic in `ratio` (incompressible text scores high).
 */
import { gzipSync } from 'node:zlib';

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
 * Approximate conditional "surprise" — how unexpected the text is relative
 * to what a model already knows.
 *
 * High score (→ 1): preserve verbatim. Low score (→ 0): safe to compress.
 * Heuristic blend of gzip density (novel text compresses poorly) and
 * project-specific identifiers the model cannot reconstruct from priors.
 * `repoBaselineDensity` anchors the score to the workspace average; when
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

const DEFAULT_REPO_BASELINE_DENSITY = 0.45;

/**
 * Estimate the fraction of "project-specific identifier" characters in the
 * text. Long camelCase / PascalCase / SCREAMING_SNAKE tokens hint at coined
 * naming the model would not predict. Returns a value in [0, 1].
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
