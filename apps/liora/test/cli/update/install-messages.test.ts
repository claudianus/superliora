import { describe, expect, it } from 'vitest';

import {
  renderBackgroundInstallSuccessNotice,
  renderInstallSuccessMessage,
  renderManualUpdateMessage,
} from '#/cli/update/install-messages';

describe('install-messages', () => {
  it('renders manual update instructions with source and command', () => {
    const message = renderManualUpdateMessage(
      '0.4.0',
      { version: '0.5.0' },
      'npm-global',
      'npm install -g @superliora/liora@0.5.0',
    );

    expect(message).toContain('0.4.0');
    expect(message).toContain('0.5.0');
    expect(message).toContain('npm-global');
    expect(message).toContain('npm install -g @superliora/liora@0.5.0');
  });

  it('renders install success with package name', () => {
    expect(renderInstallSuccessMessage({ version: '0.5.0' })).toContain('0.5.0');
  });

  it('uses github-specific background notice copy', () => {
    const message = renderBackgroundInstallSuccessNotice('0.5.0', 'github-checkout');
    expect(message).toContain('0.5.0');
  });

  it('prefixes version with v in generic background notice', () => {
    const message = renderBackgroundInstallSuccessNotice('0.5.0', 'npm-global');
    expect(message).toContain('v0.5.0');
  });
});
