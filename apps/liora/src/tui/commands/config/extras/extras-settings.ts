/**
 * Settings → Provider extras — auto-detected subscription/plan extras
 * (web search, image/video generation, bundled MCP servers) with a
 * per-service off switch. Everything is auto-detected by default; the
 * only control here is opting a service out via extras.disabledProviders.
 */

import type { ProviderExtrasStatus } from '@superliora/sdk';

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { formatExtrasCapabilities } from '../../../components/messages/status-panel/extras';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import type { SlashCommandHost } from '../../hub/dispatch';

interface ExtrasRow {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly disabled: boolean;
}

function buildRows(
  extras: ProviderExtrasStatus | undefined,
  disabled: readonly string[],
): ExtrasRow[] {
  // The freshly read config list is authoritative — the live status snapshot
  // can lag a setConfig write by a tick.
  const rows: ExtrasRow[] = (extras?.providers ?? []).map((provider) => {
    const off = disabled.includes(provider.id);
    return {
      id: provider.id,
      label: `${provider.label} — ${off ? 'OFF' : 'on'}`,
      description:
        `${provider.source} · ${formatExtrasCapabilities(provider.capabilities)} · ` +
        `Enter to ${off ? 're-enable' : 'disable'}`,
      disabled: off,
    };
  });
  for (const id of disabled) {
    if (rows.some((row) => row.id === id)) continue;
    rows.push({
      id,
      label: `${id} — OFF`,
      description: 'not detected right now (config only) · Enter to re-enable',
      disabled: true,
    });
  }
  return rows;
}

export function showProviderExtrasSettings(host: SlashCommandHost): void {
  void openProviderExtrasPicker(host);
}

async function openProviderExtrasPicker(host: SlashCommandHost): Promise<void> {
  let extras: ProviderExtrasStatus | undefined;
  try {
    extras = (await host.requireSession().getStatus()).extras;
  } catch {
    extras = undefined;
  }
  let disabled: readonly string[] = [];
  try {
    const config = await host.harness.getConfig({ reload: true });
    disabled = config.extras?.disabledProviders ?? [];
  } catch {
    disabled = [];
  }

  const rows = buildRows(extras, disabled);
  if (rows.length === 0) {
    host.showStatus(
      'No provider extras detected. Extras auto-activate when a supported key/OAuth is present (Z.AI, Qwen Token Plan, xAI, Codex).',
      'warning',
    );
    return;
  }

  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Provider extras (auto-detected)',
      hint: '↑↓ · Enter toggles · Esc',
      searchable: true,
      options: rows.map((row) => ({
        value: row.id,
        label: row.label,
        description: row.description,
      })),
      onSelect: (id) => {
        dismissPickerDialog(host);
        void toggleProviderExtra(host, id, disabled);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Provider extras' },
  );
}

async function toggleProviderExtra(
  host: SlashCommandHost,
  id: string,
  disabled: readonly string[],
): Promise<void> {
  const next = disabled.includes(id) ? disabled.filter((d) => d !== id) : [...disabled, id];
  try {
    await host.harness.setConfig({ extras: { disabledProviders: next } });
    host.showStatus(
      next.includes(id)
        ? `Provider extras "${id}" disabled — no search slot, media backend, or auto MCP from it (applies to new sessions).`
        : `Provider extras "${id}" re-enabled (auto-detect; applies to new sessions).`,
      'success',
    );
  } catch (error) {
    host.showStatus(
      `Failed to update provider extras: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return;
  }
  await openProviderExtrasPicker(host);
}
