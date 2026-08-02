import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';

import { ToolChainSummaryComponent } from '#/tui/components/messages/tool-chain-summary';
import { setActiveTranscriptDetail } from '#/tui/features/transcript/transcript-density';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('ToolChainSummaryComponent', () => {
  const prev = chalk.level;
  afterEach(() => {
    chalk.level = prev;
    setActiveTranscriptDetail('standard');
  });

  it('shows click-expand nudge at minimal density when tools recorded', () => {
    chalk.level = 3;
    setActiveTranscriptDetail('minimal');
    const chain = new ToolChainSummaryComponent(0);
    chain.record({ file: 'a.ts', linesAdded: 1 });
    const plain = stripAnsi(chain.render(60).join('\n'));
    expect(plain).toMatch(/tools/);
    expect(plain).toMatch(/click expand/i);
  });

  it('omits click-expand nudge outside minimal', () => {
    chalk.level = 3;
    setActiveTranscriptDetail('compact');
    const chain = new ToolChainSummaryComponent(0);
    chain.record({ file: 'a.ts' });
    const plain = stripAnsi(chain.render(60).join('\n'));
    expect(plain).not.toMatch(/click expand/i);
  });
});
