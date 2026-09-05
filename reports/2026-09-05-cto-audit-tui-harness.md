# 2026-09-05 CTO 감사: TUI 코딩 에이전트 및 하네스 워크플로

대상: `liora` TUI 에이전트 + Conductor 하네스(job-desk / goal-driver / JobCreate·JobResume 파이프라인)
증거원: 2026-09-05 실사용 시뮬레이션 세션 로그(`wd_demo_f17c32e71bb9/session_bf06d4b2-*`, `session_9c49e44b-*`), 컨덕터 세션 로그(`wd_superliora_0373e614f15d/session_5d8a5671-*`), 데모 워크스페이스(`liora-sim/demo`) 최종 상태.
방법: 세션 wire.jsonl / liora.log 발췌 + 데모 워크스페이스 git 상태 직접 확인. 본 감사 자체가 하네스의 결함 3~4건을 직접 겪으며 수집되었다는 점이 품질 리스크로 작동한다(아래 ③-d).

---

## ① 실사용 시뮬레이션 실행 결과 (실측)

### 1.1 시나리오 구성

| 시나리오 | 세션 | 태스크 | 결과 |
|---|---|---|---|
| A | `wd_demo_f17c32e71bb9/session_9c49e44b-*` | `src/util.ts` slugify 태스크(테스트 동반) | 도구 호출 다수로 진행(Read 등 확인됨), 세션 10:20:22 시작 |
| B | `wd_demo_f17c32e71bb9/session_bf06d4b2-*` | `calc.ts`에 `subtract` 함수 추가(headless) | **미완료** — 아래 실측 참조 |

### 1.2 calc.ts subtract 태스크 실측

데모 워크스페이스(`C:/Users/Administrator/AppData/Local/Temp/liora-sim/demo`) 최종 상태 직접 확인:

- `calc.ts` 내용: `add` 함수만 존재. `subtract` 부재 — 워커가 코드를 수정하지 못했다(파일은 초기 상태 그대로).
- `git log --oneline`: `aa613ac init` 단 하나. 태스크 커밋 0건.
- 세션 로그 `agents/agent-0/`에는 `step.begin` 이벤트 1건만 기록 — 스폰 직후 LLM 턴이 실패로 끝났고 실질 작업 단계가 없었다.
- main lane 로그: LLM 설정(`provider=openai model=z-ai/glm-5.3-free`) 직후 요청 실패. 발췌:

> `2026-09-05T01:26:55.128Z INFO  llm config  requestId=2d6fc849 provider=openai model=z-ai/glm-5.3-free modelAlias=tokenrouter/z-ai/glm-5.3-free`
> 이후 `WARN llm request failed … errorName=APIEmptyResponseError`(세션 로그)

결론: subtract 태스크는 **실패**. 성공 여부·소요 시간을 정상 완료 기준으로 측정할 수 없었고, 실패 원인은 코드가 아니라 워커 모델(glm-5.3-free)의 응답 실패였다. 소요는 세션 타임스탬프 기준 10:26 → 10:29(약 3분)에 중단.

### 1.3 세션 재개(resume) 실측

컨덕터 세션(5d8a)의 THINK 블록에 재개 시도 관찰 기록이 남아 있다:

> THINK: "Resumed the driver — it's queued …" (time=1788572696236, 즉 2026-09-05T02:24:56Z)

- goal-driver 재개(JobResume) 후 잔여 월클록이 음수 → **1ms 클램프 → 즉사**가 2회 관측되었다(워커 THINK: "remaining budget goes negative and clamps to 1ms → instant death (observed twice on the goal-driver)").
- 재개 자체의 오버헤드보다, 재개가 원래 데드라인을 그대로 재사용하는 설계 때문에 "재개 = 즉사"가 되었다. 즉 재개 경로로는 어떤 시간도 측정 불가.
- 회수 경로로 확인된 것: 죽은 세션의 워크트리(`conductor-jmtnr3k1s2tldy5`)는 클린(미커밋 초안 없음), 옛 드라이버 워크트리(`conductor-jmtnorrgr4cb4m4`)도 커밋 가능 산물 없음(HEAD 6d4c6f0f5로 동일). 두 세션이 수집한 증거는 커밋 없이 소실 직전이었고, 본 보고서가 그 회수 산물이다.

### 1.4 감사 중 관측한 하네스·모델 오류 (liora.log 발췌)

> `2026-09-05T01:02:41.374Z WARN  llm request failed  requestId=4cde9b66 errorName=APIEmptyResponseError errorMessage="Th…`(thinking-only 응답, finishReason=truncated)
> `2026-09-05T01:13:56.950Z WARN  llm request failed  requestId=f6f909f9 turnStep=0.9 attempt=2/3 errorName=APIProvider…`(429 rate limit 계열)
> `2026-09-05T02:19:48.494Z ERROR turn failed  turnId=0 agentId=agent-1  APIEmptyResponseError…`

- 유일 워커 모델 `tokenrouter/z-ai/glm-5.3-free`는 프리 티어로 분당 8요청 제한(429 "Maximum 8 requests within 1 minutes")이 있고, 부하 시 thinking-only 응답으로 `APIEmptyResponseError`(finishReason=truncated)를 낸다.
- 같은 기간 `fleet_model_catalog` 헤더는 해당 별칭을 계속 live-healthy로 표시했다 — **헤더(주입 시점 스냅샷)와 스폰 시점 라이브 프로브의 불일치**.
- job ledger(`tools.update_store job_ledger`)는 226 스냅샷으로 잦은 상태 변화를 기록했다. `subagent.lifecycle` 이벤트만 1,191건 — 재큐/재시도가 상당수를 차지한다.

---

## ② 2026년 OSS 코딩 에이전트 대비 갭 분석

기준선: Claude Code, Codex CLI, Gemini CLI, opencode, Aider. 세션 로그에 워커가 남긴 정형 벤치마크 수치 메모는 발견되지 않았으므로(불확실성 명시), 아래는 본 감사 관측 + 해당 도구들의 공개된 설계 특성 대비 갭이다. 정량 벤치마크가 아니라 구조적 갭 중심.

| 갭 | SuperLiora 현황(관측) | OSS 에이전트 관행 |
|---|---|---|
| **체크포인트(커밋) 전략** | "탐색→마무리 배치 커밋" 패턴이 월클록 즉사와 결합해 커밋 0건으로 세션 소실(본 감사 3~4회 관측) | Claude Code/Aider는 각 변경을 즉시 파일로 기록; Aider는 편집마다 자동 git 커밋이 기본 옵션 — 세션 죽어도 산물이 남는다 |
| **장기 작업 예산** | 30분 고정 월클록 + 재개 시 예산 승계(음수→1ms 클램프) | Codex CLI/Gemini CLI는 워크스페이스 상태가 디스크에 있어 재실행 시 예산 초기화; 세션 예산 소진이 산물 소실로 이어지지 않음 |
| **모델 페일오버** | 단일 프리 모델 의존. 429/빈 응답 시 스폰 전면 마비, 카탈로그 헤더는 healthy 유지 | Claude Code(Anthropic 1st party + Bedrock/Vertex), opencode(다중 프로바이더 fallback), Aider(다중 모델 + `/model` 즉시 전환) — 하나 죽으면 다른 모델로 계속 |
| **세션 재개 UX** | JobResume이 데드라인을 재사용해 재개 자체가 즉사 | 대부분 `/resume`은 새 프로세스 예산으로 이어 받는다 — "재개"의 의미가 다름 |
| **장애 시 자가복구** | goal-desk heal 루프가 죽은 드라이버 재큐만 반복, 신규 스폰 없음(40분+ 관측) | 장애 시 사용자에게 명확한 에러를 즉시 보여주는 편이 일반적 — 무한 재큐보다 낫다 |

요약: 에이전트 엔진 자체의 도구 품질은 경쟁력이 있으나, **하네스의 예산·재개·페일오버·체크포인트 정책이 실전 장기 작업에서 산물을 보존하지 못한다**. 2026년 OSS 관점에서 가장 큰 구조적 결함은 (1) 커밋 없는 장기 실행, (2) 재개 불가능한 예산 설계, (3) 단일 모델 의존의 세 가지다.

---

## ③ 체감 순 우선순위 백로그

### (a) goal-driver 재개 시 잔여 월클록 음수 → 1ms 클램프 즉사 [최우선]

- **현상**: 30분 데드라인 소진으로 죽은 job을 JobResume하면 원래 데드라인이 그대로 재사용된다. 잔여 예산이 음수가 되고 하한 클램프(1ms)에 걸려 즉시 사망. 2회 관측(본 감사 세션에서 재현).
- **증거**: 워커 THINK "remaining budget goes negative and clamps to 1ms → instant death (observed twice on the goal-driver)"; `goal-*` kind는 `continue_from`도 거부("not affinity-eligible").
- **수정 제안**: JobResume 시 데드라인을 승계하지 않고 새 예산(또는 최소 리저브)을 부여. 최소한 음수 잔여는 "즉시 실패 + 명확한 안내"로 바꾸고, implement kind에만 허용된 예산 리셋을 resume 경로에도 적용.

### (b) goal-desk heal 루프: 죽은 드라이버 재큐만 반복, 신규 스폰 없음

- **현상**: 드라이버가 월클록으로 죽은 뒤 goal-desk의 heal 루프가 40분 이상 같은 job을 재큐만 반복했다. 새 드라이버 스폰 없이 대기 상태가 지속.
- **증거**: 워커 THINK "its heal loop only re-queues the dead one, observed 40+ min".
- **수정 제안**: heal 루프에 N회 재큐 후 스폰 포기/에스컬레이션 전환, 또는 데드라인 만료 job은 자동으로 신규 스폰으로 전환하는 상태 머신 추가.

### (c) 워커 모델 프로브 실패 시 스폰 장기 마비 + 카탈로그 헤더 불일치

- **현상**: 유일 프리 모델 glm-5.3-free가 429(분당 8요청) 또는 빈 응답(finishReason=truncated)이면 모든 워커 스폰이 블록. 그사이 `fleet_model_catalog` 헤더는 같은 별칭을 live-healthy로 계속 표시 — 운영자 입장에서 "왜 안 되지?" 진단이 어렵다.
- **증거**: liora.log `WARN llm request failed … APIEmptyResponseError` / `attempt=2/3 errorName=APIProvider…`(429 계열); 헤더↔프로브 불일치는 컨덕터 세션에서 반복 관측("no live worker model for coder (tried tokenrouter/z-ai/glm-5.3-free)" 재큐 다발 + job ledger 226 스냅샷).
- **수정 제안**: (1) 카탈로그 헤더를 스폰 시점 라이브 프로브 결과로 갱신 또는 스냅샷 시각 표기; (2) 프로브 실패 시 대체 별칭 자동 폴백; (3) 429/빈 응답을 구분해 "분당 쿼터 대기"와 "모델 교체 필요"를 다른 안내로.

### (d) 30분 월클록 + "마무리 배치 커밋" 패턴의 반복 즉사

- **현상**: 느린 모델 + 30분 고정 예산 조합에서 워커가 "탐색/수집 먼저, 마무리에 몰아서 커밋" 전략을 취하면 마무리 단계 직전에 월클록이 끝난다. 커밋 0건으로 즉사, 산물 소실. 본 감사에서 3~4회 관측(이전 세션 2회 + 회수 세션 + 간헐적 반복), 이 보고서 자체가 그 소실 위험에서 회수된 산물이다.
- **증거**: 워커 THINK "Deadline deaths mid-finishing strand uncommitted artifacts with zero receipts (observed twice this session, forcing a full salvage session over the dead worktree)"; 데모 태스크(subtract)도 커밋 0건(`git log`: `aa613ac init` 단일).
- **수정 제안**: (1) 장기 job 브리핑에 "검증된 산물 즉시 소형 커밋"을 의무 조항으로(하네스 프롬프트에 강제 주입); (2) 월클록 잔여 X% 도달 시 커밋 강제 인터럽트("지금까지 산물 커밋 후 종료" 모드); (3) 워크트리 스냅샷이 이미 존재하므로 즉사 시 자동 브랜치 저장을 커밋으로 승격.

### (e) 기타 회수된 버그/개선점 (로그·insights 기반)

1. **APIEmptyResponseError 처리**: thinking-only 응답(finishReason=truncated)을 일반 실패로 처리해 재시도만 반복 — thinking 파트만 있으면 텍스트 재요청 또는 모델 전환으로 즉시 대응. 로그: `01:02:41 … APIEmptyResponseError errorMessage="Th…"`, `02:19:48 ERROR turn failed … agentId=agent-1`.
2. **JobCreate 명시 별칭 실패 시 omit-alias 재시도 규칙**: 명시적 `model_alias` 프로브 실패(`No live catalog aliases remain — omit model_alias for harness role pick`) 직후 별칭 생략 재시도로 성공한 사례 존재 — 자동 폴백으로 만들 가치.
3. **컨텍스트/토큰 폭주**: 감사 세션 하나가 250만 토큰/53+ 도구 호출을 소모(체크포인트 기록). 장기 세션에서 idle pulse·시스템 리마인더가 컨텍스트를 지속적으로 잠식 — 재개 세션에는 "추출물만 읽기" 모드의 경량 프롬프트가 필요.
4. **워크스페이스 분리 추정**: 감사 중 발견된 `session_ba60897a`(8/27~8/31)는 agents/만 있고 logs/가 없는 반쪽 세션 — 세션 상태 파일 무결성 검사 후롤 필요.
5. **`context.rollback_attempt` 3회 / `turn.cancel` 1회**: 롤백·취소 경로의 안정성 재검토 대상(빈도 낮으나 무음 손실 위험).
6. **demo 워크스페이스 잔존**: `Temp/liora-sim/demo`의 미완료 태스크 산물이 회수 없이 방치 — 시뮬레이션 종료 시 자동 정리 또는 상태 저장.

**개선 인크리먼트 아이디어(워커가 남긴 정책 메모에서)**: 장기 브리핑에 커밋-퍼스트 조항 강제, 헤더 presence는 재큐 1회 정당화 사유일 뿐(재큐 재실패 시 에피소드 내 대기), goal-desk 우산은 회구 완료 후 정리, 회수 세션 브리핑도 동일하게 "읽기 전용 소스 + 즉시 커밋"으로 사이즈.

---

## 결론

엔진은 동작한다. 깨지는 지점은 정책이다: 예산 승계(1ms 클램프), 재큐 무한 루프(무스폰), 단일 프리 모델 의존(429 마비), 커밋 지연(월클록 즉사 시 산물 소실). (a)(d) 두 건만 고쳐도 "세션이 죽어도 산물은 남는다"는 최소 신뢰선이 확보된다. (b)(c)는 자가복구 신뢰성, (e)는 진단 가능성 문제다.

*작성 근거: 세션 로그 wire.jsonl/liora.log 발췌, 데모 워크스페이스 git 상태 직접 확인, 감사 세션 insights 3건. OSS 비교는 정형 벤치마크가 아닌 구조적 관측임을 명시한다.*
