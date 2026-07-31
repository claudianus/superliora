/**
 * Security settings glance — SSOT for redaction posture and W6 redteam-soft suite.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REDTEAM_SOFT_SUITE_REL_PATH =
  'packages/agent-core/test/security/redteam-soft.test.ts';

export const REDTEAM_SOFT_SUITE_TIP =
  `W6 redteam-soft: ${REDTEAM_SOFT_SUITE_REL_PATH} — sk-/Bearer/AIza redaction + .env PATH_SENSITIVE smoke.`;

function redteamSoftSuiteAbsolutePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '../../test/security/redteam-soft.test.ts');
}

/** Live gate — true when the W6 redteam-soft vitest file exists beside agent-core. */
export function isRedteamSoftSuitePresent(): boolean {
  return existsSync(redteamSoftSuiteAbsolutePath());
}

/** Bench / Diagnostics live line — Settings → Bench and Security both reuse SSOT path. */
export function formatRedteamSoftSuitePresentLine(): string {
  const label = isRedteamSoftSuitePresent() ? 'present' : 'missing';
  return `W6 redteam suite: ${label} — ${REDTEAM_SOFT_SUITE_REL_PATH}`;
}

/** Compact redaction posture line for Settings → Security. */
export function redactSecretsStatusLine(): string {
  return 'Redaction: active — redactSecretsInText masks sk-*, Bearer, AIza* in tool/log diagnostics.';
}
