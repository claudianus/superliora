/**
 * `/loop` — start or stop an in-conversation periodic prompt loop.
 *
 * Usage:
 *   /loop [interval] <prompt>
 *   /loop stop [loopId]
 *   /loop list
 *
 * Interval may be seconds (`30s`), minutes (`2m`), or a bare number of minutes
 * (legacy). Minimum interval is enforced server-side (60s).
 */

import { formatErrorMessage } from '../utils/event-payload';
import { NO_ACTIVE_SESSION_MESSAGE } from '../constant/liora-tui';
import type { SlashCommandHost } from './hub/dispatch';

const MIN_INTERVAL_MS = 60_000;

export async function handleLoopCommand(
  host: SlashCommandHost,
  args: string = '',
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const trimmed = args.trim();
  if (trimmed.length === 0) {
    host.showError('사용법: /loop [interval] <prompt> | /loop stop [id] | /loop list');
    return;
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'list' || lower.startsWith('list ')) {
    try {
      const loops = await session.listConversationLoops();
      if (loops.length === 0) {
        host.showStatus('활성 대화 루프가 없습니다.');
        return;
      }
      const lines = loops.map((loop) => {
        const intervalSec = Math.round(loop.intervalMs / 1000);
        return `${loop.id} · ${loop.status} · ${String(loop.iterations)}/${String(loop.maxIterations)} · ${String(intervalSec)}s · ${loop.prompt.slice(0, 60)}`;
      });
      host.showStatus(lines.join('\n'));
    } catch (error) {
      host.showError(`루프 목록 조회 실패: ${formatErrorMessage(error)}`);
    }
    return;
  }

  if (lower === 'stop' || lower.startsWith('stop ')) {
    const rest = trimmed.slice(4).trim();
    const loopId = rest.length === 0 ? undefined : rest;
    try {
      const stopped = await session.stopConversationLoop(loopId);
      if (stopped === undefined) {
        host.showStatus('중지할 대화 루프가 없습니다.');
        return;
      }
      host.showStatus(`루프 ${stopped.id}를 중지했습니다.`);
    } catch (error) {
      host.showError(`루프 중지 실패: ${formatErrorMessage(error)}`);
    }
    return;
  }

  const parsed = parseLoopArgs(trimmed);
  if (parsed === undefined) {
    host.showError('사용법: /loop [interval] <prompt>  (예: /loop 2m 상태 점검)');
    return;
  }

  try {
    const state = await session.startConversationLoop({
      prompt: parsed.prompt,
      intervalMs: parsed.intervalMs,
    });
    const intervalSec = Math.round(state.intervalMs / 1000);
    host.showStatus(
      `루프 ${state.id} 시작 · 간격 ${String(intervalSec)}s · 최대 ${String(state.maxIterations)}회 · 프롬프트: ${state.prompt.slice(0, 80)}`,
    );
  } catch (error) {
    host.showError(`루프 시작 실패: ${formatErrorMessage(error)}`);
  }
}

function parseLoopArgs(args: string): { intervalMs: number; prompt: string } | undefined {
  const tokens = args.match(/\S+/g);
  if (tokens === null || tokens.length === 0) return undefined;

  const first = tokens[0] ?? '';
  const intervalMs = parseIntervalToken(first);
  if (intervalMs !== undefined) {
    const prompt = tokens.slice(1).join(' ').trim();
    if (prompt.length === 0) return undefined;
    return { intervalMs: Math.max(intervalMs, MIN_INTERVAL_MS), prompt };
  }

  const prompt = args.trim();
  if (prompt.length === 0) return undefined;
  return { intervalMs: MIN_INTERVAL_MS, prompt };
}

/** Parse `30s`, `2m`, `1h`, or bare minutes number. */
function parseIntervalToken(token: string): number | undefined {
  const match = token.match(/^(\d+(?:\.\d+)?)(s|m|h)?$/i);
  if (match === null) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = (match[2] ?? 'm').toLowerCase();
  if (unit === 's') return Math.floor(value * 1000);
  if (unit === 'h') return Math.floor(value * 60 * 60 * 1000);
  return Math.floor(value * 60 * 1000);
}
