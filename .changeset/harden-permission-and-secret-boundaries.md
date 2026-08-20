---
'@superliora/agent-core': minor
'@superliora/oauth': patch
'@harness-kit/tui-renderer': patch
'@superliora/liora': patch
---

Close four ways the agent could act outside its permission boundary, and stop leaving the terminal broken on an abnormal exit.

- Conductor Bash classification treated `env` as a plain read-only command and never looked at what followed it, so `env rm -rf …` and `env git push` passed as "inspection". `env` is now unwrapped and the command it runs is classified instead. The same pass covers read-only commands that write through a flag or an extra operand (`sort -o`, `tree -o`, `date -s`, `rg --pre`, `uniq IN OUT`, `hostname NAME`).
- An `ask` permission policy is now denied, not auto-approved, when the host has no approval channel connected. A misconfigured or headless host previously ran every gated tool unattended. Set `SUPERLIORA_PERMISSION_ALLOW_WITHOUT_APPROVAL=1` to opt back in for scripted runs.
- Sensitive-file detection compared path segments after splitting on `/` only, so Windows paths like `C:\Users\me\.ssh\config` and `.kube\config` collapsed into one segment and skipped every directory rule.
- The OAuth loopback callback accepted any `state`. Since any page the user has open can issue a request to a loopback port, an attacker-supplied authorization code could be exchanged. The callback server now verifies `state` against the login attempt in constant time and keeps waiting instead of failing on a forged request.
- Automatic git bootstrap ran `git add -A` in folders the user never chose to version, committing `.env` files and private keys into history. Credential files are now unstaged before the baseline commit, and a folder holding nothing else still gets a valid base ref.
- Emergency TUI exit (SIGHUP, dead pty, failed stop) removed the `exit` handler that restores the terminal before exiting, leaving the alternate screen, mouse reporting, and raw mode on. Restore now runs first, covers raw mode, and also fires for an exception that escapes the TUI.
