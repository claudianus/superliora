/**
 * Settings → Cache — hit-rate glance + Cache Sacred tips (W1).
 */

import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import {
  buildCacheSettingsLines,
  resolveCacheSessionGlance,
  type CacheGlanceTone,
  type CacheStyledLine,
} from '../../../utils/cache/cache-glance';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { currentTheme } from '../../../theme/theme';

import type { SlashCommandHost } from '../../hub/dispatch';

function applyCacheTone(line: CacheStyledLine): string {
  switch (line.tone) {
    case 'success':
      return currentTheme.fg('success', line.text);
    case 'warning':
      return currentTheme.fg('warning', line.text);
    case 'muted':
      return currentTheme.fg('textMuted', line.text);
    default:
      return line.text;
  }
}

function renderCacheSettingsLines(
  session: ReturnType<typeof resolveCacheSessionGlance>,
): string[] {
  const plain = buildCacheSettingsLines(session);
  const toneByText = new Map<string, CacheGlanceTone | undefined>();
  toneByText.set(session.statusLine.text, session.statusLine.tone);
  if (session.prefixLine != null) toneByText.set(session.prefixLine.text, session.prefixLine.tone);
  if (session.missReasonLine != null) {
    toneByText.set(session.missReasonLine.text, session.missReasonLine.tone);
  }
  if (session.freezeLine != null) toneByText.set(session.freezeLine.text, session.freezeLine.tone);

  return plain.map((line) => {
    const tone = toneByText.get(line);
    if (tone === undefined) return line;
    return applyCacheTone({ text: line, tone });
  });
}

export async function showCacheSettings(host: SlashCommandHost): Promise<void> {
  let session = resolveCacheSessionGlance({
    appStateCacheMeter: host.state.appState.cacheMeter,
  });

  try {
    const status = await host.requireSession().getStatus();
    session = resolveCacheSessionGlance({
      appStateCacheMeter: host.state.appState.cacheMeter,
      statusHitRate: status.cacheHitRate,
      statusWarmStreak: status.cacheWarmStreak,
      cacheFrozen: status.cacheFrozen,
      usage: status.usage,
    });
  } catch {
    /* keep AppState-only glance */
  }

  const lines = renderCacheSettingsLines(session);
  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => lines,
    borderToken: 'primary',
    title: ' Cache ',
    enterBeatSeed: 'cache',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
