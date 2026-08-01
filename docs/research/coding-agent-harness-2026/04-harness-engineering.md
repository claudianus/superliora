# 04 — Harness Engineering

## 1. 정의

Harness engineering = **모델 주변의 결정적·운영적 환경**을 설계하는 일.

```
Agent = Model + Harness
```

모델: 추론.  
하네스: 무엇을 만질 수 있는지, 무엇을 봤는지, 틀린 뒤 어떻게 막히는지.

2026년 초 Hashimoto / OpenAI Codex 대규모 에이전트 출하 / Böckeler 프레임워크가 용어를 고정시켰다. Faros 등은 이를 AI 엔지니어링 **3단계(환경·자율)** 로 본다. 2026 중반에는 Loop가 4번째 층으로 분리되어 논의된다 ([01](./01-maturity-stack.md)).

## 2. Guides vs Sensors (사이버네틱스)

Böckeler (Thoughtworks):

| | Guides (feedforward) | Sensors (feedback) |
|---|---|---|
| 시점 | 행동 **전** | 행동 **후** |
| 예 | AGENTS.md, system prompt, skill, tool schema | lint, typecheck, test, Pre/PostToolUse hook, eval |
| 준수율 | ~70% (영향) | ~100% (강제에 가깝다) |
| 실패 시 | 모델이 무시 가능 | 다음 행동에 에러 주입 / 차단 |

대부분의 팀은 Guides에 과투자하고 Sensors에 과소투자한다.  
**문장으로 막는 것을 훅으로 옮기는 순간**이 하네스 성숙의 변곡점이다.

### Computational vs Inferential sensors

| 종류 | 예 | 우선순위 |
|---|---|---|
| Computational (결정적) | eslint, tsc, vitest exit code | **먼저** |
| Inferential (LLM) | 코드 리뷰 에이전트, rubric judge | 결정적이 못 닿을 때 |

LLM 리뷰어만 믿고 린트를 안 돌리는 것은 비싼 센서를 약한 자리에 쓰는 일이다.

## 3. 프로덕션 하네스 10 부품

amux / Faros / Osmani 종합:

| # | 부품 | 질문 |
|---|---|---|
| 1 | Context pipelines | 무엇을 항상/온디맨드로 넣는가 |
| 2 | Guides / Skills | 행동 전 제약 |
| 3 | Sensors | 행동 후 검증 |
| 4 | Tool interfaces | MCP, shell, browser, FS |
| 5 | Memory | 세션 넘어 무엇이 남는가 |
| 6 | Sandboxes | kaos / Docker / 권한 |
| 7 | Orchestration | subagent, swarm, worktree |
| 8 | Hooks / lifecycle | PreToolUse, PostToolUse, Stop |
| 9 | Permissions | allowlist, YOLO, HITL |
| 10 | Observability | trace, token, cost, session replay |

Faros 5층 압축: **Tool orchestration · Verification loops · Context & memory · Guardrails · Observability**.

## 4. Ratchet Principle

Osmani / Hashimoto 합류점:

> 에이전트가 실수할 때마다, **그 실수 클래스가 다시는 불가능하도록** 하네스를 조인다. 하네스는 조이기만 한다.

진단 트리:

```
실수 발생
  ├─ 규칙을 몰랐다     → Guide (AGENTS.md / skill)
  ├─ 알고도 어겼다     → Sensor (hook / CI)
  ├─ 정보가 없었다     → Context pipeline (MCP / skill)
  ├─ 위험한 툴 사용    → Permission / sandbox
  ├─ 컨텍스트 오염     → Isolate (subagent)
  └─ 아무도 몰랐다     → Observability
```

**Zero aspirational rules**: 실패 일시를 못 가리키면 그 줄은 삭제.

## 5. 2026 상위 기법 인벤토리

capitalandcompute / Osmani 계열에서 이름이 붙은 것들:

| 기법 | 제거하는 실패 | 비용 |
|---|---|---|
| Ratchet rules | 같은 실수 반복 | 거의 0 토큰, 규율 |
| Memory files as learning | 매 세션 재교육 | always-on 소량 |
| Spec-driven development | 유창하게 틀린 구현 | 스펙 작성 시간 |
| Ralph loops | 긴 작업 context rot | iteration마다 state 재독 |
| Context resets + handoffs | 창 가득 시 판단 저하 | handoff 품질 |
| Evaluator agents | 자기 채점 | 2nd agent 토큰 |
| Worktrees + orchestration | 직렬·단일 관점 | 배수 비용 |

### Spec-driven development (SDD)

Vibe coding의 반대. Spec Kit / Kiro / OpenSpec 등.

```
intent → versioned spec → plan → tasks → code against spec
```

탐색 단계에는 과함. **멀티세션·멀티에이전트·틀린 구현 비용이 큰 곳**에서 이김.

### Evaluator split

Anthropic 장기 앱 하네스: planner / generator / **별도 evaluator**(few-shot 보정 + 명시 루브릭).  
같은 컨텍스트의 자기 승인은 reward hacking을 부른다 (루프 논문이 인용하는 문헌선).

## 6. 훅 설계 패턴 (실무)

| 훅 | 용도 | 관례 |
|---|---|---|
| PreToolUse | 파괴적 명령·비밀 파일 차단 | exit 2 + stderr 이유 → 에이전트에 피드백 |
| PostToolUse | 편집 후 lint/type/test | JSON `additionalContext`로 주입 (stdout 평문은 무시되는 도구 있음) |
| Stop | “완료” 선언 시 테스트 게이트 | `stop_hook_active`로 무한루프 방지 |

품질 루프:

```
Edit → PostToolUse sensor → errors in context → agent fixes → repeat
```

사람 개입 없이 닫히는 루프가 하네스의 ROI다.

## 7. 메트릭 (리더용)

Faros 권장 베이스라인:

- cost per merged PR
- time-to-merge (agent-assisted)
- review velocity vs PR size
- compute spend per developer

에이전트 팀 내부:

- 재발 실수 클래스 수 (ratchet 속도)
- L1/L2 검증으로 끝나는 작업 비율
- handoff 후 다음 세션 cold-start 시간
- 조기 승리 선언 비율

## 8. 최소 하네스 → 확장 순서

1. 짧은 `AGENTS.md` + 빌드/테스트 명령
2. PreToolUse 안전 게이트
3. PostToolUse computational sensors
4. Skills (상세 절차 on-demand)
5. Memory + prune 규칙
6. Plan / Spec 게이트
7. Evaluator / swarm
8. Overnight Ralph + budget + named terminals

**Start simple.** 복잡도는 실패 모드가 생길 때만.

## 9. SuperLiora 하네스 좌표

| 부품 | 위치 |
|---|---|
| Engine loop | `packages/agent-core/src/loop` |
| Tools / policies | `packages/agent-core/src/tools` |
| Skills | `packages/agent-core/src/skill`, `.agents/skills` |
| Memory | `packages/agent-core/src/memory` |
| Sandbox / FS | `packages/kaos` |
| LLM | `packages/kosong` |
| Public harness API | `packages/node-sdk` (`@superliora/sdk`) |
| TUI | `apps/liora` + `packages/tui-renderer` |
| Server host | `packages/server` |
| Repo ratchet | `pnpm run check:test-baseline`, source-install gate |
| Design tension | [harness-minimization-roadmap](../../specs/2026-07-12-superliora-harness-minimization-roadmap.md) |

설계 긴장: **기능을 쌓는 하네스** vs **pi처럼 최소 폐쇄 루프**. SuperLiora는 서버·TUI·swarm을 가지므로 “완전 pi화”는 목표가 아니고, **로컬 핫패스를 가볍게** 유지하는 것이 목표다.

## 10. 안티패턴

- Guides만 늘리고 CI/훅은 그대로
- 툴 20개 always-on (선택 혼동)
- 관측 없이 overnight
- “YOLO로 생산성”만 보고 감사 로그 없음
- 하네스 문서와 코드 drift

다음: [05 — Loop Engineering](./05-loop-engineering.md)
