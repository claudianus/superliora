/** Durable user-requested aside seeded only from completed parent context. */

import { constants } from 'node:fs';
import { copyFile, link, mkdir } from 'node:fs/promises';
import { join } from 'pathe';

import type { Agent } from '../../agent';
import type { ContextMessage } from '../../agent/context';
import { isBlobRef } from '../../agent/records';
import type { Session } from '../index';

const BLOB_HASH_PATTERN = /^[a-f0-9]{64}$/;

export async function createSideChannelSubagent(
  session: Session,
  ownerAgentId: string,
  signal: AbortSignal,
  observers?: {
    readonly onWorktreePath?: (path: string) => void;
    readonly onCreated?: (id: string, agent: Agent) => void;
  },
): Promise<{ readonly id: string; readonly agent: Agent }> {
  const parent = await session.ensureAgentResumed(ownerAgentId);
  signal.throwIfAborted();
  const messages = parent.context.completedHistorySnapshot();
  const kaos = parent.kaos;
  observers?.onWorktreePath?.(kaos.getcwd());
  const { id, agent: child } = await session.createAgent(
    { type: 'sub', generate: parent.rawGenerate },
    { parentAgentId: ownerAgentId },
  );
  observers?.onCreated?.(id, child);
  signal.throwIfAborted();

  child.config.update({
    cwd: kaos.getcwd(),
    modelAlias: parent.config.modelAlias,
    thinkingLevel: parent.config.thinkingLevel,
    systemPrompt: parent.config.systemPrompt,
  });
  if (child.kaos !== kaos) child.setKaos(kaos);
  child.permission.setMode(parent.permission.mode);
  await copyReferencedBlobs(parent, child, messages);
  signal.throwIfAborted();
  if (child.context.history.length > 0) child.context.clear();
  for (const message of messages) child.context.appendMessage(message);
  child.records.logRecord({ type: 'forked' });
  await child.records.flush();
  signal.throwIfAborted();
  return { id, agent: child };
}

/** Existing native blobrefs need their immutable artifacts in the child's store. */
async function copyReferencedBlobs(parent: Agent, child: Agent, messages: readonly ContextMessage[]): Promise<void> {
  let hashes: Set<string> | undefined;
  for (const message of messages) {
    for (const part of message.content) {
      for (const value of Object.values(part)) {
        if (value === null || typeof value !== 'object' || !('url' in value)
          || typeof value.url !== 'string' || !isBlobRef(value.url)) continue;
        const separator = value.url.indexOf(';');
        const hash = value.url.slice(separator + 1);
        if (separator < 0 || !BLOB_HASH_PATTERN.test(hash)) throw new Error('Invalid blob reference in completed parent context.');
        hashes ??= new Set();
        hashes.add(hash);
      }
    }
  }
  if (hashes === undefined) return;
  const sourceHome = parent.homedir;
  const targetHome = child.homedir;
  if (sourceHome === undefined || targetHome === undefined) {
    throw new Error('Durable aside media requires source and destination agent storage.');
  }
  await parent.records.flush();
  const targetDir = join(targetHome, 'blobs');
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  for (const hash of hashes) {
    const source = join(sourceHome, 'blobs', hash);
    const target = join(targetDir, hash);
    try {
      await link(source, target);
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code === 'EEXIST') continue;
      if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP' && code !== 'ENOSYS') throw error;
      try {
        await copyFile(source, target, constants.COPYFILE_EXCL);
      } catch (copyError) {
        if (copyError !== null && typeof copyError === 'object' && 'code' in copyError && copyError.code === 'EEXIST') continue;
        throw copyError;
      }
    }
  }
}
