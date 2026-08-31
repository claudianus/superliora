# @superliora/liora

## 0.21.0

### Minor Changes

- Worker Dock: goal-lane ledger rows (goal-desk / goal-driver) now show live telemetry and plain status instead of a bare title. Desk rows mirror their driver's phase, provenance chips (`desk` / `driver`) replace the blank model column, and the misleading "suspended — waiting for a pool slot" / "finishing" copy for ledger ghosts was replaced with specific notes (e.g. `paused — /goal resume to continue`).

### Patch Changes

- Fix the VerifySurface dead-end on packaged hosts: `browser-use doctor` no longer refuses to probe when no source packageRoot exists, `browser-use install` now repairs the missing cloakbrowser/playwright-core node_modules sidecars next to the installed binary, and the browser runtimes load playwright-core through a disk resolver that walks the documented install roots instead of a bare external import. Also accept explicit `focus: null` in the auto-skillify lesson gate JSON (models emit null, not an absent field).

## 0.20.6

### Patch Changes

- Remove the unused `apps/vis` session visualizer and its build plumbing.
- `liora vis` was a ghost subcommand (registered nowhere), so the app, its
- `@superliora/vis-server` / `@superliora/vis-web` workspace packages, the
- `build-vis-asset` prebuild step, the embedded web asset stub, and the vis
- typecheck CI steps are gone. No shipped CLI surface changes; builds get
- faster by dropping the vis asset generation from `prebuild`.
- Stop vendoring the external skill catalog in the repo.
- `packages/agent-core/src/skill/catalog/` held ~23k files (~187 MB) fetched from
- seven third-party skill repos and committed as build output. It is now a
- gitignored build artifact:
- Fresh checkouts ship builtin skills only; `SearchSkill` degrades gracefully
- until the catalog is fetched.
- Source installs (`install.sh`, `~/.superliora/source` upgrades) fetch the
- catalog automatically after `pnpm install` and skip gracefully when offline
- (`SUPERLIORA_SKIP_SKILL_CATALOG=1` forces the skip).
- Manual fetch: `pnpm run build:skill-catalog`.
- The catalog build script moved to `packages/agent-core/scripts/` so its
- `js-yaml` dependency resolves, and `retrieval:build` now skips the skill
- corpus when the index has not been fetched instead of crashing.

## 0.20.5

### Patch Changes

- Cut per-push CI wall time from ~27 to ~15 minutes: Windows CI runs a Windows-critical subset per push with the full suite moved to a nightly schedule and release tags, and the test-baseline ratchet consumes the unified test run's results JSON instead of re-running vitest. Landing changesets on a green main now ships automatically: the new auto-release workflow versions, commits, tags, and dispatches the native publish pipeline.

## 0.20.4

### Patch Changes

- Scope worker model selection to user-selected models: non-auto sessions no longer roam the provider catalog for worker/job models (explicit role models, then the session model), catalog recommendation surfaces (fleet card, Still-live lists) follow the same pool, and the Cursor included-lane hint is only injected when a cursor lane alias is actually configured.
- Keep per-model 403 region/entitlement rejections alias-scoped instead of poisoning the shared provider credential, weigh fresh main-lane traffic over stale credential marks at spawn gates, and give reasoning-capable models completion headroom in live probes so thinking-first upstreams no longer read as empty.

## 0.20.3

### Patch Changes

- Fix TUI crash `options.lines.slice is not a function` when measuring long thinking blocks during transcript scroll geometry. ThinkingComponent now implements windowed `measureContentRows`/`paintContentRows` and guards large bodies with a length-only stub during measure mode; `projectRendererLineWindow`/`Preview` defensively handle stale placeholder arrays.

## 0.20.2

### Patch Changes

- Stop re-appending the user prompt on every provider-failure retry, which inflated the context with duplicate messages and skewed model input after a failed turn.
- Treat a recent successful LLM call on a model as proof it is live, so job workers no longer get blocked by a false probe failure on a model the session is actively using.
- Stop auto-memory from recording system-generated prompts as user preferences, and skip duplicate captures of the same preference.
- Give auto-created skills one rewrite round using the quality-gate feedback instead of dropping the lesson.
- Remove the leftover worktree when a job is cancelled before its worker ever ran.

## 0.20.0

### Minor Changes

- Resolve catalog wires per model from metadata and split multi-protocol providers by wire. A gateway that serves several protocols from one API root now picks the wire from the model's `provider.npm` and each protocol receives its own provider entry with the correct API root.

### Patch Changes

- Move the inherit entry to the end of the picker so it preserves the row index when toggling worker inherit-parent.

## 0.19.0

### Minor Changes

- Unify opencode Go/Zen to a single provider with smart per-model wire and predictable routing. Unify `opencode-go/muse` hard split into one provider per Go/Zen with model-level `protocol` (`openai`/`openai_responses`/`anthropic`) resolved by live `/models` + pattern fallback, not per-id hardcode. Extend `ModelAlias.protocol` to 3-way enum and generalize provider-manager wire resolution. Migrate legacy `opencode-go-muse` aliases and expose Go in the local catalog. Add worker inherit-parent routing: per-role `loopControl.*Model="inherit"` and global `workerInheritParent`/`workerInheritParentRoles` so workers can mirror the parent model for cache/consistency. TUI shows an explicit inherit row and CLI `provider route worker-inherit`. Add conductor model pool (`loopControl.conductorModelPool`/`conductorPoolMode`) so the orchestrator ranks only user-selected aliases, fixing cross-provider drift. CLI `provider route conductor-pool` and TUI pool hint.


## 0.18.0

### Minor Changes

- Add the Workspace side dock: with SUPERLIORA_EXPERIMENTAL_WORKSPACE_DOCK=1, clicking a mission-control worker opens its live transcript in a right-hand column beside the main transcript instead of taking over the editor.

## 0.17.1

### Patch Changes

- Warm sessions keep their model across smart-route role switches, and route ordering prefers the warmed provider prefix on ties — switching aliases destroys the prompt cache and costs more than it saves. Disable with SUPERLIORA_EXPERIMENTAL_CACHE_STICKY_ROUTING=false.
- Job affinity weighs resume checkpoints, shared context paths, kind match, and recency when folding a follow-up into an existing Job, and the affinity hint shows the score with its reasons.
- Job Deck rows and the worker usage strip show each worker's prompt-cache hit share, so a worker drifting below the 99% cache target is visible at a glance.

## 0.17.0

### Minor Changes

- Show the job's branch diff in Merge Preview before landing. Press D inside Merge Preview to review the changed files.

### Patch Changes

- Queued prompts held by the daemon now survive a restart and keep their order instead of being dropped when dispatch fails.
- Workers that crash or fail to spawn now retry up to twice with backoff before the job is marked failed.
- Background jobs now ring the terminal bell and send a desktop notification when they finish, fail, or need input.
- Send the per-session prompt-cache routing marker to Bedrock and Vertex Claude so worker prompt prefixes stay isolated.

## 0.16.1

### Patch Changes

- Remove unused FREE-mode helper exports.

## 0.16.0

### Minor Changes

- Make background auto-updates opt-in. Enable them in Command Hub → Upgrade → Auto-install.

### Patch Changes

- Require --insecure-no-tls for non-loopback server binds and hide the bearer token on those binds unless --show-token is passed.
- Answer 401 for unknown paths without a token, compare Origins including port, reject a null Origin, and cap WebSocket frame size at 1 MiB.
- Open files through explorer.exe on Windows so filenames containing cmd metacharacters cannot run commands.
- Close shell wrapper and git flag bypasses of the Conductor worker no-push guard.
- Recognize hex IPv4-mapped IPv6 addresses in the fetch tool private-address check, and stop blocking public domains that start with ULA-looking prefixes.
- Kill processes spawned by Script tool calls when the call times out or is cancelled, and stop reusing the first call's parent context for later calls.
- Restrict OAuth token files to the current user on Windows and enable the cross-process token refresh lock there.
- Pin Lightpanda, oh-my-posh, and cua-driver installs to fixed versions with checksum verification.
- Leave the PowerShell execution policy unchanged during install unless --allow-execution-policy is passed.
- Verify the Node.js bootstrap download against nodejs.org SHASUMS256 before using it, and pin installer modules to the published release tag.
- Redact credential-shaped strings before writing editor input history to disk, and apply secret redaction to log message bodies.
- Cap live ACP sessions with least-recently-used eviction instead of holding every session forever.
- Drop __proto__ and constructor keys from config patches before merging.
- Retry Windows atomic writes when the target file is briefly locked, treat malformed glob character classes as no-match instead of crashing, and warn when the docker process sandbox falls back to host execution.

## 0.15.5

### Patch Changes

- Fix opencode-go muse-spark 1.2 contributor routing to use openai_responses. The zen/go chat completions endpoint returns 500 for this model while the responses endpoint succeeds.

## 0.15.4

### Patch Changes

- Fix `Model "auto" is not configured` after `/free off` → `/free on`: the turn now falls back to a concrete free model with stale probe cooldowns cleared, so a transient free-tier outage surfaces a provider error instead of a config error.
- Side LLM calls (prompt suggestions, ghost text) no longer resolve auth against the virtual `auto` pin.
- Stale free-model aliases are now actually deleted from config.toml on `/free on` and at startup (the previous prune wrote a patch the deep-merge config API cannot apply).

## 0.15.3

### Patch Changes

- Fix FREE mode `Model auto is not configured` when no healthy free model is available: fallback to any free alias as last resort so the turn surfaces a provider error instead of a config error.
- Prune stale free-model aliases (`opencode/x-preview-f-free`, `deepseek-v4-flash-free`, etc.) that are no longer in the live `models.dev` catalog and clear `defaultModel` when it points at a deleted alias.

## 0.15.2

### Patch Changes

- Unify ClinePass provider id `clinepass` (without hyphen) to `cline-pass` per `models.dev` (13 models) and remove last hard-coded `cline-pass/glm-5.2` fallback — now all 4 curated providers (`opencode` 93, `zai` 16, `zai-coding-plan` 7, `cline-pass` 13) are fully live via `models.dev` → `OpenRouter` → `provider /models` with `BUILT_IN_CATALOG_JSON` offline fallback. No hard-coded model lists remain.

## 0.15.1

### Patch Changes

- Fix FREE mode crash when no free models are configured and remove stale hard-coded model lists: `opencode`/`zai`/`zai-coding-plan`/`cline-pass` now rely on live `models.dev` (93/16/7/13) via additive merge, with OpenRouter (`https://openrouter.ai/api/v1/models`) as live fallback when `models.dev` is unreachable. `clinepass` (without hyphen) unified to `cline-pass` per `models.dev`. Curated `big-pickle` now correctly flagged `cost 0` for FREE detection.
- Fix `/free on` immediately warning when no healthy free model and `FREE` turn routing emitting `free-no-model` warning instead of generic `model.not_configured`. Lint fix for `free-mode.test.ts` unnecessary cast.

## 0.15.0

### Minor Changes

- Add FREE mode for model routing: set `free_mode = true` in `config.toml` or run `/free on` to route every role (coding, planning, exploration, compaction, completion, debugging, and Smart Auto main session) to free-tier models only. Selection remains benchmark-aware (models.dev coding benches, quality/value scores, tier/context filters) — not a dumb cheapest-price pick — and relaxes strict quality floors only to pick the best available free candidate. Use `/free status`/`/free off` or `free_mode = false` to restore standard routing; enabling FREE auto-switches a paid pinned `default_model` to `auto` so the main turn also uses free.

## 0.14.0

### Minor Changes

- Add custom model input for unlisted and just-released models and refresh model catalog handling. Add Ctrl+N custom model dialog in the model picker and `liora provider model add <providerId> <modelId>` for any wire ID not yet in models.dev or provider /models; custom entries are marked userManaged and survive catalog refreshes. Run /model then Ctrl+N or `liora provider model add anthropic claude-opus-4-8 --thinking` to try it. Offline fallback presets for Copilot, Codex, xAI Grok, and cloud Claude are updated to current flagships.

## 0.13.7

### Patch Changes

- Keep hotfix coding jobs in isolated worktrees and refuse Land until the Job has passed. Job Deck reads the land cell on the existing job snapshot.
- Keep standing Memory preferences in later turns, including Job follow-ups that never mention them.
- Pin Job worker prompt cache to the worker so parallel workers no longer share the Conductor session key and evict each other's routes.
- Show Land on the Job Deck gate line, and say hotfix coding jobs always isolate in worktrees. Open Job Deck (Alt+J) to see the land cell.

## 0.13.6

### Patch Changes

- Fix Cursor subscription chat against the current AgentService host, device checksum, and Connect error trailers so turns stop failing with generic API errors.

## 0.13.5

### Patch Changes

- Fix Cursor/Grok text-form tool calls so JSON array arguments are not split on commas.

## 0.13.4

### Patch Changes

- Send thinking effort `max` as `max` on OpenAI-compatible requests instead of rewriting it to `xhigh`.
- Show OpenRouter, OpenCode Zen, and Z.AI in `/login`, and keep thinking on when the imported model cannot disable it.
- Save detected catalog API keys as `{env:VAR}` from `/login` instead of copying the secret into the file.
- Prefill GitHub Copilot paste-login from `gh auth token` when env is empty, and point failed Anthropic/Cursor/xAI OAuth at API key, cloud, or client-version env pins.

## 0.13.3

### Patch Changes

- Start the research-bridge loopback server when Node launches the host as a Windows child process.

## 0.13.2

### Patch Changes

- Fix Windows workers missing bundled node/pnpm when SuperLiora home is redirected, and stop retrying stalled LLM streams.

## 0.13.1

### Patch Changes

- Fix the Windows desktop shortcut doing nothing on the first double-click after a fresh install.

## 0.13.0

### Minor Changes

- Conductor now runs work as named sessions you can resume, keep, apply, or open as a PR. Use `/jobs drawer` to continue yesterday's session, `/jobs rename` to name it, `/jobs land` for Keep/Apply/PR, or `liora -r <name>`.

## 0.12.18

### Patch Changes

- Coding jobs now default to no extra verify workers and auto-land; follow-ups reuse the live job. `/job mode hotfix` skips the worktree when you are the only coding job.

## 0.12.17

### Patch Changes

- Fix Windows browser spawn EINVAL so visual proof is skipped_host instead of a product fail, and land playable dests when tests pass.

## 0.12.16

### Patch Changes

- Stop compact transcript rows from jumping up and down while tools run.
- Default transcript detail to standard. Ctrl+O still cycles minimal → compact → standard → full.

## 0.12.15

### Patch Changes

- Stop JobInspect and JobInbox transcript notices from bouncing up and down while ambient motion is on.

## 0.12.14

### Patch Changes

- Fix the Windows desktop shortcut that showed a wt.exe license error on first double-click.
- Add /folder to switch the workspace at runtime. Run /folder, or pick Open folder in Command Hub. Desktop launches from the home folder prompt for a project.
- Use the SuperLiora Neon Noir mark on desktop and Start Menu shortcuts instead of the Node.js icon.

## 0.12.13

### Patch Changes

- Show a live turn-status line above the prompt. Parked TaskOutput waits stay a calm cue; click the leftover row to open /tasks, [stop] to cancel, or [↓] to detach.
- Send adjacent queued prompts as one turn and paint each as its own bubble. Consecutive search tools fold into one group.
- Stream long assistant answers without re-parsing markdown that has already settled.
- Make the session picker a scan list. Open it from Command Hub → Sessions or /resume.
- Add experimental GitHub Copilot login. Enable with SUPERLIORA_EXPERIMENTAL_GITHUB_COPILOT=1, then /login.

## 0.12.12

### Patch Changes

- Stop Upgrade Studio from installing optional sidecars and winget packages. Those steps need a console or UAC, and the studio has neither.

## 0.12.11

### Patch Changes

- Show live remaining provider quota in the footer and a /quota glance. Run /quota to see every logged-in provider.
- Delete expired local web-search cache rows and cap the table at 256.
- Fix `liora upgrade --main` on Windows so a source checkout writes to `%LOCALAPPDATA%\SuperLiora\bin` and finds pnpm under SUPERLIORA_HOME.

## 0.12.10

### Patch Changes

- Keep chrome motion (header, footer, thought-orb, editor frame) alive on classic ConPTY. Large-area starfields stay static; Windows Terminal with WT_SESSION stays synchronized.

## 0.12.9

### Patch Changes

- Give the welcome hero a live premium frame (comet chase + breath; static when motion is off).
- Sweep chrome-band ratio bars (Todo Board, Worker Dock, footer context) with a gradient wash.
- Cap skill dumps and rotate spill files so full catalog bodies and /init dumps stay out of history.
- Give the device-code login panel a live frame that matches the rest of the chrome.
- Fix Windows shutdown (sqlite handles), search/worktree path identity (8.3 and `\\?\`), install-terminal hangs, and gate hangs.
- Give the prompt editor a live frame on the shared clock.
- Morph live thinking into a thought-orb (·∘○◎●) instead of a generic spinner.
- Fix one-liner installs (`irm | iex` / `curl | bash`) dying after Node download because the bootstrap bundle omitted `checkout-health.mjs`.

## 0.12.8

### Patch Changes

- Pick a roomy drive for the SuperLiora data home (~100 GB free). On Windows, use another drive when the profile disk is tight, and set SUPERLIORA_HOME to keep it there.
- Recover a broken or hollow source checkout on `liora upgrade --main`, including Windows longpaths and atomic replace.
- Keep the resolved Node on PATH for source upgrades, and recognize the prebuilt wrapper marker so native can switch to source.
- Survive a full disk without crashing (ENOSPC / SQLITE_FULL) and reclaim cache, tmp, and logs.
- Close permission gaps: unwrap env secrets, tighten OAuth state and Windows secret paths, and do not auto `git add -A` of `.env`.

## 0.12.7

### Patch Changes

- Add a SuperLiora desktop shortcut that opens the TUI in a real terminal. After install, double-click SuperLiora on the Desktop.
- Localize the installer, upgrade screens, and TUI in Korean and English, keep product names in English, and pick OS language more reliably (including Korean Windows under Git Bash). Set SUPERLIORA_LOCALE=ko|en or Settings → Language.

## 0.12.6

### Patch Changes

- Fix the TUI flickering as soon as it opens in Windows Terminal, and stop the host-setup sheet from reappearing after it has already run.
- Put TUI animations on one clock so editor glow, worker dock linger, shell elapsed time, and footer pulses actually run.

## 0.12.5

### Patch Changes

- Stop the footer from saying a session is replaying during file scans, shorten Windows cwd paths, restore typed prompts when send is rejected, and tell the operator why Command Hub stays closed over `/files`.
- Keep hidden diagnostic dumps off by default. `--debug` writes a thinner set under ~/.superliora/logs: info-level session logs, no per-frame hang files, no duplicate start breadcrumbs.
- Keep session files in a tighter layout. New sessions write the index under sessions/, TUI draft/goals/prefs live in ui/, metadata writes are crash-safe, agent folders stay relative, and the session index stays compact. Existing sessions still open.

## 0.12.4

### Patch Changes

- Stop heavy TUI flickering on Windows while the agent is streaming or working: pace frame updates on terminals that cannot repaint atomically, batch streaming text instead of redrawing on every chunk, and snap the type-on reveal into place instead of animating it.
- Fix TUI startup flicker and the provider picker opening on a black screen on Windows: palette colors are no longer re-sent on every splash frame, and the screen repaints fully after the splash ends or the terminal resizes.
- `liora upgrade` now auto-installs updates for GitHub checkout installs on Windows. The updater locates Git for Windows' bash.exe (never the System32 WSL launcher), runs the checkout update script through it, and passes the running Node directory on PATH so the script can rebuild. When Git Bash is not installed, the manual update command is still shown.

## 0.12.3

### Patch Changes

- Fix stale lines piling up in the `liora upgrade` prompt and progress display when output wraps, repainting frames safely at any terminal width.
- Restyle the upgrade prompt, upgrade progress, and install scripts with animated spinners, gradient progress bars, and styled status output; raw stage markers now only appear in piped or CI output.

## 0.12.2

### Patch Changes

- Stop Oh My Posh from erroring on Windows PowerShell 5.1 with the inbox PSReadLine. Run `/host-setup` to refresh the profile.

## 0.12.1

### Patch Changes

- Stop the blank flickering transcript on first launch so Welcome and the idle scene paint instead of an empty pane.

## 0.12.0

### Minor Changes

- Add host setup for Windows, macOS, and Linux (Windows Terminal on Windows, CaskaydiaCove Nerd Font, Oh My Posh, zoxide, fzf) and show a confirm list before applying. Run `/host-setup`.

## 0.11.7

### Patch Changes

- Failed upgrades no longer block the next `liora upgrade` with a stale in-progress lock.

## 0.11.6

### Patch Changes

- Source installs and `liora upgrade --main` now download pnpm when Corepack is missing or broken.

## 0.11.5

### Patch Changes

- Cap long-context models at their cheap price bands so default sessions stay off whole-request cliffs (Seed/Qwen Coder 128k, Grok/Gemini Pro 200k, Qwen Plus/Flash 256k, GPT-5.4/5.5/5.6 and Fugu Ultra 272k, MiniMax M3 512k). Claude 4.6+, Gemini Flash, Qwen Max, MiMo V2.5, and DeepSeek V4 stay uncapped.

## 0.11.4

### Patch Changes

- Cap Grok sessions at 200k context so prompts stay off xAI long-context (2×) rates. Auto-compaction and the working-set ceiling follow that window.
- Stop treating a finished native `liora upgrade` as a failed npm install when the binary has no nearby package.json.

## 0.11.3

### Patch Changes

- Stop TUI black-line flicker by giving every screen cell an explicit canvas background and never erasing a line to the terminal default color.

## 0.11.2

### Minor Changes

- Judge Conductor Job isolation, Premium density, and publish targets from the finish-line effect, not prompt keywords. Set task_track, surface_kind, debug_fixer, and remote_ref on the Job when you already know the contract.

### Patch Changes

- Show the thinking level next to the model name in the TUI header.
- Group Conductor jobs on the Job Deck by session outcome, with blocked and remaining first. Open Job Deck with Alt+J.
- Show why Conductor isolated a job, stayed on this checkout, or routed a search — on Job Deck, the create ACK, inspect, Push Preview, and WebSearch glances. Open Job Deck (Alt+J) or run /job inspect.
- Conductor merge and push stay on the job's own git checkout. Opening SuperLiora in another repo no longer sends those jobs to the live session cwd.

## 0.11.1

### Patch Changes

- Split greenfield_chain JobCreate contracts so skeleton gates on scaffold/type/lint/unit/build only, fill keeps product AC and web visual checks, and delete-pass cleans placeholders without rebuilding. Queued chain children show a parent-phase wait label.
- When Jobs are running and the main chat lane stays idle for N minutes (default 4; `SUPERLIORA_CONDUCTOR_IDLE_PULSE_MINUTES`), fire a short JobList-only status report with spam guards.
- Do not treat missing job kind as merge-green; keep merge trust honest when kind is absent.

## 0.11.0

### Minor Changes

- Add Settings path sandbox modes (`off` | `workspace` | `read-only`) and mark the current Security sandbox choice in the picker.
- Auto-classify Conductor Jobs onto coding vs general tracks from the request text.
- Compress session wire history with gzip, and add `liora gc` plus `doctor --storage` for local storage hygiene.
- Set up Windows Terminal during install so new Windows installs land in a usable terminal profile.

### Patch Changes

- Pin Inspect diagnostics and mask push stderr noise in agent-core handoffs.
- Preserve gzip wire history on resume append and fork; teach vis to read gzip-only session wires.
- Skip verify fan-out for mission/none/desktop jobs so non-code tracks stay lean.
- Resolve vis fixture paths on Windows and include vis-server in local tests.

## 0.10.2

### Patch Changes

- Show Worker Dock as Workers, count only interview replies, paint each row as role · job title, and keep resume ghosts on the job title instead of Resuming.
- Keep question dialogs from freezing TUI input when an interview sits unanswered.
- Stop ambient letterbox and prompt black-band wipes on Windows ConPTY.
- Recall prompt history with Up/Down on an empty draft instead of ghost autocomplete.
- Keep Conductor off auto-compaction dumps and cut merge-verify-wake loops.
- Let Conductor open a session Goal via CreateGoal.

## 0.10.1

### Patch Changes

- Keep compiler stacks and stray stdout/stderr out of the TUI prompt. Diagnostic dumps stay in the session log instead of overwriting the draft.

## 0.10.0

### Minor Changes

- Add opt-in Performance mode (`off` | `auto` | `on`, default `off`) that overlays the Appearance Off pack and tighter transcript caps on low-spec machines without rewriting saved `[appearance]` prefs. Settings → Appearance and `/performance` control it.

### Patch Changes

- Retry image paste when the first attach fails, and snap external carets forward so Hangul/emoji inserts are not eaten.
- Fix prompt-box image paste races on Windows/WSL and stop Hangul/cluster inserts from dropping characters.
- Default transcript density to compact for new sessions and unset config; label compact as the default in the Settings `/transcript` picker. Change with `/transcript` or Ctrl+O.
- Default mouse wheel always scrolls the transcript; use Alt+wheel over a tool output to scroll that nested view only.
- Keep long session resume/replay from freezing the TUI by capping the transcript window during hydrate.
- Recognize macOS Cmd as the TUI primary modifier (same chords as Ctrl on Linux/Windows), and show Cmd instead of hardcoded Ctrl in shortcut hints.
- Fill leftover and newly exposed TUI rows with the theme background on resize instead of flashing default-black erase bars.
- Show Windows native OS toast notifications via PowerShell WinRT.
- Fix AUTO role routing so quality roles prefer XHIGH when available, and cheap/compaction roles pick a recent thinking-off model.
- On Windows, put SuperLiora runtime git/bin and node ahead of PATH and run Script shell/git/node via absolute paths instead of bare `bash -lc`.
- Plan Desk / mission jobs use a 45m wall-clock; post-spawn stalls mark blocked; spent remaining no longer disables the deadline.
- In auto permission mode, land-to-main no longer opens a confirm dialog for size/danger holds.

## 0.9.6

### Patch Changes

- Fix `liora upgrade` on Windows failing with `'iex' is not recognized`.

## 0.9.5

### Patch Changes

- Stop the TUI from full-clearing on terminal resize, editor panel replace, and transcript shrink; keep the last streaming line revealing instead of snapping.
- Fix Windows install so `liora` works in the same PowerShell window after `irm | iex`, and find PortableGit under `~/.superliora/runtime/git`.
- Stop session resume from crashing when a Conductor job worktree is missing; remount the branch or hold the job instead.
- Fix Conductor affinity reuse under blocked parents so continue_from children schedule instead of staying queued.
- Prefer newer same-family models at equal price in smart role routing; stop stale prompt ghost text from covering typed input.

## 0.9.4

### Patch Changes

- Fix Windows Grok / OAuth login opening a page without `client_id` when `cmd start` split the authorize URL on `&`.

## 0.9.3

### Patch Changes

- Fix Windows install so `irm | iex` works on PowerShell 5.1, and the same command runs from cmd.exe.

## 0.9.2

### Patch Changes

- Fix Windows install and first launch: PowerShell 5.1 can parse the installer, `.cmd` shims start, `LIORA_SHELL_PATH` is honored, and Portable Git is downloaded when Git Bash is missing.

## 0.9.1

### Patch Changes

- Fix Conductor fleet reliability and Job/Worker surfaces: stall detection, non-blocking resume, Goal Desk pool capacity, web explore caps, merge/push off the spawn queue, cheaper dock heartbeats, and clearer Jobs vs Workers UI under load.

## 0.9.0

### Minor Changes

- Trim the public CLI to essentials: drop `liora vis` from help, keep day-to-day job ops in the TUI (`/jobs`), and document the keep-list in `liora -h` / reference docs.

## 0.8.2

### Patch Changes

- Keep Cursor Auto, Grok 4.5, and Composer 2.5 usable when API-lane models hit quota; JobCreate points at those included-lane aliases first.

## 0.8.1

### Patch Changes

- Fix `/goal` blocking when cheap coding-chain models fail live probe: escalate to max/parent (e.g. the Conductor model), mark spawn as resumable `blocked`, and show `/model` + `/goal resume` on the Goal Monitor.
- Conductor `/goal` lights Goal Monitor and the footer desk badge immediately, with live worker activity on the monitor.
- Stop Goal Desk from showing eternal "spinning up" after workers finish; the monitor reports awaiting Conductor / missing worker, and finish criteria no longer look already met.
- Fix Conductor fleets stuck forever at queued after resume: Goal Desk drivers schedule under the umbrella, verify Jobs still run when merge trust blocks the parent, and session resume always pumps already-queued work.
- Fix verify Jobs failing with `verdict=missing` after a real dual-axis pass by parsing the full worker result before the summary size cap.
- Resume and MergeJob heal verify Jobs that already have dual-axis JSON in the summary but never stamped `verifyVerdict`.
- Conductor verify Jobs that finish without dual-axis JSON fail, get one automatic structured re-verify, and skip Debug; MergeJob tells you to requeue verify for JSON instead of opening Debug.
- Fix MergeJob held on `Checks not green` for greenfield apps: root packages run the completion gate, `build` counts as typecheck, missing scripts are `not_applicable`, and a passed verify child can witness green when the gate left slots `not_run`.

## 0.8.0

### Minor Changes

- Conductor JobCreate can keep same-context follow-ups on an existing worker: pass continue_from_job_id (or affinity=auto with ownership_paths) to steer/fold a live or queued Job, or reuse its worktree and resume checkpoint after it finishes. ACK lines may include affinity_hint when a cold create overlaps a live owner.

### Patch Changes

- Smart auto routing prefers bench-backed flagships (e.g. grok-4.5) over dated heuristic SKUs and shows per-role pick reasons after probing. Open Settings → Model routing → Smart auto routing.
- Fix tool transcript rows leaving a black bar after the text when phase tint pads the line.

## 0.7.1

### Patch Changes

- Fix Conductor jobs stuck at "Queued after resume" after a session restart by publishing the main agent before fleet autopilot spawns and waiting for the schedule pump to promote workers.
- Stop letting stale model capability lists hide models.dev vision/tool flags, and skip vision picks that just failed a live probe.

## 0.7.0

### Minor Changes

- Auto-resume safe Conductor jobs after a hard exit, keep a crash-durable job ledger mirror, and show Worker Dock recovery ghosts until workers relaunch. Opt out with `/job autoresume off`.
- Settings → Model routing → Smart auto routing now live-probes each role chain and pins only models that respond. Open Settings → Model routing to run it.

### Patch Changes

- Conductor now sees media key readiness and briefs game/media assets with GenerateImage/GenerateVideo success criteria when keys are present.
- Show live role and model progress while Smart auto routing probes chains.
- Fix Smart Auto sessions rejecting the first prompt with model.not_configured before a concrete model is pinned.
- Reject Conductor JobCreate/spawn when the worker model fails a live probe instead of queueing a doomed worker.
- Show a short Model failover notice when a worker retries on a fallback model.
- GenerateImage/GenerateVideo fall back to auto when a forced provider is not ready.
- Stop the Worker Dock from stealing Enter so `/exit` and prompt submit still work while workers are visible.
- Replace poetic idle aquarium mood lines with short status labels (idle, listening, ready, waiting).
- Drop the extra Todo Board / Worker Dock side indent so chrome bands use the full stage width.
- Fix Upgrade Studio broken frame layout and stalled-looking install progress during `/upgrade`.

## 0.6.0

### Minor Changes

- Conductor Jobs declare `surface_kind` (none/web/tui/mixed) and stamp `verifyVerdict` for merge proof. Path regex no longer invents VerifySurface gates. Set `surface_kind` on JobCreate; JobSteer can patch it when MergeJob holds.
- Smart Auto on the Conductor lane picks a coding-class orchestrator from models.dev scores. Conductor can set JobCreate.model_alias from the fleet catalog when role models are auto. Use `/model auto` with the Conductor profile.

### Patch Changes

- Replace the GitHub Pages ANSI museum hero with a brand-first landing and curated HTML product frame; add feature-cluster TUI visuals and a bento motion grid.

## 0.5.1

### Patch Changes

- Fix upgrade/install version skew: pin native installs to the GitHub Release they advertise, sync CDN tip files with the CLI version, and harden SEA binary replace with backup rollback.
- Polish the GitHub Pages museum landing: column-scoped hero veil, clearer Stage captions, tighter CTA hierarchy, and bilingual theme labels.

## 0.5.0

### Minor Changes

- Conductor Jobs drop UltraSwarm-style `expertRole` and use Job kinds instead: `research` for web/docs investigation and `verify` for Maker≠Checker checks after implement. Merge waits on a passed verify child.
- Conductor Jobs carry Matt-style quality contracts: `test_seams` / `tdd_mode`, debug `repro_command`, dual-axis Standards∥Spec verify children, Plan Desk frontier grilling, `blocked_by_job_ids` scheduling, and SkillCreate writing-for-agents gates. Merge conflicts enqueue a resolve Job.
- Add opt-in Aside MCP sidecar wiring for private browser evidence. Run `liora browser-use aside enable`.

## 0.4.0

### Minor Changes

- Smart Auto skips retired or probe-failed model aliases, fails over on model-not-found errors, and ranks fresher models using models.dev data. Pin the session model to `auto` to use it.
- Worker Dock: open transcripts with hover chrome that uses a distinct pad (·) so selection keeps a single ❯ cursor; densemode reserves a fixed gutter so columns stay aligned.

### Patch Changes

- Skip exhausted Qwen/Alibaba token-plan providers in worker model routing and when pinning Smart Auto loop roles.
- Stop interactive `/exit` from hanging when MCP or background cleanup stalls.
- Start the TUI on Neon Noir at module load so upgrades no longer flash or stick on bare dark before preferences apply.
- Stop background compaction from cancelling on Conductor inject/steer append-only churn; scale the worker deadline with context size; stop compaction progress from resizing the transcript on every stream tick.

## 0.3.1

### Patch Changes

- Skip Smart Auto picks when a provider has no usable API key or OAuth token, and fall back from unhealthy role overrides.
- Fix the native SEA build by exporting `/locale` argument completions.
- Push jobs infer `gh-pages` from Pages deploy briefs and enable GitHub Pages after a successful push when possible.

## 0.3.0

### Minor Changes

- Restore richer premium transcript streaming motion: faster type-on catch-up, stronger live ink glow/caret, steadier ambient cadence under light load, and more concurrent tool-card live rebuilds. Set Visual Quality to Premium to feel it.
- Unify Todo Board and Worker Dock chrome-band live motion.
- Add `--main` / `/upgrade --main` to install tip of `main` past published releases.
- Add turn-level Smart Auto model routing and PushJob remote publish gating.
- Localize the interactive TUI (EN/KO) via Settings language.

### Breaking Changes

- Remove Mission mode and Swarm mode surfaces (`/mission`, `/swarm`, `/fleet`, related settings). Use `/plan`, `/goal`, the agent dock, and the job strip instead.
- Remove beginner-hostile diagnostic slash commands (`/bench`, `/renderer`, `/term`, `/export-debug-zip`, `/improve-harness`, `/preflight`) and `/feedback`.
- Drop remaining Kimi-era CLI migration / cache compatibility paths; use `liora` and `.superliora` only.

## 0.20.1

SuperLiora 0.20.1 (2026-08-08) was the first GitHub Release with native SEA installers (`install.sh` / `install.ps1`).

