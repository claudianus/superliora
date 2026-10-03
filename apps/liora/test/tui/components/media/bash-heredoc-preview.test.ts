import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';
import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import { SubAgentEventHandler } from '#/tui/controllers/subagent-event/handler';
import type { SessionEventHost } from '#/tui/controllers/session-event/handler';
import type { Event } from '@superliora/sdk';
import { appendStreamingArgsPreview } from '#/tui/utils/event-payload';
import { formatBashHeredocPreview } from '#/tui/components/media/bash-heredoc-preview';
import { highlightLines } from '#/tui/components/media/code-highlight';
import { COMMAND_PREVIEW_LINES } from '#/tui/constant/rendering';
import { STREAMING_ARGS_PREVIEW_MAX_BYTES } from '#/tui/constant/streaming';
import { buildStreamingCallPreviewComponents } from '#/tui/components/messages/tool-call/call-preview-body';
import { ToolCallSubagentState } from '#/tui/components/messages/tool-call/subagent-state';
import { ShellExecutionComponent } from '#/tui/components/messages/shell/shell-execution';
import { buildSingleSubagentBlockComponents } from '#/tui/components/messages/tool-call/subagent-block';

const strip = (text: string): string => text.replaceAll(/\u001B\[[0-9;]*m/g, '');
const render = (components: { render(width: number): string[] }[]): string =>
  components.flatMap((component) => component.render(160)).map(strip).join('\n');

describe('bash heredoc command previews', () => {
  beforeEach(() => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
  });
  afterEach(() => {
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('highlights literal redirected source using the existing language renderer', () => {
    const code = 'const answer = 42;';
    const lines = formatBashHeredocPreview(`cat > 'example.ts' <<'EOF'\n${code}\nEOF`)!;
    expect(lines[1]).toContain(highlightLines(code, 'typescript')[0]);
    expect(strip(lines.join('\n'))).toContain('not execution output');
    expect(strip(lines.join('\n'))).not.toContain('echo done');
  });

  it.each([
    ['python', 'python', 'print("hello")'],
    ['python3', 'python', 'from pathlib import Path; Path("example.ts").write_text("hello")'],
    ['node', 'javascript', 'const answer = 42;'],
  ])('highlights %s stdin as script input without inferring its file operations', (interpreter, language, code) => {
    const lines = formatBashHeredocPreview(`${interpreter} - <<'CODE'\n${code}\nCODE`)!;
    expect(lines[1]).toContain(highlightLines(code, language)[0]);
    expect(strip(lines.join('\n'))).toContain('script input; not execution output');
    expect(strip(lines.join('\n'))).not.toContain('wrote');
  });

  it('highlights apply_patch input as a patch, not an applied diff', () => {
    const patch = '+const answer = 42;';
    const lines = formatBashHeredocPreview(`apply_patch <<'PATCH'\n${patch}\nPATCH`)!;
    expect(lines[1]).toContain(highlightLines(patch, 'diff')[0]);
    expect(strip(lines.join('\n'))).toContain('patch input; not execution output');
  });

  it('shows the live tail of an incomplete body and handles tab-stripping delimiters', () => {
    const body = Array.from({ length: 40 }, (_, i) => `const value${i} = ${i};`);
    const lines = formatBashHeredocPreview(`cat <<-'EOF' > example.ts\n${body.join('\n')}\n\tEOF`)!;
    const plain = strip(lines.join('\n'));
    expect(lines).toHaveLength(COMMAND_PREVIEW_LINES + 1);
    expect(plain).toContain('value39');
    expect(plain).not.toContain('value0');
    expect(plain).not.toContain('EOF');
  });

  it('leaves ordinary, ambiguous and dynamic commands on the shell rendering path', () => {
    for (const command of ['echo hello', 'echo "<<EOF"\ntext', 'cat <<$END\ntext', 'cat "<<EOF"\ntext', 'cat <<EOF${suffix}\ntext', 'cat <<A <<B\ntext', 'cat <<EOF\n', 'python3 -c "print(1)" <<PY\ntext', 'node --eval x <<JS\ntext', 'sh <<SH\ntext']) {
      expect(formatBashHeredocPreview(command)).toBeUndefined();
    }
  });

  it('bounds preview input and discloses the byte cap', () => {
    const lines = formatBashHeredocPreview(`cat > example.ts <<EOF\n${'x\n'.repeat(STREAMING_ARGS_PREVIEW_MAX_BYTES)}`)!;
    expect(lines.length).toBeLessThanOrEqual(COMMAND_PREVIEW_LINES + 2);
    expect(strip(lines.join('\n'))).toContain('UTF-8 byte limit reached');
  });

  it.each(['界', '😀'])('bounds final heredoc %s source at a whole UTF-8 code point', (scalar) => {
    const header = 'cat > example.ts <<EOF\n';
    const unitBytes = Buffer.byteLength(scalar);
    const count = Math.floor((STREAMING_ARGS_PREVIEW_MAX_BYTES - Buffer.byteLength(header)) / unitBytes);
    const expected = scalar.repeat(count);
    const command = header + expected + scalar + 'ASCII_AFTER_CAP';
    const lines = formatBashHeredocPreview(command)!;
    const plain = strip(lines.join('\n'));
    expect(plain).toContain(expected);
    expect(plain).not.toContain('ASCII_AFTER_CAP');
    expect(plain).toContain('UTF-8 byte limit reached');
    expect(plain.isWellFormed()).toBe(true);
    expect(Buffer.byteLength(header + expected)).toBeLessThanOrEqual(STREAMING_ARGS_PREVIEW_MAX_BYTES);
  });

  it('updates main-agent previews before JSON arguments finish, reusing the shell node', () => {
    const command = `cat > example.ts <<'EOF'\n${Array.from({ length: 20 }, (_, i) => `const n${i} = ${i};`).join('\n')}`;
    const partial = JSON.stringify({ command }).slice(0, -2);
    const first = buildStreamingCallPreviewComponents({ toolCall: { id: 'bash1', name: 'Bash', args: {} }, streamText: partial, existingShell: undefined });
    const firstOutput = render(first.components);
    expect(firstOutput).toContain('const n19');
    expect(firstOutput.match(/const n19/g)).toHaveLength(1);
    expect(firstOutput).not.toContain('const n0');
    const next = buildStreamingCallPreviewComponents({ toolCall: { id: 'bash1', name: 'Bash', args: {} }, streamText: JSON.stringify({ command: 'echo done' }), existingShell: first.shell });
    expect(next.shell).toBe(first.shell);
    expect(render(next.components)).not.toContain('INPUT · Bash heredoc');
    expect(render(next.components)).toContain('echo done');
  });

  it('keeps growing command and heredoc nodes before actual output', () => {
    const shell = new ShellExecutionComponent({ command: 'cat > example.ts <<EOF', showCommand: true });
    shell.setResultOutput('ACTUAL OUTPUT');
    shell.setCommand('cat > example.ts <<EOF\nconst first = 1;', 2);
    shell.setCommand('cat > example.ts <<EOF\nconst first = 1;\nconst second = 2;', 3);
    const output = render([shell]);
    expect(output.indexOf('INPUT · Bash heredoc')).toBeLessThan(output.indexOf('const second'));
    expect(output.match(/const second/g)).toHaveLength(1);
    expect(output.match(/const first/g)).toHaveLength(1);
    expect(output.lastIndexOf('const second')).toBeLessThan(output.indexOf('ACTUAL OUTPUT'));
  });

  it('uses the same bounded live preview for subagent activity', () => {
    const state = new ToolCallSubagentState();
    state.appendSubToolCallDelta({ id: 'child', name: 'Bash', argumentsPart: JSON.stringify({ command: "cat > example.ts <<'EOF'\nconst child = 1;" }).slice(0, -2) });
    const output = render(buildSingleSubagentBlockComponents({
      toolCallId: 'parent', workspaceDir: undefined,
      activities: [...state.subToolActivities.values()],
      derivedSubagentPhase: 'running', subagentError: undefined, subagentText: '', subagentThinkingText: '',
    }));
    expect(output).toContain('not execution output');
    expect(output).toContain('const child = 1;');
  });
  it('reuses source Text nodes and removes them without moving actual output', () => {
    const shell = new ShellExecutionComponent({ command: 'cat > example.ts <<EOF\nconst first = 1;', showCommand: true });
    shell.setResultOutput('ACTUAL OUTPUT');
    const [commandNode, labelNode, sourceNode, outputNode] = shell.children;
    shell.setCommand('cat > example.ts <<EOF\nconst first = 1;\nconst second = 2;', 3);
    expect(shell.children[0]).toBe(commandNode);
    expect(shell.children[1]).toBe(labelNode);
    expect(shell.children[2]).toBe(sourceNode);
    expect(shell.children.at(-1)).toBe(outputNode);
    shell.setCommand('echo first\necho second\necho third', 3);
    expect(shell.children).not.toContain(labelNode);
    expect(shell.children).not.toContain(sourceNode);
    expect(shell.children.at(-1)).toBe(outputNode);
    expect(render([shell]).indexOf('echo third')).toBeLessThan(render([shell]).indexOf('ACTUAL OUTPUT'));
  });

  it.each([false, true])('renders delivered child deltas on an attached card with runInBackground=%s', (runInBackground) => {
    const parent = new ToolCallComponent({ id: 'parent', name: 'SessionControl', args: { operation: 'spawn', description: 'worker' } }, undefined);
    const host = {
      btwPanelController: { routeEvent: () => false },
      streamingUI: { getToolComponent: (id: string) => id === 'parent' ? parent : undefined },
    } as unknown as SessionEventHost;
    const handler = new SubAgentEventHandler(host, {
      backgroundTasks: new Map(), backgroundTaskTranscriptedTerminal: new Set(), syncBackgroundAgentBadge: () => {},
    });
    handler.subagentInfo.set('worker', { parentToolCallId: 'parent', name: 'worker', runInBackground });
    // Exercise detached phase too, but deliberately retain the parent card.
    // This proves rendering of delivered events, not background event delivery.
    if (runInBackground) parent.markBackgrounded();
    const command = "node - <<'JS'\nconst workerSource = 42;";
    const json = JSON.stringify({ command });
    const prefix = json.indexOf('42');
    for (const argumentsPart of [json.slice(0, prefix), json.slice(prefix, -2)]) {
      expect(handler.routeChildAgentEvent({ type: 'tool.call.delta', agentId: 'worker', toolCallId: 'child', name: 'Bash', argumentsPart } as Event)).toBe(true);
    }
    const live = render([parent]);
    expect(live).toContain('INPUT · Bash heredoc');
    expect(live).toContain('const workerSource = 42;');
    expect(live).not.toContain('wrote');
    handler.routeChildAgentEvent({ type: 'tool.progress', agentId: 'worker', toolCallId: 'child', update: { kind: 'stdout', text: 'ACTUAL WORKER OUTPUT' } } as Event);
    const output = render([parent]);
    expect(output.indexOf('const workerSource')).toBeLessThan(output.indexOf('ACTUAL WORKER OUTPUT'));
    handler.routeChildAgentEvent({ type: 'tool.result', agentId: 'worker', toolCallId: 'child', output: 'done', isError: false } as Event);
    expect(render([parent])).not.toContain('INPUT · Bash heredoc');
  });

  it('shows the tail of the bounded JSON prefix, not source received after the args cap', () => {
    const command = 'cat > example.ts <<EOF\n' + 'const padding = 1;\n'.repeat(5000) + 'SOURCE_AFTER_CAP';
    const json = JSON.stringify({ command });
    const prefix = appendStreamingArgsPreview(undefined, json);
    expect(prefix).toHaveLength(STREAMING_ARGS_PREVIEW_MAX_BYTES);
    const first = buildStreamingCallPreviewComponents({ toolCall: { id: 'cap', name: 'Bash', args: {} }, streamText: prefix, existingShell: undefined });
    expect(render(first.components)).toContain('const padding');
    expect(render(first.components)).not.toContain('SOURCE_AFTER_CAP');
    const capped = appendStreamingArgsPreview(prefix, 'MORE_SOURCE_AFTER_CAP');
    expect(capped).toBe(prefix);
    const state = new ToolCallSubagentState();
    state.appendSubToolCallDelta({ id: 'child', name: 'Bash', argumentsPart: json });
    const before = state.subToolActivities.get('child')?.args['command'];
    state.appendSubToolCallDelta({ id: 'child', argumentsPart: 'MORE_SOURCE_AFTER_CAP' });
    expect(state.subToolActivities.get('child')?.args['command']).toBe(before);
    expect(before).not.toContain('SOURCE_AFTER_CAP');
  });

  it.each(['Write', 'Edit', 'Other'])('does not project %s input as Bash source', (name) => {
    const command = 'cat > example.ts <<EOF\nconst notBash = 1;';
    expect(buildStreamingCallPreviewComponents({ toolCall: { id: name, name, args: {} }, streamText: JSON.stringify({ command }), existingShell: undefined }).components).toEqual([]);
    const state = new ToolCallSubagentState();
    state.appendSubToolCallDelta({ id: name, name, argumentsPart: JSON.stringify({ command }).slice(0, -2) });
    const output = render(buildSingleSubagentBlockComponents({ toolCallId: 'parent', workspaceDir: undefined, activities: [...state.subToolActivities.values()], derivedSubagentPhase: 'running', subagentError: undefined, subagentText: '', subagentThinkingText: '' }));
    expect(output).not.toContain('INPUT · Bash heredoc');
  });

  it('clears command and source nodes on an empty command, retaining actual output', () => {
    const shell = new ShellExecutionComponent({ command: 'cat > example.ts <<EOF\nconst stale = 1;', showCommand: true });
    shell.setResultOutput('ACTUAL OUTPUT');
    const resultNode = shell.children.at(-1);
    shell.setCommand('', 3);
    expect(shell.children).toEqual([resultNode]);
    expect(render([shell])).toContain('ACTUAL OUTPUT');
    expect(render([shell])).not.toContain('INPUT');
    expect(render([shell])).not.toContain('stale');
    shell.setCommand('cat > example.ts <<EOF\nconst fresh = 2;', 3);
    expect(render([shell]).indexOf('const fresh')).toBeLessThan(render([shell]).indexOf('ACTUAL OUTPUT'));
  });

  it('decodes split escaped JSON newlines and Unicode before the string closes', () => {
    const state = new ToolCallSubagentState();
    const prefix = '{"command":"cat > example.ts <<EOF\\nconst word = \\"';
    state.appendSubToolCallDelta({ id: 'escaped', name: 'Bash', argumentsPart: prefix + '\\u03' });
    expect(state.subToolActivities.get('escaped')?.args['command']).toBe('cat > example.ts <<EOF\nconst word = "');
    state.appendSubToolCallDelta({ id: 'escaped', argumentsPart: 'bb\\";\\nconst next = 2;' });
    expect(state.subToolActivities.get('escaped')?.args['command']).toBe('cat > example.ts <<EOF\nconst word = "λ";\nconst next = 2;');
  });

  it('falls back to shell rendering rather than hiding commands after the delimiter', () => {
    const command = 'cat > example.ts <<EOF\nconst input = 1;\nEOF\nrm example.ts\necho done';
    expect(formatBashHeredocPreview(command)).toBeUndefined();
    const shell = new ShellExecutionComponent({ command, showCommand: true });
    const output = render([shell]);
    expect(output).toContain('rm example.ts');
    expect(output).toContain('echo done');
    expect(output).not.toContain('INPUT · Bash heredoc');
    expect(formatBashHeredocPreview('cat > example.ts <<EOF\nconst input = 1;\nEOF\n  \n')).toBeDefined();
  });

  it('consumes a child delta without creating a preview when its parent card is missing', () => {
    const parent = new ToolCallComponent({ id: 'parent', name: 'SessionControl', args: { operation: 'spawn' } }, undefined);
    const host = {
      btwPanelController: { routeEvent: () => false },
      streamingUI: { getToolComponent: () => undefined },
    } as unknown as SessionEventHost;
    const handler = new SubAgentEventHandler(host, {
      backgroundTasks: new Map(), backgroundTaskTranscriptedTerminal: new Set(), syncBackgroundAgentBadge: () => {},
    });
    handler.subagentInfo.set('worker', { parentToolCallId: 'parent', name: 'worker', runInBackground: true });
    const before = render([parent]);
    expect(handler.routeChildAgentEvent({ type: 'tool.call.delta', agentId: 'worker', toolCallId: 'child', name: 'Bash', argumentsPart: JSON.stringify({ command: 'node - <<JS\nconst missing = 1;' }).slice(0, -2) } as Event)).toBe(true);
    expect(render([parent])).toBe(before);
    expect(render([parent])).not.toContain('INPUT · Bash heredoc');
  });

});
