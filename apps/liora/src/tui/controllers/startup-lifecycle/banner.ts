import { BannerProvider } from '../../banner/banner-provider';
import { readBannerDisplayState, writeBannerDisplayState } from '../../banner/state';
import { BannerComponent } from '../../components/chrome/banner';
import { WelcomeComponent } from '../../components/chrome/welcome';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import type { StartupLifecycleHost } from './types';

export async function loadStartupBanner(host: StartupLifecycleHost): Promise<void> {
  const provider = new BannerProvider(host.state.appState.version);
  const displayState = await readBannerDisplayState();
  const now = new Date();
  const banner = await provider.load(fetch, {
    state: displayState,
    now,
  });
  host.state.appState.banner = banner;
  if (banner === null) return;

  renderStartupBanner(host);
  requestTUILayoutRender(host.state);

  if (banner.display === 'always') return;
  try {
    await writeBannerDisplayState({
      version: 1,
      shown: {
        ...displayState.shown,
        [banner.key]: { lastShownAt: now.toISOString() },
      },
    });
  } catch {
    // Best-effort: banner display state should never block startup.
  }
}

export function renderStartupBanner(host: StartupLifecycleHost): void {
  if (host.state.appState.banner === null || host.state.appState.banner === undefined) {
    return;
  }
  if (host.state.transcriptContainer.children.some((child) => child instanceof BannerComponent)) {
    return;
  }
  const welcomeIndex = host.state.transcriptContainer.children.findIndex(
    (child) => child instanceof WelcomeComponent,
  );
  const banner = new BannerComponent(host.state.appState.banner);
  if (welcomeIndex >= 0) {
    host.state.transcriptContainer.children.splice(welcomeIndex + 1, 0, banner);
  } else {
    host.state.transcriptContainer.children.unshift(banner);
  }
  host.state.transcriptContainer.invalidate();
}
