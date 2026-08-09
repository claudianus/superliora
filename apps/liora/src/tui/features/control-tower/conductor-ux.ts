/**
 * Conductor UX v2 orchestration — Intent Composer mount, timeline region,
 * project-mode cycle, and one-shot timeline default.
 */

import {
  DEFAULT_CONDUCTOR_PREFERENCES,
  saveTuiConfig,
  type ConductorPreferences,
} from '../../config';
import { IntentComposerComponent } from '../../components/chrome/intent-composer';
import { ConductorTimelinePanelComponent } from '../../components/panes/conductor-timeline/timeline-panel';
import { isConductorUxV2Enabled } from '../../commands/job-hotpath';
import { tuiConfigFromHost } from '../../commands/config/appearance/tui-persist';
import type { Session } from '@superliora/sdk';

import type { ColorToken } from '../../theme';
import type { AppState } from '../../types';
import type { TUIState } from '../../tui-state';
import {
  CONDUCTOR_PROJECT_MODE_POOL,
  cycleConductorProjectMode,
  type ConductorProjectMode,
} from '../../utils/job/intent-brief';
import { emptyConductorJobsSnapshot } from '../../utils/job/job-strip';
import {
  loadProfileLiveGlance,
  SOVEREIGN_CONDUCTOR_PROFILE_NAME,
} from '../../utils/agent/profile-glance';
import { requestTUIContentRender, requestTUILayoutRender } from '../../utils/render/frame-render';

/** Minimal host surface for Conductor UX v2 chrome wiring. */
export interface ConductorUxHost {
  readonly state: TUIState;
  readonly session?: Session;
  setAppState?(patch: Partial<AppState>): void;
  showStatus(msg: string, color?: ColorToken): void;
  readonly jobBoardController?: { openDeck(jobId?: string): void };
}

export function mountIntentComposer(host: ConductorUxHost): void {
  if (!isConductorUxV2Enabled()) return;
  const mode = host.state.appState.conductorProjectMode ?? 'balanced';
  const composer = new IntentComposerComponent({
    projectMode: mode,
    requestRender: () => {
      host.state.renderer.requestRender('manual');
    },
    onBlur: () => {
      host.state.ui.setFocus(host.state.editor);
    },
  });
  host.state.intentComposer = composer;
  host.state.editorContainer.clear();
  host.state.editorContainer.addChild(composer);
  host.state.editorContainer.addChild(host.state.editor);
  host.state.editor.connectedAbove = true;
  host.state.ui.setFocus(host.state.editor);
  requestTUILayoutRender(host.state);
}

export function focusIntentComposer(host: ConductorUxHost): boolean {
  if (!isConductorUxV2Enabled()) return false;
  if (host.state.intentComposer === undefined) {
    mountIntentComposer(host);
  }
  const live = host.state.intentComposer;
  if (live === undefined) return false;
  live.setExpanded(true);
  host.state.ui.setFocus(live);
  host.showStatus('Intent brief — edit slots, Esc returns to prompt', 'info');
  return true;
}

export function applyConductorProjectMode(
  host: ConductorUxHost,
  mode: ConductorProjectMode,
): void {
  const previous = host.state.appState.conductor ?? DEFAULT_CONDUCTOR_PREFERENCES;
  const conductor: ConductorPreferences = { ...previous, projectMode: mode };
  const pool = CONDUCTOR_PROJECT_MODE_POOL[mode];
  const jobs = host.state.appState.conductorJobs;
  host.setAppState?.({
    conductorProjectMode: mode,
    conductor,
    ...(jobs !== undefined && jobs !== null
      ? { conductorJobs: { ...jobs, maxConcurrent: pool } }
      : {}),
  });
  host.state.intentComposer?.applyProjectMode(mode);
  void host.session?.jobSetProjectMode(mode).catch(() => {
    /* session-local pref still applied */
  });
  void saveTuiConfig(tuiConfigFromHost(host, { conductor })).catch(() => {});
  host.showStatus(`Project mode → ${mode} (pool=${String(pool)})`, 'info');
  requestTUIContentRender(host.state);
}

export function cycleAndApplyProjectMode(host: ConductorUxHost): ConductorProjectMode {
  const next = cycleConductorProjectMode(host.state.appState.conductorProjectMode);
  applyConductorProjectMode(host, next);
  return next;
}

export function setTranscriptRegionMode(
  host: ConductorUxHost,
  mode: 'chat' | 'timeline',
): void {
  const previous = host.state.appState.conductor ?? DEFAULT_CONDUCTOR_PREFERENCES;
  const conductor: ConductorPreferences = {
    ...previous,
    transcriptRegionMode: mode,
  };
  host.setAppState?.({ transcriptRegionMode: mode, conductor });
  syncTranscriptRegion(host);
  void saveTuiConfig(tuiConfigFromHost(host, { conductor })).catch(() => {});
}

export function toggleTranscriptRegion(host: ConductorUxHost): 'chat' | 'timeline' {
  const current = host.state.appState.transcriptRegionMode ?? 'chat';
  const next = current === 'chat' ? 'timeline' : 'chat';
  setTranscriptRegionMode(host, next);
  host.showStatus(next === 'timeline' ? 'Region → Timeline' : 'Region → Chat', 'info');
  return next;
}

export function syncTranscriptRegion(host: ConductorUxHost): void {
  const mode = host.state.appState.transcriptRegionMode ?? 'chat';
  const container = host.state.transcriptContainer;
  if (mode === 'timeline' && isConductorUxV2Enabled()) {
    ensureTimelinePanel(host);
    const panel = host.state.conductorTimelinePanel;
    if (panel === undefined) return;
    if (!container.isAquariumOverlayActive) {
      container.showLockedRegionOverlay((add) => {
        add(panel);
      });
    }
  } else if (container.isAquariumOverlayActive) {
    container.exitAquariumOverlay();
  }
  requestTUILayoutRender(host.state);
}

function ensureTimelinePanel(host: ConductorUxHost): void {
  if (host.state.conductorTimelinePanel !== undefined) return;
  host.state.conductorTimelinePanel = new ConductorTimelinePanelComponent({
    getSnapshot: () => host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot(),
    onOpenChat: () => {
      setTranscriptRegionMode(host, 'chat');
    },
    onSelectJob: (jobId) => {
      host.jobBoardController?.openDeck(jobId);
    },
    requestRender: () => {
      host.state.renderer.requestRender('manual');
    },
  });
}

/**
 * One-shot: when conductor profile + jobs exist + flag ON, default to timeline once.
 */
export function maybeDefaultTimelineOnce(host: ConductorUxHost): void {
  if (!isConductorUxV2Enabled()) return;
  const prefs = host.state.appState.conductor ?? DEFAULT_CONDUCTOR_PREFERENCES;
  if (prefs.timelineDefaulted) return;
  const jobs = host.state.appState.conductorJobs?.jobs ?? [];
  if (jobs.length < 1) return;
  const profile = loadProfileLiveGlance({}).effectiveProfile;
  if (profile !== SOVEREIGN_CONDUCTOR_PROFILE_NAME) return;

  const conductor: ConductorPreferences = {
    ...prefs,
    transcriptRegionMode: 'timeline',
    timelineDefaulted: true,
  };
  host.setAppState?.({
    conductor,
    transcriptRegionMode: 'timeline',
  });
  syncTranscriptRegion(host);
  void saveTuiConfig(tuiConfigFromHost(host, { conductor })).catch(() => {});
  host.showStatus('Timeline view (default once with Conductor jobs)', 'info');
}
