# 03 — Context Engineering

## 1. 정의

> Context engineering is the art and science of filling the context window with just the right information at each step of an agent’s trajectory.  
> — LangChain, *Context Engineering for Agents*

컨텍스트 창은 **유한한 작업 메모리**다. “많이 넣을수록 좋다”는 2025 Chroma 등 연구에서 반박된다: 입력이 커질수록 프론티어 모델도 정확도가 떨어질 수 있다 (*context rot*).

## 2. 네 레버 (Write / Select / Compress / Isolate)

### Write — 밖으로 쓴다

창에 쌓지 말고 디스크·git·보드에 남긴다.

| 아티팩트 | 역할 |
|---|---|
| `feature_list.json` (Anthropic) | pass/fail이 요약에 의해 왜곡되지 않게 |
| `claude-progress.txt` / progress log | 다음 세션 오리엔테이션 |
| git commits | 불변 진실 + 롤백 |
| `PLAN.md` / ADR | 장문 목표는 파일로, 루프 objective는 짧게 |
| MEMORY / session notes | 크로스 세션 학습 (junk drawer 방지 필수) |

Anthropic (*Effective harnesses for long-running agents*, 2025-11): 긴 작업의 핵심은 **세션 간 브릿지**. Compaction만으로는 부족.

### Select — 골라 넣는다

| 기법 | 설명 |
|---|---|
| JIT file read | 에이전트가 필요할 때 Read/Grep |
| Progressive disclosure | Skill: 이름·설명만 always, 본문 on-demand |
| Path-scoped rules | `.claude/rules/`, nested `AGENTS.md` |
| Tool RAG | 툴이 많을 때 description 검색으로 후보 축소 (~3× 선택 정확도 보고 사례) |
| MCP on demand | 항상 연결하지 말고 작업에 맞게 |

### Compress — 줄인다

| 기법 | 특징 |
|---|---|
| **Compaction / summarization** | 같은 에이전트가 이어감. 연속성↑, context anxiety 잔존 가능 |
| **Context editing** | stale tool result 제거. Anthropic: 100-turn eval에서 토큰 ~84%↓, 성능↑ 보고 |
| **Tool-result truncation** | 이벤트 쪽 truncation → 모든 클라이언트 이득 (SuperLiora 원칙) |
| **Hard reset + handoff** | 창을 비우고 구조화 핸드오프로 재시작. Sonnet 4.5 context anxiety에 강함 |

Anthropic (*Harness design for long-running apps*): Opus 4.5 이후 context anxiety가 약해져 **연속 세션 + auto-compact**만으로 충분한 경우도 생김. **하네스는 모델 약점을 가정하고, 모델이 세면 스캐폴딩을 옮긴다** — 없애지 않는다.

### Isolate — 나눈다

| 기법 | 막는 실패 |
|---|---|
| Subagent / swarm 역할 분리 | 컨텍스트 오염, 자기 채점 |
| Git worktree | 병렬 에이전트 충돌 |
| Plan vs Execute 세션 | 구현 잡음이 계획 오염 |
| Maker / Checker 이중 세션 | reward hacking |

## 3. 장기 실행: Compaction vs Reset

```
                    ┌─ Compaction ──► 같은 세션, 요약된 과거
Long trajectory ───┤
                    └─ Reset+Handoff ► 새 세션, 파일에서 재구성
```

| | Compaction | Reset + Handoff |
|---|---|---|
| 연속성 | 높음 | 낮음 (파일로 재구성) |
| Context anxiety | 남을 수 있음 | 창이 깨끗 |
| 핸드오프 품질 의존 | 낮음 | **매우 높음** |
| 대표 패턴 | Claude Code auto-compact (~95%) | Anthropic initializer/coding, Ralph |

**Ralph loop** (Huntley, 2025-07; 이후 Claude Code plugin):  
`while :; do cat PROMPT.md | agent ; done`  
상태 = 파일 + git. 매 iteration fresh context. 멍청하지만 **context rot를 구조적으로 우회**.

## 4. Anthropic 장기 하네스 패턴 (필수 암기)

Initializer (1회) → Coding agent (N회)

Initializer가 남기는 것:

1. `init.sh` — 서버/환경 기동
2. `feature_list.json` — 전부 `passes: false`로 시작 (JSON이 Markdown보다 덜 훼손됨)
3. progress 파일
4. 초기 git commit

Coding agent 세션 루틴:

1. `pwd` / git log / progress / feature list 읽기
2. 기본 E2E가 도는지 확인
3. **한 기능만** 구현
4. 검증 후 `passes` 갱신, commit, progress 기록
5. clean state로 종료

실패 모드 대응표 (Anthropic):

| 문제 | 처방 |
|---|---|
| 한 방에 다 하려다 context 고갈 | 한 feature / session |
| 조기 승리 선언 | JSON feature list |
| 반쯤 구현된 채 종료 | git + progress + clean state 규칙 |
| 테스트 없이 pass | 브라우저/실제 사용자 경로 검증 |

## 5. 메모리 과학 쪽 동향 (2026)

- *Agentic Memory* (ACL 2026): STM/LTM을 RL로 통합 관리하려는 방향
- 실무는 아직 **파일 메모리 + 큐레이션**이 주류
- 논문·현장 공통: **무분별 append는 성능 저하**. Memory도 ratchet/prune 대상

## 6. AGENTS.md / CLAUDE.md 컨텍스트 예산

| 권장 | 근거 |
|---|---|
| Always-on은 짧다 (<150–300줄 흔한 가이드) | 매 턴 토큰 고정비 |
| 상세는 Skills / nested / rules | progressive disclosure |
| 크로스툴 SSOT = `AGENTS.md` | 2025말 AAIF 기증, 다수 도구 채택 |
| Claude 전용은 `CLAUDE.md`에서 `@AGENTS.md` import | 중복 방지 |

리트머스: *이 줄을 지우면 에이전트가 실제로 실수하는가?* No → 삭제.

## 7. SuperLiora 대응

| 이론 | SuperLiora |
|---|---|
| Always-on guides | root + nested `AGENTS.md` |
| Progressive skills | `.agents/skills`, `packages/agent-core` skill catalog |
| Compress | agent-core compaction / event truncation (TUI 포함 전 클라이언트) |
| Isolate | subagent, ultraswarm, worktree 관행 |
| Write | plan artifacts, session, swarm ledgers (`.superliora/`) |
| Select | Read/Grep 도구, skill discovery |

TUI 특화: **실시간 가시성**을 위해 truncation은 emitter 쪽에서 — 컨텍스트 엔지니어링이 UX와 직결.

## 8. 연습

1. 긴 세션 하나를 골라 transcript에서 “창의 절반이 오래된 tool dump”인지 본다.
2. Write할 것 / Compress할 것 / Isolate할 작업을 세 갈래로 나눈다.
3. Handoff 템플릿 초안: *한 일 / 다음 / 막힌 곳 / 검증 명령*.

다음: [04 — Harness Engineering](./04-harness-engineering.md)
