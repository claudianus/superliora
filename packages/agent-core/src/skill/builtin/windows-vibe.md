---
name: windows-vibe
description: >
  Cross-platform SuperLiora host setup — Nerd Font, Oh My Posh, zoxide, fzf,
  and a managed shell profile. On Windows also Windows Terminal, winget, and
  default-terminal promotion. Use for PC-bang / school / conhost machines,
  broken glyphs, "터미널 깨짐", missing winget, or vibe / terminal setup.
  Prefer /host-setup over improvising installs.
whenToUse: >
  Windows Terminal, conhost, PC bang, 피시방, nerd font, Oh My Posh, zoxide,
  vibe coding setup, broken TUI boxes, winget missing, /host-setup,
  /windows-setup, macos-setup, linux-setup
---

# SuperLiora host setup (builtin)

The product command is **`/host-setup`**. Aliases: `/windows-setup`,
`/macos-setup`, `/linux-setup`, `/vibe-setup`, `/terminal-setup`.
`/windows-setup apply` is the same apply path.

It prints a list of installs, file writes, and setting changes, then asks
**진행할까요?** before applying. Do not invent a one-off install script.

On Windows, classic **conhost** (PC-bang / school images) cannot render the
TUI well — prefer Windows Terminal after apply.

## Happy path

1. On Windows, check `<windows_terminal_readiness>` if present. `status=ok`
   does not mean font/prompt are done — still offer `/host-setup status`.
2. Tell the user to run **`/host-setup`** in this TUI. That opens the confirm
   sheet. `/host-setup apply -y` skips the sheet. `/host-setup status` lists
   items only.
3. If you are a **Conductor**: do **not** install packages on this lane.
   Point at `/host-setup`, or `JobCreate` with `task_track=general`.
4. If you are a **general-track Job**: run `scripts/install/host-setup.mjs`
   (`ensureHostSetup`). Skip with `SUPERLIORA_NO_HOST_SETUP=1`.

## What apply does (and does not)

Does (all platforms, user-local):

- Install CaskaydiaCove Nerd Font when missing
- Install Oh My Posh (GitHub binary → `~/.superliora/runtime/oh-my-posh`;
  Homebrew used only if already on PATH; winget on Windows)
- Write the SuperLiora Neon Noir Oh My Posh theme
- Install zoxide and fzf when missing
- Upsert a marked SuperLiora block in shell profiles
  (Windows: PowerShell 5.1 + 7; macOS/Linux: `~/.zshrc` + `~/.bashrc`)
- Refresh `fc-cache` on Linux after a font install

Does (Windows only):

- Bootstrap winget when Store/App Installer is missing
- Install Windows Terminal (winget, then MSIX)
- Install Terminal-Icons when PSGallery is reachable
- Set CurrentUser execution policy to RemoteSigned when it is Restricted
- Write the Windows Terminal SuperLiora fragment + Start Menu shortcut
- Merge WT defaults (Neon Noir, Nerd Font, acrylic, Win+` quake) when settings parse
- Promote Windows Terminal as the default console when empty or Console Host

Does not:

- Block CLI install on failure
- Disable process mitigations / CET
- Force PowerShell 7, Homebrew, Fish, or a GUI terminal on Unix
- Overwrite a user-chosen Windows default terminal that is already not Console Host
- Require a Y/N prompt on `curl | bash` / `irm | iex` (those print the same
  list, then apply)

## Startup

When something is still `needed`, the TUI shows the same confirm sheet. It
does **not** silently install. Disable the startup sheet with
`SUPERLIORA_AUTO_TERMINAL=0` or `SUPERLIORA_NO_HOST_SETUP=1`.
`/host-setup` still works.

## Skip / env

- `--no-host-setup` / `SUPERLIORA_NO_HOST_SETUP=1` — skip the whole sidecar
- `--no-terminal` / `SUPERLIORA_NO_TERMINAL=1` / `SUPERLIORA_SKIP_TERMINAL=1`
  — skip Windows Terminal only
- `SUPERLIORA_AUTO_TERMINAL=0` — no startup confirm sheet
- `SUPERLIORA_NO_WINGET=1`
- `SUPERLIORA_NO_NERD_FONT=1`
- `SUPERLIORA_NO_SHELL_VIBE=1`
- `SUPERLIORA_NO_POSH=1`
- `SUPERLIORA_NO_ZOXIDE=1`
- `SUPERLIORA_NO_FZF=1`
