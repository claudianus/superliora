

import { homedir } from 'node:os';
import { join } from 'node:path';

import { resolveLioraHome } from '@superliora/agent-core';


export const KIMI_SERVER_LABEL = 'com.superliora.liora-server';


export const KIMI_SERVER_PLIST_FILENAME = `${KIMI_SERVER_LABEL}.plist`;


export const KIMI_SERVER_SYSTEMD_UNIT = 'liora-server.service';


export const KIMI_SERVER_TASK_NAME = 'LioraServer';


export function launchAgentPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', KIMI_SERVER_PLIST_FILENAME);
}


export function systemdUnitPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', KIMI_SERVER_SYSTEMD_UNIT);
}


export function supervisorLogPath(): string {
  return join(resolveLioraHome(), 'server', 'server.log');
}


export function installPlanPath(): string {
  return join(resolveLioraHome(), 'server', 'install.json');
}


export function guiDomain(uid: number = process.getuid?.() ?? 0): string {
  return `gui/${uid}`;
}
