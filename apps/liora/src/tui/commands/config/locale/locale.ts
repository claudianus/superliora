/**
 * /locale slash command and Settings → Language picker.
 * Persists `tui.toml` `locale` and applies via setCliLocale.
 */

import { resolveCliLocale, setCliLocale, type LocalePreference } from '#/cli/i18n';
import { saveTuiConfig, type LocalePreference as ConfigLocalePreference } from '../../../config';
import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { formatErrorMessage } from '../../../utils/event-payload';
import { ttui } from '../../../utils/tui-i18n';
import { requestTUIContentRender } from '../../../utils/render/frame-render';
import { tuiConfigFromHost } from '../appearance/tui-persist';
import type { SlashCommandHost } from '../../hub/dispatch';

const LOCALE_VALUES = ['auto', 'en', 'ko'] as const;

function isLocalePreference(value: string): value is ConfigLocalePreference {
  return (LOCALE_VALUES as readonly string[]).includes(value);
}

function applyLocalePreference(preference: ConfigLocalePreference): void {
  setCliLocale(resolveCliLocale({ preference, env: process.env }));
}

export function currentLocalePreference(host: SlashCommandHost): ConfigLocalePreference {
  return host.state.appState.locale ?? 'auto';
}

export async function persistLocalePreference(
  host: SlashCommandHost,
  preference: ConfigLocalePreference,
): Promise<boolean> {
  try {
    await saveTuiConfig(tuiConfigFromHost(host, { locale: preference }));
  } catch (error) {
    host.showStatus(
      ttui('tui.locale.saveFailed', { message: formatErrorMessage(error) }),
      'error',
    );
    return false;
  }
  host.setAppState({ locale: preference });
  applyLocalePreference(preference);
  requestTUIContentRender(host.state);
  return true;
}

export async function handleLocaleCommand(host: SlashCommandHost, args: string): Promise<void> {
  const token = args.trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (token.length === 0 || token === 'help') {
    showLocaleSettings(host);
    return;
  }
  if (!isLocalePreference(token)) {
    host.showError(ttui('tui.locale.usage'));
    return;
  }
  if (token === currentLocalePreference(host)) {
    host.showStatus(ttui('tui.locale.unchanged', { value: token }));
    return;
  }
  const ok = await persistLocalePreference(host, token);
  if (ok) {
    host.showStatus(ttui('tui.locale.applied', { value: labelForPreference(token) }), 'success');
  }
}

function labelForPreference(preference: LocalePreference): string {
  if (preference === 'auto') return ttui('tui.locale.option.auto');
  if (preference === 'ko') return ttui('tui.locale.option.ko');
  return ttui('tui.locale.option.en');
}

export function showLocaleSettings(host: SlashCommandHost): void {
  const current = currentLocalePreference(host);
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.locale.title'),
      hint: ttui('tui.locale.hint'),
      currentValue: current,
      options: [
        {
          value: 'auto',
          label: ttui('tui.locale.option.auto'),
          description: ttui('tui.locale.option.autoDesc'),
        },
        {
          value: 'en',
          label: ttui('tui.locale.option.en'),
          description: ttui('tui.locale.option.enDesc'),
        },
        {
          value: 'ko',
          label: ttui('tui.locale.option.ko'),
          description: ttui('tui.locale.option.koDesc'),
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (!isLocalePreference(value)) return;
        void persistLocalePreference(host, value).then((ok) => {
          if (ok) {
            host.showStatus(
              ttui('tui.locale.applied', { value: labelForPreference(value) }),
              'success',
            );
          }
        });
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.locale.title') },
  );
}
