# H6 1단계 — 검증 명령 "선택"의 하드코딩 인벤토리

- 작성: 2026-09-17 (Asia/Seoul)
- 범위: **검증 명령을 고르는 로직(무엇을 돌릴지)** 만. 결과 판정(무엇이 성공인지)은 2단계.
- 소스 레포: `/Users/modumaru/Desktop/code/superliora` (branch `main`, base SHA `daba5672f`)
- 사용자 요구: "검증하고 이런 거 하드코딩되어 있는 거 코드 전체에서 완전히 폐기. 검증이든 리뷰든 전부 LLM 지능 기반으로."

이 문서는 **교체 전 인벤토리**다. 이 커밋 이후에 국소 교체를 넣는다(같은 창, 별도 커밋).

---

## 1. 인벤토리 — "무엇을 돌릴지"를 문자열·휴리스틱으로 정하는 곳

| # | 파일:라인 | 현재 판정 방식 | 성격 | 확인된/가능한 오판 |
| --- | --- | --- | --- | --- |
| A1 | `packages/agent-core/src/tools/builtin/ops/run-project-checks.ts:80-90` `SCRIPT_CANDIDATES` | 검증 종류(`test`/`typecheck`/`build`/`smoke`/`lint`)마다 **허용 스크립트 이름 목록**을 하드코딩 (`test: ['test','test:unit','test:ci','vitest']` 등) | 이름 화이트리스트 | 프로젝트가 `pnpm run vitest:unit`·`check`·`e2e` 등 다른 이름을 쓰면 "스크립트 없음"으로 skipped. `static: []`는 "스크립트가 존재할 수 없다"는 코드 내 가정 |
| A2 | `run-project-checks.ts:338-346` `pickScript()` | 위 목록을 **선언 순서대로** 훑어 첫 일치를 채택 | 결정적 추정 | 실제로 무엇이 테스트인지 보지 않음. 예: `test`가 린트만 돌려도 그대로 `test`로 기록 |
| A3 | `run-project-checks.ts:354-381` `rewriteDirectNodeScript()` | `node --test <spec>` 문자열을 **정규식 파싱**해 인자를 다시 조립. 맨 스크립트에서 `tests` 디렉터리를 **합성**하던 것이 H2의 원인(현재는 수정됨) | 문자열 재작성 | `node --test --experimental-*`·`node --test --test-name-pattern` 같은 플래그 스펙은 매치 실패 → pnpm 경로로 우회. 테스트가 아닌 `node --check`도 같은 함수가 처리 |
| A4 | `run-project-checks.ts:383-390` `packageLooksLikeNoInstallSite()` | `dependencies`/`devDependencies`가 비어 있고 `test` 스크립트가 `node --test`/`node --check` 문자열이면 **"의존성 없는 정적 사이트"로 단정** → `typecheck`/`build`/`lint`를 exitCode 0으로 **건너뜀** | 스크립트 본문 정규식 | `node --test`를 쓰지만 타입체크가 필요한 프로젝트에서 typecheck가 조용히 0으로 기록. `scriptRunsWithoutInstall()`(348-352)도 같은 정규식 |
| A5 | `run-project-checks.ts:274-311` `staticSiteFallback()` | `package.json`이 없고 `.js`/`.mjs`/`.cjs`/`.html` 글로브에 걸리면 **`static` 검사로 자동 전환** | 확장자 휴리스틱 | JS 파일 0개 + HTML만 있는 사이트, Next/Remix 류의 프리렌더 산출물 등은 `node --check`가 아닌 다른 검증이 필요할 수 있음 |
| A6 | `run-project-checks.ts:92,108,137` `DEFAULT_CHECKS = ['test','typecheck','build']` | 종류를 **생략하면 이 3개를 기본으로 실행** | 기본값 하드코딩 | 실제 검증 계약이 무엇인지 프로젝트·과제마다 다른데도 고정. `test2` 같은 프로젝트는 `check` 스크립트가 있지만 기본 세트에 없음 |
| A7 | `run-project-checks.md:3-7` (도구 설명문) | A4/A5와 같은 규칙을 **LLM 프롬프트 문면**으로 고정 | 프롬프트 하드코딩 | 모델이 프로젝트별 판단을 하지 않고 문서화된 휴리스틱을 따르게 됨 |
| B1 | `packages/agent-core/src/tools/builtin/job/job-greenfield-chain.ts:35` `MECHANICAL_CMD_RE = /tsc\|typecheck\|vitest\|eslint\|oxlint\|lint\|build\|pnpm test\|npm test/i` | **검증 명령 문자열이 기계 명령인지** 키워드 매치로 판정 | 키워드 매치 | `pnpm test:e2e`, `node --test`, `deno test`, `uv run pytest`, `make verify` 등은 "기계적 검증 아님"으로 분류될 수 있음. 실제로 `node --test`는 `vitest`/`pnpm test` 패턴에 걸리지 않음 |
| B2 | `job-greenfield-chain.ts:47-50` `SKELETON_DEFAULT_VERIFICATION = ['npx tsc --noEmit','npx vitest run --reporter=dot']` | 검증 명령이 **비어 있으면 이 두 개를 합성** | 문자열 합성 | (a) B1 필터를 통과한 명령이 하나도 없을 때 **프로젝트에 없는 도구**를 돌리라고 지시. (b) B1이 오분류해 필터 아웃해도 그대로 이 합성이 실행됨 (A1과 같은 병) |
| B3 | `job-greenfield-chain.ts:33,75-77` `VISUAL_TOOL_RE` + `isVisualOrProductGateLine()` | **명령 문자열에 도구 이름**(verifySurface/browser-status 등)이 들어 있으면 "시각 게이트"로 판정 | 도구 이름 매치 | 시각 검증을 `pnpm run smoke:visual` 같은 **프로젝트 고유 스크립트**로 하는 경우 이 게이트가 잡지 못함(§ ledger 79행의 `smoke:visual` 별도 패턴이 그 증거) |
| C1 | `packages/agent-core/src/sensors/verification-sensor-ledger.ts:75,134` `MECHANICAL_TEST_RE` 등 | 실행된 Bash 명령 **문자열**에 `vitest\|jest\|pytest\|node --test\|…`이 있으면 "테스트가 실제로 돌았다"로 기록 | 텍스트 스캔 | 프로젝트가 `npx zx verify.mjs`, `task test`, 자체 러너를 쓰면 "테스트 미실행"으로 기록됨(실제 돌았는데도). 반대로 스크립트 출력 텍스트에 단어만 있어도 매치될 수 있음 |
| C2 | `verification-sensor-ledger.ts:136,138` typecheck/lint 패턴 | `tsc\|tsgo\|vue-tsc\|svelte-check\|…` / `oxlint\|eslint\|biome check\|…` 키워드 매치 | 텍스트 스캔 | `dprint check`, `ruff`, `golangci-lint`, `deno lint` 등은 인식 안 됨 |
| C3 | `swarm-evidence-gate.ts:61-64,237-239` | 증거로 인정할 **파일명·확장자·디렉터리 접두** 목록(`.test.ts`, `vitest`, `packages/`\|`apps/`\|`src/`… )을 하드코딩 | 목록 매치 | `deno test *_test.ts`, `cargo test`는 `.test.` 패턴이 아니어서 증거로 인정되지 않음 |
| C4 | `tools/display/classify-command-output.ts:70-149` | 출력 텍스트를 보고 도구를 판정(vitest/jest/pytest/go test/cargo test **Matcher** 고정 순서) | 출력 파싱 | 새 러너(예: `bun test`, `deno test`)는 분류 불가. **단, 이건 표시용 계층이라 이번 교체 대상에서 제외** |
| C5 | `agent/goal/predicate-runner.ts:144` `const args = ['exec','vitest','run',absTestFile]` | 성공 조건(predicate) 스크립트를 **무조건 vitest**로 실행 | 도구 고정 | vitest가 없는(Node --test/pytest) 프로젝트에서 predicate가 전부 실패 |

**이번 교체 우선순위**: A1~A7(도구 자체의 "무엇을 돌릴지") → B1~B3(그 위의 잡 체인 필터/합성) → C계열은 후속 창(결과·증거 판정에 가까움).
C4는 표시 계층이므로 범위 밖. C5는 별도 창(goal predicate) 발주 대상.

---

## 2. 경계 원칙 (이번 교체가 지킬 것)

- **선언 우선**: 프로젝트가 `package.json`에서 이미 선언한 검증 스크립트는 **문자열 그대로** 쓴다. 하드코딩 화이트리스트(A1)보다 프로젝트 선언이 우선.
- **LLM은 선택만**: 무엇을 돌릴지(어떤 스크립트/명령) 고르는 판단은 LLM. 프로젝트 선언이 없거나 모호할 때만 개입.
- **기계는 실행 보존**: LLM이 고른 명령을 그대로 `kaos.exec`으로 실행하고 **exit code를 그대로 보존**. 타이머·프로세스 관리·스트림 상한·exit code 기록은 그대로 기계에 남긴다.
- **폴백은 명시**: LLM이 못 고르면 "**판정 불가**"를 명시적으로 기록한다. 조용히 exit 0으로 통과시키지 않는다(A4의 skip-0 경로가 그 반대 사례).

---

## 3. 근본 원인 (대표 3건, 파일·라인)

1. **이름 화이트리스트** — `run-project-checks.ts:80-90` + `pickScript():338-346`.
   프로젝트가 선언한 스크립트 이름이 목록 밖이면 검증 자체가 skipped. **프로젝트 선언을 읽지 않고 있다.**
2. **`node --test`만 특별 취급하는 문자열 재작성** — `rewriteDirectNodeScript():354-381` + `packageLooksLikeNoInstallSite():383-390`.
   `node` 러너만 정규식으로 손보고, 나머지 러너(pytest/cargo/vitest…)는 `pnpm run <script>`로 보낸다.
3. **빈 검증 목록의 무조건 합성** — `job-greenfield-chain.ts:47-50` `SKELETON_DEFAULT_VERIFICATION`.
   검증 명령이 없으면 프로젝트에 없는 `tsc`/`vitest`를 지시한다(H2와 같은 방향의 사고: 없는 것을 만들어낸다).

---

## 4. 다음 단계(이 창에서 이어짐)

- `pickScript()`를 **선언 우선 + LLM 폴백**으로 국소 교체(함수 단위, 파일 전체 갈아엎기 없음).
- LLM 판정 실패 시 `undecidable`을 명시 기록(`skipped` + reason). 조용한 exit 0 금지.
- 회귀 테스트: 형제 디렉터리·스크립트 부재 케이스에서 판정이 흔들리지 않을 것.
- `mechanicalVerificationCommands()`의 무조건 합성도 같은 원칙으로 확인(범위 내 국소 수정 또는 명시적 미완 기록).
