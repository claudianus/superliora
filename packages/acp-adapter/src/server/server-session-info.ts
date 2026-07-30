import type { SessionInfo } from '@agentclientprotocol/sdk';
import type { SessionSummary } from '@superliora/sdk';

/**
 * Project a Kimi SDK {@link SessionSummary} into the ACP
 * {@link SessionInfo} shape used by `session/list`.
 *
 * Field mapping (mirrors the Python reference at
 * `acp/server.py:303-322`):
 *  - `sessionId` ← `summary.id`.
 *  - `cwd`        ← `summary.workDir` (the SDK's name for the same
 *                    concept; ACP picked `cwd` and the rename happens
 *                    at every boundary in this adapter).
 *  - `title`      ← `summary.title` when present; otherwise omitted
 *                    (ACP's `title` is `string | null | undefined`).
 *                    Empty strings are normalized to `null` so the
 *                    client can detect "no title" via `=== null`
 *                    rather than chasing falsy semantics.
 *  - `updatedAt`  ← `new Date(summary.updatedAt).toISOString()`. The
 *                    SDK stores epoch ms (`number`); ACP wants ISO 8601.
 *                    Invalid timestamps fall back to `null` rather
 *                    than producing `Invalid Date` strings on the wire.
 */
export function sessionSummaryToSessionInfo(summary: SessionSummary): SessionInfo {
  let updatedAt: string | null = null;
  if (typeof summary.updatedAt === 'number' && Number.isFinite(summary.updatedAt)) {
    const date = new Date(summary.updatedAt);
    if (!Number.isNaN(date.getTime())) {
      updatedAt = date.toISOString();
    }
  }
  const titleRaw = summary.title;
  const title = typeof titleRaw === 'string' && titleRaw.length > 0 ? titleRaw : null;
  return {
    sessionId: summary.id,
    cwd: summary.workDir,
    title,
    updatedAt,
  };
}
