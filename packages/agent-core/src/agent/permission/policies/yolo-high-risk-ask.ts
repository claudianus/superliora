import type { Agent } from '../..';
import { PERMISSION_HIGH_RISK_GUARD_ENV } from '../types';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

/**
 * Opt-in native Bash consent for destructive commands and sensitive material
 * in `auto` and `yolo` mode. Explicit user rules and session grants take
 * precedence. Manual mode already asks for unmatched native calls.
 */
export class YoloHighRiskAskPermissionPolicy implements PermissionPolicy {
  readonly name = 'yolo-high-risk-ask';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (!isHighRiskGuardEnabled()) return;
    if (!isUnattendedMode(this.agent.permission.mode)) return;
    if (context.toolCall.name !== 'Bash') return;

    const command = bashCommand(context);
    if (command === undefined) return;

    const risk = classifyYoloHighRiskBash(command);
    if (risk === undefined) return;

    return {
      kind: 'ask',
      reason: {
        yolo_high_risk: true,
        risk,
      },
    };
  }
}

/** Guard activation flag — default off; only an explicit truthy env turns it on. */
export function isHighRiskGuardEnabled(): boolean {
  const raw = process.env[PERMISSION_HIGH_RISK_GUARD_ENV]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

/** Permission modes that approve unmatched native calls without prompting. */
export function isUnattendedMode(mode: string): boolean {
  return mode === 'auto' || mode === 'yolo';
}

export function classifyYoloHighRiskBash(command: string): string | undefined {
  const text = command.trim();
  if (text.length === 0) return undefined;

  const destructive = matchPattern(text, [
    [/\brm\s+-(?=[a-z]*r)(?=[a-z]*f)[a-z]*\b/i, 'recursive force delete'],
    [/\brm\s+-[a-z]*f[a-z]*\b/i, 'force delete'],
    [/\b(?:Remove-Item|rm)\b.*(?:^|\s)-(?:Recurse|Force)\b/i, 'recursive or forced remove'],
    [/\b(?:del|rd|rmdir)\b.*\/[sq]\b/i, 'Windows recursive or quiet delete'],
    [/\bmkfs(?:\.[a-z0-9]+)?\b/i, 'filesystem formatting command'],
    [/\bdd\s+if=.*\bof=\/dev\//i, 'raw disk write'],
    [/\bdiskutil\s+(?:eraseDisk|partitionDisk)\b/i, 'disk erase or partition command'],
    [/\b(?:drop\s+database|truncate\s+table)\b/i, 'destructive database command'],
    [/\bgit\s+clean\s+-[a-z]*[dfx][a-z]*\b/i, 'git clean can remove untracked files'],
    [/\bgit\s+reset\s+--hard\b/i, 'hard git reset'],
    [/\bterraform\s+destroy\b/i, 'Terraform destroy'],
    [/\bkubectl\s+delete\b/i, 'Kubernetes delete'],
    [/\bdocker\s+(?:system|volume)\s+prune\b/i, 'Docker prune'],
  ]);
  if (destructive !== undefined) return destructive;

  return matchPattern(text, [
    [
      /\b(?:password|passwd|api[_-]?key|secret|token|access[_-]?token)\s*[:=]/i,
      'credential-like assignment',
    ],
    [/\b(?:sk-[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9_]{20,})\b/i, 'token-like secret'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key material'],
    [/(?:^|\/)\.env(?:\.[a-z0-9_-]+)?(?:\s|$)/i, 'dotenv access'],
    [/(?:^|\/)\.aws\/credentials\b/i, 'aws credentials access'],
    [/(?:^|\/)\.ssh(?:\/|\s|$)/i, 'ssh key material access'],
  ]);
}

function bashCommand(context: PermissionPolicyContext): string | undefined {
  const args = context.args;
  if (args === null || typeof args !== 'object') return undefined;
  const command = (args as { command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

function matchPattern(text: string, patterns: ReadonlyArray<readonly [RegExp, string]>): string | undefined {
  for (const [pattern, label] of patterns) {
    if (pattern.test(text)) return label;
  }
  return undefined;
}
