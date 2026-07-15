import { describe, expect, it } from 'vitest';

import { buildContextOsReportLines } from '#/tui/commands/info';
import type { ContextOSRetrievalDiagnostics } from '@superliora/sdk';

const sample: ContextOSRetrievalDiagnostics = {
  health: {
    revision: 2,
    pageCount: 2,
    readyPageCount: 1,
    needsRehydrationPageCount: 1,
    atRiskPageCount: 0,
    fileHintCount: 1,
    rawRefCount: 1,
    missingEvidencePageCount: 1,
    evidenceIdRecallScore: 0.5,
    latestContinuityStatus: 'needs_rehydration',
    lastPageSequence: 2,
  },
  queryFileHintCount: 1,
  candidatePageCount: 2,
  metadataFilteredPageCount: 0,
  semanticFilteredPageCount: 0,
  selectedPageCount: 1,
  selectedPageSequences: [2],
  selectedScores: [0.7],
  selectedStatuses: ['needs_rehydration'],
  selectedReasons: ['file_hint_match', 'missing_evidence_ids'],
  selectedEvidenceIdRecallScores: [0.5],
  missingEvidenceReasonCount: 1,
  supersededPageCount: 0,
};

describe('buildContextOsReportLines', () => {
  it('renders continuity, privacy ZDR tip, and media skill guidance', () => {
    const lines = buildContextOsReportLines(
      sample,
      { telemetryEnabled: true, configPath: '/tmp/config.toml' },
      'auth flow',
    ).join('\n');
    expect(lines).toContain('auth flow');
    expect(lines).toContain('needs_rehydration');
    expect(lines).toContain('Telemetry: ON');
    expect(lines).toContain('telemetry = false');
    expect(lines).toContain('WebSearch');
    expect(lines).toContain('GenerateImage');
    expect(lines).toContain('evidence-miss selections 1');
  });

  it('marks telemetry off as ZDR-friendly', () => {
    const lines = buildContextOsReportLines(
      sample,
      { telemetryEnabled: false, configPath: '/tmp/config.toml' },
      '',
    ).join('\n');
    expect(lines).toContain('Telemetry: OFF');
    expect(lines).toContain('ZDR-friendly');
  });
});
