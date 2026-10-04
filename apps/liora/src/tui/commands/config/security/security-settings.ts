/**
 * Settings → Security — sandbox, permissions, and redaction.
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { loadNetworkGlance } from '../../../utils/network/network-glance';
import {
  buildSecuritySettingsLines,
  SECURITY_NOT_OS_SANDBOX,
  SECURITY_REDACTION_TIP,
  SECURITY_SANDBOX_TIP,
  type SecurityGlanceInput,
  type SecuritySandboxEnforcement,
  type SecuritySandboxProfile,
} from '../../../utils/security/security-glance';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export {
  SECURITY_NOT_OS_SANDBOX,
  SECURITY_REDACTION_TIP,
  SECURITY_SANDBOX_TIP,
};

const SANDBOX_OPTIONS: ReadonlyArray<{
  readonly value: SecuritySandboxProfile;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: 'off',
    label: '끔 (off)',
    description: '기본값 · 워크스페이스 밖 절대경로 허용 · 민감 경로는 계속 차단',
  },
  {
    value: 'workspace',
    label: '워크스페이스 (workspace)',
    description: '파일 도구가 워크스페이스(+ /add-dir) 안으로만 경로를 받음',
  },
  {
    value: 'read-only',
    label: '읽기 전용 (read-only)',
    description: '쓰기/편집 전부 차단 · 읽기는 워크스페이스 규칙',
  },
];

const ENFORCEMENT_OPTIONS: ReadonlyArray<{
  readonly value: 'enforcement-lexical' | 'enforcement-process';
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: 'enforcement-lexical',
    label: '강도: lexical',
    description: '기본값 · Bash 경로 토큰 검사 (OS 격리 아님)',
  },
  {
    value: 'enforcement-process',
    label: '강도: process',
    description: '네이티브 Bash만 격리 · Docker 필수 · 호스트 대체 실행 없음 · off면 workspace로 올림',
  },
];


function resolveSandboxProfile(session: {
  getResumeState?: () =>
    | {
        readonly sessionMetadata?: {
          readonly custom?: Readonly<Record<string, unknown>>;
        };
      }
    | undefined;
}): SecuritySandboxProfile | undefined {
  try {
    const resume = session.getResumeState?.();
    const raw = resume?.sessionMetadata?.custom?.['sandboxProfile'];
    if (raw === 'off' || raw === 'workspace' || raw === 'read-only') {
      return raw;
    }
    // Product default is off when metadata has no key.
    if (resume !== undefined) {
      return 'off';
    }
  } catch {
    /* optional */
  }
  return undefined;
}

function resolveSandboxEnforcement(session: {
  getResumeState?: () =>
    | {
        readonly sessionMetadata?: {
          readonly custom?: Readonly<Record<string, unknown>>;
        };
      }
    | undefined;
}): SecuritySandboxEnforcement | undefined {
  try {
    const resume = session.getResumeState?.();
    const raw = resume?.sessionMetadata?.custom?.['sandboxEnforcement'];
    if (raw === 'lexical' || raw === 'process') {
      return raw;
    }
    if (resume !== undefined) {
      return 'lexical';
    }
  } catch {
    /* optional */
  }
  return undefined;
}


async function loadSecurityGlance(host: SlashCommandHost): Promise<SecurityGlanceInput> {
  const permissionMode = host.state.appState.permissionMode ?? 'manual';
  const workDir = host.state.appState.workDir ?? process.cwd();
  const additionalDirs = host.state.appState.additionalDirs ?? [];
  const base: SecurityGlanceInput = {
    permissionMode,
    workDir,
    additionalDirs,
    network: loadNetworkGlance(process.env),
  };

  try {
    const session = host.requireSession();
    const status = await session.getStatus();
    return {
      ...base,
      permissionFromSession: status.permission,
      sandboxProfile: resolveSandboxProfile(session),
      sandboxEnforcement: resolveSandboxEnforcement(session),
    };
  } catch {
    return base;
  }
}

export function showSecuritySettings(host: SlashCommandHost): void {
  void (async () => {
    let current: SecuritySandboxProfile | undefined;
    try {
      current = resolveSandboxProfile(host.requireSession());
    } catch {
      current = undefined;
    }

    mountPickerDialog(
      host,
      new ChoicePickerComponent({
        title: ttui('tui.settings.pane.security.title'),
        hint: '↑↓ navigate · Enter select · Esc cancel',
        notice: SECURITY_NOT_OS_SANDBOX,
        searchable: true,
        currentValue: current ?? 'off',
        options: [
          {
            value: 'status',
            label: 'Security status',
            description:
              'Permission mode · path sandbox · network egress · redaction.',
          },
          ...SANDBOX_OPTIONS.map((opt) => ({
            value: opt.value,
            label: opt.label,
            description: opt.description,
          })),
          ...ENFORCEMENT_OPTIONS.map((opt) => ({
            value: opt.value,
            label: opt.label,
            description: opt.description,
          })),
        ],
        onSelect: (value) => {
          dismissPickerDialog(host);
          if (value === 'status') {
            void showSecuritySettingsPanel(host);
            return;
          }
          if (value === 'off' || value === 'workspace' || value === 'read-only') {
            void applySandboxProfile(host, value);
            return;
          }
          if (value === 'enforcement-lexical' || value === 'enforcement-process') {
            void applySandboxEnforcement(
              host,
              value === 'enforcement-process' ? 'process' : 'lexical',
            );
            return;
          }
        },
        onCancel: () => {
          dismissPickerDialog(host);
        },
      }),
      { label: ttui('tui.settings.pane.security.title') },
    );
  })();
}

async function applySandboxProfile(
  host: SlashCommandHost,
  profile: SecuritySandboxProfile,
): Promise<void> {
  try {
    await host.harness.setConfig({ sandboxProfile: profile });
  } catch (error) {
    host.showStatus(
      `Failed to save sandboxProfile: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return;
  }

  try {
    const session = host.requireSession();
    if (typeof (session as { setSandboxProfile?: (p: SecuritySandboxProfile) => Promise<void> }).setSandboxProfile === 'function') {
      await (session as { setSandboxProfile: (p: SecuritySandboxProfile) => Promise<void> }).setSandboxProfile(
        profile,
      );
    }
  } catch {
    // Config saved; live session optional when no session is open.
  }

  const label =
    profile === 'off' ? '끔 (off)' : profile === 'workspace' ? '워크스페이스' : '읽기 전용';
  host.showStatus(
    `Path sandbox → ${label}. Not OS isolation. Applies to Bash path tokens from the next turn.`,
    profile === 'off' ? 'warning' : 'success',
  );
}

async function applySandboxEnforcement(
  host: SlashCommandHost,
  enforcement: SecuritySandboxEnforcement,
): Promise<void> {
  let profile: SecuritySandboxProfile | undefined;
  try {
    profile = resolveSandboxProfile(host.requireSession());
  } catch {
    profile = undefined;
  }

  const coerceWorkspace = enforcement === 'process' && (profile === undefined || profile === 'off');
  const configPatch = coerceWorkspace
    ? { sandboxProfile: 'workspace' as const, sandboxEnforcement: enforcement }
    : { sandboxEnforcement: enforcement };

  try {
    await host.harness.setConfig(configPatch);
  } catch (error) {
    host.showStatus(
      `Failed to save sandboxEnforcement: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return;
  }

  try {
    const session = host.requireSession() as {
      setSandboxProfile?: (p: SecuritySandboxProfile) => Promise<void>;
      setSandboxEnforcement?: (e: SecuritySandboxEnforcement) => Promise<void>;
    };
    if (coerceWorkspace && typeof session.setSandboxProfile === 'function') {
      await session.setSandboxProfile('workspace');
    }
    if (typeof session.setSandboxEnforcement === 'function') {
      await session.setSandboxEnforcement(enforcement);
    }
  } catch {
    // Config saved; live session optional when no session is open.
  }

  host.showStatus(
    coerceWorkspace
      ? 'Sandbox enforcement → process. Profile raised to workspace. Native Bash requires Docker; no host fallback. Host application, plugins, and raw Kaos remain trusted.'
      : `Sandbox enforcement → ${enforcement}. Process mode confines native Bash only (Docker required; no host fallback). Lexical mode is not OS isolation. Host application, plugins, and raw Kaos remain trusted.`,
    enforcement === 'process' ? 'warning' : 'success',
  );
}

async function showSecuritySettingsPanel(host: SlashCommandHost): Promise<void> {
  const lines = buildSecuritySettingsLines(await loadSecurityGlance(host));

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.security.panelTitle'),
    enterBeatSeed: 'security',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
