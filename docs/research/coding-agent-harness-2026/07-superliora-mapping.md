# 07 — SuperLiora 매핑

업계 이론을 SuperLiora 코드·문서 축에 꽂는 장. “우리가 이미 강한 곳 / 의도적으로 비운 곳 / 다음에 조일 곳”을 구분한다.

## 1. 아키텍처 ↔ 성숙도 층

```
apps/liora (TUI)          ── 관측·HITL·실시간 스트림 (Harness UX)
packages/tui-renderer     ── 프레임 예산·모션 (가시성 = 센서의 인간측)
packages/node-sdk         ── 공개 Harness API
packages/agent-core       ── Engine: loop / tools / skill / memory / plan / collaboration
packages/kosong           ── Model I/O
packages/kaos             ── Sandbox / FS / process
packages/server           ── Hosted harness (REST+WS)
packages/protocol         ── 스키마 (가이드의 기계 가능 형태)
.agents/skills + AGENTS.md── Guides (repo + product)
```

하드 제약 (root AGENTS.md)은 그 자체가 **ratchet된 가이드**다.

- Agent standalone (Session 없이 생성)
- `apps/liora`는 `@superliora/sdk`만, agent-core 직접 import 금지
- source-install atomic commits
- TUI 실시간: truncation은 emitter 쪽

## 2. 층별 대응표

### Prompt

| 이론 | SuperLiora |
|---|---|
| System / role | agent profiles (`packages/agent-core` profile) |
| Task contract | plan mode, ultraplan, `agentic-goal-loop` |
| Tool descriptions | builtin tools metadata |
| Skill body | `SKILL.md` catalogs |

### Context

| 이론 | SuperLiora |
|---|---|
| Always-on rules | `AGENTS.md` (root + nested) |
| Progressive disclosure | skills catalog, write-tui skill 등 |
| Write out of window | plan files, session persistence, swarm ledgers |
| Compress | agent compaction, tool-result truncation |
| Isolate | subagent host, ultraswarm collaboration |
| Select | Read/Grep/Glob tools, skill discovery |

### Harness

| 이론 | SuperLiora |
|---|---|
| Tool orchestration | `src/loop` + tools + scheduler/guards |
| Sensors | tests, `check:test-baseline`, hooks skill surface, smoke |
| Permissions | agent permission layer, YOLO/plan modes |
| Sandbox | kaos |
| Observability | telemetry package, vis apps, TUI live stream |
| Multi-agent | collaboration/swarm |

### Loop

| 이론 | SuperLiora |
|---|---|
| Internal cycle | `packages/agent-core/src/loop` (순수, host 분리) |
| External loop spec | goal-loop skill, user/CI orchestration |
| Verification ladder | vitest, smoke, baseline ratchet, e2e packages |
| Named terminals | goal-loop lifecycle: pursuing / achieved / unmet / budget-limited |
| Overnight | 사용자·스킬·외부 스케줄러 조합 (제품화 정도는 진화 중) |

## 3. 이미 이론과 잘 맞는 설계

1. **Loop purity** — 엔진과 호스트 분리 = “내부 사이클 ≠ 외부 루프 스펙”
2. **Event-side truncation** — 컨텍스트 압축 이익이 TUI·서버·SDK에 공유
3. **Nested AGENTS.md** — path-scoped progressive guides
4. **Skills as on-demand guides** — Böckeler의 guides + LangChain progressive disclosure
5. **Test baseline ratchet** — Osmani ratchet의 CI형 구현
6. **Swarm / plan specs** — maker-orchestrator·검증 게이트 실험이 `docs/specs/`에 축적
7. **Minimization roadmap** — 하네스 비대화 경계 인식 (pi 대조)

## 4. 의식적으로 관리할 긴장

| 긴장 | 설명 | 이론적 처방 |
|---|---|---|
| 풍부한 TUI vs 최소 CLI | 가시성은 센서, 복잡도이기도 함 | 로컬 핫패스 단순화 (roadmap Phase 2) |
| 툴 확장 vs 선택 혼동 | 도구↑ → prompt/context 비용↑ | core vs extended tools |
| Skill 카탈로그 비대 | always-on description 노이즈 | 검색·카테고리·risk 라벨 |
| Swarm 토큰 | isolate 이익 vs 배수 비용 | 검증 L1/L2가 있을 때만 병렬 |
| 서버 호스트 | 팀/원격에 이득, 로컬엔 과함 | in-process 경로 |

## 5. SuperLiora 기여자용 “이론 → PR” 치트시트

| 버그/불만 | 먼저 손댈 곳 | 이론 태그 |
|---|---|---|
| 에이전트가 레포 규칙 무시 | nested AGENTS / skill | Guide |
| 알고도 위험 명령 | permission / PreToolUse | Sensor |
| 긴 세션 품질 붕괴 | compaction 정책, handoff 아티팩트 | Context |
| 툴 잘못 고름 | 툴셋 축소·description 정리 | Harness |
| 완료라고 거짓말 | stop gate + validate 명령 | Loop L1/L2 |
| 서브에이전트 오염 | 역할·컨텍스트 격리 | Isolate |
| 같은 테스트 실패 반복 | baseline / CI hook | Ratchet |
| TUI에 안 보임 | emitter truncation / stream path | Observability |

## 6. 학습 과제 (레포 실습)

1. `packages/agent-core/src/loop`에서 internal cycle 경계를 읽고, host가 넣는 입력을 목록화한다.
2. 최근 본인(또는 팀) 에이전트 실패 1건을 Guide/Sensor/Context/Loop 중 하나에 PR로 고정한다.
3. `agentic-goal-loop` 템플릿으로 실제 마이그레이션/커버리지 루프 초안을 쓴다.
4. [harness-minimization-roadmap](../../specs/2026-07-12-superliora-harness-minimization-roadmap.md)의 Phase 2와 이 문서 §4 긴장을 대조한다.

## 7. 제품 포지셔닝 (내부용 한 줄)

SuperLiora의 차별점은 “더 큰 모델”이 아니라:

- **TUI 실시간 가시성**을 하네스 관측층에 기본 장착하고
- **agent-core 루프 순수성 + SDK 경계**로 엔진을 재사용 가능하게 두며
- **repo-level ratchet**(AGENTS, baseline, source-install gate)으로 실패를 구조에 누적하는 것

이론 언어로: *Sensors와 Observability가 1급인 TUI 코딩 하네스*.

다음: [08 — 참고문헌](./08-references.md)
