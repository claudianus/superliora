/**
 * Settings → Cache — hit-rate glance + invalidate action + Cache Sacred (W1 / §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import {
  buildCacheSettingsLines,
  cacheInvalidateStatusMessage,
  nextCacheInvalidateEpoch,
  resolveCacheSessionGlance,
  type CacheGlanceTone,
  type CacheStyledLine,
} from '../../../utils/cache/cache-glance';
import { formatErrorMessage } from '../../../utils/event-payload';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { currentTheme } from '../../../theme/theme';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

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

export async function invalidatePromptCache(host: SlashCommandHost): Promise<void> {
  try {
    const config = await host.harness.getConfig();
    const epoch = nextCacheInvalidateEpoch(config.cache?.invalidateEpoch);
    await host.harness.setConfig({ cache: { invalidateEpoch: epoch } });
    host.showStatus(cacheInvalidateStatusMessage(epoch), 'warning');
  } catch (error) {
    host.showError(`Failed to invalidate prompt cache: ${formatErrorMessage(error)}`);
  }
}

export function showCacheSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Cache',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Cache status',
          description: 'Hit rate · warm streak · freeze · Cache Sacred tips.',
        },
        {
          value: 'invalidate',
          label: 'Invalidate prompt cache',
          description: 'Bump cache.invalidateEpoch — cold prefix on the next turn.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showCacheSettingsPanel(host);
          return;
        }
        if (value === 'invalidate') {
          void invalidatePromptCache(host);
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Cache' },
  );
}

async function showCacheSettingsPanel(host: SlashCommandHost): Promise<void> {
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
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
