# Super Kimi Code 오토 컴팩션 메커니즘 분석 보고서

**분석 일자:** 2026-06-27
**대상 리포지토리:** `/Users/modumaru/Documents/super-kimi-code`
**핵심 패키지:** `packages/agent-core/src/agent/compaction/`

---

## 1. Executive Summary

Super Kimi Code의 오토 컴팩션은 **4계층 하이브리드 아키텍처**로 구성되어 있습니다:

1. **전략 계층 (Strategy):** Ratio + Absolute Token 기반 트리거
2. **풀 컴팩션 (Full Compaction):** LLM 기반 요약, 병렬 블록 처리, 앵커 문서, 구조화 팩트
3. **마이크로 컴팩션 (Micro Compaction):** 툴 결과 선택적 트렁케이션
4. **메모리 계층 (Memory):** 추출된 팩트와 앵커 문서의 영속적 관리

**발견 및 수정한 버그:**
- `retryCount` off-by-one: `MAX_COMPACTION_RETRY_ATTEMPTS = 5` 설정에도 4번만 재시도하던 버그 수정
- Parallel block thresholds를 모델별로 configurable하게 변경
- Parallel block summarization에서 usage 미추적 문제 개선 (aggregate tracking)
- `extractAnchorDiff`의 헤딩 레벨 유연성 개선 (`##` → `#{1,4}`)
- `extractFactsFromSummary`에 URL, API endpoint, test result, version 패턴 추가

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Compaction Trigger Layer                     │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ DefaultStrategy│  │ PipelineStrategy │  │ ToolCollapseStrategy│  │
│  │ (ratio+absolute)│  │ (multi-layer)    │  │ (tool groups)    │  │
│  └──────────────┘  └──────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Full Compaction (full.ts)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Sequential   │  │ Parallel     │  │ Anchor + Memory      │  │
│  │ Summarize    │  │ Block Split  │  │ (Incremental)        │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│  retryCount: 5 retries, usage tracking for parallel blocks     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Micro Compaction (micro.ts)                    │
│  Cache-missed + ContextUsageRatio 기반 툴 결과 트렁케이션        │
│  Flag: `KIMI_CODE_EXPERIMENTAL_MICRO_COMPACTION` (default: true) │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Context Memory (context/index.ts)            │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │ applyCompaction() │  │ project() + micro │                    │
│  │ (history replace) │  │ (compact messages)│                    │
│  └──────────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Compaction Strategy Layer (strategy.ts)

### 3.1 DefaultCompactionStrategy

```typescript
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  triggerRatio: 0.85,        // 85% context 사용 시 트리거
  blockRatio: 0.85,          // triggerRatio와 동일하면 async compaction 비활성화
  reservedContextSize: 50_000,
  maxCompactionPerTurn: Infinity,
  maxRecentMessages: 4,      // 최근 4개 메시지 보존
  maxRecentUserMessages: Infinity,
  maxRecentSizeRatio: 0.2,   // 최근 메시지가 전체 20% 이하
  minOverflowReductionRatio: 0.05,
  absoluteTriggerTokens: 200_000,  // 200k 절대 토큰 임계값
  parallelBlockThreshold: 30_000,  // 병렬 블록 분할 임계값 (NEW)
  parallelBlockTarget: 15_000,     // 병렬 블록 목표 크기 (NEW)
};
```

**Key Features:**
- **Ratio-based trigger:** `usedSize >= maxSize * 0.85`
- **Absolute trigger:** `usedSize >= 200_000` (maxSize >= 200k인 모델에 대해)
- **Safe split logic:** `canSplitAfter()` - 툴 콜/결과 그룹의 원자성 보장
- **Reserved context:** `maxSize - 50k` 도달 시 선제적 트리거
- **Configurable parallel blocks:** 모델/프로바이더별로 병렬 블록 임계값 조정 가능

**Research Alignment:**
- 200k absolute trigger는 "Lost in the Middle" (Liu et al.) 및 대형 컨텍스트 모델의 성능 저하 연구를 반영합니다. 1M+ 컨텍스트 모델도 200k 이후에는 recall accuracy가 급격히 감소합니다.

### 3.2 PipelineStrategy (2026 Best Practice)

```typescript
export class PipelineStrategy implements CompactionStrategy {
  constructor(
    private readonly strategies: readonly CompactionStrategy[],
    private readonly trigger: CompactionStrategy,
  ) {}
  // ...
}
```

- Microsoft Agent Framework의 `PipelineCompactionStrategy`에서 영감을 받음
- Gentle → Aggressive 순차 적용 가능
- `ToolCollapseStrategy` + `SlidingWindowStrategy` 조합으로 계층적 압축

### 3.3 ToolCollapseStrategy & SlidingWindowStrategy

- `ToolCollapseStrategy`: 오래된 툴 콜 그룹을 요약 메시지로 축소
- `SlidingWindowStrategy`: 최근 N개 비시스템 메시지 그룹만 유지

---

## 4. Full Compaction (full.ts)

### 4.1 Compaction Lifecycle

```typescript
// TurnFlow.runStepLoop() hooks:
beforeStep: async ({ signal }) => {
  this.flushSteerBuffer();
  this.agent.microCompaction.detect();     // Micro compaction trigger
  await this.agent.fullCompaction.beforeStep(stepSignal);  // Full compaction trigger
  await this.agent.injection.inject();
  // ...
},
afterStep: async ({ usage }) => {
  // ...
  await this.agent.fullCompaction.afterStep();  // Optional post-step compaction
  // ...
},
```

**Overflow Handling:**
```typescript
// TurnFlow.runStepLoop() catch block:
if (error instanceof APIContextOverflowError || ...ErrorCodes.CONTEXT_OVERFLOW) {
  await this.agent.fullCompaction.handleOverflowError(signal, error);
  continue; // Retry with compacted context
}
```

### 4.2 Sequential Summarize (Bug Fixed)

**Fixed Behavior:** `MAX_COMPACTION_RETRY_ATTEMPTS = 5` → 정확히 5 retries (6 total attempts)

**Fix Details:**
```typescript
// Before (buggy):
const delays = retryBackoffDelays(MAX_COMPACTION_RETRY_ATTEMPTS); // returns 4 delays
if (retryCountRef.value + 1 >= MAX_COMPACTION_RETRY_ATTEMPTS) { // throws at 4
  throw error;
}

// After (fixed):
const delays = retryBackoffDelays(MAX_COMPACTION_RETRY_ATTEMPTS + 1); // returns 5 delays
if (retryCountRef.value >= MAX_COMPACTION_RETRY_ATTEMPTS) { // throws at 5
  throw error;
}
// Plus: defensive assertion added
if (delays.length !== MAX_COMPACTION_RETRY_ATTEMPTS) {
  throw new Error(`Expected ${MAX_COMPACTION_RETRY_ATTEMPTS} retry delays, got ${delays.length}`);
}
```

### 4.3 Parallel Block Summarization (Improved)

```typescript
const parallelThreshold = this.strategy.parallelBlockThreshold ?? DEFAULT_PARALLEL_BLOCK_THRESHOLD;
if (compactedTokens > parallelThreshold && originalHistory.slice(0, compactedCount).length > 4) {
  const blocks = this.splitIntoBlocks(originalHistory.slice(0, compactedCount));
  // ... sequential block processing with aggregated usage tracking
}
```

**Improvements Applied:**
- **Configurable thresholds:** `parallelBlockThreshold`와 `parallelBlockTarget`를 `CompactionStrategy`에서 override 가능
- **Aggregated usage tracking:** 이전에는 "usage is not tracked for parallel blocks"였으나, 이제 각 block의 usage를 합산하여 `compaction_finished` telemetry에 포함
- **Sequential processing:** `Promise.all()` 대신 sequential loop로 변경하여 rate limit에 더 안전

### 4.4 Anchor Document & Memory (Improved)

**Anchor Document (anchor.ts):**
```typescript
export interface AnchorDocument {
  readonly intent: string;
  readonly changes: readonly string[];
  readonly decisions: readonly string[];
  readonly nextSteps: readonly string[];
}
```

- **Improvement:** `extractAnchorDiff`의 section matching을 `##`에서 `#{1,4}`로 확장하여 다양한 마크다운 헤딩 레벨 지원
- Factory.ai 및 Anthropic 2026 context-engineering guidance에서 영감
- Intent, Changes, Decisions, Next Steps 4개 섹션으로 증분 업데이트

**Structured Facts (memory.ts):**
```typescript
export interface ExtractedFact {
  readonly category: 'file' | 'decision' | 'error' | 'dependency' | 'config' | 'api' | 'state';
  readonly subject: string;
  readonly detail: string;
  readonly importance: 'critical' | 'important' | 'contextual';
}
```

- **Improvement:** URL (`https://...`), API endpoint (`GET /api/...`), test result (`1 passed, 2 failed`), version (`v1.0.0`) 패턴 추가
- MemGPT-style hierarchical memory 개념 적용
- Rule-based extraction: 파일 경로, 에러, 결정, 의존성, 설정, API, 상태 패턴 매칭
- Dedup & merge across compactions → `MAX_FACTS = 50`, `FACT_TOKEN_BUDGET = 2000`

---

## 5. Micro Compaction (micro.ts)

```typescript
export interface MicroCompactionConfig {
  keepRecentMessages: 20;       // 최근 20개 메시지 보존
  minContentTokens: 100;        // 100토큰 이상 콘텐츠만 대상
  cacheMissedThresholdMs: 3600000;  // 1시간 캐시 미스
  truncatedMarker: '[Old tool result content cleared]';
  minContextUsageRatio: 0.5;    // 50% 이상 사용 시만 작동
}
```

**Trigger Conditions:**
1. `micro_compaction` flag enabled (default: true)
2. `cacheAgeMs >= 1 hour` (last assistant message > 1 hour ago)
3. `contextUsageRatio >= 0.5` (50% 이상 컨텍스트 사용)

**Mechanism:**
- Cutoff 이전의 `tool` role 메시지 중 `estimateTokensForContentParts >= 100`인 것들을 `[Old tool result content cleared]`로 교체
- 실제 히스토리를 변경하지 않고 `project()` 시점에 적용 (non-destructive)

---

## 6. Context Integration (context/index.ts)

```typescript
applyCompaction(result: CompactionResult): void {
  this._history = [
    {
      role: 'assistant',
      content: [{ type: 'text', text: result.summary }],
      toolCalls: [],
      origin: { kind: 'compaction_summary' },
    },
    ...this._history.slice(result.compactedCount),
  ];
  this._tokenCount = result.tokensAfter;
  this.tokenCountCoveredMessageCount = this._history.length;
  // ...
}
```

- Compaction summary를 단일 assistant 메시지로 삽입
- `origin: { kind: 'compaction_summary' }`로 undo boundary 설정
- `undo()` 시 compaction summary 이전까지만 rollback 가능

---

## 7. 2026년 최신 연구 및 베스트 프랙티스 비교

### 7.1 이미 반영된 현대적 기법

| 기법 | 코드 구현 | 연구 출처 |
|------|----------|----------|
| **Absolute Token Trigger (200k)** | `absoluteTriggerTokens: 200_000` | Lost in the Middle (2023), 확장된 후속 연구들 |
| **Hierarchical Memory** | `extractedFacts` + `AnchorDocument` | MemGPT (2023), 이후 개선 연구들 |
| **Incremental Summarization** | `AnchorDocument` diff append | Factory.ai, Anthropic context engineering (2024-2026) |
| **Parallel Block Summarization** | `splitIntoBlocks()` + usage aggregation | Map-reduce summarization (2024-2025) |
| **Multi-Strategy Pipeline** | `PipelineStrategy` | Microsoft Agent Framework (2024-2025) |
| **Selective Tool Truncation** | `MicroCompaction` | LLM tool use optimization (2024-2025) |
| **Structured Fact Extraction** | Rule-based `extractFactsFromSummary()` (URL, API, test, version 추가) | Structured memory for LLM agents (2024-2026) |

### 7.2 최신 연구 동향 (2025-2026) 및 적용 가능성

**1. Semantic Chunking + Embedding-based Retrieval**
- 현재 코드는 rule-based split (`canSplitAfter`)만 사용
- **향후 개선:** 툴 콜/결과 그룹 외에 semantic similarity 기반 chunking 도입 가능
- 연구: RAPTOR (2024), GraphRAG (2024) 등의 recursive abstraction 기법

**2. Learned Compression / LLMLingua-style**
- 현재는 LLM-based summarization (expensive)
- **향후 개선:** Small language model을 활용한 prompt compression (LLMLingua-2, 2024) 도입 검토
- 토큰 비용을 30-50% 절감 가능

**3. KV-Cache-aware Compaction**
- 현재는 메시지 레벨에서만 압축
- **향후 개선:** KV-Cache reuse (vLLM, SGLang 스타일)을 고려한 compaction
- 특히 동일한 prefix를 가진 tool 결과에 효과적

**4. Multi-modal Compaction**
- 현재 `read-media.ts`, `file/read-media.ts` 등에서 이미지 처리
- **향후 개선:** Vision 컨텍스트도 포함한 compaction 전략 필요

**5. Speculative Compaction**
- 현재는 reactive (trigger-based)
- **향후 개선:** Predictive compaction - 턴 시작 전에 예상 토큰 사용량으로 선제적 compaction
- Goal mode에서의 multi-turn 예측에 특히 유용

### 7.3 아쉬운 점

**1. Summarization Quality Evaluation 부재**
- Compaction summary의 품질을 측정하는 메트릭 없음
- **개선:** ROUGE, BERTScore, 또는 task-specific success rate를 compaction 후 측정

**2. No Adaptive Retry Strategy**
- `retryBackoffDelays`는 fixed exponential backoff
- **개선:** Provider-specific rate limit, model-specific truncation pattern을 학습한 adaptive retry

**3. Limited Context-Awareness in Micro Compaction**
- `MicroCompaction`은 단순히 툴 결과를 `[Old tool result content cleared]`로 교체
- **개선:** 툴 결과의 중요도를 평가하여 선택적 보존 (e.g., error 결과는 보존)

---

## 8. 수정 사항 상세

### 8.1 Critical Bug Fix: retryCount Off-by-One

**Location:** `packages/agent-core/src/agent/compaction/full.ts:441-455`

**Root Cause:** `retryBackoffDelays(5)` returns 4 delays, but the condition `retryCount + 1 >= 5` threw at retryCount=4, meaning only 4 retries happened.

**Fix:**
1. `retryBackoffDelays(MAX_COMPACTION_RETRY_ATTEMPTS + 1)` → returns 5 delays
2. Changed condition to `retryCountRef.value >= MAX_COMPACTION_RETRY_ATTEMPTS`
3. Added defensive assertion: `if (delays.length !== MAX_COMPACTION_RETRY_ATTEMPTS) throw new Error(...)`

**Tests Updated:**
- `expect(inputs).toHaveLength(5)` → `toHaveLength(6)` (5 retries = 6 total attempts)
- `expect(attempts).toBe(5)` → `toBe(6)`
- `retryCount: 4` → `retryCount: 5` in telemetry assertions

### 8.2 Configurable Parallel Block Thresholds

**Location:** `packages/agent-core/src/agent/compaction/strategy.ts`, `full.ts`

**Changes:**
- Added `parallelBlockThreshold: number` and `parallelBlockTarget: number` to `CompactionConfig`
- Added optional `parallelBlockThreshold?: number` and `parallelBlockTarget?: number` to `CompactionStrategy` interface
- Replaced hardcoded `PARALLEL_BLOCK_THRESHOLD = 30_000` and `PARALLEL_BLOCK_TARGET = 15_000` with `DEFAULT_PARALLEL_BLOCK_THRESHOLD` and `DEFAULT_PARALLEL_BLOCK_TARGET`
- `splitIntoBlocks()` now reads from `this.strategy.parallelBlockThreshold ?? DEFAULT_PARALLEL_BLOCK_THRESHOLD`

**Tests Updated:** All inline `CompactionConfig` objects in `full.test.ts` and `strategy.test.ts` now include the new fields.

### 8.3 Parallel Block Usage Tracking

**Location:** `packages/agent-core/src/agent/compaction/full.ts`

**Changes:**
- Replaced `Promise.all()` with sequential loop to avoid rate limit issues
- Aggregated each block's `TokenUsage` into a single `blockUsage` variable
- Set `usage = blockUsage` so telemetry `compaction_finished` event includes correct usage
- Removed the "usage is not tracked for parallel blocks" comment

### 8.4 Enhanced Fact Extraction

**Location:** `packages/agent-core/src/agent/compaction/memory.ts`

**Changes:**
- Added URL pattern: `https?://[^\s]+`
- Added API endpoint pattern: `(GET|POST|PUT|DELETE|PATCH)\s+[^\s]+`
- Added test result pattern: `\d+\s+(passed|failed|skipped)|test\s+(passing|failing)|coverage\s+\d+%`
- Added version pattern: `(version|v)\s*\d+\.\d+(?:\.\d+)?`

### 8.5 Anchor Diff Robustness

**Location:** `packages/agent-core/src/agent/compaction/anchor.ts`

**Changes:**
- Changed section matching regex from `^##?\s*...` to `^#{1,4}\s*...`
- Now supports `###`, `####` heading levels in addition to `##`

---

## 9. Code Quality Assessment

### Strengths
1. **Layered Architecture:** Strategy → Full → Micro → Memory로 명확히 분리
2. **Safety:** `canSplitAfter()`로 툴 콜/결과 원자성 보장
3. **Observability:** Telemetry 이벤트 (`compaction_finished`, `compaction_failed`, `micro_compaction_finished`) 풍부
4. **Undo Support:** `compaction_summary` origin으로 undo boundary 제공
5. **Experimental Flags:** `micro_compaction` flag로 안전한 rollout
6. **Usage Tracking:** Parallel block summarization도 usage 포함 (NEW)
7. **Flexible Config:** 모델별 parallel block threshold 조정 가능 (NEW)

### Weaknesses
1. **No Compaction Quality Feedback Loop:** 요약 품질을 측정하고 전략을 조정하는 메커니즘 부재
2. **No Adaptive Retry Strategy:** `retryBackoffDelays`는 fixed exponential backoff
3. **Limited Context-Awareness in Micro Compaction:** `MicroCompaction`은 단순 툴 결과 교체
4. **Parallel Block Summary Coherence:** 병렬 블록 요약 시 블록 간 의존성/흐름 손실 가능성

---

## 10. Recommendations

### Immediate (P0) - Completed
1. ✅ **Fix `retryCount` off-by-one bug** in `sequentialSummarize`
2. ✅ **Add `delays.length` assertion** to catch mismatch early
3. ✅ **Make parallel block thresholds configurable** per model/provider
4. ✅ **Add parallel block usage tracking** for complete telemetry
5. ✅ **Improve `extractAnchorDiff` robustness** with flexible heading levels
6. ✅ **Enhance `extractFactsFromSummary`** with URL, API, test, version patterns

### Short-term (P1)
7. **Add compaction quality metric** (e.g., post-compaction task success rate)
8. **Improve `extractAnchorDiff` parsing** with more structured approach (e.g., YAML frontmatter)

### Long-term (P2)
9. **Evaluate LLMLingua-style learned compression** for cost reduction
10. **Explore KV-Cache-aware compaction** for performance
11. **Implement semantic chunking** for better split boundaries
12. **Add speculative/predictive compaction** for goal mode optimization

---

## 11. Test Results

```
compaction/full.test.ts    48 passed
compaction/strategy.test.ts 12 passed
compaction/micro.test.ts   25 passed
---------------------------------
전체 compaction 테스트        85 passed
```

---

*Report generated by code analysis of `/Users/modumaru/Documents/super-kimi-code` with reference to 2024-2026 LLM context management research.*
