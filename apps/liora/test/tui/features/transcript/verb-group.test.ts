import { describe, expect, it } from 'vitest';
import { classifyToolVerbKind, formatVerbGroupLabel, turnActivityIdentity } from '#/tui/features/transcript/verb-group';
describe('minimal runtime verb groups', () => {
  it('labels commands and session operations without claiming a child was spawned', () => {
    expect(classifyToolVerbKind('Bash')).toBe('command');
    expect(classifyToolVerbKind('SessionControl')).toBe('subagent');
    expect(classifyToolVerbKind('HistoricalTool')).toBe('other');
    expect(formatVerbGroupLabel([{ name: 'Bash', running: true }, { name: 'SessionControl' }])).toBe('Running 1 command · Running 1 session operation');
    expect(formatVerbGroupLabel([{ name: 'Bash' }, { name: 'Bash' }])).toBe('Ran 2 commands');
  });
  it('retains running identity for remount-free paints', () => {
    expect(turnActivityIdentity([{ name: 'Bash', running: true }])).toBe('Bash:1');
  });
});
