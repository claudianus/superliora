import { PRODUCT_NAME } from '#/constant/app';
import { t, tln } from '#/cli/i18n';

import { CHANGELOG_URL } from './prompt';
import { NPM_PACKAGE_NAME, type InstallSource, type UpdateTarget } from './types';

export function renderManualUpdateMessage(
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  installCommand: string,
): string {
  let sourceDesc: string;
  switch (source) {
    case 'npm-global':
    case 'pnpm-global':
    case 'yarn-global':
    case 'bun-global':
      sourceDesc = source;
      break;
    case 'homebrew':
      sourceDesc = 'homebrew';
      break;
    case 'github-checkout':
      sourceDesc = t('cli.runtime.update.source.githubCheckout');
      break;
    case 'native':
      sourceDesc = t('cli.runtime.update.source.native');
      break;
    case 'unsupported':
      sourceDesc = t('cli.runtime.update.source.unsupported');
      break;
  }
  return (
    `${t('cli.runtime.update.manualHeader', {
      package: NPM_PACKAGE_NAME,
      current: currentVersion,
      target: target.version,
    })}\n` +
    `${t('cli.runtime.update.manualSource', { source: sourceDesc })}\n` +
    `${t('cli.runtime.update.manualCommand', { command: installCommand })}\n`
  );
}

export function renderInstallSuccessMessage(target: UpdateTarget): string {
  return tln('cli.runtime.update.installSuccess', {
    package: NPM_PACKAGE_NAME,
    version: target.version,
  });
}

export function renderGithubCheckoutInstallSuccessMessage(target: UpdateTarget): string {
  return tln('cli.runtime.update.githubInstallSuccess', {
    product: PRODUCT_NAME,
    version: target.version,
  });
}

export function renderBackgroundInstallSuccessNotice(version: string, source?: InstallSource): string {
  if (source === 'github-checkout') {
    return tln('cli.runtime.update.backgroundGithub', {
      product: PRODUCT_NAME,
      version,
    });
  }
  const displayVersion = version.startsWith('v') ? version : `v${version}`;
  return t('cli.runtime.update.backgroundSuccess', {
    product: PRODUCT_NAME,
    version: displayVersion,
    changelog: CHANGELOG_URL,
  });
}
