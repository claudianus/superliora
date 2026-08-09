# SuperLiora

**Conductor harness** — 채팅은 컨트롤 플레인이고, 구현은 격리 Job(worktree)에서 돌아갑니다.

[라이브 사이트](https://claudianus.github.io/superliora/) · [English](./README.md) · [문서](https://claudianus.github.io/superliora/docs/getting-started.html)

## 설치

**Node.js ≥24.15.0** 필요.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex

liora --version
```

## 사용

```bash
liora                 # Conductor 인터랙티브 세션
liora --continue      # 현재 디렉터리 최근 세션 이어하기
liora --plan          # Plan Desk로 시작
```

TUI에서 `/login` · `/model`로 프로바이더를 연결한 뒤 원하는 결과를 적으세요. Conductor가 Job을 만듭니다. `/jobs` 또는 `Alt+J`(Job Deck)로 보고, Inbox(`Alt+I`)에서 질문에 답하세요.

## 문서 · 개발

- 사이트·가이드: https://claudianus.github.io/superliora/
- 기여: [CONTRIBUTING.md](./CONTRIBUTING.md)
- 보안: [SECURITY.md](./SECURITY.md)

## License

MIT — [LICENSE](./LICENSE)
