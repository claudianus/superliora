# 02 — Prompt Engineering (2026에도 죽지 않은 층)

## 1. 위치

프롬프트 엔지니어링은 더 이상 “전부”가 아니다. 그래도 **루프 스펙의 알맹이, 스킬 본문, 도구 설명, stop-hook 피드백 문구**는 전부 프롬프트다.

루프 논문(arXiv:2607.00038)의 입장:

> learning to use the wrench does not mean throwing away the screwdriver

## 2. 역사적 계보 (코딩 에이전트에 살아남은 것)

| 계열 | 대표 | 오늘날 어디에 남았나 |
|---|---|---|
| Chain-of-Thought | Wei et al. | Thinking mode, interleaved reasoning |
| Self-Consistency | Wang et al. | 샘플·투표보다 **테스트로 다수결**이 흔함 |
| Plan-and-Solve / Least-to-Most | Wang / Zhou | Plan mode, ultraplan |
| ReAct | Yao et al. | 모든 에이전트 툴 루프의 조상 |
| Self-Refine / Reflexion | Madaan / Shinn | PostToolUse 센서 + 구두 교훈 파일 |
| Toolformer / ToolLLM | Schick / Qin | MCP · 동적 툴 로드 |
| Tree/Graph of Thoughts | Yao / Besta | 탐색형 리서치 에이전트, 비용↑ |

코딩에서는 “더 길게 생각하라”보다 **외부 검증 신호**가 이긴다. 논문도 반복한다: unaided self-correction은 피드백 없이 불안정하다.

## 3. 2026 실전 프롬프트 원칙 (코딩)

### 3.1 짧게, 실패에 뿌리내리게

- 줄마다 **실제로 일어난 사고**를 가리킬 수 있어야 한다 (aspirational rule 금지)
- 린터/타입이 이미 잡는 것을 prose로 반복하지 말 것 → **센서로 옮김**
- Vercel 등 사례: 수십 KB rules를 수 KB로 압축해도 통과율 유지 (보고 사례)

### 3.2 계약형 지시 (Goal / Loop용)

`agentic-goal-loop`가 요구하는 5요소는 사실상 프롬프트 계약이다.

1. Objective — 한 문장 결과
2. Constraints — 건드리면 안 되는 것
3. Validate — **정확한 셸 명령**
4. Stop when — 검증 가능한 종료
5. Document — 변경에 맞는 문서 갱신

### 3.3 Karpathy식 행동 골격 (현장 관행)

많은 `AGENTS.md` / 워크플로가 비슷하게 수렴한다.

1. **Think before coding** — 가정·트레이드오프를 먼저
2. **Simplicity first** — 최소 구현, 추측성 추상화 금지
3. **Surgical changes** — 드라이브바이 리팩터 금지
4. **Goal-driven execution** — 성공 기준을 루프 조건으로

### 3.4 Maker ≠ Judge 문구

모델이 스스로 “완료”를 선언하게 두지 마라.

- Bad: “작업이 끝나면 스스로 리뷰하고 머지해”
- Better: “`pnpm test`가 green일 때만 done. 리뷰는 별도 역할/세션”

## 4. 프롬프트가 놓이는 표면들

| 표면 | 로드 시점 | 길이 예산 |
|---|---|---|
| System / profile prompt | 항상 | 매우 짧게 유지 |
| `AGENTS.md` / CLAUDE.md | 세션 시작 | 보통 <150–300줄 권장 |
| Nested `AGENTS.md` | 경로 진입 시 | 도메인당 짧음 |
| Skills (`SKILL.md`) | 이름만 always, 본문 on-demand | progressive disclosure |
| Task / Plan / Loop body | 태스크당 | 목표·검증 중심 |
| Hook stderr / additionalContext | 이벤트 후 | 기계가 고칠 수 있는 에러만 |

## 5. 안티패턴

| 안티패턴 | 왜 나쁜가 | 대안 |
|---|---|---|
| 소설형 온보딩 문서 전부 주입 | context rot | 포인터 + on-demand |
| “항상 최고 품질로” | 검증 불가 | 테스트/린트/벤치 |
| 금지사항 100개 | 무시됨 | 상위 10 + PreToolUse 블록 |
| 동일 규칙을 3파일에 복제 | drift | `AGENTS.md` SSOT |
| 모델에게 정책 해석을 맡김 | 일관성 붕괴 | 훅 exit 2 |

## 6. SuperLiora에서의 프롬프트

- root / nested `AGENTS.md` — 핫패스 제약 (소스 설치 게이트, TUI 실시간성 등)
- `.agents/skills/*` — 작업별 절차 프롬프트
- `packages/agent-core` profile / plan prompts
- 도구 description — 툴 선택 품질의 1차 레버 (툴이 많으면 설명 겹침 → 혼동)

관련 스펙: 도구 과다·중복은 프롬프트만으로 해결되지 않는다 → 하네스에서 툴셋 축소 ([tool-redundancy-review](../../specs/2026-07-12-superliora-tool-redundancy-review.md)).

## 7. 연습

1. 최근 에이전트 실패 1건을 고른다.
2. “더 강한 문장”으로 고칠 수 있는지, **훅/테스트로 박을 수 있는지** 분기한다.
3. 문장으로만 남는 것은 `AGENTS.md`에 1줄 + 실패 일시를 주석으로 남긴다.

다음: [03 — Context Engineering](./03-context-engineering.md)
