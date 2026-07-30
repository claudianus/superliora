import type { Agent } from '..';
import type { CompactionResult } from '../compaction';

import { MAX_CONTEXT_OS_PAGES, MAX_SELECTED_PAGES } from './constants';
import { buildHealthSnapshot, formatContextOSDiagnoseLine, formatContextOSHealthLine } from './health';
import { renderBudgetedInjection } from './render';
import { selectPagesWithMetadata } from './selection';
import type {
  ContextOSData,
  ContextOSPage,
  ContextOSRetrievalDiagnostics,
  ContextOSSelection,
  ContextOSSelectionResult,
} from './types';

export type {
  ContextOSData,
  ContextOSHealthContinuityStatus,
  ContextOSHealthSnapshot,
  ContextOSPage,
  ContextOSRetrievalDiagnostics,
  ContextOSSelection,
} from './types';

export { formatContextOSDiagnoseLine, formatContextOSHealthLine };

export class ContextOSManager {
  private _revision = 0;
  private nextSequence = 1;
  private readonly _pages: ContextOSPage[] = [];

  constructor(private readonly agent: Agent) {}

  get revision(): number {
    return this._revision;
  }

  data(): ContextOSData {
    return {
      revision: this._revision,
      pages: this._pages,
    };
  }

  health() {
    return buildHealthSnapshot(this._revision, this._pages);
  }

  clear(): void {
    if (this._pages.length === 0 && this._revision === 0) return;
    this._pages.splice(0);
    this._revision += 1;
  }

  recordCompaction(result: CompactionResult): void {
    if (result.contextPack === undefined) return;
    const sequence = this.nextSequence++;
    const page: ContextOSPage = {
      id: `ctx-page-${String(sequence)}`,
      sequence,
      contextPack: result.contextPack,
      summary: result.summary,
      rawRefs: result.rawRefs ?? [],
      actions: result.actions ?? [],
    };
    this._pages.push(page);
    if (this._pages.length > MAX_CONTEXT_OS_PAGES) {
      this._pages.splice(0, this._pages.length - MAX_CONTEXT_OS_PAGES);
    }
    this._revision += 1;
    const health = this.health();
    this.agent.telemetry.track('context_os_page_recorded', {
      page_sequence: sequence,
      context_os_status: result.contextPack.contextOS.continuity.status,
      context_os_score: result.contextPack.contextOS.continuity.score,
      raw_ref_count: result.contextPack.evidence.rawRefCount,
      action_count: result.contextPack.evidence.actionTypes.length,
      context_os_page_count: health.pageCount,
      context_os_ready_page_count: health.readyPageCount,
      context_os_needs_rehydration_page_count: health.needsRehydrationPageCount,
      context_os_at_risk_page_count: health.atRiskPageCount,
      context_os_file_hint_count: health.fileHintCount,
      context_os_raw_ref_count: health.rawRefCount,
      context_os_missing_evidence_page_count: health.missingEvidencePageCount,
      context_os_evidence_id_recall_score: health.evidenceIdRecallScore,
      context_os_latest_status: health.latestContinuityStatus,
      evidence_id_recall_score:
        result.contextPack.contextOS.qualitySignals?.evidenceIdRecallScore,
    });
  }

  select(query: string, limit = MAX_SELECTED_PAGES): readonly ContextOSSelection[] {
    return this.selectWithMetadata(query, limit).selections;
  }

  diagnose(query: string, limit = MAX_SELECTED_PAGES): ContextOSRetrievalDiagnostics {
    const result = this.selectWithMetadata(query, limit);
    return {
      health: this.health(),
      queryFileHintCount: result.queryFileHintCount,
      candidatePageCount: result.candidatePageCount,
      metadataFilteredPageCount: result.metadataFilteredPageCount,
      semanticFilteredPageCount: result.semanticFilteredPageCount,
      selectedPageCount: result.selections.length,
      selectedPageSequences: result.selections.map((selection) => selection.page.sequence),
      selectedScores: result.selections.map((selection) => selection.score),
      selectedStatuses: result.selections.map(
        (selection) => selection.page.contextPack.contextOS.continuity.status,
      ),
      selectedReasons: [...new Set(result.selections.flatMap((selection) => selection.reasons))],
      selectedEvidenceIdRecallScores: result.selections.map(
        (selection) => selection.page.contextPack.contextOS.qualitySignals?.evidenceIdRecallScore ?? 1,
      ),
      missingEvidenceReasonCount: result.selections.filter((selection) =>
        selection.reasons.includes('missing_evidence_ids'),
      ).length,
      supersededPageCount: result.supersededCount,
    };
  }

  private selectWithMetadata(query: string, limit = MAX_SELECTED_PAGES): ContextOSSelectionResult {
    return selectPagesWithMetadata(this._pages, query, limit);
  }

  buildInjection(query: string): string | undefined {
    const selectionResult = this.selectWithMetadata(query);
    const { selections: selected, supersededCount } = selectionResult;
    if (selected.length === 0) {
      this.trackRetrievalMiss(selectionResult);
      return undefined;
    }
    const injection = renderBudgetedInjection(this._revision, selected);
    if (injection === undefined) {
      this.trackRetrievalMiss(selectionResult);
      return undefined;
    }
    const health = this.health();
    this.agent.telemetry.track('context_os_pages_selected', {
      selected_count: selected.length,
      rendered_page_count: injection.pages.length,
      dropped_page_count: injection.droppedPageCount,
      compacted_page_count: injection.pages.filter((page) => page.profileName !== 'full').length,
      top_score: selected[0]?.score ?? 0,
      top_recall_eval_score: selected[0]?.page.contextPack.contextOS.qualitySignals?.recallEvalScore,
      top_evidence_id_recall_score:
        selected[0]?.page.contextPack.contextOS.qualitySignals?.evidenceIdRecallScore,
      missing_evidence_reason_count: selected.filter((selection) =>
        selection.reasons.includes('missing_evidence_ids'),
      ).length,
      context_os_missing_evidence_page_count: health.missingEvidencePageCount,
      context_os_evidence_id_recall_score: health.evidenceIdRecallScore,
      top_structured_item_count:
        selected[0]?.page.contextPack.contextOS.retrievalSignalCounts?.structuredItemCount,
      top_retrieval_query_count:
        selected[0]?.page.contextPack.contextOS.retrievalSignalCounts?.retrievalQueryCount,
      injection_chars: injection.text.length,
      revision: this._revision,
      rehydration_raw_ref_count: injection.pages.reduce((sum, page) => sum + page.rawRefCount, 0),
      bounded_rehydration: true,
      superseded_page_count: supersededCount,
      query_file_hint_count: selectionResult.queryFileHintCount,
      candidate_page_count: selectionResult.candidatePageCount,
      metadata_filtered_page_count: selectionResult.metadataFilteredPageCount,
      semantic_filtered_page_count: selectionResult.semanticFilteredPageCount,
      context_os_page_count: health.pageCount,
      context_os_ready_page_count: health.readyPageCount,
      context_os_at_risk_page_count: health.atRiskPageCount,
      context_os_file_hint_count: health.fileHintCount,
      poisoning_warning_count: injection.pages.reduce(
        (sum, page) => sum + page.poisoningWarningCount,
        0,
      ),
      audit_warning_count: injection.audit.warnings.length,
      audit_warnings: injection.audit.warnings.join(','),
    });
    return injection.text;
  }

  private trackRetrievalMiss(selectionResult: ContextOSSelectionResult): void {
    if (selectionResult.queryFileHintCount === 0 && selectionResult.candidatePageCount > 0) {
      return;
    }
    const health = this.health();
    this.agent.telemetry.track('context_os_pages_missed', {
      query_file_hint_count: selectionResult.queryFileHintCount,
      candidate_page_count: selectionResult.candidatePageCount,
      metadata_filtered_page_count: selectionResult.metadataFilteredPageCount,
      semantic_filtered_page_count: selectionResult.semanticFilteredPageCount,
      context_os_page_count: health.pageCount,
      context_os_ready_page_count: health.readyPageCount,
      context_os_at_risk_page_count: health.atRiskPageCount,
      context_os_file_hint_count: health.fileHintCount,
      revision: this._revision,
    });
  }
}
