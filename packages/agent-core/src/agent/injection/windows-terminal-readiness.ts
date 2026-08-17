/**
 * Conductor Windows TUI-host readiness — env-only, no installer imports.
 * PC-bang / school images often start SuperLiora in conhost; the TUI looks broken
 * and users do not know to run /windows-setup.
 */

import { SOVEREIGN_CONDUCTOR_PROFILE_NAME } from '#/profile/main-profile';
import { DynamicInjector } from './injector';

export const WINDOWS_TERMINAL_READINESS_VARIANT = 'windows_terminal_readiness';

export interface WindowsTerminalReadinessSnapshot {
  readonly applicable: boolean;
  readonly host: 'windowsterminal' | 'conhost' | 'other';
  readonly status: 'ok' | 'degraded';
  readonly inWindowsTerminal: boolean;
}

export function windowsTerminalReadinessFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): WindowsTerminalReadinessSnapshot {
  if (platform !== 'win32') {
    return {
      applicable: false,
      host: 'other',
      status: 'ok',
      inWindowsTerminal: false,
    };
  }
  const inWindowsTerminal = Boolean((env.WT_SESSION ?? '').trim());
  return {
    applicable: true,
    host: inWindowsTerminal ? 'windowsterminal' : 'conhost',
    status: inWindowsTerminal ? 'ok' : 'degraded',
    inWindowsTerminal,
  };
}

export function renderWindowsTerminalReadiness(
  snapshot: WindowsTerminalReadinessSnapshot,
): string | undefined {
  if (!snapshot.applicable || snapshot.status !== 'degraded') return undefined;
  return [
    '<windows_terminal_readiness>',
    `host=${snapshot.host} status=${snapshot.status}`,
    'Classic console cannot render the SuperLiora TUI well (PC-bang / school images often land here).',
    'Tell the user to run /windows-setup apply, or JobCreate task_track=general to apply the Windows vibe host (Windows Terminal + Nerd Font + Oh My Posh + SuperLiora profile).',
    'Do not install packages on the Conductor lane. Load Skill("windows-vibe") only when writing that brief.',
    '</windows_terminal_readiness>',
  ].join('\n');
}

export class WindowsTerminalReadinessInjector extends DynamicInjector {
  protected override readonly injectionVariant = WINDOWS_TERMINAL_READINESS_VARIANT;

  protected override getInjection(): string | undefined {
    if (this.agent.type !== 'main') return undefined;
    if (this.agent.config.profileName !== SOVEREIGN_CONDUCTOR_PROFILE_NAME) {
      return undefined;
    }
    return renderWindowsTerminalReadiness(windowsTerminalReadinessFromEnv());
  }
}
