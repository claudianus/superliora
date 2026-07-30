import type { ExperimentalFeatureState } from '@superliora/sdk';

import {
  ExperimentsSelectorComponent,
  type ExperimentalFeatureDraftChange,
} from '../../components/dialogs/experiments-selector';
import { formatErrorMessage } from '../../utils/event-payload';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/mount-picker';
import { setExperimentalFeatures } from '../experimental-flags';
import type { SlashCommandHost } from '../dispatch';

export async function showExperimentsPanel(host: SlashCommandHost): Promise<void> {
  let features: readonly ExperimentalFeatureState[];
  try {
    features = await host.harness.getExperimentalFeatures();
  } catch (error) {
    host.showError(`Failed to load experimental features: ${formatErrorMessage(error)}`);
    return;
  }
  mountExperimentsPanel(host, features);
}

export async function applyExperimentalFeatureChanges(
  host: SlashCommandHost,
  changes: readonly ExperimentalFeatureDraftChange[],
): Promise<void> {
  if (changes.length === 0) {
    host.showStatus(
      'No experimental feature changes to apply.',
      'textMuted',
    );
    return;
  }

  const experimental: Record<string, boolean> = {};
  for (const change of changes) {
    experimental[change.id] = change.enabled;
  }

  try {
    await host.harness.setConfig({ experimental });
    const features = await host.harness.getExperimentalFeatures();
    setExperimentalFeatures(features);
    host.refreshSlashCommandAutocomplete();
    dismissPickerDialog(host);
    if (host.session !== undefined) {
      await host.session.reloadSession();
      await host.reloadCurrentSessionView(
        host.session,
        'Experimental features updated. Session reloaded.',
      );
    } else {
      host.showStatus('Experimental features updated.', 'success');
    }
    host.track('experimental_features_apply', { changed: changes.length });
  } catch (error) {
    host.showError(`Failed to update experimental features: ${formatErrorMessage(error)}`);
  }
}

function mountExperimentsPanel(
  host: SlashCommandHost,
  features: readonly ExperimentalFeatureState[],
): void {
  mountPickerDialog(host,
    new ExperimentsSelectorComponent({
      features,
      onApply: (changes) => {
        void applyExperimentalFeatureChanges(host, changes);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
  );
}
