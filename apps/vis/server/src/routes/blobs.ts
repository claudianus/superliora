import { Hono } from 'hono';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

import { SUPERLIORA_HOME } from '../config';
import { isSafeAgentId, readSessionDetail } from '../lib/session-store';
import { isSafeBlobHash } from '../lib/blob-resolver';

/**
 * Raster image types the SPA previews inline. Everything else — including
 * `text/html`, `image/svg+xml`, or any attacker-requested `mime` — is served
 * as an inert download so a poisoned session blob can never execute script on
 * the vis origin.
 */
const SAFE_INLINE_MIME_RE = /^image\/(?:png|jpeg|gif|webp|avif)$/;

export function blobResponseContentType(requested: string | undefined): string {
  return requested !== undefined && SAFE_INLINE_MIME_RE.test(requested)
    ? requested
    : 'application/octet-stream';
}

export function blobsRoute(home: string = SUPERLIORA_HOME): Hono {
  const r = new Hono();
  r.get('/:id/blobs/:hash', async (c) => {
    const id = c.req.param('id');
    const agentId = c.req.query('agent') ?? 'main';
    const hash = c.req.param('hash');
    if (!isSafeAgentId(agentId)) {
      return c.json({ error: 'invalid agent id', code: 'BAD_REQUEST' }, 400);
    }
    if (!isSafeBlobHash(hash)) {
      return c.json({ error: 'invalid blob hash', code: 'BAD_REQUEST' }, 400);
    }
    const detail = await readSessionDetail(home, id);
    if (!detail) {
      return c.json({ error: 'session not found', code: 'NOT_FOUND' }, 404);
    }
    const agent = detail.agents.find((a) => a.agentId === agentId);
    if (!agent) {
      return c.json(
        { error: `agent "${agentId}" not found`, code: 'NOT_FOUND' },
        404,
      );
    }
    const blobPath = join(agent.homedir, 'blobs', hash);
    let content: Buffer;
    try {
      content = await readFile(blobPath);
    } catch {
      return c.json({ error: 'blob not found', code: 'NOT_FOUND' }, 404);
    }
    const mimeType = blobResponseContentType(c.req.query('mime'));
    const headers: Record<string, string> = { 'content-type': mimeType };
    if (mimeType === 'application/octet-stream') {
      headers['content-disposition'] = 'attachment';
    }
    return new Response(content, { headers });
  });
  return r;
}
