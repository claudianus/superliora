import type {
  CompactionContinuityStatus,
  CompactionContextPack,
  CompactionResultAction,
  CompactionResultRawRef,
} from '../compaction';

export type ContextOSRenderProfileName = 'full' | 'compact' | 'minimal';

export interface ContextOSRenderProfile {
  readonly name: ContextOSRenderProfileName;
  readonly maxListItems: number;
  readonly maxFileHints: number;
  readonly maxItemChars: number;
  readonly maxGoalChars: number;
  readonly includeRawRefs: boolean;
}

export interface ContextOSPage {
  readonly id: string;
  readonly sequence: number;
  readonly contextPack: CompactionContextPack;
  readonly summary: string;
  readonly rawRefs: readonly CompactionResultRawRef[];
  readonly actions: readonly CompactionResultAction[];
}

export interface ContextOSSelection {
  readonly page: ContextOSPage;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface ContextOSData {
  readonly revision: number;
  readonly pages: readonly ContextOSPage[];
}

export type ContextOSHealthContinuityStatus = CompactionContinuityStatus | 'none';

export interface ContextOSHealthSnapshot {
  readonly revision: number;
  readonly pageCount: number;
  readonly readyPageCount: number;
  readonly needsRehydrationPageCount: number;
  readonly atRiskPageCount: number;
  readonly fileHintCount: number;
  readonly rawRefCount: number;
  /** Pages whose last compaction lost durable evidence/node/archive identifiers. */
  readonly missingEvidencePageCount: number;
  /** Mean evidenceIdRecallScore across pages that expose the signal (1 when unknown). */
  readonly evidenceIdRecallScore: number;
  readonly latestContinuityStatus: ContextOSHealthContinuityStatus;
  readonly lastPageSequence: number;
}

export interface ContextOSRetrievalDiagnostics {
  readonly health: ContextOSHealthSnapshot;
  readonly queryFileHintCount: number;
  readonly candidatePageCount: number;
  readonly metadataFilteredPageCount: number;
  readonly semanticFilteredPageCount: number;
  readonly selectedPageCount: number;
  readonly selectedPageSequences: readonly number[];
  readonly selectedScores: readonly number[];
  readonly selectedStatuses: readonly ContextOSHealthContinuityStatus[];
  readonly selectedReasons: readonly string[];
  readonly selectedEvidenceIdRecallScores: readonly number[];
  readonly missingEvidenceReasonCount: number;
  readonly supersededPageCount: number;
}

export interface ContextOSSelectionResult {
  readonly selections: readonly ContextOSSelection[];
  readonly supersededCount: number;
  readonly queryFileHintCount: number;
  readonly candidatePageCount: number;
  readonly metadataFilteredPageCount: number;
  readonly semanticFilteredPageCount: number;
}

export interface ContextOSSupersessionResult {
  readonly selections: readonly ContextOSSelection[];
  readonly supersededCount: number;
}

export interface RenderedContextOSInjection {
  readonly text: string;
  readonly pages: readonly RenderedContextOSPage[];
  readonly droppedPageCount: number;
  readonly audit: ContextOSInjectionAudit;
}

export interface ContextOSInjectionAudit {
  readonly warnings: readonly string[];
}

export interface RenderedContextOSPage {
  readonly text: string;
  readonly rawRefCount: number;
  readonly poisoningWarningCount: number;
  readonly profileName: ContextOSRenderProfileName;
}

export interface RenderedList {
  readonly text: string;
  readonly poisoningWarningCount: number;
}

export interface SanitizedRecalledText {
  readonly text: string;
  readonly poisoningWarningCount: number;
}
