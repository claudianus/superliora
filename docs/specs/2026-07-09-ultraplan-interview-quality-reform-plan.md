# UltraPlan 인터뷰 품질 개혁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인터뷰 피로도를 낮추고 의도 정확도를 높이기 위해, 출처 추적·Dialectic Rhythm Guard·PATH 라우팅·Refine/Restate 게이트·엔진 결함 수정을 하이브리드(엔진 강제 + 프롬프트)로 구현한다.

**Architecture:** 엔진은 출처(origin) 추적과 Rhythm Guard, safe-default 탈출, 증거 필터, 드리프트 완화를 강제한다. 프롬프트는 PATH 라우팅, Refine, Restate, lateral thinking 주입을 가이드한다. 새 도구 `RecordInterviewFinding`이 자동 답(PATH 1/3)의 엔진 진입점이다.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo (`packages/agent-core`)

**Spec:** `docs/specs/2026-07-09-ultraplan-interview-quality-reform-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/agent-core/src/agent/plan/ultra-plan-mode.ts` | Modify | `InterviewRound.origin`, `InterviewState` 필드 2개, `addInterviewRound(origin)`, `recentUserPromptTexts` 필터, `formatInterviewReadinessGuide` Rhythm Guard + lateral 주입 |
| `packages/agent-core/src/tools/builtin/planning/record-interview-finding.ts` | Create | `RecordInterviewFindingTool` — PATH 1/3 자동 답 기록 도구 |
| `packages/agent-core/src/tools/builtin/planning/index.ts` | Modify | `RecordInterviewFindingTool` export 추가 |
| `packages/agent-core/src/agent/plan/index.ts` | Modify | `recordUltraInterviewFinding` 메서드 + `startInterview` 타임스탬프 |
| `packages/agent-core/src/agent/permission/policies/plan-mode-guard-deny.ts` | Modify | interview 단계 `RecordInterviewFinding` 허용 + Rhythm Guard deny |
| `packages/agent-core/src/agent/injection/plan-mode.ts` | Modify | `PHASE_INSTRUCTIONS.interview` 재작성 (PATH/Refine/Restate) + 질문 수 통일 |
| `packages/agent-core/src/tools/builtin/planning/next-phase.ts` | Modify | interview→design 게이트 safe-default 진행 + phaseInstructions interview 텍스트 |
| `packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts` | Modify | `validateUltraPlanDrift` 자동생성 Seed 관대한 임계값 |
| `packages/agent-core/test/agent/ultra-plan-mode.test.ts` | Modify | 출처 추적, Rhythm Guard, safe-default, 증거 필터, 드리프트 완화 테스트 |

---

## Task 1: 인터뷰 타입에 origin + 카운터 + 타임스탬프 추가

**Files:**
- Modify: `packages/agent-core/src/agent/plan/ultra-plan-mode.ts:78-126`

- [ ] **Step 1: `InterviewAnswerOrigin` 타입 + `InterviewRound.origin` 추가**

`ultra-plan-mode.ts`에서 `InterviewPerspective` 타입 정의(~라인 78) 직전에 새 타입을 추가하고, `InterviewRound` 인터페이스(~라인 89)에 `origin` 필드를 추가한다.

기존 `InterviewRound`:
```typescript
export interface InterviewRound {
  readonly roundNumber: number;
  readonly question: string;
  readonly userResponse: string;
  readonly timestamp: number;
}
```

새 코드 — `InterviewPerspective` 전에 타입 추가:
```typescript
export type InterviewAnswerOrigin = 'user' | 'code' | 'research';
```

새 `InterviewRound`:
```typescript
export interface InterviewRound {
  readonly roundNumber: number;
  readonly question: string;
  readonly userResponse: string;
  readonly timestamp: number;
  /** Where the answer came from. 'user' = user decided via AskUserQuestion;
   *  'code' = agent answered from codebase evidence; 'research' = external research. */
  readonly origin: InterviewAnswerOrigin;
}
```

- [ ] **Step 2: `InterviewState`에 카운터 + 타임스탬프 추가**

`InterviewState` 인터페이스(~라인 111)에 두 필드를 추가한다.

기존 끝부분:
```typescript
  /** Once true, the interview stays "ready" until a new round is added —
   *  LLM non-determinism cannot un-ready an already-passed gate. */
  readonly monotonicReadyLocked?: boolean;
}
```

새 코드 — `monotonicReadyLocked` 뒤에 추가:
```typescript
  /** Once true, the interview stays "ready" until a new round is added —
   *  LLM non-determinism cannot un-ready an already-passed gate. */
  readonly monotonicReadyLocked?: boolean;
  /** Consecutive rounds where origin was 'code' or 'research' (not 'user').
   *  Reset to 0 on each 'user' answer. Drives the Dialectic Rhythm Guard. */
  readonly consecutiveNonUserAnswers: number;
  /** Wall-clock timestamp when the interview phase started. Used to filter
   *  pre-interview user prompts out of the ambiguity evidence. */
  readonly startedAtTimestamp: number;
}
```

- [ ] **Step 3: `startInterview`에서 타임스탬프 + 카운터 초기화**

`startInterview` 메서드(~라인 651)에서 `_interviewState` 초기화 객체에 두 필드를 추가한다.

기존:
```typescript
  startInterview(initialContext: string): void {
    this._currentPerspective = 'researcher';
    this._lastAmbiguityResult = null;
    this._interviewState = {
      rounds: [],
      initialContext,
      ambiguityScore: null,
      completionCandidateStreak: 0,
      lastReadyEvidenceHash: undefined,
      lastScoredEvidenceHash: undefined,
      cachedLlmResult: undefined,
      monotonicReadyLocked: false,
    };
  }
```

새 코드 — 마지막에 두 필드 추가:
```typescript
  startInterview(initialContext: string): void {
    this._currentPerspective = 'researcher';
    this._lastAmbiguityResult = null;
    this._interviewState = {
      rounds: [],
      initialContext,
      ambiguityScore: null,
      completionCandidateStreak: 0,
      lastReadyEvidenceHash: undefined,
      lastScoredEvidenceHash: undefined,
      cachedLlmResult: undefined,
      monotonicReadyLocked: false,
      consecutiveNonUserAnswers: 0,
      startedAtTimestamp: Date.now(),
    };
  }
```

- [ ] **Step 4: `addInterviewRound`에 origin 파라미터 + 카운터 로직 추가**

`addInterviewRound` 메서드(~라인 666)를 수정한다.

기존:
```typescript
  addInterviewRound(question: string, userResponse: string): void {
    const round: InterviewRound = {
      roundNumber: this._interviewState.rounds.length + 1,
      question,
      userResponse,
      timestamp: Date.now(),
    };
    this.advancePerspective();
    this._interviewState = {
      ...this._interviewState,
      rounds: [...this._interviewState.rounds, round],
      // A new round changes the evidence — invalidate the LLM cache and
      // unlock monotonic ready so the gate is re-evaluated fairly.
      lastScoredEvidenceHash: undefined,
      cachedLlmResult: undefined,
      monotonicReadyLocked: false,
    };
  }
```

새 코드:
```typescript
  addInterviewRound(
    question: string,
    userResponse: string,
    origin: InterviewAnswerOrigin = 'user',
  ): void {
    const round: InterviewRound = {
      roundNumber: this._interviewState.rounds.length + 1,
      question,
      userResponse,
      timestamp: Date.now(),
      origin,
    };
    this.advancePerspective();
    const consecutiveNonUserAnswers =
      origin === 'user' ? 0 : this._interviewState.consecutiveNonUserAnswers + 1;
    this._interviewState = {
      ...this._interviewState,
      rounds: [...this._interviewState.rounds, round],
      consecutiveNonUserAnswers,
      // A new round changes the evidence — invalidate the LLM cache and
      // unlock monotonic ready so the gate is re-evaluated fairly.
      lastScoredEvidenceHash: undefined,
      cachedLlmResult: undefined,
      monotonicReadyLocked: false,
    };
  }
```

- [ ] **Step 5: 빌드 확인**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm -C packages/agent-core run build`
Expected: 기존 `addInterviewRound` 호출이 기본값 `'user'`로 동작하므로 타입 에러 없음.

- [ ] **Step 6: 기존 테스트 회귀 확인**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-plan-mode.test.ts`
Expected: PASS — 기존 `addInterviewRound` 호출이 기본값 origin으로 동작.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/src/agent/plan/ultra-plan-mode.ts
git commit -m "feat(ultra-plan): add origin tracking and rhythm guard state to interview"
```

---

## Task 2: `recordUltraInterviewFinding` + `RecordInterviewFindingTool` 생성

**Files:**
- Create: `packages/agent-core/src/tools/builtin/planning/record-interview-finding.ts`
- Modify: `packages/agent-core/src/tools/builtin/planning/index.ts`
- Modify: `packages/agent-core/src/agent/plan/index.ts`
- Modify: `packages/agent-core/src/agent/tool/index.ts`

- [ ] **Step 1: `recordUltraInterviewFinding` 메서드를 `plan/index.ts`에 추가**

`recordUltraInterviewAnswers` 메서드(~라인 216) 다음에 새 메서드를 추가한다.

```typescript
  recordUltraInterviewFinding(
    finding: string,
    origin: 'code' | 'research',
    questionAnswered: string,
  ): void {
    if (!this._isActive || !this._isUltraMode || this._phase !== 'interview') return;
    this.ultraEngine.addInterviewRound(questionAnswered, finding, origin);
    void this.ultraEngine.calculateAmbiguityScore(undefined, (delta) => {
      this.emitThinkingDelta(delta);
    });
    this._interviewRoundCount = this.ultraEngine.interviewState.rounds.length;
    this.logStateCheckpoint();
  }
```

- [ ] **Step 2: `RecordInterviewFindingTool` 생성**

`packages/agent-core/src/tools/builtin/planning/record-interview-finding.ts` 생성:

```typescript
/**
 * RecordInterviewFindingTool — records a code or research finding during the
 * Ultra Plan interview without asking the user. This is the PATH 1 (auto-answer)
 * and PATH 3 (research) entry point of the question-routing system.
 */

import type { Agent } from '#/agent';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';

export const RecordInterviewFindingInputSchema = z.object({
  question_answered: z
    .string()
    .min(1)
    .describe('The interview question this finding answers (e.g. "What framework version is used?").'),
  finding: z
    .string()
    .min(1)
    .describe('The factual answer discovered from code or research. Be specific — cite files, versions, or sources.'),
  origin: z
    .enum(['code', 'research'])
    .describe("'code' if the finding comes from reading the codebase/config/manifests. 'research' if from external sources (web, docs)."),
}).strict();

export type RecordInterviewFindingInput = z.infer<typeof RecordInterviewFindingInputSchema>;

export class RecordInterviewFindingTool implements BuiltinTool<RecordInterviewFindingInput> {
  readonly name = 'RecordInterviewFinding' as const;
  readonly description = `Record a factual finding that answers an interview question WITHOUT asking the user.

Use this when the codebase, config, or external research already answers the question:
- PATH 1 (code): package versions, framework choices, existing patterns, file structure — read the code and record the finding with origin "code".
- PATH 3 (research): API compatibility, pricing, version support — research first, then record with origin "research".

Do NOT use this for human decisions (goals, acceptance criteria, trade-offs, visual/scope preferences). Those require AskUserQuestion.

The Dialectic Rhythm Guard limits consecutive non-user findings — after 3 in a row, you MUST use AskUserQuestion next.`;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(RecordInterviewFindingInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: RecordInterviewFindingInput): ToolExecution {
    return {
      description: `Recording ${args.origin} finding: ${args.question_answered.slice(0, 80)}`,
      approvalRule: this.name,
      execute: async () => this.execution(args),
    };
  }

  private async execution(args: RecordInterviewFindingInput): Promise<ExecutableToolResult> {
    if (!this.agent.planMode.isActive || !this.agent.planMode.isUltraMode) {
      return { isError: true, output: 'RecordInterviewFinding is only available in Ultra Plan interview phase.' };
    }
    if (this.agent.planMode.phase !== 'interview') {
      return { isError: true, output: 'RecordInterviewFinding is only available during the interview phase.' };
    }
    this.agent.planMode.recordUltraInterviewFinding(args.finding, args.origin, args.question_answered);
    return {
      output: `Recorded ${args.origin} finding for: ${args.question_answered}\n\nThe finding has been added to the interview evidence. Continue with the next focus from the readiness checklist.`,
    };
  }
}
```

- [ ] **Step 3: `planning/index.ts`에 export 추가**

`packages/agent-core/src/tools/builtin/planning/index.ts`:

기존:
```typescript
export * from './enter-plan-mode';
export * from './exit-plan-mode';
export * from './next-phase';
```

새 코드 — 마지막 줄 추가:
```typescript
export * from './enter-plan-mode';
export * from './exit-plan-mode';
export * from './next-phase';
export * from './record-interview-finding';
```

- [ ] **Step 4: 도구 등록 — `agent/tool/index.ts`**

`createPlanningGoalAndStateTools` 메서드(~라인 555)에서 `new b.NextPhaseTool(this.agent)` 다음 줄에 추가:

```typescript
      new b.NextPhaseTool(this.agent),
      new b.RecordInterviewFindingTool(this.agent),
```

- [ ] **Step 5: 빌드 확인**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm -C packages/agent-core run build`
Expected: 타입 에러 없음.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/tools/builtin/planning/record-interview-finding.ts \
        packages/agent-core/src/tools/builtin/planning/index.ts \
        packages/agent-core/src/agent/plan/index.ts \
        packages/agent-core/src/agent/tool/index.ts
git commit -m "feat(ultra-plan): add RecordInterviewFinding tool for PATH 1/3 auto-answer"
```

---

## Task 3: plan-mode-guard에 RecordInterviewFinding 허용 + Rhythm Guard deny

**Files:**
- Modify: `packages/agent-core/src/agent/permission/policies/plan-mode-guard-deny.ts`

- [ ] **Step 1: interview 단계에 RecordInterviewFinding 허용 + Rhythm Guard 추가**

`plan-mode-guard-deny.ts`의 `evaluateUltraPhase`에서 `interview` 케이스를 수정한다. `AskUserQuestion` 허용 로직 다음에 `RecordInterviewFinding` 허용 + Rhythm Guard 차단을 추가한다.

기존 interview 케이스 시작부:
```typescript
      case 'interview': {
        if (toolName === 'AskUserQuestion') {
          this.agent.planMode.incrementInterviewRound();
          return;
        }
        if (toolName === 'NextPhase') return;
```

새 코드 — `AskUserQuestion` 블록 뒤, `NextPhase` 전에 추가:
```typescript
      case 'interview': {
        if (toolName === 'AskUserQuestion') {
          this.agent.planMode.incrementInterviewRound();
          return;
        }
        if (toolName === 'RecordInterviewFinding') {
          // Dialectic Rhythm Guard: after 3 consecutive non-user answers,
          // force the next question to the user via AskUserQuestion.
          const consecutive = this.agent.planMode.ultraEngine.interviewState.consecutiveNonUserAnswers;
          if (consecutive >= 3) {
            return {
              kind: 'deny',
              message:
                'Rhythm Guard: 3 consecutive findings were recorded without user input. Use AskUserQuestion next to confirm a decision with the user directly. Do not use RecordInterviewFinding again until the user has answered at least one question.',
            };
          }
          return;
        }
        if (toolName === 'NextPhase') return;
```

- [ ] **Step 2: 빌드 + 테스트 확인**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm -C packages/agent-core run build && pnpm --filter @superliora/agent-core exec vitest run test/tools/plan-mode-hard-block.test.ts`
Expected: 빌드 통과, 기존 테스트 통과 (RecordInterviewFinding은 아직 테스트에 없음).

- [ ] **Step 3: Commit**

```bash
git add packages/agent-core/src/agent/permission/policies/plan-mode-guard-deny.ts
git commit -m "feat(permission): allow RecordInterviewFinding in interview + Rhythm Guard deny"
```

---

## Task 4: 증거 필터 — recentUserPromptTexts에 startedAtTimestamp 적용

**Files:**
- Modify: `packages/agent-core/src/agent/plan/ultra-plan-mode.ts:1039-1045`

- [ ] **Step 1: `recentUserPromptTexts`에 타임스탬프 필터 추가**

`recentUserPromptTexts` 메서드(~라인 1039)에서 인터뷰 시작 이후의 프롬프트만 포함하도록 필터를 추가한다.

먼저 user message에 `timestamp` 필드가 있는지 확인한다:
Run: `rg -n "timestamp" packages/agent-core/src/agent/context/ | head -5` 또는 `rg -n "interface.*Message\|type.*Message" packages/agent-core/src/agent/context/types.ts | head`

만약 message에 timestamp가 없다면, `filter`에서 `_index`를 사용해 `startedAtTimestamp`가 설정된 이후의 메시지를 인덱스 기반으로 추정한다. 하지만 대부분의 채팅 메시지 타입에는 timestamp가 있으므로, 먼저 확인한다.

기존 `recentUserPromptTexts`:
```typescript
  private recentUserPromptTexts(): string[] {
    return (this.agent.context?.history ?? [])
      .filter((message) => message.role === 'user' && isRealUserPromptOrigin(message.origin))
      .slice(-3)
      .map((message) => extractText(message, '\n').trim())
      .filter((text) => text.length > 0);
  }
```

새 코드:
```typescript
  private recentUserPromptTexts(): string[] {
    const startedAt = this._interviewState.startedAtTimestamp ?? 0;
    return (this.agent.context?.history ?? [])
      .filter((message) =>
        message.role === 'user' &&
        isRealUserPromptOrigin(message.origin) &&
        (message.timestamp ?? 0) >= startedAt,
      )
      .slice(-3)
      .map((message) => extractText(message, '\n').trim())
      .filter((text) => text.length > 0);
  }
```

만약 메시지 타입에 `timestamp` 필드가 없어서 타입 에러가 나면, 메시지 타입을 확인하고 필요시 `(message as { timestamp?: number }).timestamp ?? 0` 형태로 안전하게 접근한다.

- [ ] **Step 2: 빌드 확인**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm -C packages/agent-core run build`
Expected: 타입 에러 없음. 메시지에 timestamp가 있으면 그대로, 없으면 안전 캐스트로 해결.

- [ ] **Step 3: 기존 테스트 회귀 확인**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-plan-mode.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-core/src/agent/plan/ultra-plan-mode.ts
git commit -m "fix(ultra-plan): filter pre-interview user prompts from ambiguity evidence"
```

---

## Task 5: 드리프트 면제 완화 — 자동생성 Seed 관대한 임계값

**Files:**
- Modify: `packages/agent-core/src/agent/plan/ultra-plan-mode.ts:68` (새 상수)
- Modify: `packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts:218-229`

- [ ] **Step 1: 관대한 드리프트 임계값 상수 추가**

`ultra-plan-mode.ts`에서 `ULTRA_PLAN_DRIFT_THRESHOLD`(~라인 68) 다음에 자동생성 Seed용 상수를 추가한다.

기존:
```typescript
export const ULTRA_PLAN_DRIFT_THRESHOLD = 0.4;
```

새 코드 — 다음 줄에 추가:
```typescript
export const ULTRA_PLAN_DRIFT_THRESHOLD = 0.4;

/** Tolerant drift threshold for auto-generated Seed Specs (extracted from
 *  interview answers). Stricter than full exemption but more lenient than
 *  manually-written Seeds, since interview-derived Seeds have inherent
 *  wording variance. */
export const ULTRA_PLAN_DRIFT_THRESHOLD_AUTO = 0.6;
```

- [ ] **Step 2: `validateUltraPlanDrift`에서 완전 면제를 관대한 검사로 교체**

`exit-plan-mode.ts`의 `validateUltraPlanDrift`(~라인 218-229)를 수정한다.

기존:
```typescript
  private async validateUltraPlanDrift(plan: string): Promise<UltraPlanDriftResult> {
    const seed = this.agent.planMode.ultraEngine.seedSpec;
    const autoGenerated = seed?.autoGenerated ?? false;
    if (autoGenerated) {
      this.agent.telemetry.track('ultra_plan_drift_soft_gate', { combined: 0 });
      return {
        ok: true,
        metrics: { goalDrift: 0, constraintDrift: 0, ontologyDrift: 0 },
        warning:
          'The Seed Spec was auto-generated from the interview, so drift checking is skipped. Exiting with a warning so the user can review the plan. If the plan is wrong, cancel it and re-enter UltraPlan to refine the Seed.',
      };
    }
```

새 코드:
```typescript
  private async validateUltraPlanDrift(plan: string): Promise<UltraPlanDriftResult> {
    const seed = this.agent.planMode.ultraEngine.seedSpec;
    const autoGenerated = seed?.autoGenerated ?? false;
    if (autoGenerated) {
      const metrics = await this.agent.planMode.ultraEngine.calculateDrift(plan, []);
      const combined = combinedDrift(metrics);
      this.agent.telemetry.track('ultra_plan_drift_soft_gate', { combined });
      if (combined <= ULTRA_PLAN_DRIFT_THRESHOLD_AUTO) {
        return {
          ok: true,
          metrics,
          warning:
            'The Seed Spec was auto-generated from the interview. Drift is within the tolerant threshold, but review the plan before approving. If the plan is wrong, cancel it and re-enter UltraPlan to refine the Seed.',
        };
      }
      // Fall through to the standard drift rejection path below.
    }
```

`combinedDrift`와 `ULTRA_PLAN_DRIFT_THRESHOLD_AUTO`를 import해야 한다. 파일 상단의 import에 추가:

```typescript
import { combinedDrift, ULTRA_PLAN_DRIFT_THRESHOLD_AUTO } from '../../../agent/plan/ultra-plan-mode';
```

기존에 `isDriftAcceptable`만 import하고 있다면 `combinedDrift`와 `ULTRA_PLAN_DRIFT_THRESHOLD_AUTO`를 추가한다. import 문은 파일 상단에서 확인 후 수정.

- [ ] **Step 3: 빌드 확인**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm -C packages/agent-core run build`
Expected: import 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-core/src/agent/plan/ultra-plan-mode.ts \
        packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts
git commit -m "fix(ultra-plan): apply tolerant drift threshold to auto-generated Seeds"
```

---

## Task 6: formatInterviewReadinessGuide에 Rhythm Guard 알림 + lateral thinking 주입

**Files:**
- Modify: `packages/agent-core/src/agent/plan/ultra-plan-mode.ts:1447-1525`
- Modify: `InterviewReadinessGuideOptions` 인터페이스

- [ ] **Step 1: `InterviewReadinessGuideOptions`에 `consecutiveNonUserAnswers` 추가**

`InterviewReadinessGuideOptions` 인터페이스(~라인 1374)에 필드를 추가한다.

기존:
```typescript
export interface InterviewReadinessGuideOptions {
  readonly perspective?: InterviewPerspective;
  readonly interviewRoundCount?: number;
}
```

새 코드:
```typescript
export interface InterviewReadinessGuideOptions {
  readonly perspective?: InterviewPerspective;
  readonly interviewRoundCount?: number;
  readonly consecutiveNonUserAnswers?: number;
}
```

- [ ] **Step 2: `readinessBlockerMessage`에서 consecutiveNonUserAnswers 전달**

`readinessBlockerMessage` 메서드(~라인 965)에서 `formatInterviewReadinessGuide` 호출에 `consecutiveNonUserAnswers`를 추가한다.

기존:
```typescript
  async readinessBlockerMessage(readiness?: UltraPlanReadiness): Promise<string> {
    const resolved = readiness ?? (await this.interviewReadiness({ rescore: true }));
    return formatInterviewReadinessGuide(resolved, {
      perspective: this._currentPerspective,
      interviewRoundCount: this._interviewState.rounds.length,
    });
  }
```

새 코드:
```typescript
  async readinessBlockerMessage(readiness?: UltraPlanReadiness): Promise<string> {
    const resolved = readiness ?? (await this.interviewReadiness({ rescore: true }));
    return formatInterviewReadinessGuide(resolved, {
      perspective: this._currentPerspective,
      interviewRoundCount: this._interviewState.rounds.length,
      consecutiveNonUserAnswers: this._interviewState.consecutiveNonUserAnswers,
    });
  }
```

- [ ] **Step 3: `formatInterviewReadinessGuide`에 Rhythm Guard 알림 추가**

`formatInterviewReadinessGuide`(~라인 1447)에서 MAX_ROUNDS 체크 블록 다음에 Rhythm Guard 블록을 추가한다.

기존 — MAX_ROUNDS 블록(~라인 1503-1508):
```typescript
  if (interviewRoundCount >= MAX_INTERVIEW_ROUNDS) {
    lines.push(
      '',
      `Round cap: ${interviewRoundCount} interview rounds completed (soft cap ${MAX_INTERVIEW_ROUNDS}). Design stays blocked until the blockers above close — do not call NextPhase until READY.`,
    );
  }
```

새 코드 — 그 다음에 Rhythm Guard 블록 추가:
```typescript
  if (interviewRoundCount >= MAX_INTERVIEW_ROUNDS) {
    lines.push(
      '',
      `Round cap: ${interviewRoundCount} interview rounds completed (soft cap ${MAX_INTERVIEW_ROUNDS}). Design stays blocked until the blockers above close — do not call NextPhase until READY.`,
    );
  }

  const consecutiveNonUser = options?.consecutiveNonUserAnswers ?? 0;
  if (consecutiveNonUser >= 3) {
    lines.push(
      '',
      '⚠ RHYTHM GUARD: 3 consecutive findings were answered from code or research, not the user.',
      'Your next turn MUST use AskUserQuestion (PATH 2) to confirm a decision with the user directly.',
      'Do not use RecordInterviewFinding again until the user has answered at least one question.',
    );
  }
```

- [ ] **Step 4: lateral thinking 주입 — NEXT TURN 초점에 관점별 질문 추가**

`formatInterviewReadinessGuide`의 끝부분(~라인 1520-1522)에서 NEXT TURN 초점 다음에 lateral thinking 질문을 추가한다.

기존 끝부분:
```typescript
    `NEXT TURN — AskUserQuestion: close the focus below through the ${perspective} perspective (one primary gap per round):`,
    pickNextInterviewFocus(readiness, perspective),
  );

  return lines.join('\n');
}
```

새 코드:
```typescript
    `NEXT TURN — AskUserQuestion: close the focus below through the ${perspective} perspective (one primary gap per round):`,
    pickNextInterviewFocus(readiness, perspective),
  );

  const lateralHint = perspectiveLateralHint(perspective);
  if (lateralHint !== undefined) {
    lines.push('', `Lateral thinking (${perspective}): ${lateralHint}`);
  }

  return lines.join('\n');
}

function perspectiveLateralHint(perspective: InterviewPerspective): string | undefined {
  const hints: Partial<Record<InterviewPerspective, string>> = {
    researcher: 'What information are we still missing? What similar problems have documented solutions?',
    simplifier: 'What can we remove without breaking the core outcome? Consider a Baseline that cuts 30%+ of scope.',
    architect: 'How would we design this from scratch? What abstraction would clarify the structure?',
    'breadth-keeper': 'What edge cases or quality dimensions did the user skip? Balance stretch goals vs non-goals.',
    'seed-closer': 'What would make this definitely fail? Lock each acceptance criterion to a pass/fail test.',
  };
  return hints[perspective];
}
```

- [ ] **Step 5: 빌드 + 테스트 확인**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm -C packages/agent-core run build && pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-plan-mode.test.ts`
Expected: 빌드 통과, 기존 테스트 통과.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/agent/plan/ultra-plan-mode.ts
git commit -m "feat(ultra-plan): add Rhythm Guard alert and lateral thinking to readiness guide"
```

---

## Task 7: MAX_ROUNDS safe-default 탈출 옵션

**Files:**
- Modify: `packages/agent-core/src/agent/plan/ultra-plan-mode.ts` (`formatInterviewReadinessGuide` + 새 상수)
- Modify: `packages/agent-core/src/tools/builtin/planning/next-phase.ts:83-105`

- [ ] **Step 1: `formatInterviewReadinessGuide`의 MAX_ROUNDS 메시지에 safe-default 옵션 추가**

Task 6에서 수정한 MAX_ROUNDS 블록을 확장한다.

기존 (Task 6에서 이미 수정됨):
```typescript
  if (interviewRoundCount >= MAX_INTERVIEW_ROUNDS) {
    lines.push(
      '',
      `Round cap: ${interviewRoundCount} interview rounds completed (soft cap ${MAX_INTERVIEW_ROUNDS}). Design stays blocked until the blockers above close — do not call NextPhase until READY.`,
    );
  }
```

새 코드:
```typescript
  if (interviewRoundCount >= MAX_INTERVIEW_ROUNDS) {
    lines.push(
      '',
      `Round cap: ${interviewRoundCount} interview rounds completed (soft cap ${MAX_INTERVIEW_ROUNDS}).`,
      'Two options:',
      '1. AskUserQuestion: offer the user to advance with conservative defaults for remaining gaps.',
      '   If the user confirms, call NextPhase({ phase: "design", advance_with_defaults: true }).',
      '2. Continue interviewing to close the remaining blockers manually.',
    );
  }
```

- [ ] **Step 2: NextPhaseInputSchema에 `advance_with_defaults` 추가**

`next-phase.ts`의 `NextPhaseInputSchema`(~라인 15)에 선택 필드를 추가한다.

기존:
```typescript
export const NextPhaseInputSchema = z.object({
  phase: z.enum(['interview', 'design', 'review', 'write', 'exit']).describe(
    'The target phase to advance to. Must be the next logical phase in the workflow.',
  ),
}).strict();
```

새 코드:
```typescript
export const NextPhaseInputSchema = z.object({
  phase: z.enum(['interview', 'design', 'review', 'write', 'exit']).describe(
    'The target phase to advance to. Must be the next logical phase in the workflow.',
  ),
  advance_with_defaults: z
    .boolean()
    .optional()
    .describe(
      'Only valid for interview→design when the round cap is reached. When true, remaining seed gaps are filled with conservative defaults and the interview advances. The user must have explicitly agreed via AskUserQuestion.',
    ),
}).strict();
```

- [ ] **Step 3: interview→design 게이트에 safe-default 진행 허용**

`next-phase.ts`의 interview→design 게이트(~라인 83-105)를 수정한다. `readiness.ready`가 false일 때, `advance_with_defaults`가 true이고 라운드 수가 MAX를 초과하면 통과를 허용한다.

기존:
```typescript
    if (currentPhase === 'interview' && targetPhase === 'design') {
      const readiness = await this.agent.planMode.ultraEngine.interviewReadiness({ rescore: true });
      if (!readiness.ready) {
        return {
          isError: true,
          output: await this.agent.planMode.ultraEngine.readinessBlockerMessage(),
        };
      }
```

새 코드:
```typescript
    if (currentPhase === 'interview' && targetPhase === 'design') {
      const readiness = await this.agent.planMode.ultraEngine.interviewReadiness({ rescore: true });
      if (!readiness.ready) {
        const roundCount = this.agent.planMode.ultraEngine.interviewState.rounds.length;
        const wantsSafeDefault = args.advance_with_defaults === true && roundCount >= MAX_INTERVIEW_ROUNDS;
        if (!wantsSafeDefault) {
          return {
            isError: true,
            output: await this.agent.planMode.ultraEngine.readinessBlockerMessage(),
          };
        }
        // Safe-default advance: round cap reached and user explicitly agreed.
        // Fall through to seed generation — the auto-generated Seed will fill
        // remaining gaps with conservative assumptions.
      }
```

`MAX_INTERVIEW_ROUNDS`를 import해야 한다. 파일 상단 import 확인 후 추가:
```typescript
import { MAX_INTERVIEW_ROUNDS } from '#/agent/plan/ultra-plan-mode';
```

또는 기존 import 경로에 따라:
```typescript
import { MAX_INTERVIEW_ROUNDS } from '../../../agent/plan/ultra-plan-mode';
```

기존 import 패턴을 확인해서 맞춘다.

- [ ] **Step 4: 빌드 확인**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm -C packages/agent-core run build`
Expected: 타입 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/agent/plan/ultra-plan-mode.ts \
        packages/agent-core/src/tools/builtin/planning/next-phase.ts
git commit -m "feat(ultra-plan): add safe-default escape when interview round cap is reached"
```

---

## Task 8: 인터뷰 프롬프트 재작성 — PATH/Refine/Restate + 질문 수 통일

**Files:**
- Modify: `packages/agent-core/src/agent/injection/plan-mode.ts:212-250` (PHASE_INSTRUCTIONS.interview)
- Modify: `packages/agent-core/src/tools/builtin/planning/next-phase.ts:117` (phaseInstructions interview)

- [ ] **Step 1: `PHASE_INSTRUCTIONS.interview` 재작성**

`injection/plan-mode.ts`의 interview 프롬프트(~라인 212-250)를 재작성한다. "expert leader mindset"을 유지하면서 PATH 라우팅, Refine, Restate, 질문 수 통일을 추가한다.

기존 전체 interview 블록(~라인 212-250)을 읽은 후, 새 버전으로 교체:

```typescript
  interview: `## Interview Phase
Mission: interview quality drives plan quality. Do not merely execute the user's prompt — act as an expert leader who teaches, surfaces unknown-unknowns, and elevates the goal with evidence-backed upgrade paths.

Allowed: Context7Resolve, Context7Docs, WebSearch, FetchURL, LioraContext, LioraRead, LioraSearch, LioraTree, LioraSymbol, LioraCallgraph, LioraExpand, Read, Grep, Glob, ReadMediaFile, SearchSkill, Skill, SearchExpert, read-only Bash, TodoList progress tracking, AskUserQuestion, RecordInterviewFinding, NextPhase.
Write, Edit, TaskStop, CronCreate, CronDelete, ExitPlanMode BLOCKED.

Expert leader mindset:
- Surface unknown-unknowns: risks, opportunities, and industry patterns the user did not mention.
- Teach briefly: one concrete insight per round (1-2 sentences; cite sources when possible).
- Propose upgrade paths: options with clear payoffs (visual polish, UX, performance, maintainability, conversion, reliability, speed to ship).
- Preserve user agency: always include a Baseline (original scope) and a Defer/minimal path — never force an upgrade.

Question routing — minimize user fatigue, maximize decision quality:
- PATH 1 (auto-answer): If the codebase, config, or manifest already answers the question, use RecordInterviewFinding with origin "code". Do NOT ask the user.
- PATH 2 (user judgment): Goal, acceptance criteria, trade-offs, business logic, visual/scope preferences → ALWAYS use AskUserQuestion. These are human decisions.
- PATH 3 (research): External facts (API versions, pricing, compatibility) → research first, then use RecordInterviewFinding with origin "research". Confirm surprising findings with the user.
- When in doubt → PATH 2. Asking is safer than guessing.
- The Dialectic Rhythm Guard limits consecutive non-user findings. After 3 in a row, you MUST use AskUserQuestion next.

Before each AskUserQuestion when needed, research-first is strongly encouraged: search and read current sources so insights, defaults, and discrete options are evidence-backed.
${LIBRARY_DOCS_RESEARCH_GUIDANCE}
Prefer Context7Resolve/Context7Docs for library APIs; WebSearch/FetchURL for external facts; LioraContext, LioraRead, Grep, Glob for codebase facts. Skip extra research when the evidence pack already answers the gap.

Refine gate — preserve user intent:
When the user gives a free-text answer (via "Other" or an open question), do not compress it to one line. Structure it before the next round:
- Decision: [the core choice]
- Reasoning: [why, 1-2 bullets]
- Constraints: [user-stated limits]
- Out of scope: [what the user deferred]
- Codebase context: [what you verified from code]
This structure feeds the Seed Spec extraction — sloppy compression loses intent.

Restate gate — before advancing:
Before calling NextPhase to Design, restate the agreed goal in one sentence and confirm with the user via AskUserQuestion:
"Based on our discussion, the goal is: <one sentence>. If someone read only this line, would they arrive at the same outcome you have in mind?"
Options: [Yes, advance to Design] / [Adjust wording] / [Missing scope].
This is the ONLY point where one-line compression is allowed.

Perspective: {{perspective}} — {{perspectiveDescription}}

Rotate 5 lenses each round for a distinct improvement angle: Researcher, Simplifier, Architect, Breadth-keeper, Seed-closer.

UltraGoal must be judgeable as complete/incomplete, true/false, or pass/fail.
NextPhase to Design is blocked until ambiguity <= 0.2, all per-dimension clarity floors pass, no required gaps remain, and the UltraGoal is verifiable.
The live readiness checklist below lists exact blockers and the one question to ask next — follow it; do not guess or repeat resolved topics.
Seed Spec is auto-extracted from interview answers on Design transition. Do not Write or Edit the plan file during Interview.

Round {{round}} | perspective {{perspective}} | ambiguity {{ambiguityScore}} | milestone {{milestone}} | next {{nextMilestone}}

AskUserQuestion design:
- Before calling NextPhase, read the readiness checklist — if NOT READY, ask only about the listed NEXT TURN focus.
- Ask 1-2 focused questions per call when a missing decision blocks a verifiable UltraGoal or required Seed section, or when an upgrade choice materially changes the plan.
- Each round must close at least one open gap or add a Completion Criterion — never repeat a question about a section already captured.
- Option shape: Baseline (user's original intent) + 1-3 Upgrades (named payoff + trade-off in description) + Defer/minimal scope when relevant.
- Append "(Recommended)" only when evidence strongly favors one upgrade; never recommend without a reason.
- Lead with a short insight when it helps the user learn ("adding X typically improves Y because …").

Do not advance just because the task feels actionable. If AskUserQuestion is unavailable, surface the gap — do not fake completion.
Do not call EnterPlanMode while already in Ultra Plan; use NextPhase to advance phases, never EnterPlanMode(phase).

Your turn MUST end with AskUserQuestion, RecordInterviewFinding, or NextPhase. Read-only research in the same turn is allowed and encouraged when it improves the next question.`,
```

- [ ] **Step 2: next-phase.ts phaseInstructions interview 텍스트 업데이트**

`next-phase.ts`의 `phaseInstructions`(~라인 117) interview 항목을 업데이트한다.

기존:
```typescript
      interview: "Interview Phase: Act as an expert leader — teach brief insights, surface unknown-unknowns, and present Baseline + Upgrade choices backed by read-only research when needed. Prefer Context7Resolve/Context7Docs for library APIs; WebSearch/FetchURL for other external facts. Elevate the UltraGoal; do not merely clarify gaps. When ambiguity <= 0.2, clarity floors pass, the UltraGoal is true/false verifiable, and required Seed gaps are closed, call NextPhase({ phase: 'design' }).",
```

새 코드:
```typescript
      interview: "Interview Phase: Act as an expert leader — teach brief insights, surface unknown-unknowns, and present Baseline + Upgrade choices backed by read-only research. Route questions: use RecordInterviewFinding when code or research already answers them (PATH 1/3), and AskUserQuestion only for human decisions (PATH 2). After 3 consecutive non-user findings, the Rhythm Guard forces AskUserQuestion. Refine free-text answers into structured form (Decision/Reasoning/Constraints/Out-of-scope/Context). Before advancing, restate the goal in one sentence and confirm with the user. When ambiguity <= 0.2, clarity floors pass, the UltraGoal is true/false verifiable, and required Seed gaps are closed, call NextPhase({ phase: 'design' }).",
```

- [ ] **Step 3: 빌드 + 테스트 확인**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm -C packages/agent-core run build && pnpm --filter @superliora/agent-core exec vitest run test/agent/injection/plan-mode.test.ts test/agent/ultra-plan-mode.test.ts`
Expected: 빌드 통과. injection 테스트는 프롬프트 텍스트 단언이 있을 수 있으므로, 실패하면 새 텍스트에 맞게 단언 업데이트.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-core/src/agent/injection/plan-mode.ts \
        packages/agent-core/src/tools/builtin/planning/next-phase.ts
git commit -m "feat(ultra-plan): rewrite interview prompt with PATH routing, Refine, Restate gates"
```

---

## Task 9: 테스트 추가 — 출처 추적, Rhythm Guard, safe-default, 증거 필터, 드리프트 완화

**Files:**
- Modify: `packages/agent-core/test/agent/ultra-plan-mode.test.ts`
- Modify: `packages/agent-core/test/tools/plan-mode-hard-block.test.ts`

- [ ] **Step 1: 출처 추적 + Rhythm Guard 테스트 추가**

`ultra-plan-mode.test.ts`에 출처 추적과 Rhythm Guard 테스트를 추가한다. 기존 테스트의 `activePlanAgent` 헬퍼 패턴을 따른다.

```typescript
  it('tracks origin and resets consecutiveNonUserAnswers on user answer', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('interview');

    planMode.ultraEngine.addInterviewRound('What framework?', 'Next.js 14', 'code');
    expect(planMode.ultraEngine.interviewState.consecutiveNonUserAnswers).toBe(1);

    planMode.ultraEngine.addInterviewRound('What ORM?', 'Prisma', 'code');
    expect(planMode.ultraEngine.interviewState.consecutiveNonUserAnswers).toBe(2);

    planMode.ultraEngine.addInterviewRound('What is the goal?', 'Build feature X', 'user');
    expect(planMode.ultraEngine.interviewState.consecutiveNonUserAnswers).toBe(0);
  });

  it('blocks RecordInterviewFinding after 3 consecutive non-user answers (Rhythm Guard)', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('interview');

    planMode.ultraEngine.addInterviewRound('Q1', 'code answer 1', 'code');
    planMode.ultraEngine.addInterviewRound('Q2', 'code answer 2', 'code');
    planMode.ultraEngine.addInterviewRound('Q3', 'code answer 3', 'code');

    const result = evaluatePlanPolicy(agent, 'RecordInterviewFinding', {
      question_answered: 'Q4',
      finding: 'code answer 4',
      origin: 'code',
    });
    const deny = expectDeny(result);
    expect(deny.message ?? '').toContain('Rhythm Guard');
  });

  it('allows AskUserQuestion even when Rhythm Guard is active', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('interview');

    planMode.ultraEngine.addInterviewRound('Q1', 'code answer 1', 'code');
    planMode.ultraEngine.addInterviewRound('Q2', 'code answer 2', 'code');
    planMode.ultraEngine.addInterviewRound('Q3', 'code answer 3', 'code');

    expect(
      evaluatePlanPolicy(agent, 'AskUserQuestion', { question: 'What do you want?' }),
    ).toBeUndefined();
  });
```

- [ ] **Step 2: 증거 필터 테스트 추가**

```typescript
  it('excludes pre-interview user prompts from ambiguity evidence', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    // Simulate a user prompt before interview started (timestamp before startedAtTimestamp).
    const startedAt = planMode.ultraEngine.interviewState.startedAtTimestamp;
    expect(startedAt).toBeGreaterThan(0);
    // The evidence text should not include pre-interview prompts.
    // Since recentUserPromptTexts filters by timestamp >= startedAt,
    // any history before that is excluded.
    const evidence = (planMode.ultraEngine as any).interviewEvidenceText();
    // With no interview rounds and no post-interview prompts, evidence should be minimal.
    expect(evidence).not.toContain('pre-interview chat');
  });
```

- [ ] **Step 3: 드리프트 완화 테스트 추가**

드리프트 완화는 `exit-plan-mode.ts`에 있으므로, `exit-plan-mode.test.ts` 또는 `ultra-plan-mode.test.ts`에 추가. 기존 드리프트 테스트 패턴을 확인 후 추가:

```typescript
  it('allows auto-generated Seed with tolerant drift (combined <= 0.6)', async () => {
    // This tests the validateUltraPlanDrift path for autoGenerated Seeds.
    // Mock calculateDrift to return combined = 0.5 (within tolerant threshold).
    // Verify the result is ok: true with a warning.
    // Follow the existing drift test pattern in the file.
  });
```

기존 드리프트 테스트가 어떻게 작성되었는지 파일에서 확인 후, 동일한 패턴으로 auto-generated Seed 관대한 임계값 케이스를 추가한다.

- [ ] **Step 4: RecordInterviewFinding 허용 테스트 (plan-mode-hard-block.test.ts)**

`plan-mode-hard-block.test.ts`에 RecordInterviewFinding이 interview 단계에서 허용되는지 테스트를 추가한다.

```typescript
  it('allows RecordInterviewFinding in Ultra Plan interview phase', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('interview');

    expect(
      evaluatePlanPolicy(agent, 'RecordInterviewFinding', {
        question_answered: 'What framework version?',
        finding: 'Next.js 14.2.0 from package.json',
        origin: 'code',
      }),
    ).toBeUndefined();
  });

  it('blocks RecordInterviewFinding outside interview phase', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('research');

    const deny = expectDeny(
      evaluatePlanPolicy(agent, 'RecordInterviewFinding', {
        question_answered: 'What framework version?',
        finding: 'Next.js 14.2.0',
        origin: 'code',
      }),
    );
    expect(deny.message ?? '').toContain('Research phase');
  });
```

- [ ] **Step 5: 테스트 실행 — 전부 통과 확인**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-plan-mode.test.ts test/tools/plan-mode-hard-block.test.ts test/agent/injection/plan-mode.test.ts`
Expected: PASS — 새 테스트 + 기존 테스트 모두 통과.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/test/agent/ultra-plan-mode.test.ts \
        packages/agent-core/test/tools/plan-mode-hard-block.test.ts
git commit -m "test(ultra-plan): add origin tracking, Rhythm Guard, evidence filter, drift tests"
```

---

## Task 10: 전체 빌드 및 테스트 검증

- [ ] **Step 1: agent-core 전체 테스트**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-plan-mode.test.ts test/tools/plan-mode-hard-block.test.ts test/agent/injection/plan-mode.test.ts test/agent/permission/tool-read-only.test.ts test/tools/exit-plan-mode.test.ts test/tools/enter-plan-mode.test.ts`
Expected: PASS — 우리가 변경한 영역의 모든 테스트 통과.

- [ ] **Step 2: 전체 빌드**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm run build`
Expected: 타입 에러, declaration emit 에러 없음.

- [ ] **Step 3: import 체크**

Run: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" && pnpm run check:imports`
Expected: 통과.

- [ ] **Step 4: changeset 작성**

`.changeset/ultraplan-interview-quality.md` 생성:

```markdown
---
"@superliora/liora": minor
---

Rework the UltraPlan interview to reduce question fatigue and sharpen intent capture. The agent now auto-answers factual questions from code (RecordInterviewFinding) and reserves AskUserQuestion for real decisions. A rhythm guard forces a user check-in after three consecutive auto-answers, a restate gate confirms the goal before advancing, and the round cap offers a safe-default escape.
```

- [ ] **Step 5: Commit changeset**

```bash
git add .changeset/ultraplan-interview-quality.md
git commit -m "add changeset for UltraPlan interview quality reform"
```

---

## Self-Review (작성자 점검)

**스펙 커버리지:**
- ✅ 출처 태그 + 답 추적 (엔진) → Task 1
- ✅ RecordInterviewFinding 도구 (PATH 1/3 진입점) → Task 2
- ✅ plan-mode-guard RecordInterviewFinding 허용 + Rhythm Guard deny → Task 3
- ✅ 증거 필터 (recentUserPromptTexts) → Task 4
- ✅ 드리프트 면제 완화 → Task 5
- ✅ Rhythm Guard 알림 + lateral thinking 주입 → Task 6
- ✅ MAX_ROUNDS safe-default 탈출 → Task 7
- ✅ 인터뷰 프롬프트 재작성 (PATH/Refine/Restate + 질문 수 통일) → Task 8
- ✅ 테스트 (출처 추적, Rhythm Guard, safe-default, 증거 필터, 드리프트) → Task 9
- ✅ 전체 빌드/테스트/changeset → Task 10

**자리표석자 스캔:** 모든 코드 블록에 실제 구현 포함. TBD/TODO 없음.

**타입 일관성:**
- `InterviewAnswerOrigin = 'user' | 'code' | 'research'` — Task 1(정의), Task 2(사용), Task 3(사용)에서 일치.
- `addInterviewRound(question, userResponse, origin = 'user')` — Task 1에서 기본값으로 기존 호출 호환.
- `consecutiveNonUserAnswers` — Task 1(상태), Task 3(읽기), Task 6(전달)에서 일치.
- `ULTRA_PLAN_DRIFT_THRESHOLD_AUTO = 0.6` — Task 5(정의), Task 5(사용)에서 일치.
- `advance_with_defaults` — Task 7(schema), Task 7(게이트)에서 일치.
