import type { ContextOSHealthSnapshot, ContextOSPage, ContextOSRetrievalDiagnostics } from './types';

/** Compact one-line health for TUI/status dashboards. */
export function formatContextOSHealthLine(health: ContextOSHealthSnapshot): string {
  if (health.pageCount <= 0) return 'no pages';
  const evidence =
    health.missingEvidencePageCount > 0
      ? `evidence ${health.evidenceIdRecallScore.toFixed(2)} (missing ${String(health.missingEvidencePageCount)})`
      : `evidence ${health.evidenceIdRecallScore.toFixed(2)}`;
  return `${health.latestContinuityStatus} · pages ${String(health.readyPageCount)}/${String(health.pageCount)} ready · ${evidence}`;
}

export function formatContextOSDiagnoseLine(diagnostics: ContextOSRetrievalDiagnostics): string {
  const health = formatContextOSHealthLine(diagnostics.health);
  const reasons =
    diagnostics.selectedReasons.length === 0
      ? 'none'
      : diagnostics.selectedReasons.slice(0, 4).join(',');
  const evidenceMissing =
    diagnostics.missingEvidenceReasonCount > 0
      ? ` · evidence-miss selections ${String(diagnostics.missingEvidenceReasonCount)}`
      : '';
  return `${health} · selected ${String(diagnostics.selectedPageCount)}/${String(diagnostics.candidatePageCount)} · reasons ${reasons}${evidenceMissing}`;
}

export function buildHealthSnapshot(
  revision: number,
  pages: readonly ContextOSPage[],
): ContextOSHealthSnapshot {
  const fileHints = new Set<string>();
  let readyPageCount = 0;
  let needsRehydrationPageCount = 0;
  let atRiskPageCount = 0;
  let rawRefCount = 0;
  let missingEvidencePageCount = 0;
  let evidenceScoreSum = 0;
  let evidenceScoreCount = 0;

  for (const page of pages) {
    const contextOS = page.contextPack.contextOS;
    for (const file of contextOS.fileHints) {
      fileHints.add(file);
    }
    rawRefCount += page.contextPack.evidence.rawRefCount;
    if (contextOS.continuity.status === 'ready') {
      readyPageCount += 1;
    } else if (contextOS.continuity.status === 'needs_rehydration') {
      needsRehydrationPageCount += 1;
    } else {
      atRiskPageCount += 1;
    }
    const evidenceScore = contextOS.qualitySignals?.evidenceIdRecallScore;
    if (evidenceScore !== undefined) {
      evidenceScoreSum += evidenceScore;
      evidenceScoreCount += 1;
      if (evidenceScore < 1) missingEvidencePageCount += 1;
    } else if (contextOS.continuity.reasons.includes('missing_evidence_ids')) {
      missingEvidencePageCount += 1;
    }
  }

  const latestPage = pages.at(-1);
  return {
    revision,
    pageCount: pages.length,
    readyPageCount,
    needsRehydrationPageCount,
    atRiskPageCount,
    fileHintCount: fileHints.size,
    rawRefCount,
    missingEvidencePageCount,
    evidenceIdRecallScore:
      evidenceScoreCount === 0
        ? 1
        : Number((evidenceScoreSum / evidenceScoreCount).toFixed(2)),
    latestContinuityStatus: latestPage?.contextPack.contextOS.continuity.status ?? 'none',
    lastPageSequence: latestPage?.sequence ?? 0,
  };
}
