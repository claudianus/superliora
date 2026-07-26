import { describe, expect, it } from 'vitest';

import { renderNotificationXml } from '#/agent/context/notification-xml';

describe('agent/context/notification-xml — renderNotificationXml', () => {
  it('emits the canonical opening tag with the load-bearing "notification " prefix', () => {
    const xml = renderNotificationXml({
      id: 'n-1',
      category: 'background_task',
      type: 'completed',
      source_kind: 'agent',
      source_id: 'agent-abc',
    });
    expect(xml).toContain('<notification id="n-1"');
    expect(xml.trimEnd().endsWith('</notification>')).toBe(true);
  });

  it('uses the literal "unknown" fallback for every missing string attribute', () => {
    const xml = renderNotificationXml({});
    expect(xml).toMatch(/id="unknown"/);
    expect(xml).toMatch(/category="unknown"/);
    expect(xml).toMatch(/type="unknown"/);
    expect(xml).toMatch(/source_kind="unknown"/);
    expect(xml).toMatch(/source_id="unknown"/);
  });

  it('omits the agent_id attribute entirely when the source has no agent_id', () => {
    const xml = renderNotificationXml({
      id: 'n-1',
      category: 'background_task',
      type: 'completed',
      source_kind: 'process',
      source_id: 'proc-1',
    });
    expect(xml).not.toMatch(/agent_id=/);
  });

  it('emits agent_id only when it is a non-empty string', () => {
    const xml = renderNotificationXml({
      id: 'n-1',
      category: 'background_task',
      type: 'completed',
      source_kind: 'agent',
      source_id: 'agent-abc',
      agent_id: 'agent-xyz',
    });
    expect(xml).toContain('agent_id="agent-xyz"');
  });

  it('escapes the double-quote character in attributes (non-empty escaping)', () => {
    const xml = renderNotificationXml({
      id: 'has "quotes"',
      category: 'c',
      type: 't',
      source_kind: 'k',
      source_id: 's',
    });
    // The exact escape ordering is owned by `#/utils/xml-escape`; we only
    // assert that the literal `"` no longer appears inside the id attribute
    // and that some escape artifact replaces it.
    const idMatch = xml.match(/id="([^"]*)"/);
    expect(idMatch).not.toBeNull();
    expect(idMatch?.[1]).not.toContain('"');
  });

  it('emits Title and Severity lines only when non-empty', () => {
    const xml = renderNotificationXml({
      id: 'n-1',
      category: 'c',
      type: 't',
      source_kind: 'k',
      source_id: 's',
      title: 'Heads up',
      severity: 'info',
    });
    expect(xml).toContain('Title: Heads up');
    expect(xml).toContain('Severity: info');
  });

  it('skips Title/Severity/Body when those fields are empty or missing', () => {
    const xml = renderNotificationXml({
      id: 'n-1',
      category: 'c',
      type: 't',
      source_kind: 'k',
      source_id: 's',
    });
    expect(xml).not.toMatch(/Title:/);
    expect(xml).not.toMatch(/Severity:/);
  });

  it('appends the body verbatim when provided', () => {
    const xml = renderNotificationXml({
      id: 'n-1',
      category: 'c',
      type: 't',
      source_kind: 'k',
      source_id: 's',
      body: 'Background task completed successfully.',
    });
    expect(xml).toContain('Background task completed successfully.');
  });

  it('appends a single child block when children is a non-empty string', () => {
    const xml = renderNotificationXml({
      id: 'n-1',
      category: 'c',
      type: 't',
      source_kind: 'k',
      source_id: 's',
      children: '<child>one</child>',
    });
    expect(xml).toContain('<child>one</child>');
  });

  it('appends multiple child blocks when children is a string array', () => {
    const xml = renderNotificationXml({
      id: 'n-1',
      category: 'c',
      type: 't',
      source_kind: 'k',
      source_id: 's',
      children: ['<a/>', '<b/>', ''],
    });
    expect(xml).toContain('<a/>');
    expect(xml).toContain('<b/>');
  });

  it('falls back to extraBlocks when children is missing', () => {
    const xml = renderNotificationXml({
      id: 'n-1',
      category: 'c',
      type: 't',
      source_kind: 'k',
      source_id: 's',
      extraBlocks: ['<fallback/>'],
    });
    expect(xml).toContain('<fallback/>');
  });
});
