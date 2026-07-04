import type { ToolCall } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../../src/agent';
import type { PermissionPolicyContext } from '../../../src/agent/permission';
import { GuiUseSafetyPermissionPolicy } from '../../../src/agent/permission/policies/gui-use-safety';
import { ToolAccesses } from '../../../src/loop';

const signal = new AbortController().signal;

function policyContext(toolName: string, args: unknown): PermissionPolicyContext {
  return {
    turnId: '0',
    stepNumber: 1,
    signal,
    llm: {},
    args,
    toolCall: {
      type: 'function',
      id: `call_${toolName}`,
      name: toolName,
      arguments: JSON.stringify(args),
    } satisfies ToolCall,
    toolCalls: [
      {
        type: 'function',
        id: `call_${toolName}`,
        name: toolName,
        arguments: JSON.stringify(args),
      },
    ],
    execution: {
      accesses: ToolAccesses.all(),
      approvalRule: toolName,
      execute: async () => ({ output: '' }),
    },
  } as unknown as PermissionPolicyContext;
}

function policy(hasApprovalSurface: boolean): GuiUseSafetyPermissionPolicy {
  return new GuiUseSafetyPermissionPolicy({
    rpc: hasApprovalSurface ? { requestApproval: vi.fn() } : undefined,
  } as unknown as Agent);
}

describe('GuiUseSafetyPermissionPolicy', () => {
  it('lets ordinary browser ref actions fall through to the current permission mode', () => {
    expect(
      policy(false).evaluate(policyContext('BrowserAct', {
        actions: [{ type: 'click_ref', ref: '@e1' }],
      })),
    ).toBeUndefined();
  });

  it('asks for high-risk desktop shortcuts when an approval surface exists', () => {
    expect(
      policy(true).evaluate(policyContext('ComputerAct', {
        actions: [{ type: 'press_keys', keys: 'Cmd+Q' }],
      })),
    ).toMatchObject({
      kind: 'ask',
      reason: {
        gui_use: true,
        gui_use_risk: 'computer_risky_shortcut',
        approval_surface: true,
      },
    });
  });

  it('denies high-risk desktop shortcuts without an approval surface', () => {
    expect(
      policy(false).evaluate(policyContext('ComputerAct', {
        actions: [{ type: 'press_keys', keys: 'Cmd+Q' }],
      })),
    ).toMatchObject({
      kind: 'deny',
      reason: {
        gui_use: true,
        gui_use_risk: 'computer_risky_shortcut',
        approval_surface: false,
      },
    });
  });

  it('hard-blocks irreversible system commands', () => {
    expect(
      policy(true).evaluate(policyContext('ComputerAct', {
        actions: [{ type: 'type_text', text: 'shutdown -h now' }],
      })),
    ).toMatchObject({
      kind: 'deny',
      reason: {
        gui_use: true,
        gui_use_risk: 'computer_hard_blocked_text',
        blocked: true,
      },
    });
  });

  it('asks before entering credential-like text into GUI surfaces', () => {
    expect(
      policy(true).evaluate(policyContext('BrowserAct', {
        actions: [{ type: 'type_text', text: 'api_key=sk-example000000000000000000' }],
      })),
    ).toMatchObject({
      kind: 'ask',
      reason: {
        gui_use: true,
        gui_use_risk: 'browser_sensitive_text',
      },
    });
  });

  it('blocks unsafe browser console eval even in automatic modes', () => {
    expect(
      policy(true).evaluate(policyContext('BrowserConsole', {
        expression: 'localStorage.getItem("token")',
      })),
    ).toMatchObject({
      kind: 'deny',
      reason: {
        gui_use: true,
        gui_use_risk: 'browser_console_unsafe_eval',
        blocked: true,
      },
    });
  });
});
