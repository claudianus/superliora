---
"@superliora/liora": patch
---

fix(install): auto-set PowerShell execution policy to prevent profile load error

On Windows, the default PowerShell execution policy is Restricted/Undefined. After SuperLiora installed its managed block to Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1 (and PowerShell 7), every new terminal printed: "cannot be loaded because running scripts is disabled" before any prompt. Root cause was consent-gated policy handling: the installer wrote the profile but left the policy untouched unless --allow-execution-policy was passed, so the profile was always blocked on a fresh Windows install.

Fix: ensure-shell-vibe now auto-remediates CurrentUser to RemoteSigned idempotently when the managed profile would be blocked, respecting Group Policy and explicit opt-out (SUPERLIORA_NO_EXECUTION_POLICY=1). host-setup plan text and installer messages updated, legacy --allow-execution-policy kept as alias, terminal/host-setup paths now propagate the result for correct user feedback, and install.ps1/strings updated.
