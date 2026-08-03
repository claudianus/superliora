# 재구성 프로그램 수락 게이트 체크리스트 (V1~V7)

작성일: 2026-08-03
상태: Phase 0 산출물 (수락 게이트 검증 체크리스트 — 프로그램 완료 판정 기준)
선행 문서:
- `docs/specs/2026-08-03-meta-orchestrator-v2-contract.md` — §8 스트림 분할, §9 수락 게이트 V1~V7, §10 리스크 레지스터
- `docs/specs/2026-08-03-blocking-and-legacy-inventory.md` — A 블로킹 경로, B 레거시 인벤토리, C 폐기 순서/가드레일, D 집계

검증 기준 커밋: `4fcf9e0b4` (인벤토리 조사 기준과 동일)
본문에 인용한 모든 파일 경로는 위 커밋에서 실재를 확인했다.

> 이 문서는 계약서 §9의 수락 게이트 V1~V7을 **기계 측정 가능한 검증 항목**으로 분해한 체크리스트다.
> 각 항목은 ① 필요한 테스트/명령/증거 ② 담당 스트림 ③ 현재 상태 ④ 판정 기준을 갖는다.
> 하나라도 미달이면 v2 미완료다.

**상태 용어 정의**

- **존재**: 가드레일(테스트/가드)이 이미 존재하고 그대로 통과 판정에 쓸 수 있다.
- **부분**: 관련 코드가 있으나 계약이 요구하는 수준에 못 미친다(강화/재설계 필요).
- **TODO**: 존재하지 않으며 구현 스트림이 만들기 전까지 게이트가 열리지 않는다.

**게이트 ↔ 스트림/단계 매핑 요약** (스트림 정의: 계약서 §8, 폐기 단계 R0~R7: 인벤토리 C.2)

| 게이트 | 주제 | 담당 스트림 | 관련 폐기 단계 |
|---|---|---|---|
| V1 | delegation-only conductor | S0 (가드 코어) | R0 |
| V2 | 비동기 위임, 동기 대기 0건 | S1 (Job 런타임 v2) | R1 |
| V3 | 입력 항상성 | S2 (컨트롤 타워 TUI) | — |
| V4 | 알림/인박스 오프로딩 | S4 (desk 워커 + 프로토콜 v2) | — |
| V5 | 컨트롤 타워 TUI | S2 | — |
| V6 | 레거시 폐기 | S3 (레거시 폐기) | R2~R7 |
| V7 | 사고 재발 방지 | S1 | R1 |
| GF | 최종 전체 게이트 (Source-install) | 전 스트림 공통 | 모든 PR |

---

## 1. V1 — delegation-only conductor (계약서 §2)

목표: conductor 프로필에서 파일 변경/장기 실행 도구가 런타임에 100% 거부되고, 거부 시 위임(Job)으로 수렴한다.

| # | 검증 항목 | 필요한 테스트/명령/증거 | 담당 | 현재 상태 | 판정 기준 (통과 / 불합격) |
|---|---|---|---|---|---|
| V1-1 | conductor 도구 화이트리스트 스냅샷 | `conductor.yaml` 도구 목록 스냅샷 테스트: `Write`/`Edit`/`ApplyPatch`/`RunProjectChecks`/`Agent`/`Fleet`/`TaskOutput` 부재, `Job*`+`AskUserQuestion`+조회류만 존재 | S0 | **부분** — 프로파일 목록 테스트는 존재(`packages/agent-core/test/profile/default-agent-profiles.test.ts` 21건, `packages/agent-core/test/profile/main-profile.test.ts` 7건)하나 conductor 화이트리스트를 명시 고정하지 않음 | 스냅샷 테스트 그린 + `packages/agent-core/src/profile/default/conductor.yaml`에 금지 도구 0건 / 목록 변동이 스냅샷 갱신 없이 통과되면 불합격 |
| V1-2 | `ConductorDirectWorkGuard` 거부 계약 | 메인이 `Write` 호출 → 도구 실행 **전** `isError: true` + 고정 라우팅 문구 + 제안 Job 초안(title/prompt) 동봉을 단언하는 계약 테스트 (신규 `agent/conductor-guard.ts`) | S0 | **TODO** — `packages/agent-core/src/agent/conductor-guard.ts` 없음; 훅 위치 `packages/agent-core/src/loop/tool-call-execute.ts`만 존재 | 계약 테스트 그린 + 서드파티/플러그인 도구도 기본 보수 판정(write 간주)으로 거부됨 / 프롬프트 우회 경로 1건이라도 도구 실행이 도달하면 불합격 |
| V1-3 | 가드 에스컬레이션 (2회→자동 Job 기록, 3회→턴 종료) | 2회 위반 시 가드가 원장에 `queued` Job 초안을 직접 기록하고 ACK하는 테스트, 3회 위반 시 턴 강제 종료 + 시스템 메시지 테스트 | S0 | **TODO** | 두 단계 모두 테스트 그린 / 자동 기록 없이 거부만 반복되면 불합격 |
| V1-4 | G3 벽시계 트리프와이어 | 도구 벽시계 예산 테스트: 소프트 5초 경고, 하드 15초 호출 중단 + `isError` 반환; 3회 연속 트리프 시 턴 종료 + 진단 리포트 | S0 | **TODO** — 훅 위치(`loop/tool-call-execute.ts`)만 존재 | 시간 가상화 테스트에서 15초 초과 도구가 중단되고 예산 내 도구는 영향 없음 / `Job*`·`AskUserQuestion` 예외가 발견되면 불합격 |
| V1-5 | Bash 읽기 전용 정책 | conductor에서 쓰기 명령(설치/빌드/마이그레이션) 거부 테스트 + 읽기 전용 명령(`git status/log/diff`류) 허용 테스트; 5초 초과 셸은 V1-4 예산으로 차단 | S0 | **부분** — 정책 기반 `packages/agent-core/src/agent/permission/policies/tool-read-only.ts` 존재; conductor 전용 테스트 없음 | conductor 대상 쓰기 hard-deny 테스트 그린 / 쓰기 명령 1건 통과 시 불합격 |

## 2. V2 — 비동기 위임, 동기 대기 0건 (계약서 §3)

목표: 메인 턴이 워커 수명(스폰 준비/실행/완료/머지)을 `await`하지 않음을 런타임 가드 + CI 테스트로 증명한다.

| # | 검증 항목 | 필요한 테스트/명령/증거 | 담당 | 현재 상태 | 판정 기준 (통과 / 불합격) |
|---|---|---|---|---|---|
| V2-1 | G1 ACK 데드라인 | 원장 변경 도구(JobCreate/JobSteer/JobResume 등)가 원장 upsert + ACK만 수행; 스케줄 펌프(`scheduleQueuedJobs`)에 지연 주입 시에도 ACK p99 ≤ 250ms | S1 | **TODO** — 위반 지점 `packages/agent-core/src/tools/builtin/job/job-tools.ts`(`await scheduleQueuedJobs`) 실존 | 시간 가상화 테스트에서 지연 주입과 무관하게 ACK 데드라인 준수 / 도구 경로가 스케줄/스폰을 await하면 불합격 |
| V2-2 | G2 스폰 격리 (`WorkerSpawner` 큐 + `spawning` 상태) | 스폰 체인(`ensureAgentResumed`→`assertContractCompiles`→`createAgent`)에 120초 지연 주입 → JobCreate ACK 정상; `spawning` 전이 이벤트 방출; 스폰 예산 30초 초과 시 `blocked`+사유 기록 | S1 | **TODO** — 대상 경로 `packages/agent-core/src/session/subagent/subagent-host.ts`, `packages/agent-core/src/fleet/spawn-agents.ts` 실존 | 지연 주입 테스트 그린 + 스폰 큐가 어떤 사용자 턴 프로미스 체인에도 미연결 / 메인 턴에서 스폰 준비 await 1건 발견 시 불합격 |
| V2-3 | G4-1 비대기 론칭 계약 (실효화) | 가짜 스폰(`spawnOne` 주입)으로 `launchJobWorker` 호출 → 반환 시점에 completion 프로미스가 **미해결**이어야 통과. 수동 불리언 인자인 `assertNonBlockingLaunchContract`를 런타임 관찰로 대체 | S1 | **부분** — `assertNonBlockingLaunchContract`가 `packages/agent-core/src/tools/builtin/job/job-lanes.ts`에 존재하나 수동 불리언 인자라 실효성 없음 | 대체된 계약 테스트가 실제 프로미스 상태를 관찰해 그린 / 수동 인자 경로가 남으면 불합격 |
| V2-4 | G4-3 await 정적 스캔 | `packages/agent-core/src/tools/builtin/job/**` + conductor 경로에서 `handle.completion` / `spawnAgents` 결과를 `await`하는 패턴을 잡는 lint/스크립트 (위반 목록은 인벤토리 A장 14건과 1:1 대응) | S1 | **TODO** | 스캔 위반 **0건** / 1건이라도 검출되면 불합격 (인벤토리 A-2~A-10 각 항목이 스캔 룰과 매핑돼야 함) |
| V2-5 | G5 머지 오프로딩 | `MergeJob`이 신뢰 판정(auto/hold)만 하고 반환하는 계약 테스트 — 머지 지연 주입 시에도 도구 반환 시간 단언; 실행은 랜딩 워커(kind=`merge`) 담당 | S1 | **TODO** — 인라인 머지 `packages/agent-core/src/tools/builtin/job/job-land.ts`(`landJobToMain`) 실존 | 판정/실행 분리 테스트 그린 + 메인 턴에서 `git merge` 실행 경로 0건 / 메인이 자기 턴에서 머지를 실행하면 불합격 |
| V2-6 | 라이브 데모 계측 증거 | 데모 세션에서 워커 3개 동시 실행 중 메인 턴 벽시계 최대값 ≤ 3초인 계측 로그 (계약서 §3.3) | S1+S2 | **TODO** — 증거 산출 절차 미구축 | 계측 로그 첨부 + 최대값 ≤ 3초 / 측정 불가 또는 초과 시 불합격 |

## 3. V3 — 입력 항상성 (계약서 §7, 인벤토리 A-1/A-11)

목표: 워커 부하와 무관하게 사용자 입력이 즉시 접수·분류되어 ACK로 응답된다. 입력 드롭 0건.

| # | 검증 항목 | 필요한 테스트/명령/증거 | 담당 | 현재 상태 | 판정 기준 (통과 / 불합격) |
|---|---|---|---|---|---|
| V3-1 | 입력 → ACK 렌더 지연 계측 | 워커 3개 실행 + 완료 폭주 상황에서 사용자 입력 → ACK 렌더 p95 ≤ 1초 TUI 계측 테스트 | S2 | **TODO** — 현 큐잉 경로 `apps/liora/src/tui/controllers/transcript/message-dispatch.ts`(`enqueueMessage`) 실존 | 계측 테스트 그린 (p95 ≤ 1초) / 입력이 턴 종료를 기다리면 불합격 |
| V3-2 | 큐잉 경로 소멸 + 입력 드롭 0건 | 현 `streamingPhase !== 'idle'` → `enqueueMessage` 동작을 캐릭터라이제이션으로 고정 → 분류기 루프 교체 후 경로 삭제; 분류 실패 시 폴백 `job_create` 수렴 테스트 포함 | S2 | **부분** — 삭제 대상 코드(큐잉 경로)는 실존, 캐릭터라이제이션 테스트 없음 | 큐잉 경로 grep 0건 + 어떤 입력도 드롭되지 않는 테스트 그린 / 조용한 드롭 1건 발견 시 불합격 |
| V3-3 | 로딩 오버레이 중 입력 보존 | 세션 로딩/리플레이 중 입력 → 저장(원장 접수) → 로드 완료 후 분류 테스트 (A-11) | S2 | **TODO** — 거부 경로 `message-dispatch.ts`(`isSessionLoadingOverlayActive`) 실존 | 입력이 거부되지 않고 보존 후 처리됨 / 로딩 중 입력이 드롭되면 불합격 |

## 4. V4 — 알림/인박스 오프로딩 (계약서 §4, 인벤토리 A-12)

목표: 완료 알림과 인박스 처리가 메인 턴 예산을 소비하지 않는다. 폭주는 desk 워커가 digest한다.

| # | 검증 항목 | 필요한 테스트/명령/증거 | 담당 | 현재 상태 | 판정 기준 (통과 / 불합격) |
|---|---|---|---|---|---|
| V4-1 | 주입 캡 테스트 | 주입 ≤ 1.5KB / ≤ 5 이벤트 / 턴당 1블록, 알림 도구 회당 ≤ 250ms 단언 테스트; 캡 초과 시 드롭 + 스트립 표시(`inbox N (batched)`) | S4 | **부분** — 런타임 캡은 `packages/agent-core/src/agent/injection/job-desk.ts`(`JobDeskInjector`, MAX_CHARS=1500/MAX_EVENTS=5)에 존재하나 **테스트 0건** (agent-core 테스트에서 job-desk 참조 없음 확인) | 캡 단언 테스트 그린 / 캡 우회 주입이 재현되면 불합격 |
| V4-2 | 폭주 digest (desk 워커) | 완료 10건 동시 도착 → 메인 턴 증가 ≤ 1회, desk 워커(kind=`desk`)가 중복 제거·그룹핑 후 1건 에스컬레이션 카드 생성 (5분 내 ≥5건 또는 `/job digest` 트리거) | S4 | **TODO** — desk 워커 미구현 | 시나리오 테스트에서 메인 턴 증가 1회 이하 + 에스컬레이션 정확히 1건 / 메인이 digest 루프를 직접 돌면 불합격 |
| V4-3 | journal 스키마 이중 읽기 | 프로토콜 v2 필드 추가 후 v1 journal 리플레이 호환 테스트 (schemaVersion 기반 unknown-ignore; 계약서 §10 리스크 완화) | S4 | **TODO** — 기존 호환 원칙 테스트는 `packages/protocol/src/__tests__/job-events.test.ts`(2건)에 일부 존재, v2 필드 없음 | v1/v2 journal 혼독 테스트 그린 / 구 journal 리플레이 실패 시 불합격 |

## 5. V5 — 컨트롤 타워 TUI (계약서 §5)

목표: 기본 화면이 워커 보드(전용 렌더 경로)이며, 조작 증거가 스크린샷/VerifySurface로 제출된다.

| # | 검증 항목 | 필요한 테스트/명령/증거 | 담당 | 현재 상태 | 판정 기준 (통과 / 불합격) |
|---|---|---|---|---|---|
| V5-1 | 보드 기본 화면 렌더 증거 | `apps/liora/src/tui/features/control-tower/*` (신규) 보드 화면의 스크린샷 또는 VerifySurface 증거; 프레임 예산(16ms 셀 무효화, 스트림 코얼레싱) 준수 | S2 | **TODO** — `features/control-tower/` 미존재; 폐기 대상 `features/agent-swarm/`(war-room)은 실존 | 보드가 세션 시작 기본 화면으로 렌더된 증거 첨부 / 트랜스크립트 entry나 푸터 스트립을 기본 관제로 쓰면 불합격 |
| V5-2 | 조작 증거 | needs_user 상단 고정, peek/attach 드릴다운(S2), 큐 패널(S3), 보드 복귀(`Esc`) 조작의 스크린샷/VerifySurface 증거 | S2 | **TODO** | 각 조작별 증거 1건 이상 / 증거 없는 "완료" 선언은 불합격 (계약서 §5.4) |
| V5-3 | 보드 스토어 단일 소스 | `job.updated`/`job.inbox` + 워커 스트리밍 이벤트를 보드 스토어 1개가 수용하는 계약 테스트; `SessionEventJobDesk`(카운터 델타) 흡수·폐기 확인 | S2 | **부분** — 흡수 대상 `apps/liora/src/tui/controllers/session-event/job-desk.ts` 실존; 보드 스토어 없음 | 스토어 1개로 수렴 + 구 델타 경로 grep 0건 / 이벤트 구독 소스가 2개 이상이면 불합격 |

참고: 컨트롤 타워 전환 시 `apps/liora/test/tui/utils/job-strip.test.ts`(3건)는 폐기/교체 대상 가드레일이다(인벤토리 C.3).

## 6. V6 — 레거시 폐기 (계약서 §6, 인벤토리 B장/C장)

목표: 인벤토리 B장 DELETE 판정 항목 전부가 §6.2 가드레일 4종(캐릭터라이제이션 / 대체 경로 증명 / 참조 0건 / 베이스라인 래칫)을 갖춘 PR로 삭제된다.

| # | 검증 항목 (폐기 단계) | 필요한 테스트/명령/증거 | 담당 | 현재 상태 | 판정 기준 (통과 / 불합격) |
|---|---|---|---|---|---|
| V6-1 | R2 — collaboration 심 제거 (B-8) | `#/collaboration`·`collaboration/` import 전수 이관 후 심 삭제; `pnpm run check:imports` + 심 이름 import grep 0건 | S3 | **TODO** — 삭제 대상 `packages/agent-core/src/tools/builtin/collaboration/` 실존 | grep 0건 + check:imports 그린 / 고아 import 잔존 시 불합격 |
| V6-2 | R3 — orchestratorMode + 브리지 제거 (B-1, B-5) | SpawnWorker 계열 도구 5종 **캐릭터라이제이션** + JobCreate로 동일 작업을 재현하는 **대체 증명** 테스트; 삭제 후 `orchestratorMode` 플래그/콜백/RPC 필드 grep 0건 | S3 | **TODO** — 삭제 대상 `packages/agent-core/src/tools/builtin/fleet/orchestrator.ts`, `packages/agent-core/src/agent/orchestrator.ts`, `packages/agent-core/src/tools/builtin/job/job-fleet-bridge.ts` 실존 | 캐릭터라이제이션→대체 증명→삭제 순서 준수 + grep 0건 / 가드레일 없는 삭제 PR은 병합 불가 |
| V6-3 | R4 — UltraSwarm 제거 (B-2, 임계 경로) | UltraSwarm 도구 입출력 **캐릭터라이제이션** + Mission-스웜 결합 분리 후 **Mission 회복 시나리오 3종**(중단→재개, needs_user, 완료)이 UltraSwarm 없이 그린; journal `UltraworkRunMirror` 구 스키마 읽기 전용 보존 | S3 | **TODO** — 삭제 대상 `tools/builtin/fleet/ultra-swarm*.ts`(13파일), `session/ultra-swarm-*.ts`(5파일), `packages/agent-core/src/agent/ultra-swarm-run.ts` 실존 | 회복 3종 그린 + `ultraSwarmRun` 참조 grep 0건 / Mission 리플레이 회귀 발생 시 불합격 |
| V6-4 | R5 — AgentSwarm + TUI 서피스 제거 (B-3, B-7) | fan-out 5태스크 → 5 Job **대체 증명** 테스트 (v1 A3 계승) + 슬래시 커맨드 목록 스냅샷 갱신; 도구 본체와 `features/agent-swarm/*`, `commands/swarm|ultrawork` 동시 삭제(고아 금지) | S3 | **TODO** — 삭제 대상 `packages/agent-core/src/tools/builtin/fleet/agent-swarm.ts`, `apps/liora/src/tui/features/agent-swarm/`, `apps/liora/src/tui/commands/swarm/`, `apps/liora/src/tui/commands/ultrawork/` 실존 | 대체 증명 그린 + 백엔드/진입점 동시 제거 + 스냅샷 갱신 / 고아 커맨드 잔존 시 불합격 |
| V6-5 | R6 — swarm 잔여 모듈 + 레지스트리 단일화 (B-4, B-6) | `swarm-bus-coordination.ts`/`swarm-humanize.ts`/`swarm-maker-checker.ts` 삭제 + REBUILD 4종(`swarm-dag-scheduler.ts`, `swarm-run-ledger.ts`, `swarm-budget.ts`, `swarm-cost-guard.ts`) 흡수 후 구 모듈 grep 0건; "활성 워커 목록"이 단일 Job 원장으로만 응답하는 계약 테스트 | S3 | **TODO** — 대상 9개 `packages/agent-core/src/fleet/swarm-*.ts` 실존; KEEP 2종(`swarm-file-lease.ts`, `swarm-evidence-gate.ts`)은 유지 | 단일 원장 계약 테스트 그린 + KEEP 모듈 사용처 테스트 유지 / 상태 진실이 원장 밖에서 발견되면 불합격 |
| V6-6 | R7 — 최종 스윕 | `ultra*` 심볼 grep 0건, `orchestratorMode` grep 0건, journal 구 스키마 읽기 전용 확인, `pnpm run check:test-baseline` 그린(삭제로 줄어드는 pinned 실패는 베이스라인 갱신 반영) | S3 | **TODO** — 스윕 대상 실존 확인됨 (위 V6-1~V6-5 대상 전체) | 모든 grep 0건 + 래칫 그린 / 잔재 심볼 1건이라도 발견 시 불합격 |
| V6-7 | 삭제 PR 프로세스 게이트 (§6.2 4종) | 모든 삭제 PR에 ① 캐릭터라이제이션 ② 대체 경로 증명 ③ `check:imports` + 삭제 심볼 grep 0건 ④ `check:test-baseline` 통과 첨부 | S3 | **부분** — ③④ 명령은 존재(`pnpm run check:imports`, `pnpm run check:test-baseline` + `meta/test-baseline.yaml`), ①② 테스트 없음 | 4종 미첨부 삭제 PR 병합 불가 / 순서 위반(가드 없는 삭제) 적발 시 불합격 |

## 7. V7 — 사고 재발 방지 (계약서 §9 V7, 인벤토리 A-0)

목표: 2026-08-03에 실제로 발생한 두 사고가 회귀 테스트로 고정되어 레드→그린으로 증명된다.

| # | 검증 항목 | 필요한 테스트/명령/증거 | 담당 | 현재 상태 | 판정 기준 (통과 / 불합격) |
|---|---|---|---|---|---|
| V7-1 | 사고 1 — 125초 스폰 블로킹 재현 | 스폰 체인(`subagent-host.ts`의 `ensureAgentResumed`→`assertContractCompiles`→`createAgent`)에 120초 지연을 주입해 재현하는 회귀 테스트: 가드 적용 전 레드 → G1/G2 적용 후 ACK ≤ 250ms로 그린 | S1 | **TODO** — 사고 경로 파일 전부 실존 | 레드→그린 증명 커밋 첨부 / 지연 주입 시 ACK가 스폰 완료를 기다리면 불합격 |
| V7-2 | 사고 2 — exploration_model 403 라우팅 재현 | `resolveSubagentModelAlias`(`packages/agent-core/src/utils/cheap-model.ts`) 단위 테스트: (a) explore 프로파일 + 인가 없는 explorationModel → 부모 모델 또는 `models.fast`로 폴백, (b) 403 시뮬레이션 시 해당 alias가 unhealthy 마킹되어 재라우팅 차단 | S1 | **TODO** — 수정 대상 `cheap-model.ts`, `packages/agent-core/src/session/subagent/subagent-child-config.ts` 실존 | 두 시나리오 테스트 그린 + Job 워커의 `explorationModel` 암묵 폴백 제거 확인 / 403 alias로 재라우팅이 재현되면 불합격 |

## 8. GF — 최종 전체 게이트 (Source-install gate, 전 PR 공통)

`packages/agent-core`, `packages/node-sdk`, `packages/acp-adapter`, 또는 `apps/liora` 번들 그래프를 건드리는 **모든 PR**은 V 게이트와 별개로 아래 6단계를 순서대로 통과해야 한다 (루트 `AGENTS.md` "Source-install gate"). 명령 존재 여부는 루트/패키지 `package.json`에서 확인했다.

| # | 명령 | 목적 | 현재 상태 | 판정 기준 |
|---|---|---|---|---|
| GF-1 | `pnpm -C packages/node-sdk run build:dts` | 공개 타입 선언 빌드 (커밋 자립성 검증 겸용) | **존재** (`packages/node-sdk` 스크립트 확인) | exit 0 / 미존재 타입 참조 실패 시 불합격 |
| GF-2 | `pnpm run build` | 워크스페이스 전체 빌드 | **존재** (루트 스크립트 확인) | exit 0 |
| GF-3 | `pnpm run check:imports` | 워크스페이스 import 규칙 (V6 참조 제거 확인과 공유) | **존재** (루트 스크립트 확인) | exit 0 |
| GF-4 | `pnpm -C apps/liora run build` | CLI 번들 빌드 | **존재** (`apps/liora` 스크립트 확인) | exit 0 |
| GF-5 | `pnpm -C apps/liora run smoke` | CLI 스모크 실행 | **존재** (`apps/liora` 스크립트 확인) | exit 0 |
| GF-6 | `pnpm run check:test-baseline` | 테스트 래칫 (`meta/test-baseline.yaml` 대비 신규 실패/미해금 pinned 실패 차단) | **존재** (루트 스크립트 + `meta/test-baseline.yaml`, `scripts/check-test-baseline.mjs` 확인) | exit 0; 의도적 pinned 실패 수정 시 `node scripts/check-test-baseline.mjs --update`로 갱신 후 커밋 |

보조: 커밋 전 자립성 검증 절차 — `git stash && pnpm -C packages/node-sdk run build:dts && git stash pop` (루트 AGENTS.md "Commit atomicity").

## 9. 가드레일 현황 집계 (인벤토리 C.3 실측)

### 9.1 이미 존재하는 가드레일 (경로·건수 검증 완료)

| 가드레일 | 실제 경로 | 케이스 수 | 보호 대상 / v2 역할 |
|---|---|---|---|
| job-ledger | `packages/agent-core/test/tools/job-ledger.test.ts` | **21**건 (C.3 기재 20건에서 1건 증가) | Job 원장/상태 머신 — KEEP 자산의 핵심 가드 |
| default-agent-profiles | `packages/agent-core/test/profile/default-agent-profiles.test.ts` | 21건 | 프로파일 도구 목록 — V1-1 conductor 스냅샷의 기반 |
| main-profile | `packages/agent-core/test/profile/main-profile.test.ts` | 7건 | 메인 프로파일 도구 목록 |
| bash | `packages/agent-core/test/tools/bash.test.ts` | 57건 | 워커 push 금지/보안 가드 (인근 `bash-support.test.ts` 4건 별도 존재) |
| bash-env | `packages/agent-core/test/tools/bash-env.test.ts` | 3건 | 셸 환경 보안 가드 |
| job-events | `packages/protocol/src/__tests__/job-events.test.ts` | 2건 | `job.*` 프로토콜 이벤트 호환 — V4-3의 기반 |
| job-strip | `apps/liora/test/tui/utils/job-strip.test.ts` | 3건 | TUI 스트립 — 컨트롤 타워 전환 시 **폐기/교체 대상** |

합계: 7개 파일, 114 케이스.

### 9.2 추가 필요 가드레일 (삭제 전 의무 + 게이트별 작업)

"신규"는 존재하지 않아 새로 만들어야 하는 항목, "강화"는 관련 코드가 있어 보강이 필요한 항목(상태=부분)이다.

| 구분 | 신규 (TODO) | 강화 (부분) |
|---|---|---|
| C.3 명시 의무 5종 | orchestrator 도구 5종 캐릭터라이제이션 / UltraSwarm 도구 입출력 캐릭터라이제이션 / AgentSwarm 배치 결과 캐릭터라이제이션 / Mission-스웜 분리 회복 시나리오 3종 / TUI 슬래시 목록 스냅샷 (이상 V6-2~V6-4에 포함) | — |
| V1 | 직접 작업 가드 계약(V1-2), 에스컬레이션(V1-3), 트리프와이어(V1-4) | conductor 화이트리스트 스냅샷(V1-1), Bash 읽기 전용 테스트(V1-5) |
| V2 | ACK 데드라인(V2-1), 스폰 격리(V2-2), 정적 스캔(V2-4), 머지 오프로딩(V2-5), 데모 계측(V2-6) | 비대기 론칭 계약 실효화(V2-3) |
| V3 | ACK 지연 계측(V3-1), 로딩 입력 보존(V3-3) | 큐잉 경로 캐릭터라이제이션(V3-2) |
| V4 | 폭주 digest(V4-2), 스키마 이중 읽기(V4-3) | 주입 캡 테스트(V4-1) |
| V5 | 보드 렌더 증거(V5-1), 조작 증거(V5-2) | 보드 스토어 단일 소스(V5-3) |
| V6 | R2~R7 단계 삭제·스윕(V6-1~V6-6) | 삭제 PR 프로세스 게이트 배선(V6-7) |
| V7 | 125초 재현(V7-1), 403 라우팅 재현(V7-2) | — |

### 9.3 수치 요약

| 지표 | 수치 |
|---|---|
| 게이트 검증 항목 총계 | **35건** (V1 5, V2 6, V3 3, V4 3, V5 3, V6 7, V7 2, GF 6) |
| 이미 준비된 가드레일 | **7개 테스트 파일 / 114 케이스** + GF 명령 6종 + `check:imports`/`check:test-baseline` 인프라 |
| 부분(강화 필요) 항목 | **7건** (V1-1, V1-5, V2-3, V3-2, V4-1, V5-3, V6-7) |
| TODO(신규 필요) 항목 | **22건** (V1 3, V2 5, V3 2, V4 2, V5 2, V6 6, V7 2) |
| 게이트 미달 시 효과 | 해당 스트림 병합 보류; V 게이트 하나라도 미달이면 v2 미완료 |

## 10. 리스크 교차 참조 (계약서 §10)

| 리스크 | 관련 게이트 항목 | 체크리스트 대응 |
|---|---|---|
| 분류기 오판으로 사소한 질의가 Job화 | V3-2 | 분류 폴백 방향(direct_answer 우선)을 V3-2 판정에 반영 |
| 메인 루프 교체 중 journal 리플레이 깨짐 | V4-3 | 스키마 버전 + 이중 읽기 테스트로 고정 |
| 스폰 큐가 새 병목이 됨 | V2-2, V2-6 | 스폰 예산 30초 + `spawning` 가시화 + 데모 계측 |
| UltraSwarm 제거 중 Mission 회귀 | V6-3 | 회복 시나리오 3종을 임계 경로 게이트로 고정 |
| TUI 재설계 범위 팽창 | V5-1~V5-3 | 보드/드릴다운/큐 3화면 외 항목은 체크리스트에 넣지 않음(v2.x 이월) |
| 삭제 반발(기능 상실감) | V6-2, V6-4 | 대체 경로 증명 테스트를 삭제 PR 필수 가드레일로 고정 |

---

## 부록 — 판정 절차

1. 각 스트림은 PR 머지 전 담당 게이트 항목의 증거(테스트 그린 로그/계측 수치/스크린샷)를 PR 본문에 첨부한다.
2. GF-1~GF-6은 모든 PR에서 순서대로 실행하며 하나라도 실패하면 병합 불가다.
3. 프로그램 완료 판정은 V1~V7 29개 항목(V 게이트) 전부 통과 + GF 통과 후, 이 문서의 체크박스를 갱신하는 방식으로 기록한다.
4. 게이트 항목 자체의 변경(추가/완화)은 계약서 개정 절차와 동일하게 취급한다 — 체크리스트 단독 완화 불가.
