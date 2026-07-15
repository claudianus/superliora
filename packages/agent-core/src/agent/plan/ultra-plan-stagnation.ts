/**
 * Pure stagnation detectors for Ultra Plan.
 */

export type StagnationPatternType =
  | 'spinning'
  | 'oscillation'
  | 'no_drift'
  | 'diminishing_returns';

export interface StagnationDetection {
  readonly pattern: StagnationPatternType;
  readonly detected: boolean;
  readonly confidence: number;
  readonly evidence: Record<string, unknown>;
}

export function hashText(text: string): string {
  let h1 = 5381;
  let h2 = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) | 0;
    h2 = (h2 * 33 + c) | 0;
  }
  return `${h1.toString(36)}:${h2.toString(36)}`;
}

export function detectSpinning(
  _phaseOutputs: readonly string[],
  errorSignatures: readonly string[],
): StagnationDetection {
  const threshold = 3;
  const hashes = errorSignatures.map((e) => hashText(e));
  const last = hashes.slice(-threshold);
  const detected = last.length >= threshold && last.every((h) => h === last[0]);
  return {
    pattern: 'spinning',
    detected,
    confidence: detected ? 0.9 : 0.0,
    evidence: { threshold, lastErrors: errorSignatures.slice(-threshold) },
  };
}

export function detectOscillation(phaseOutputs: readonly string[]): StagnationDetection {
  const cycles = 2;
  const hashes = phaseOutputs.map((o) => hashText(o));
  if (hashes.length < cycles * 2) {
    return { pattern: 'oscillation', detected: false, confidence: 0.0, evidence: {} };
  }
  const n = hashes.length;
  const detected =
    hashes[n - 1] === hashes[n - 3] && hashes[n - 2] === hashes[n - 4];
  return {
    pattern: 'oscillation',
    detected,
    confidence: detected ? 0.85 : 0.0,
    evidence: { cycles, lastOutputs: phaseOutputs.slice(-cycles * 2) },
  };
}

export function detectNoDrift(driftScores: readonly number[]): StagnationDetection {
  const threshold = 3;
  const epsilon = 0.01;
  if (driftScores.length < threshold) {
    return { pattern: 'no_drift', detected: false, confidence: 0.0, evidence: {} };
  }
  const last = driftScores.slice(-threshold);
  const maxDiff = Math.max(...last) - Math.min(...last);
  const detected = maxDiff < epsilon;
  return {
    pattern: 'no_drift',
    detected,
    confidence: detected ? 0.8 : 0.0,
    evidence: { threshold, maxDiff, lastScores: last },
  };
}

export function detectDiminishingReturns(driftScores: readonly number[]): StagnationDetection {
  const threshold = 3;
  if (driftScores.length < threshold + 1) {
    return { pattern: 'diminishing_returns', detected: false, confidence: 0.0, evidence: {} };
  }
  const improvements: number[] = [];
  for (let i = 1; i < driftScores.length; i++) {
    improvements.push((driftScores[i] ?? 0) - (driftScores[i - 1] ?? 0));
  }
  const last = improvements.slice(-threshold);
  const avgImprovement = last.reduce((a, b) => a + b, 0) / last.length;
  const detected = avgImprovement < 0.01;
  return {
    pattern: 'diminishing_returns',
    detected,
    confidence: detected ? 0.75 : 0.0,
    evidence: { threshold, avgImprovement, lastImprovements: last },
  };
}

export function detectAllStagnation(
  phaseOutputs: readonly string[],
  errorSignatures: readonly string[],
  driftScores: readonly number[],
): StagnationDetection[] {
  return [
    detectSpinning(phaseOutputs, errorSignatures),
    detectOscillation(phaseOutputs),
    detectNoDrift(driftScores),
    detectDiminishingReturns(driftScores),
  ];
}
