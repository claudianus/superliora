/**
 * Pure Upgrade Studio stage → label/fraction map (no theme / no I/O).
 */

import type { InstallSource } from '#/cli/update/types';
import type { UpgradeInstallStage } from '#/cli/update/install-stages';

export type UpgradeChecklistMarker = 'done' | 'active' | 'pending' | 'failed';

export interface UpgradeChecklistRow {
  readonly stage: UpgradeInstallStage;
  readonly label: string;
  readonly marker: UpgradeChecklistMarker;
}

const STAGE_FRACTION: Record<Exclude<UpgradeInstallStage, 'failed'>, number> = {
  checking: 0.04,
  bootstrapping: 0.1,
  fetching: 0.22,
  downloading: 0.28,
  building: 0.55,
  installing: 0.75,
  sidecars: 0.9,
  done: 1,
};

const STAGE_LABEL: Record<UpgradeInstallStage, string> = {
  checking: 'Checking',
  bootstrapping: 'Bootstrapping',
  fetching: 'Fetching',
  downloading: 'Downloading',
  building: 'Building',
  installing: 'Installing',
  sidecars: 'Sidecars',
  done: 'Done',
  failed: 'Failed',
};

/** Pipeline stages shown in the checklist (excludes terminal failed). */
const GITHUB_PIPELINE: readonly UpgradeInstallStage[] = [
  'checking',
  'bootstrapping',
  'fetching',
  'building',
  'installing',
  'sidecars',
  'done',
];

const PACKAGE_PIPELINE: readonly UpgradeInstallStage[] = [
  'checking',
  'downloading',
  'installing',
  'done',
];

const NATIVE_PIPELINE: readonly UpgradeInstallStage[] = [
  'checking',
  'bootstrapping',
  'downloading',
  'installing',
  'sidecars',
  'done',
];

export function stageLabel(stage: UpgradeInstallStage): string {
  return STAGE_LABEL[stage];
}

export function stageFraction(
  stage: UpgradeInstallStage,
  previousFraction = 0,
): number {
  if (stage === 'failed') {
    return clamp01(previousFraction > 0 ? previousFraction : 0.4);
  }
  return STAGE_FRACTION[stage];
}

export function orderedStagesForSource(
  source: InstallSource,
): readonly UpgradeInstallStage[] {
  if (source === 'native') return NATIVE_PIPELINE;
  if (source === 'github-checkout') return GITHUB_PIPELINE;
  return PACKAGE_PIPELINE;
}

/**
 * Build checklist rows for the active install stage.
 * Stages before the active one are done; after are pending.
 * On failed, the active pipeline stage becomes failed and later stay pending.
 */
export function formatStageChecklist(
  source: InstallSource,
  active: UpgradeInstallStage,
): readonly UpgradeChecklistRow[] {
  const pipeline = orderedStagesForSource(source);
  const activeIndex = pipelineIndex(pipeline, active);
  const failed = active === 'failed';

  return pipeline.map((stage, index) => {
    let marker: UpgradeChecklistMarker = 'pending';
    if (failed) {
      if (index < activeIndex) marker = 'done';
      else if (index === activeIndex || (activeIndex < 0 && index === pipeline.length - 2)) {
        marker = 'failed';
      } else {
        marker = 'pending';
      }
    } else if (stage === 'done' && active === 'done') {
      marker = 'done';
    } else if (index < activeIndex) {
      marker = 'done';
    } else if (index === activeIndex) {
      marker = active === 'done' ? 'done' : 'active';
    }
    return { stage, label: stageLabel(stage), marker };
  });
}

function pipelineIndex(
  pipeline: readonly UpgradeInstallStage[],
  active: UpgradeInstallStage,
): number {
  if (active === 'failed') {
    // Prefer last non-done stage as failure point when unknown.
    const installing = pipeline.indexOf('installing');
    return installing >= 0 ? installing : Math.max(0, pipeline.length - 2);
  }
  // Treat fetching/downloading as aliases for checklist index lookup.
  const direct = pipeline.indexOf(active);
  if (direct >= 0) return direct;
  if (active === 'fetching') {
    const downloading = pipeline.indexOf('downloading');
    if (downloading >= 0) return downloading;
  }
  if (active === 'downloading') {
    const fetching = pipeline.indexOf('fetching');
    if (fetching >= 0) return fetching;
  }
  if (active === 'bootstrapping') {
    const checking = pipeline.indexOf('checking');
    if (checking >= 0) return checking;
  }
  if (active === 'sidecars') {
    const installing = pipeline.indexOf('installing');
    if (installing >= 0) return installing;
  }
  return 0;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
