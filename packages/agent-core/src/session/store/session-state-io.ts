import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'pathe';

import { ErrorCodes, LioraError } from '#/errors/index';
import { prepareSessionStateRecord } from '#/session/session-meta-format';
import { isRecord } from '#/session/store/session-store-helpers';

export const SESSION_STATE_FILE = 'state.json';

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}

function stateNotFound(sessionId: string, cause?: unknown): LioraError {
  return new LioraError(ErrorCodes.SESSION_STATE_NOT_FOUND, `Session "${sessionId}" state.json was not found`, {
    cause,
  });
}

function stateInvalid(sessionId: string): LioraError {
  return new LioraError(ErrorCodes.SESSION_STATE_INVALID, `Session "${sessionId}" state.json is invalid`);
}

type StateRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'record'; readonly value: Record<string, unknown> }
  | { readonly kind: 'invalid-shape' }
  | { readonly kind: 'corrupt' };

async function readStateFile(path: string): Promise<StateRead> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (error) {
    if (isNotFound(error)) return { kind: 'missing' };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { kind: 'corrupt' };
  }
  if (!isRecord(parsed)) return { kind: 'invalid-shape' };
  return { kind: 'record', value: parsed };
}

/**
 * Read session metadata for store mutations.
 * Valid object from `state.json` wins. Corrupt/missing primary falls back to
 * `state.json.bak`. A well-formed non-object (`[]`) is invalid and does not
 * consult the backup.
 */
export async function readRequiredSessionState(
  sessionDir: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const primary = await readStateFile(join(sessionDir, SESSION_STATE_FILE));
  if (primary.kind === 'record') return primary.value;
  if (primary.kind === 'invalid-shape') throw stateInvalid(sessionId);

  const backup = await readStateFile(join(sessionDir, `${SESSION_STATE_FILE}.bak`));
  if (backup.kind === 'record') return backup.value;
  if (primary.kind === 'missing' && backup.kind === 'missing') {
    throw stateNotFound(sessionId);
  }
  throw stateInvalid(sessionId);
}

/** tmp → bak rotation → rename, matching live `SessionMetadataPersistence`. */
export async function writeSessionStateFile(
  statePath: string,
  value: Record<string, unknown>,
): Promise<void> {
  const payload = prepareSessionStateRecord(value, dirname(statePath));
  const tmpPath = `${statePath}.tmp`;
  const bakPath = `${statePath}.bak`;
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(tmpPath, `${JSON.stringify(payload)}\n`, 'utf-8');
  try {
    await unlink(bakPath).catch(() => undefined);
    await rename(statePath, bakPath);
  } catch (error) {
    if (!isNotFound(error)) {
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }
  }
  try {
    await rename(tmpPath, statePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}
