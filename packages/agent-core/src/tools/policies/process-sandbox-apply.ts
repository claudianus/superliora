/**
 * Resolve desired sandboxEnforcement into a Kaos process-sandbox config.
 * Explicit process enforcement rejects unavailable confinement and conflicting overrides.
 */

import {
  isProcessSandboxHost,
  resolveProcessSandboxBackend,
  type ProcessSandboxConfig,
  type ProcessSandboxBackend,
} from '@superliora/kaos';

import type { SandboxEnforcement } from '../../config/sandbox-enforcement';
import type { SandboxProfile } from './path-access';

export interface ProcessSandboxStatus {
  readonly desired: SandboxEnforcement;
  readonly effective: SandboxEnforcement;
  readonly backend?: ProcessSandboxBackend;
  readonly warning?: string;
}

export interface ResolveProcessSandboxRuntimeOptions {
  readonly desired: SandboxEnforcement;
  readonly profile: SandboxProfile;
  readonly noProcess?: boolean;
  readonly workspaceDir: string;
  readonly additionalDirs?: readonly string[];
  readonly probeDocker?: () => Promise<boolean>;
  readonly platform?: NodeJS.Platform;
}

export interface ResolveProcessSandboxRuntimeResult {
  readonly status: ProcessSandboxStatus;
  readonly config?: ProcessSandboxConfig;
  readonly coercedProfile?: SandboxProfile;
}

export async function resolveProcessSandboxRuntime(
  opts: ResolveProcessSandboxRuntimeOptions,
): Promise<ResolveProcessSandboxRuntimeResult> {
  const coercedProfile = opts.desired === 'process' && opts.profile === 'off' ? 'workspace' : undefined;
  const profile = coercedProfile ?? opts.profile;

  if (opts.desired !== 'process') {
    return {
      status: { desired: opts.desired, effective: 'lexical' },
      coercedProfile,
    };
  }

  const backendResult = await resolveProcessSandboxBackend({
    platform: opts.platform,
    noProcess: opts.noProcess,
    probeDocker: opts.probeDocker,
  });

  if (backendResult.backend !== 'docker') {
    throw new Error('Process sandbox requires Docker confinement; host execution is not permitted.');
  }
  return {
    status: {
      desired: 'process',
      effective: 'process',
      backend: backendResult.backend,
      warning: backendResult.warning,
    },
    config: {
      backend: backendResult.backend,
      workspaceDir: opts.workspaceDir,
      additionalDirs: opts.additionalDirs,
      readOnly: profile === 'read-only',
    },
    coercedProfile,
  };
}

export function applyProcessSandboxToKaos(
  kaos: unknown,
  config: ProcessSandboxConfig | undefined,
): void {
  if (config !== undefined && !isProcessSandboxHost(kaos)) {
    throw new Error('Process sandbox required but this execution host cannot apply confinement.');
  }
  if (isProcessSandboxHost(kaos)) {
    kaos.setProcessSandbox(config);
  }
}
