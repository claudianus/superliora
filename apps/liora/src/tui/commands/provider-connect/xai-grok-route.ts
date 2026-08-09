/**
 * xAI Grok Build vs API billing-route picker + config apply.
 * Same OAuth token; host decides subscription quota vs API credits.
 */

import {
  resolveXaiGrokRoute,
  xaiGrokProviderRouteFields,
  type XaiGrokRoute,
} from '@superliora/oauth';

import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import { ttui } from '#/tui/utils/tui-i18n';
import type { SlashCommandHost } from '../hub/dispatch';

export function readXaiGrokRouteFromProvider(
  provider: Record<string, unknown> | undefined,
): XaiGrokRoute {
  const baseUrl =
    typeof provider?.['baseUrl'] === 'string'
      ? provider['baseUrl']
      : typeof provider?.['base_url'] === 'string'
        ? provider['base_url']
        : undefined;
  return resolveXaiGrokRoute(baseUrl);
}

/** ChoicePicker for Build (subscription) vs API (credits). Cancel → undefined. */
export function promptXaiGrokRoute(
  host: SlashCommandHost,
  current: XaiGrokRoute = 'build',
): Promise<XaiGrokRoute | undefined> {
  return new Promise((resolve) => {
    const picker = new ChoicePickerComponent({
      title: ttui('tui.provider.xaiRouteTitle'),
      hint: '↑↓ · Enter · Esc',
      options: [
        {
          value: 'build',
          label: ttui('tui.provider.xaiRouteBuild'),
          description: ttui('tui.provider.xaiRouteBuildDesc'),
        },
        {
          value: 'api',
          label: ttui('tui.provider.xaiRouteApi'),
          description: ttui('tui.provider.xaiRouteApiDesc'),
        },
      ],
      currentValue: current,
      onSelect: (value) => {
        host.restoreEditor();
        resolve(value === 'api' ? 'api' : 'build');
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(picker);
  });
}

/** Patch an existing xai-grok provider blob onto the chosen billing route. */
export function applyXaiGrokRouteToProvider(
  existingProvider: Record<string, unknown> | undefined,
  route: XaiGrokRoute,
): Record<string, unknown> {
  const fields = xaiGrokProviderRouteFields(route);
  const next: Record<string, unknown> = {
    ...(existingProvider !== undefined ? { ...existingProvider } : {}),
    type: 'openai',
    baseUrl: fields.baseUrl,
    customHeaders: fields.customHeaders,
  };
  // Prefer camelCase; drop snake_case twin so config writers do not keep a
  // stale API/Build host under the alternate key.
  delete next['base_url'];
  delete next['custom_headers'];
  return next;
}

export function xaiGrokRouteStatusLabel(route: XaiGrokRoute): string {
  return route === 'api'
    ? ttui('tui.provider.xaiRouteApi')
    : ttui('tui.provider.xaiRouteBuild');
}
