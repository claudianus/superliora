---
name: windows-vibe
description: >
  Windows TUI host setup for SuperLiora — Windows Terminal, CaskaydiaCove Nerd
  Font, Oh My Posh, zoxide, fzf, SuperLiora profile, default-terminal promotion.
  Use on PC-bang / school / conhost machines, broken glyphs, "터미널 깨짐",
  missing winget, or when the user asks for vibe / Windows Terminal setup.
  Prefer /windows-setup apply over improvising installs.
whenToUse: >
  Windows Terminal, conhost, PC bang, 피시방, nerd font, vibe coding setup,
  broken TUI boxes, winget missing, /windows-setup
---

# SuperLiora windows-vibe (builtin)

Windows users often land in the classic console host (`conhost` / `cmd.exe` /
Windows PowerShell 5.1). That host cannot render the SuperLiora TUI. PC-bang
and school images also lack `winget`, Nerd Fonts, and App Installer.

## Happy path

1. Check `<windows_terminal_readiness>` if present. `status=ok` → do not nag.
2. Tell the user to run **`/windows-setup apply`** in this TUI. That is the
   product command. It bootstraps winget when missing, installs Windows
   Terminal, installs CaskaydiaCove NF, Oh My Posh, zoxide, and fzf, writes the
   SuperLiora fragment + PowerShell profile, and promotes WT as the default
   terminal. Failures never block the CLI.
3. If you are a **Conductor**: do **not** install packages on this lane.
   Point at `/windows-setup apply`, or `JobCreate` with `task_track=general`
   whose success criterion is `WT_SESSION` set + SuperLiora profile present.
4. If you are a **general-track Job**: run the installer helpers from the
   repo / install tree — `scripts/install/ensure-terminal.mjs` — do not
   invent a one-off winget script. Skip with `SUPERLIORA_NO_TERMINAL=1`.

## What "apply" does (and does not)

Does:

- Bootstrap winget (GitHub DesktopAppInstaller + VCLibs) when Store/winget is missing
- Install `Microsoft.WindowsTerminal` (winget, then MSIX)
- Install CaskaydiaCove Nerd Font (winget-font, then user-local zip)
- Install Oh My Posh and write the SuperLiora Neon Noir prompt theme
- Install zoxide and fzf (user-local)
- Install Terminal-Icons when PSGallery is reachable
- Patch CurrentUser PowerShell 5.1 + 7 profiles with a managed SuperLiora block
- Set CurrentUser execution policy to RemoteSigned when it is Restricted
- Write `%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\SuperLiora\superliora.json` (SuperLiora + SuperLiora Shell)
- Merge WT defaults (Neon Noir, Nerd Font, acrylic, Win+` quake) when settings parse
- Start Menu shortcut targeting the SuperLiora profile
- Promote Windows Terminal as the default console when the current value is empty or Console Host

Does not:

- Block CLI install on failure
- Disable process mitigations / CET
- Force PowerShell 7 (7.6 needs a patched Windows CET stack)
- Overwrite a user-chosen default terminal that is already not Console Host

## PC-bang notes

- `wt.exe` / `pwsh.exe` App Execution Aliases can be 0-byte reparse points that
  fail from some hosts. Prefer well-known `WindowsApps` paths and the Start
  Menu shortcut.
- User-local installs only (no admin required for the happy path).
- After apply, the user must **open SuperLiora from Windows Terminal** (Start
  Menu "SuperLiora" or `wt -p SuperLiora`). Staying in conhost will still look broken.

## Auto on TUI startup

When SuperLiora starts in conhost (and not CI), it best-effort runs the same
apply path, then asks the user to reopen from Windows Terminal. That is
intentional for PC-bang / school images. Disable auto-apply with
`SUPERLIORA_AUTO_TERMINAL=0` (the startup hint still appears).

## Skip / env

- `--no-terminal` / `SUPERLIORA_NO_TERMINAL=1` / `SUPERLIORA_SKIP_TERMINAL=1`
- `SUPERLIORA_AUTO_TERMINAL=0`
- `SUPERLIORA_NO_WINGET=1`
- `SUPERLIORA_NO_NERD_FONT=1`
- `SUPERLIORA_NO_SHELL_VIBE=1`
- `SUPERLIORA_NO_POSH=1`
- `SUPERLIORA_NO_ZOXIDE=1`
- `SUPERLIORA_NO_FZF=1`
