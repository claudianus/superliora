---
name: computer-use
description: >
  SuperLiora desktop computer-use via cua-driver — ComputerStatus, ComputerCapture
  (SOM indexes), ComputerAct. Use for real desktop app clicks/typing. Do NOT
  install Anthropic CUA stacks, pyautogui, Playwright, or catalog
  computer-use-agents skills while these tools exist. Skill("computer-use").
whenToUse: >
  Desktop click, computer-use, cua-driver, SOM element click, GUI automation —
  before pyautogui / external CUA installs.
---

# SuperLiora computer-use (builtin)

Hard rule: drive **ComputerStatus → ComputerCapture → ComputerAct**. Prefer SOM
`click_element` / `set_value` indexes over raw coordinates.

## Happy path

1. `ComputerStatus` (auto-installs cua-driver when allowed).
2. `ComputerCapture` (`mode=som` for numbered elements).
3. `ComputerAct` with element indexes from the capture.
4. Re-capture after UI changes; treat Act as side-effectful.

## Do not

- Install Playwright/Chrome/pyautogui/OpenAI Operator/Anthropic computer-use SDKs.
- Follow catalog `computer-use-agents` / desktop-control playbooks while Computer* tools exist.
