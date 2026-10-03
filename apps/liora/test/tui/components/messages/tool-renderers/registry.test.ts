import { describe, expect, it } from 'vitest';
import { isGenericToolResult, pickResultRenderer } from '#/tui/components/messages/tool-renderers/registry';
import { renderTruncated } from '#/tui/components/messages/tool-renderers/truncated';
import { darkColors } from '#/tui/theme/colors';

const ctx = { expanded: false, colors: darkColors };
function render(name: string, args: Record<string, unknown>, output: string): string {
  return pickResultRenderer(name)({ id: 'call', name, args }, {
    tool_call_id: 'call', output, is_error: false,
  }, ctx).flatMap((component) => component.render(100)).join('\n').replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('minimal tool result registry', () => {
  it('keeps the Bash command visible after output arrives', () => {
    const output = render('Bash', { command: 'printf hello' }, 'hello');
    expect(output).toContain('$ printf hello');
    expect(output).toContain('hello');
    expect(isGenericToolResult('Bash')).toBe(false);
  });

  it('renders SessionControl operation output without inventing a child result', () => {
    const output = render('SessionControl', { operation: 'spawn', prompt: 'fix', description: 'Fix' }, '{"agentId":"child","status":"running"}');
    expect(output).toContain('running');
    expect(isGenericToolResult('SessionControl')).toBe(false);
  });

  it('uses expandable raw output for unknown historical tools', () => {
    expect(pickResultRenderer('HistoricalTool')).toBe(renderTruncated);
    expect(isGenericToolResult('HistoricalTool')).toBe(true);
    expect(render('HistoricalTool', {}, 'historical output')).toContain('historical output');
  });
});
