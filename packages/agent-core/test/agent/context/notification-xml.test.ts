import { describe, expect, it } from 'vitest';

import { renderNotificationXml } from '#/agent/context/notification-xml';

describe('native background notification XML', () => {
  it('keeps task identity separate from worker identity and escapes attribute delimiters', () => {
    const xml = renderNotificationXml({
      id: 'n_"1&2',
      category: 'background_task',
      type: 'task.completed',
      source_kind: 'background_task',
      source_id: 'agent-task&1',
      agent_id: 'worker-"2&3',
      title: 'Worker finished',
      severity: 'info',
      body: 'The worker returned its result.',
      children: ['<output-file path="/tmp/a&amp;b/output.log" bytes="1234"/>'],
    });
    expect(xml).toContain('<notification id="n_&quot;1&amp;2"');
    expect(xml).toContain('source_id="agent-task&amp;1"');
    expect(xml).toContain('agent_id="worker-&quot;2&amp;3"');
    expect(xml).toContain('Title: Worker finished');
    expect(xml).toContain('Severity: info');
    expect(xml).toContain('The worker returned its result.');
    expect(xml).toContain('<output-file path="/tmp/a&amp;b/output.log" bytes="1234"/>');
    expect(xml.trimEnd()).toMatch(/<\/notification>$/);
  });

  it.each([undefined, '', 123])('omits unavailable worker identity %j', (agentId) => {
    const xml = renderNotificationXml({
      id: 'bash-completed', category: 'background_task', type: 'task.completed',
      source_kind: 'background_task', source_id: 'bash-1', agent_id: agentId,
    });
    expect(xml).not.toContain('agent_id=');
  });

  it('preserves explicit child blocks in order without rendering unrelated payload fields', () => {
    const xml = renderNotificationXml({
      id: 'bash-completed', category: 'background_task', type: 'task.completed',
      source_kind: 'background_task', source_id: 'bash-1',
      children: ['<output-file/>', '', null, '<usage/>'],
      output_path: '/unrequested/output.log',
    });
    expect(xml.indexOf('<output-file/>')).toBeLessThan(xml.indexOf('<usage/>'));
    expect(xml).not.toContain('null');
    expect(xml).not.toContain('/unrequested/output.log');
  });

  it('accepts one explicit child block without splitting its markup', () => {
    const xml = renderNotificationXml({
      id: 'bash-completed', category: 'background_task', type: 'task.completed',
      source_kind: 'background_task', source_id: 'bash-1', children: '<output-file>details</output-file>',
    });
    expect(xml).toContain('<output-file>details</output-file>');
  });
});
