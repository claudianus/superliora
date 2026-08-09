/**
 * `/loop` — start or stop an in-conversation periodic prompt loop.
 */

import { formatErrorMessage } from '../utils/event-payload';
import { NO_ACTIVE_SESSION_MESSAGE } from '../constant/liora-tui';
import { ttui } from '../utils/tui-i18n';
import type { SlashCommandHost } from './hub/dispatch';

const MIN_INTERVAL_MS = 60_000;

export async function handleLoopCommand(
  host: SlashCommandHost,
  args: string = '',
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE());
    return;
  }

  const trimmed = args.trim();
  if (trimmed.length === 0) {
    host.showError(ttui('tui.loop.usage'));
    return;
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'list' || lower.startsWith('list ')) {
    try {
      const loops = await session.listConversationLoops();
      if (loops.length === 0) {
        host.showStatus(ttui('tui.loop.empty'));
        return;
      }
      const lines = loops.map((loop) => {
        const intervalSec = Math.round(loop.intervalMs / 1000);
        return `${loop.id} · ${loop.status} · ${String(loop.iterations)}/${String(loop.maxIterations)} · ${String(intervalSec)}s · ${loop.prompt.slice(0, 60)}`;
      });
      host.showStatus(lines.join('\n'));
    } catch (error) {
      host.showError(ttui('tui.loop.listFailed', { message: formatErrorMessage(error) }));
    }
    return;
  }

  if (lower === 'stop' || lower.startsWith('stop ')) {
    const rest = trimmed.slice(4).trim();
    const loopId = rest.length === 0 ? undefined : rest;
    try {
      const stopped = await session.stopConversationLoop(loopId);
      if (stopped === undefined) {
        host.showStatus(ttui('tui.loop.stopEmpty'));
        return;
      }
      host.showStatus(ttui('tui.loop.stopped', { id: stopped.id }));
    } catch (error) {
      host.showError(ttui('tui.loop.stopFailed', { message: formatErrorMessage(error) }));
    }
    return;
  }

  const parsed = parseLoopArgs(trimmed);
  if (parsed === undefined) {
    host.showError(ttui('tui.loop.usageExample'));
    return;
  }

  try {
    const state = await session.startConversationLoop({
      prompt: parsed.prompt,
      intervalMs: parsed.intervalMs,
    });
    const intervalSec = Math.round(state.intervalMs / 1000);
    host.showStatus(
      ttui('tui.loop.started', {
        id: state.id,
        interval: String(intervalSec),
        max: String(state.maxIterations),
        prompt: state.prompt.slice(0, 80),
      }),
    );
  } catch (error) {
    host.showError(ttui('tui.loop.startFailed', { message: formatErrorMessage(error) }));
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
