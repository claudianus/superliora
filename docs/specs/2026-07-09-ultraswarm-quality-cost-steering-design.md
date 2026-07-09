# UltraSwarm 품질·비용·스티어링 종합 개선 설계

- **날짜:** 2026-07-09
- **상태:** 설계 (구현 계획 대기)
- **범위:** UltraSwarm / Ultrawork (`packages/agent-core`, `packages/protocol`, `apps/liora` TUI)

## 배경과 문제의식

UltraSwarm의 취지는 "여러 도메인 전문가 에이전트가 소통하고 협업하여 최고의 결과물을 내는 것"이다. 현재 구현은 동적 스태핑, 메시지 버스, 크로스리뷰, 합의, 내구성 복구까지 갖춘 full-featured 스웜으로, 오픈소스 생태계 기준 상위권이다. 그러나 실사용 관점에서 네 가지 구조적 한계가 있다.

### 한계 1 — 비용-효익 판정 부재
`ultraSwarmDecision()`은 `ENGAGE | DEFER` 이진 판정만 한다 (`packages/agent-core/src/agent/plan/ultra-swarm-decision.ts:5-12`). 단일 에이전트로 충분한 단순 작업과 꼭 swarm이 필요한 복잡 작업을 구분하지 못하고, 비용·강도(intensity) 정보를 다루지 않는다. 결과적으로 단일 에이전트가 1분 만에 끝낼 일에 기본 24명 전문가 × 3페이즈가 발사될 수 있다.

### 한계 2 — 스티어링 불가
UltraSwarm 도구가 `await`로 페이즈/웨이브를 실행하는 동안 부모 턴이 active 상태라, 어떤 사용자 입력도 `steerBuffer`에 갇힌다.

- 일반 Enter 입력은 `enqueueMessage`로 큐에 적체되어 UltraSwarm 도구 반환 후 *다음 턴*에 처리된다 (`apps/liora/src/tui/liora-tui.ts:1558-1568`).
- Ctrl-S(steer)는 부모 턴이 active라 `steerBuffer`로 들어가, 도구 반환 후 다음 스텝의 `beforeStep`에서야 플러시된다 (`packages/agent-core/src/agent/turn/index.ts:148-159`, `:309-317`).
- 유일한 즉시 제어 수단은 ESC/Ctrl-C(전체 취소)뿐이며 (`packages/agent-core/src/agent/turn/index.ts:249-261`), 이미 소비한 토큰과 시간이 손실된다.

추가 결함: 크래시/취소 후 재개 시 사용자의 새 의도가 묻힌다. `maybeTransformPromptForInterruptedWorkResume`이 재개 의도로 판단하면 원문 프롬프트를 표준 `recoveryPrompt`로 *교체*해버린다 (`packages/agent-core/src/ultrawork/interrupted-work-resume.ts:46-48`).

### 한계 3 — 정체성(diversity) 부족
리뷰 단계는 `assignReviewCriticEdges`의 1:1 round-robin 매핑으로 한 리뷰어가 한 타겟만 평가한다 (`packages/agent-core/src/session/ultra-swarm-critic.ts:34-47`). 모든 리뷰어가 동일 프롬프트·동일 temperature로 평가하므로 "같은 모델·같은 렌즈"라 진짜 다각 검증이 되지 않는다. 합의도 규칙 기반(`councilDecisionFromReview`, `ultra-swarm.ts:1056-1070`)이라 한 명 FAIL이면 무조건 block이며, 신뢰도·다수 의견이 반영되지 않는다.

### 한계 4 — 투명성 부족
UltraSwarm은 이미 풍부한 인라인 컴포넌트(`AgentSwarmProgressComponent`)를 가지고 있으나 (`apps/liora/src/tui/components/messages/agent-swarm-progress.ts:613-711`), (a) 트랜스크립트 스크롤 안에 갇혀 스크롤하면 사라지고, (b) 비용·토큰 추정이 없고, (c) 스티어링 포인트·debate 진행·routing 게이트 결과가 안 보이며, (d) 전문가별 색상 구분이 없다(emoji만).

## 목표

1. **결과 품질 향상** — 단일 에이전트가 놓치는 결함을 swarm이 실제로 잡아내는 구조 보장.
2. **토큰 사용 합리화** — 작업 복잡도에 비례한 강도 조절로 불필요한 swarm 발사 차단.
3. **TUI 시각적 재미와 투명성** — swarm 진행·비용·debate·스티어링을 한 화면에서 실시간 가시화.
4. **실행 중 스티어링** — "다 기다리거나 전부 취소" 딜레마 해소.

## 핵심 결정 (브레인스토밍 결과)

| 축 | 결정 |
|---|---|
| 비용-효익 | 사전 라우팅 게이트 — 오케스트레이터가 swarm 필요성과 강도를 사전 판별 |
| 스티어링 | Pause-Redirect-Resume — pause → 오케스트레이터에 새 지시 주입 → 재조정 후 resume |
| 품질 | Intra-모델 diversity — 다른 페르소나·temperature·프롬프트로 독립 채점 + 불일치 시 debate |
| TUI | 풀 대시보드 — 기존 `AgentSwarmProgressComponent` 강화 + sticky |
| 빌드 순서 | 코어 먼저 — 게이트 → diversity → 스티어링 → TUI 마무리 |

---

## 섹션 1 — 사전 라우팅 게이트 (Pre-Engage Routing Gate)

### 문제
현재 `ultraSwarmDecision()`은 `ENGAGE | DEFER` 이진 판정만 하며 비용·강도 정보가 없다.

### 설계

**1.1 Decision enum 3단계화**

`packages/agent-core/src/agent/plan/ultra-swarm-decision.ts`의 `UltraSwarmDecision`을 확장:

```ts
export type UltraSwarmDecision = 'ENGAGE' | 'ADAPTIVE' | 'DEFER';
```

- `DEFER` — 단일 에이전트로 충분. UltraSwarm 도구 호출 자체를 안 함.
- `ADAPTIVE` — swarm은 필요하지만 강도를 작게(기본 24명 → 4~6명, 리뷰 1패스). 중간 복잡도.
- `ENGAGE` — 풀 스웜. 다중 레인·다중 페이즈·diversity debate. 복잡 작업.

**1.2 게이트 데이터에 routing 필드 추가**

`UltraSwarmEngageGateData` (`packages/agent-core/src/agent/plan/ultra-swarm-engage-gate.ts:3-6`)에 routing 결과 추가:

```ts
export interface UltraSwarmEngageGateData {
  readonly planPath?: string;
  readonly reason?: string;
  readonly routing?: {
    readonly decision: 'ENGAGE' | 'ADAPTIVE' | 'DEFER';
    readonly intensity: 'light' | 'standard' | 'heavy';
    readonly estimatedExperts: number;
    readonly estimatedCostUsd?: number;
    readonly rationale: string;
  };
}
```

`packages/agent-core/src/tools/builtin/collaboration/ultra-swarm.ts:1199-1202`의 강도→전문가 수 매핑이 이 `routing.intensity`를 구동한다. `ADAPTIVE` + `light`면 기본값을 4로, `ENGAGE` + `heavy`면 24로.

**1.3 라우팅 판단 근거**

오케스트레이터가 plan에 다음 시그널을 남기도록 plan 프롬프트/체커를 보강:
- 파일/레인 수, 검증 가능한 acceptance criteria 수, 위험(보안·데이터 손실 등) 존재 여부, 단일 도메인 vs 다중 도메인.

이 시그널에서 `decision` + `intensity`를 기계적으로 도출하는 헬퍼 `routeFromPlanSignals`를 추가. LLM이 plan에 적은 메타데이터에서 추출한다.

**1.4 DEFER 경로 안전장치**

DEFER는 UltraSwarm 도구를 부르지 않지만, 사용자가 강제로 swarm을 원할 경우를 대비해 `--swarm` 플래그(또는 프롬프트 키워드)로 라우팅을 override하는 탈출구를 유지.

### 기존 코드 정합
- `ultraSwarmDecision`을 쓰는 곳(`ultra-swarm-engage-gate-deny.ts`, `ultraSwarmEngageNextAction`)은 `ADAPTIVE`도 ENGAGE 계열로 취급(= UltraSwarm 호출 허용)하도록 조정.
- `engage()` / `clear()` 흐름은 그대로, `routing` 필드만 추가되어 TUI가 소비.

---

## 섹션 2 — Pause-Redirect-Resume 스티어링

### 문제
UltraSwarm 도구 실행 중에는 어떤 사용자 입력도 swarm/서브에이전트에 실시간 도달하지 못한다. 도구 반환까지 기다리거나 전부 취소해야 한다.

### 핵심 인사이트
UltraSwarm 도구 실행은 `runPhaseExperts`가 페이즈를 순회하고 그 안에서 웨이브를 순회하는 루프 구조다 (`ultra-swarm.ts:329-394`). 이 루프는 페이즈 경계·웨이브 경계라는 자연스러운 체크포인트를 가진다. 도구 반환까지 기다릴 필요 없이 루프 안에서 pause 지점을 검사할 수 있다.

### 설계

**2.1 swarmSteer RPC (steer와 분리)**

기존 `steer`는 `steerBuffer`로 빠지는 구조적 한계가 있으므로, UltraSwarm 전용 채널을 만든다.

```ts
// packages/agent-core/src/agent/index.ts
swarmSteer(input: string): void {
  this.records.logRecord({ type: 'swarm.steer', input });
  this.ultraSwarmRuntime?.requestSteer(input);
}
```

`steer`(범용, 다음 스텝)과 `swarmSteer`(UltraSwarm 런타임에 직접)를 분리. TUI는 UltraSwarm 실행 중일 때 Ctrl-S를 `swarmSteer`로 라우팅.

`swarmSteer`는 기존 `steer`의 RPC 표면 경로(rpc → session → agent)를 그대로 미러링한다 — `session/rpc.ts`의 `steer` 핸들러 옆에 `swarmSteer` 핸들러를 추가하고, `session.steer` → `agent.steer` 사슬과 나란히 `session.swarmSteer` → `agent.swarmSteer` 사슬을 만든다. `agent.swarmSteer`가 UltraSwarm 런타임 인스턴스에 연결한다 (런타임 핸들은 UltraSwarm 도구 실행 시작 시 `agent`에 등록, 종료 시 해제).

**2.2 UltraSwarm 런타임에 steer 큐 + pause 체크포인트**

```ts
// ultra-swarm.ts 내 런타임
private steerRequests: SwarmSteerRequest[] = [];

requestSteer(input: string): void {
  this.steerRequests.push({ input, ts: Date.now() });
  this.agent.ultrawork.markPaused({ reason: 'User steering requested' });
}

private checkSteerAtCheckpoint(): 'continue' | 'pause' {
  if (this.steerRequests.length === 0) return 'continue';
  // 현재 웨이브의 진행 중 전문가는 완료 대기(자연스러운 중단점),
  // 다음 웨이브/페이즈는 발사하지 않음
  return 'pause';
}
```

pause 시 UltraSwarm 도구는 조기 반환하되, 완료된 결과는 보존하고 run은 `paused` 상태로 전환. ESC와 다른 점: 진행 중 전문가를 강제 abort하지 않고 완료시키고, 완료된 산출물을 유지.

**2.3 Redirect — 오케스트레이터에 새 지시 주입**

pause 후, 새 사용자 메시지를 오케스트레이터가 "수정된 목표"로 처리하도록 resume 시 컨텍스트에 병합. 기존 결함(원문 교체)을 직접 수정:

```ts
// packages/agent-core/src/ultrawork/interrupted-work-resume.ts
// 기존 라인 47: return { promptText: resumed.recoveryPrompt, reason: intent.reason };
// 수정:
if (blockedUltrawork) {
  const resumed = await agent.ultrawork.resume();
  if (resumed === null) return undefined;
  return {
    promptText: buildResumeWithSteering(resumed.recoveryPrompt, userText), // 병합
    reason: intent.reason,
  };
}
```

`buildResumeWithSteering`은 표준 recovery 커서(진행 상태·다음 액션) + 사용자의 새 지시를 함께 렌더링. 오케스트레이터가 "어디까지 했고, 이제 사용자가 뭘 바꾸고 싶어 하는지" 둘 다 보게 한다.

**2.4 paused 상태 — blocked와 구분**

Ultrawork 상태 머신 (`packages/agent-core/src/ultrawork/mode.ts:195-205`)에 `paused`를 추가:
- `blocked` = 크래시/취소로 인한 비자발적 중단 (기존).
- `paused` = 사용자 스티어링을 위한 자발적 중단 (새로 추가).

resume 시 `paused`는 사용자 새 지시와 함께, `blocked`는 표준 복구 프롬프트와 함께 — 의도에 맞는 처리.

**2.5 TUI 입력 분기**
- UltraSwarm 실행 중 Ctrl-S → `swarmSteer` (새 채널).
- UltraSwarm 실행 중 Enter → 큐 유지 (다음 턴) — 하지만 `swarmSteer`가 있는 것을 힌트로 표시.
- UltraSwarm 실행 중 ESC → 기존 `cancel` (전체 취소, `blocked`로 회복 가능) — 유지.

### 기존 코드 정합
- `steer()` / `steerBuffer` / `flushSteerBuffer`는 일반 턴용 그대로 유지 — 건드리지 않음.
- `swarmSteer`는 UltraSwarm 런타임 인스턴스에 직접 연결되는 별도 경로.
- `cancel()` 경로(ESC)는 그대로 — "강제 전체 중단"은 여전히 필요.
- `markInterrupted` 외에 `markPaused` 추가 — 둘은 별개 상태.

---

## 섹션 3 — Intra-모델 Diversity Debate

### 문제
페르소나만 다를 뿐 같은 렌즈로 평가하니 진짜 다각 검증이 안 된다. 단일 에이전트가 놓치는 결함을 swarm이 잡아내야 "swarm이 의미 있다"가 증명되는데, 현재는 reviewer들이 비슷한 시각으로 비슷한 걸 놓친다. 합의도 규칙 기반이라 신뢰도·다수 의견이 반영 안 된다.

### 설계

**3.1 N-independents 평가 구조 — 1:1을 N:1로**

`assignReviewCriticEdges` (`ultra-swarm-critic.ts:34-47`)의 1:1 매핑을, 핵심 산출물마다 N명(기본 2~3)의 독립 평가자가 각각 다른 렌즈로 평가하도록 변경:

```ts
export interface CriticLens {
  readonly lensId: string;        // 'adversarial' | 'spec-strict' | 'edge-case'
  readonly personaAngle: string;  // "이 산출물을 깨려고 접근해라"
  readonly temperature: number;   // 렌즈별 다른 temperature
}

function assignDiverseCriticEdges(
  reviewExpertIds: readonly { expertId: string; expertName: string }[],
  sources: readonly CriticReviewSource[],
  lenses: readonly CriticLens[],
): Map<string, DiverseCriticAssignment>
```

세 가지 내장 렌즈:
- **adversarial** — "이 산출물이 틀렸음을 증명하려 시도해라" (temperature 0.9, 공격적 프레이밍).
- **spec-strict** — "acceptance criteria를 글자 그대로 대조해라" (temperature 0.2, 엄격 프레이밍).
- **edge-case** — "경계 조건·드문 입력에서 무너지는가" (temperature 0.7, 탐색적 프레이밍).

같은 기저 모델이지만 다른 시스템 프롬프트 + 다른 temperature로 독립 평가 → 진정한 intra-모델 diversity.

**3.2 다수결/신뢰도 가중 합의**

`councilDecisionFromReview` (`ultra-swarm.ts:1056-1070`)의 단순 규칙을 교체:

```ts
interface LensVote {
  readonly lensId: string;
  readonly verdict: 'PASS' | 'BLOCKED' | 'FAIL';
  readonly confidence: number;     // 0~1, reviewer self-report
  readonly rationale: string;
}

function consensusFromDiverseVotes(votes: readonly LensVote[]): CouncilDecision {
  // 신뢰도 가중 다수결
  // - 단일 FAIL에 고신뢰도면 안전 장치로 revise
  // - 만장일치 PASS + 고신뢰도면 strong-approve (남은 페이즈 생략 옵션)
}
```

기존 "한 명 FAIL = 무조건 block"에서 → "FAIL 표의 신뢰도·근거 충분성을 가중"으로. 허위 FAIL(근거 부족)은 묵히고, 진짜 결함(구체적 증거)은 살린다.

`strong-approve`(만장일치 PASS + 고신뢰도)는 새 페이즈 게이트와 연동한다: `runPhaseExperts` (`ultra-swarm.ts:329-394`)가 각 페이즈 시작 전에 직전 페이즈의 합의 결과를 검사해, `strong-approve`면 남은 페이즈를 생략(early-exit)하거나 렌즈 수를 줄여 비용을 절감한다. 이 페이즈 게이트는 `routing.intensity`의 `light`/`standard`/`heavy`와 곱해져 작동한다.

**3.3 불일치 시 심층 debate 라운드**

렌즈 간 평결이 불일치(PASS vs FAIL 혼재)할 때, 1회 추가 라운드:
- 각 평가자가 상대 평가자의 근거를 보고 자기 평결을 유지/변경.
- `retryFailedReviewExperts` (`ultra-swarm.ts:636-687`)와 유사하지만, "실패 재시도"가 아니라 "불일치 해소" 목적.
- 비용 통제: debate 라운드는 `routing.intensity`가 `heavy`일 때만. `light`/`standard`는 1패스만.

**3.4 diversity 비용 제어 — 게이트와 연동**

diversity 렌즈 수와 debate 라운드는 섹션 1의 `routing.intensity`가 구동:
- `light` — 단일 렌즈(spec-strict), debate 없음, 1패스.
- `standard` — 2 렌즈(spec-strict + adversarial), 불일치 시 1회 debate.
- `heavy` — 3 렌즈 전부, 불일치 시 최대 1회 debate, 강제 restaff 허용.

### 기존 코드 정합
- `assignReviewCriticEdges`는 일반 N:1의 특수형(degree=1)으로 일반화 — 기존 호출처는 그대로 동작.
- `councilDecisionFromReview`를 `consensusFromDiverseVotes`로 교체, 기존 return 타입(`approve|revise|block|interrupted`) 유지 + `strong-approve` 추가(만장일치 고신뢰도 시).
- `CriticAssignment` (`ultra-swarm-critic.ts:3-10`)에 `lensId`/`temperature` 필드 추가.
- `renderExpertSystemPrompt`가 렌즈 personaAngle을 리뷰 프롬프트에 병합하도록 확장.
- `buildCriticAssignmentXml`에 렌즈 지시문 추가.

---

## 섹션 4 — TUI 풀 대시보드

### 현재 상태
UltraSwarm은 이미 풍부한 인라인 컴포넌트(`AgentSwarmProgressComponent`)를 가진다 — 팀 그리드, 협업 feed, integration report, braille 진행바. 그러나 트랜스크립트 스크롤 안에 갇혀 있고, 비용/토큰 추정·스티어링 포인트·debate 진행·routing 게이트 결과가 안 보이며, 전문가별 색상 구분이 없다.

### 설계 방침: 기존 컴포넌트 강화 (방법 A)

새 고정 리전(region-layout.ts의 측정이 3곳에 중복 동기화됨)을 만드는 대신, 기존 `AgentSwarmProgressComponent`를 풀 대시보드로 확장하고 swarm 실행 중에는 transcript 상단에 "pinned"(스크롤해도 항상 보이는 sticky) 상태가 되도록 한다.

**4.1 대시보드 레이아웃 — `renderUltraSwarmLayout()` 확장**

`agent-swarm-progress.ts:668-711`의 현재 레이아웃에 새 영역을 추가. 목표 화면:

```
┌─ UltraSwarm ─ run #7 ─ ADAPTIVE · standard ────────────────┐
│ MISSION: <한 줄 목표>                                        │
│ ┌ experts ────────────┐ ┌ bus ──────────────────────────┐  │
│ │ ◉ backend-eng  WIP │ │ S→B: found XSS in login      │  │
│ │ ◉ security     WIP │ │ B→S: fixed, re-run scan      │  │
│ │ ○ qa-tester   next │ │ ⚑ council: [spec✓ adv✗]      │  │
│ │ ⏸ (paused)        │ │                               │  │
│ └─────────────────────┘ └───────────────────────────────┘  │
│ PHASE ▸ implement [████████░░] 4/6  ·  debate: 1 lens left  │
│ cost $0.42 · 18k tok · ⏸paused · ctrl-s steer · esc stop    │
└─────────────────────────────────────────────────────────────┘
```

추가되는 정보:
- **게이트 배지** — `ADAPTIVE · standard`(섹션 1 routing 결과)를 헤더에 표시.
- **debate 상태** — 렌즈별 평결(`spec✓ adv✗`)과 남은 debate 라운드 (섹션 3).
- **비용/토큰 실시간 추정** — 누적 cost/토큰.
- **pause/steer 상태** — `⏸paused` 인디케이터 + "ctrl-s steer" 힌트 (섹션 2).
- **전문가별 색상** — `ColorPalette` 토큰(lane별) 추가, emoji + 색으로 구분.

**4.2 Sticky/pinned 동작**

swarm 실행 중 `AgentSwarmProgressComponent`가 transcript 상단에 고정. 스크롤해도 대시보드는 항상 보임. swarm 완료 시 핀 해제 + 일반 트랜스크립트 블록으로 전환(현재 동작).

**4.3 이벤트 → 대시보드 데이터 파이프라인**

기존 이벤트 라우팅(`session-event-handler.ts`의 `handleEvent`)은 그대로 두고, 새 이벤트만 추가:
- `ultrawork.routing.decided` (섹션 1) → 게이트 배지 렌더.
- `ultrawork.swarm.paused` / `ultrawork.swarm.resumed` (섹션 2) → pause 인디케이터.
- `ultrawork.council.lens_vote` (섹션 3) → debate 상태 패널.
- cost/토큰은 기존 telemetry에서 누적.

`packages/protocol/src/events.ts`에 이 이벤트 타입을 추가하고, `session-event-handler.ts`에 `handleXxx` 분기를 추가 (write-tui 스킬 규칙 준수).

**4.4 스티어링 입력 시각화**

섹션 2의 `swarmSteer`가 들어오면, 대시보드에 즉시 "⏸ steering requested → orchestrator notified" 상태를 표시. 이것이 "라이브 가시성" — 사용자가 입력이 묻히지 않고 도달했음을 즉시 확인. pause → redirect → resume 사이클 전체를 대시보드에 단계별로 표시.

**4.5 색상 토큰 추가 (규칙 준수)**

`apps/liora/src/tui/theme/colors.ts`의 `ColorPalette`에 lane별 토큰 추가:

```ts
swarmLaneBackend?: string;    // architecture/implementation
swarmLaneSecurity?: string;   // security/privacy
swarmLaneQuality?: string;    // testing/evidence
swarmLaneProduct?: string;    // product requirements
```

write-tui 스킬 규칙에 따라 `theme-schema.json` + `docs/en/customization/themes.md` + `docs/zh/customization/themes.md` + custom-theme 스킬 토큰 테이블 동기화.

### 기존 코드 정합
- `AgentSwarmProgressComponent` 확장 — 새 컴포넌트 추가가 아닌 기존 컴포넌트의 `renderUltraSwarmLayout()` 강화.
- `region-layout.ts`는 건드리지 않음 (측정 동기화 부담 없음).
- 이벤트는 `protocol/src/events.ts` + `session-event-handler.ts`의 기존 패턴 그대로.
- 테마 토큰 추가 시 write-tui 스킬의 동기화 규칙 준수.

---

## 섹션 5 — 빌드 순서 / 마일스톤

"코어 먼저" 원칙. 각 마일스톤은 독립적으로 의미 있고 검증 가능하며 changeset + 테스트를 동반해 독립 병합 가능.

### 마일스톤 1 — 사전 라우팅 게이트 + TUI 기반
**의존성:** 없음 (첫 단추)
**목표:** 단순 작업에 swarm이 발사되는 것을 막고, 복잡도에 맞춰 강도를 조절.

코어 작업:
- `UltraSwarmDecision`에 `ADAPTIVE` 추가 + `routeFromPlanSignals` 헬퍼 (`ultra-swarm-decision.ts`).
- `UltraSwarmEngageGateData`에 `routing` 필드 추가 (`engage-gate.ts`).
- `ultra-swarm.ts:1199-1202` 강도→전문가 수 매핑이 `routing.intensity`를 구동하도록 연결.
- `ultra-swarm-engage-gate-deny.ts`가 `ADAPTIVE`를 ENGAGE 계열로 취급.
- DEFER override 탈출구(`--swarm` 플래그/키워드).

TUI 기반 (병렬):
- `protocol/src/events.ts`에 `ultrawork.routing.decided` 이벤트 추가.
- `session-event-handler.ts`에 `handleUltraworkRoutingDecided` 분기.
- `AgentSwarmProgressComponent` 헤더에 routing 배지 표시.

검증: 단순 refactor 작업이 `DEFER`로 라우팅되어 swarm이 안 뜨는지, 복잡 다중 레인 작업만 `ENGAGE`/`ADAPTIVE`로 가는지. 비용 절감 효과 정량 측정.

### 마일스톤 2 — Intra-모델 Diversity Debate
**의존성:** M1의 `routing.intensity` (렌즈 수·debate 라운드를 구동).
**목표:** 단일 에이전트가 놓치는 결함을 잡아내는 핵심 메커니즘.

코어 작업:
- `CriticLens` 타입 + 3개 내장 렌즈(adversarial/spec-strict/edge-case) 정의.
- `assignReviewCriticEdges` → `assignDiverseCriticEdges` 일반화 (`ultra-swarm-critic.ts`).
- `councilDecisionFromReview` → `consensusFromDiverseVotes` 교체, `strong-approve` 추가 (`ultra-swarm.ts:1056-1070`).
- `CriticAssignment`에 `lensId`/`temperature` 필드.
- 불일치 시 debate 라운드(`heavy` intensity에서만, 1회 한정).
- `renderExpertSystemPrompt`가 렌즈 personaAngle을 리뷰 프롬프트에 병합.

TUI (병렬):
- `ultrawork.council.lens_vote` 이벤트 추가.
- 대시보드 bus 패널에 렌즈별 평결(`spec✓ adv✗`) + debate 진행 표시.

검증: 같은 결함을 단일 에이전트 vs swarm(diversity)이 잡아내는 비교. 허위 FAIL(근거 부족)이 신뢰도 가중으로 묻히는지.

### 마일스톤 3 — Pause-Redirect-Resume 스티어링
**의존성:** M1(routing/intensity), M2(council decision — strong-approve 시 조기 종료와 연동).
**목표:** "다 기다리거나 전부 취소" 딜레마 해소.

코어 작업:
- `swarmSteer` RPC 추가 (`agent/index.ts`) — `steer`와 분리된 UltraSwarm 전용 채널.
- UltraSwarm 런타임에 `steerRequests` 큐 + `checkSteerAtCheckpoint` (`ultra-swarm.ts` 루프의 페이즈/웨이브 경계).
- `paused` 상태 추가 (`mode.ts` — `blocked`와 구분).
- `buildResumeWithSteering` — `interrupted-work-resume.ts:47` 결함 수정(원문 교체 → 병합).
- TUI 입력 분기: UltraSwarm 중 Ctrl-S → `swarmSteer` 라우팅 (`liora-tui.ts` / `editor-keyboard.ts`).

TUI (병렬):
- `ultrawork.swarm.paused` / `ultrawork.swarm.resumed` 이벤트 추가.
- 대시보드 pause 인디케이터(`⏸paused`) + steering 사이클 단계 표시.
- cost/토큰 실시간 누적 표시.

검증: swarm 실행 중 스티어링이 페이즈 경계에서 pause → 새 지시 반영 → resume으로 이어지는지. resume 시 사용자 새 의도가 묻히지 않는지.

### 마일스톤 4 — TUI 풀 대시보드 마무리
**의존성:** M1·M2·M3의 이벤트/데이터가 모두 깔려 있어야 의미 있음.
**목표:** 시각적 재미 + 투명성 완성.

TUI 작업:
- `AgentSwarmProgressComponent.renderUltraSwarmLayout()` 풀 대시보드로 확장.
- sticky/pinned 동작(swarm 중 transcript 상단 고정).
- lane별 색상 토큰 추가 + 테마 동기화(`colors.ts`, `theme-schema.json`, `docs/*/themes.md`, custom-theme 스킬).
- 전문가별 색상 렌더링.
- debate/cost/steer 상태를 하나의 대시보드로 통합.

검증: swarm 실행 중 대시보드가 모든 정보(게이트·debate·비용·steer)를 한 화면에 보여주는지. 스크롤해도 sticky가 유지되는지.

### 의존성 그래프

```
M1 (게이트 + TUI 기반)
 ├──→ M2 (diversity debate) ──┐
 │                            ├──→ M3 (스티어링) ──→ M4 (TUI 마무리)
 └────────────────────────────┘
```

M1이 모든 것의 기반(`routing.intensity`가 M2 렌즈 수·M3 조기종료·M4 배지를 구동). M2와 M3는 M1 위에서 느슨하게 병렬 가능하지만, M3의 strong-approve 조기 종료가 M2 합의 결과에 의존해 순서를 둔 형태. M4는 모든 코어 이벤트가 깔린 뒤에야 의미 있으므로 마지막.

---

## 테스트 전략

각 마일스톤별로 기존 테스트 파일을 확장 (새 파일 최소화 — AGENTS.md 규칙):
- M1: `ultra-swarm-decision` / `engage-gate` 관련 기존 테스트에 `ADAPTIVE` 케이스 추가.
- M2: `ultra-swarm-critic` / `councilDecision` 관련 기존 테스트에 diversity 렌즈·가중 합의 케이스 추가.
- M3: `interrupted-work-resume` / 스티어링 관련 기존 테스트에 `paused` 상태·`buildResumeWithSteering` 케이스 추가.
- M4: `agent-swarm-progress` 렌더링 테스트에 대시보드 레이아웃 케이스 추가.

## 영향받는 패키지

- `packages/agent-core` — 게이트, 스티어링, diversity, 상태 머신 (핵심).
- `packages/protocol` — 새 이벤트 타입 4종.
- `apps/liora` — TUI 대시보드, 입력 분기, 테마 토큰.
- `docs/` — 테마 토큰 문서 동기화 (M4).

Install & Release 검증 대상(`packages/agent-core`, `apps/liora` 번들 그래프 포함)이므로 PR 전 `pnpm run build` + `check:imports` + `pnpm -C apps/liora run build` + `smoke` 통과 필수.
