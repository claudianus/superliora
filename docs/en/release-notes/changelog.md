---
outline: 2
---

# Changelog

This page documents SuperLiora CLI releases. It is SuperLiora’s own release line, not upstream Kimi Code history.

The release source of truth is [`apps/liora/CHANGELOG.md`](https://github.com/claudianus/superliora/blob/main/apps/liora/CHANGELOG.md). Dates below are published GitHub Release dates (UTC). There is no GitHub Release for 0.11.1; that version is kept because the product changelog already records it.

## 0.12.14 (2026-08-22)

### Features

- Add `/folder` to switch the workspace at runtime. Run `/folder`, or pick Open folder in Command Hub. Desktop launches from the home folder prompt for a project.
- Use the SuperLiora Neon Noir mark on desktop and Start Menu shortcuts instead of the Node.js icon.

### Bug Fixes

- Fix the Windows desktop shortcut that showed a wt.exe license error on first double-click.

## 0.12.13 (2026-08-22)

### Features

- Show a live turn-status line above the prompt (activity, elapsed time, tokens, queued follow-ups). Parked TaskOutput waits stay a calm cue; click the leftover row to open `/tasks`, `[stop]` to cancel, or `[↓]` to detach.
- Send adjacent queued prompts as one turn and paint each as its own transcript bubble. Consecutive search and directory tool calls fold into one group.
- Stream long assistant answers without re-parsing markdown that has already settled.
- Make the session picker a scan list. Open it from Command Hub → Sessions or `/resume`.
- Add experimental GitHub Copilot login. Enable with `SUPERLIORA_EXPERIMENTAL_GITHUB_COPILOT=1`, then `/login` and paste a GitHub token (or set `GITHUB_TOKEN`).

## 0.12.12 (2026-08-22)

### Bug Fixes

- Stop Upgrade Studio from installing optional sidecars and winget packages. Those steps need a console or UAC, and the studio has neither.

## 0.12.11 (2026-08-21)

### Features

- Show live remaining provider quota in the footer and a `/quota` glance. Run `/quota` (or Command Hub → Quota) to see every logged-in provider. The footer chip is the active provider; unknown remaining stays hidden.

### Bug Fixes

- Fix `liora upgrade --main` on Windows so a source checkout writes the command to `%LOCALAPPDATA%\SuperLiora\bin` when Git Bash cannot see `liora`, and finds pnpm under `SUPERLIORA_HOME` instead of `~/.superliora`.

### Polish

- Delete expired local web-search cache rows and cap the table at 256 so the on-disk research cache cannot grow without bound.

## 0.12.10 (2026-08-21)

### Bug Fixes

- Keep TUI chrome motion (header, footer, thought-orb, editor frame) alive on classic Windows consoles. Large-area starfields stay static; Windows Terminal still runs the full premium clock.

## 0.12.9 (2026-08-21)

### Features

- Give the welcome hero, device-code login panel, and prompt editor live premium frames (comet chase + breath; static when motion is off).
- Morph live thinking into a thought-orb (`· ∘ ○ ◎ ●`) instead of a generic spinner.

### Bug Fixes

- Fix one-liner installs (`irm | iex` / `curl | bash`) dying after Node download because the bootstrap bundle omitted `checkout-health.mjs`.
- Fix Windows shutdown (close sqlite so the data home can be deleted), search/worktree path identity (8.3 and `\\?\`), install-terminal hangs, and gate hangs.

### Polish

- Sweep chrome-band ratio bars (Todo Board, Worker Dock, footer context) with a gradient wash.
- Cap skill dumps and rotate spill files so full catalog bodies and `/init` dumps stay out of history.

## 0.12.8 (2026-08-20)

### Features

- Pick a roomy drive for the SuperLiora data home (~100 GB free). On Windows, use another drive when the profile disk is tight, and set `SUPERLIORA_HOME` to keep it there.

### Bug Fixes

- Recover a broken or hollow source checkout on `liora upgrade --main`, including Windows longpaths and atomic replace.
- Keep the resolved Node on PATH for source upgrades, and recognize the prebuilt wrapper marker so native can switch to source.
- Survive a full disk without crashing (`ENOSPC` / `SQLITE_FULL`) and reclaim cache, tmp, and logs.
- Close permission gaps: unwrap env secrets, tighten OAuth state and Windows secret paths, and do not auto `git add -A` of `.env`.

## 0.12.7 (2026-08-20)

### Features

- Add a SuperLiora desktop shortcut that opens the TUI in a real terminal. After install, double-click SuperLiora on the Desktop.
- Localize the installer, upgrade screens, and TUI in Korean and English, keep product names in English, and pick OS language more reliably (including Korean Windows under Git Bash). Set `SUPERLIORA_LOCALE=ko|en` or Settings → Language.

## 0.12.6 (2026-08-19)

### Bug Fixes

- Fix the TUI flickering as soon as it opens in Windows Terminal, and stop the host-setup sheet from reappearing after it has already run.

### Polish

- Put TUI animations on one clock so editor glow, worker dock linger, shell elapsed time, and footer pulses actually run.

## 0.12.5 (2026-08-18)

### Bug Fixes

- Stop the footer from saying a session is replaying during file scans, shorten Windows cwd paths, restore typed prompts when send is rejected, and tell the operator why Command Hub stays closed over `/files`.

### Polish

- Keep hidden diagnostic dumps off by default. `--debug` writes a thinner set under `~/.superliora/logs`: info-level session logs, no per-frame hang files, no duplicate start breadcrumbs.
- Keep session files in a tighter layout. New sessions write the index under `sessions/`, TUI draft/goals/prefs live in `ui/`, metadata writes are crash-safe, agent folders stay relative, and the session index stays compact. Existing sessions still open.

## 0.12.4 (2026-08-18)

### Features

- `liora upgrade` now auto-installs updates for GitHub checkout installs on Windows. The updater locates Git for Windows' `bash.exe` (never the System32 WSL launcher), runs the checkout update script through it, and passes the running Node directory on PATH so the script can rebuild. When Git Bash is not installed, the manual update command is still shown.

### Bug Fixes

- Stop heavy TUI flickering on Windows while the agent is streaming or working: pace frame updates on terminals that cannot repaint atomically, batch streaming text instead of redrawing on every chunk, and snap the type-on reveal into place instead of animating it.
- Fix TUI startup flicker and the provider picker opening on a black screen on Windows: palette colors are no longer re-sent on every splash frame, and the screen repaints fully after the splash ends or the terminal resizes.

## 0.12.3 (2026-08-18)

### Bug Fixes

- Fix stale lines piling up in the `liora upgrade` prompt and progress display when output wraps, repainting frames safely at any terminal width.

### Polish

- Restyle the upgrade prompt, upgrade progress, and install scripts with animated spinners, gradient progress bars, and styled status output; raw stage markers now only appear in piped or CI output.

## 0.12.2 (2026-08-17)

### Bug Fixes

- Stop Oh My Posh from erroring on Windows PowerShell 5.1 with the inbox PSReadLine. Run `/host-setup` to refresh the profile.

## 0.12.1 (2026-08-17)

### Bug Fixes

- Stop the blank flickering transcript on first launch so Welcome and the idle scene paint instead of an empty pane.

## 0.12.0 (2026-08-17)

### Features

- Add host setup for Windows, macOS, and Linux (Windows Terminal on Windows, CaskaydiaCove Nerd Font, Oh My Posh, zoxide, fzf) and show a confirm list before applying. Run `/host-setup`.

## 0.11.7 (2026-08-17)

### Bug Fixes

- Failed upgrades no longer block the next `liora upgrade` with a stale in-progress lock.

## 0.11.6 (2026-08-17)

### Features

- Source installs and `liora upgrade --main` now download pnpm when Corepack is missing or broken.

## 0.11.5 (2026-08-17)

### Features

- Cap long-context models at their cheap price bands so default sessions stay off whole-request cliffs (Seed/Qwen Coder 128k, Grok/Gemini Pro 200k, Qwen Plus/Flash 256k, GPT-5.4/5.5/5.6 and Fugu Ultra 272k, MiniMax M3 512k). Claude 4.6+, Gemini Flash, Qwen Max, MiMo V2.5, and DeepSeek V4 stay uncapped.

## 0.11.4 (2026-08-17)

### Features

- Cap Grok sessions at 200k context so prompts stay off xAI long-context (2×) rates. Auto-compaction and the working-set ceiling follow that window.

### Bug Fixes

- Stop treating a finished native `liora upgrade` as a failed npm install when the binary has no nearby `package.json`.

## 0.11.3 (2026-08-17)

### Bug Fixes

- Stop TUI black-line flicker by giving every screen cell an explicit canvas background and never erasing a line to the terminal default color.

## 0.11.2 (2026-08-17)

### Features

- Judge Conductor Job isolation, Premium density, and publish targets from the finish-line effect, not prompt keywords. Set `task_track`, `surface_kind`, `debug_fixer`, and `remote_ref` on the Job when you already know the contract.
- Group Conductor jobs on the Job Deck by session outcome, with blocked and remaining first. Open Job Deck with Alt+J.
- Show why Conductor isolated a job, stayed on this checkout, or routed a search — on Job Deck, the create ACK, inspect, Push Preview, and WebSearch glances. Open Job Deck (Alt+J) or run `/job inspect`.

### Bug Fixes

- Conductor merge and push stay on the job's own git checkout. Opening SuperLiora in another repo no longer sends those jobs to the live session cwd.

### Polish

- Show the thinking level next to the model name in the TUI header.

## 0.11.1

### Features

- Split `greenfield_chain` JobCreate contracts so skeleton gates on scaffold/type/lint/unit/build only, fill keeps product AC and web visual checks, and delete-pass cleans placeholders without rebuilding. Queued chain children show a parent-phase wait label.
- When Jobs are running and the main chat lane stays idle for N minutes (default 4; `SUPERLIORA_CONDUCTOR_IDLE_PULSE_MINUTES`), fire a short JobList-only status report with spam guards.

### Bug Fixes

- Do not treat missing job kind as merge-green; keep merge trust honest when kind is absent.

## 0.11.0 (2026-08-16)

### Features

- Add Settings path sandbox modes (`off` | `workspace` | `read-only`) and mark the current Security sandbox choice in the picker.
- Auto-classify Conductor Jobs onto coding vs general tracks from the request text.
- Compress session wire history with gzip, and add `liora gc` plus `doctor --storage` for local storage hygiene.
- Set up Windows Terminal during install so new Windows installs land in a usable terminal profile.

### Bug Fixes

- Pin Inspect diagnostics and mask push stderr noise in agent-core handoffs.
- Preserve gzip wire history on resume append and fork; teach vis to read gzip-only session wires.
- Skip verify fan-out for mission/none/desktop jobs so non-code tracks stay lean.
- Resolve vis fixture paths on Windows and include vis-server in local tests.

## 0.10.2 (2026-08-16)

### Bug Fixes

- Keep question dialogs from freezing TUI input when an interview sits unanswered.
- Stop ambient letterbox and prompt black-band wipes on Windows ConPTY.
- Keep Conductor off auto-compaction dumps and cut merge-verify-wake loops.

### Polish

- Show Worker Dock as Workers, count only interview replies, paint each row as role · job title, and keep resume ghosts on the job title instead of Resuming.
- Recall prompt history with Up/Down on an empty draft instead of ghost autocomplete.
- Let Conductor open a session Goal via CreateGoal.

## 0.10.1 (2026-08-15)

### Bug Fixes

- Keep compiler stacks and stray stdout/stderr out of the TUI prompt. Diagnostic dumps stay in the session log instead of overwriting the draft.

## 0.10.0 (2026-08-15)

### Features

- Add opt-in Performance mode (`off` | `auto` | `on`, default `off`) that overlays the Appearance Off pack and tighter transcript caps on low-spec machines without rewriting saved `[appearance]` prefs. Settings → Appearance and `/performance` control it.
- Recognize macOS Cmd as the TUI primary modifier (same chords as Ctrl on Linux/Windows), and show Cmd instead of hardcoded Ctrl in shortcut hints.
- Show Windows native OS toast notifications via PowerShell WinRT.

### Bug Fixes

- Retry image paste when the first attach fails, and snap external carets forward so Hangul/emoji inserts are not eaten.
- Fix prompt-box image paste races on Windows/WSL and stop Hangul/cluster inserts from dropping characters.
- Keep long session resume/replay from freezing the TUI by capping the transcript window during hydrate.
- Fill leftover and newly exposed TUI rows with the theme background on resize instead of flashing default-black erase bars.
- Fix AUTO role routing so quality roles prefer XHIGH when available, and cheap/compaction roles pick a recent thinking-off model.
- On Windows, put SuperLiora runtime git/bin and node ahead of PATH and run Script shell/git/node via absolute paths instead of bare `bash -lc`.
- In auto permission mode, land-to-main no longer opens a confirm dialog for size/danger holds.

### Polish

- Default transcript density to compact for new sessions and unset config; label compact as the default in the Settings `/transcript` picker. Change with `/transcript` or Ctrl+O.
- Default mouse wheel always scrolls the transcript; use Alt+wheel over a tool output to scroll that nested view only.
- Plan Desk / mission jobs use a 45m wall-clock; post-spawn stalls mark blocked; spent remaining no longer disables the deadline.

## 0.9.6 (2026-08-14)

### Bug Fixes

- Fix `liora upgrade` on Windows failing with `'iex' is not recognized`.

## 0.9.5 (2026-08-14)

### Bug Fixes

- Stop the TUI from full-clearing on terminal resize, editor panel replace, and transcript shrink; keep the last streaming line revealing instead of snapping.
- Fix Windows install so `liora` works in the same PowerShell window after `irm | iex`, and find PortableGit under `~/.superliora/runtime/git`.
- Stop session resume from crashing when a Conductor job worktree is missing; remount the branch or hold the job instead.
- Fix Conductor affinity reuse under blocked parents so continue_from children schedule instead of staying queued.
- Prefer newer same-family models at equal price in smart role routing; stop stale prompt ghost text from covering typed input.

## 0.9.4 (2026-08-13)

### Bug Fixes

- Fix Windows Grok / OAuth login opening a page without `client_id` when `cmd start` split the authorize URL on `&`.

## 0.9.3 (2026-08-13)

### Bug Fixes

- Fix Windows install so `irm | iex` works on PowerShell 5.1, and the same command runs from cmd.exe.

## 0.9.2 (2026-08-13)

### Bug Fixes

- Fix Windows install and first launch: PowerShell 5.1 can parse the installer, `.cmd` shims start, `LIORA_SHELL_PATH` is honored, and Portable Git is downloaded when Git Bash is missing.

## 0.9.1 (2026-08-12)

### Bug Fixes

- Fix Conductor fleet reliability and Job/Worker surfaces: stall detection, non-blocking resume, Goal Desk pool capacity, web explore caps, merge/push off the spawn queue, cheaper dock heartbeats, and clearer Jobs vs Workers UI under load.

## 0.9.0 (2026-08-12)

### Features

- Trim the public CLI to essentials: drop `liora vis` from help, keep day-to-day job ops in the TUI (`/jobs`), and document the keep-list in `liora -h` / reference docs.

## 0.8.2 (2026-08-11)

### Features

- Keep Cursor Auto, Grok 4.5, and Composer 2.5 usable when API-lane models hit quota; JobCreate points at those included-lane aliases first.

## 0.8.1 (2026-08-11)

### Bug Fixes

- Fix `/goal` blocking when cheap coding-chain models fail live probe: escalate to max/parent (e.g. the Conductor model), mark spawn as resumable `blocked`, and show `/model` + `/goal resume` on the Goal Monitor.
- Stop Goal Desk from showing eternal "spinning up" after workers finish; the monitor reports awaiting Conductor / missing worker, and finish criteria no longer look already met.
- Fix Conductor fleets stuck forever at queued after resume: Goal Desk drivers schedule under the umbrella, verify Jobs still run when merge trust blocks the parent, and session resume always pumps already-queued work.
- Fix verify Jobs failing with `verdict=missing` after a real dual-axis pass by parsing the full worker result before the summary size cap.
- Resume and MergeJob heal verify Jobs that already have dual-axis JSON in the summary but never stamped `verifyVerdict`.
- Conductor verify Jobs that finish without dual-axis JSON fail, get one automatic structured re-verify, and skip Debug; MergeJob tells you to requeue verify for JSON instead of opening Debug.
- Fix MergeJob held on `Checks not green` for greenfield apps: root packages run the completion gate, `build` counts as typecheck, missing scripts are `not_applicable`, and a passed verify child can witness green when the gate left slots `not_run`.

### Polish

- Conductor `/goal` lights Goal Monitor and the footer desk badge immediately, with live worker activity on the monitor.

## 0.8.0 (2026-08-11)

### Features

- Conductor JobCreate can keep same-context follow-ups on an existing worker: pass `continue_from_job_id` (or `affinity=auto` with `ownership_paths`) to steer/fold a live or queued Job, or reuse its worktree and resume checkpoint after it finishes. ACK lines may include `affinity_hint` when a cold create overlaps a live owner.

### Bug Fixes

- Fix tool transcript rows leaving a black bar after the text when phase tint pads the line.

### Polish

- Smart auto routing prefers bench-backed flagships (e.g. grok-4.5) over dated heuristic SKUs and shows per-role pick reasons after probing. Open Settings → Model routing → Smart auto routing.

## 0.7.1 (2026-08-11)

### Bug Fixes

- Fix Conductor jobs stuck at "Queued after resume" after a session restart by publishing the main agent before fleet autopilot spawns and waiting for the schedule pump to promote workers.
- Stop letting stale model capability lists hide models.dev vision/tool flags, and skip vision picks that just failed a live probe.

## 0.7.0 (2026-08-11)

### Features

- Auto-resume safe Conductor jobs after a hard exit, keep a crash-durable job ledger mirror, and show Worker Dock recovery ghosts until workers relaunch. Opt out with `/job autoresume off`.
- Settings → Model routing → Smart auto routing now live-probes each role chain and pins only models that respond. Open Settings → Model routing to run it.

### Bug Fixes

- Fix Smart Auto sessions rejecting the first prompt with `model.not_configured` before a concrete model is pinned.
- Reject Conductor JobCreate/spawn when the worker model fails a live probe instead of queueing a doomed worker.
- GenerateImage/GenerateVideo fall back to auto when a forced provider is not ready.
- Stop the Worker Dock from stealing Enter so `/exit` and prompt submit still work while workers are visible.
- Fix Upgrade Studio broken frame layout and stalled-looking install progress during `/upgrade`.

### Polish

- Conductor now sees media key readiness and briefs game/media assets with GenerateImage/GenerateVideo success criteria when keys are present.
- Show live role and model progress while Smart auto routing probes chains.
- Show a short Model failover notice when a worker retries on a fallback model.
- Replace poetic idle aquarium mood lines with short status labels (idle, listening, ready, waiting).
- Drop the extra Todo Board / Worker Dock side indent so chrome bands use the full stage width.

## 0.6.0 (2026-08-10)

### Features

- Conductor Jobs declare `surface_kind` (none/web/tui/mixed) and stamp `verifyVerdict` for merge proof. Path regex no longer invents VerifySurface gates. Set `surface_kind` on JobCreate; JobSteer can patch it when MergeJob holds.
- Smart Auto on the Conductor lane picks a coding-class orchestrator from models.dev scores. Conductor can set JobCreate.model_alias from the fleet catalog when role models are auto. Use `/model auto` with the Conductor profile.

### Polish

- Replace the GitHub Pages ANSI museum hero with a brand-first landing and curated HTML product frame; add feature-cluster TUI visuals and a bento motion grid.

## 0.5.1 (2026-08-10)

### Bug Fixes

- Fix upgrade/install version skew: pin native installs to the GitHub Release they advertise, sync CDN tip files with the CLI version, and harden SEA binary replace with backup rollback.

### Polish

- Polish the GitHub Pages museum landing: column-scoped hero veil, clearer Stage captions, tighter CTA hierarchy, and bilingual theme labels.

## 0.5.0 (2026-08-10)

### Features

- Conductor Jobs drop UltraSwarm-style `expertRole` and use Job kinds instead: `research` for web/docs investigation and `verify` for Maker≠Checker checks after implement. Merge waits on a passed verify child.
- Conductor Jobs carry Matt-style quality contracts: `test_seams` / `tdd_mode`, debug `repro_command`, dual-axis Standards∥Spec verify children, Plan Desk frontier grilling, `blocked_by_job_ids` scheduling, and SkillCreate writing-for-agents gates. Merge conflicts enqueue a resolve Job.
- Add opt-in Aside MCP sidecar wiring for private browser evidence. Run `liora browser-use aside enable`.

## 0.4.0 (2026-08-10)

### Features

- Smart Auto skips retired or probe-failed model aliases, fails over on model-not-found errors, and ranks fresher models using models.dev data. Pin the session model to `auto` to use it.
- Worker Dock: open transcripts with hover chrome that uses a distinct pad (·) so selection keeps a single ❯ cursor; densemode reserves a fixed gutter so columns stay aligned.

### Bug Fixes

- Skip exhausted Qwen/Alibaba token-plan providers in worker model routing and when pinning Smart Auto loop roles.
- Stop interactive `/exit` from hanging when MCP or background cleanup stalls.
- Start the TUI on Neon Noir at module load so upgrades no longer flash or stick on bare dark before preferences apply.
- Stop background compaction from cancelling on Conductor inject/steer append-only churn; scale the worker deadline with context size; stop compaction progress from resizing the transcript on every stream tick.

## 0.3.1 (2026-08-09)

### Bug Fixes

- Skip Smart Auto picks when a provider has no usable API key or OAuth token, and fall back from unhealthy role overrides.
- Fix the native SEA build by exporting `/locale` argument completions.

### Features

- Push jobs infer `gh-pages` from Pages deploy briefs and enable GitHub Pages after a successful push when possible.

## 0.3.0 (2026-08-09)

### Features

- Restore richer premium transcript streaming motion: faster type-on catch-up, stronger live ink glow/caret, steadier ambient cadence under light load, and more concurrent tool-card live rebuilds. Set Visual Quality to Premium to feel it.
- Unify Todo Board and Worker Dock chrome-band live motion.
- Add `--main` / `/upgrade --main` to install tip of `main` past published releases.
- Add turn-level Smart Auto model routing and PushJob remote publish gating.
- Localize the interactive TUI (EN/KO) via Settings language.

### Breaking Changes

- Remove Mission mode and Swarm mode surfaces (`/mission`, `/swarm`, `/fleet`, related settings). Use `/plan`, `/goal`, the agent dock, and the job strip instead.
- Remove beginner-hostile diagnostic slash commands (`/bench`, `/renderer`, `/term`, `/export-debug-zip`, `/improve-harness`, `/preflight`) and `/feedback`.
- Drop remaining Kimi-era CLI migration / cache compatibility paths; use `liora` and `.superliora` only.

## 0.20.1 (2026-08-08)

SuperLiora 0.20.1 was the first GitHub Release with native SEA installers (`install.sh` / `install.ps1`).
