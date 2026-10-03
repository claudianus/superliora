import type { SessionMode } from '@agentclientprotocol/sdk';
import type { PermissionMode } from '@superliora/sdk';

/** Modes reflect native permission policy, not separate agent workflows. */
export const ACP_MODES = [
  { id: 'manual', name: 'Manual', description: 'Request approval for operations requiring consent.' },
  { id: 'auto', name: 'Auto', description: 'Use native automatic permission policy.' },
  { id: 'yolo', name: 'YOLO', description: 'Allow operations without interactive approval.' },
] as const satisfies readonly SessionMode[];

export const DEFAULT_MODE_ID = 'manual' as const;
export type AcpModeId = PermissionMode;

export function isAcpModeId(value: unknown): value is AcpModeId {
  return value === 'manual' || value === 'auto' || value === 'yolo';
}
