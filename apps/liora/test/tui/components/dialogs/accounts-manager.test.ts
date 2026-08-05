import { describe, expect, it, vi } from 'vitest';

import {
  AccountActionPickerComponent,
  AccountRemoveConfirmComponent,
  AccountsListPickerComponent,
  ACCOUNTS_PRIMARY_MARK,
  buildOAuthAccountPoolRows,
  formatOAuthAccountRowLine,
  oauthAccountRole,
} from '#/tui/components/dialogs/auth/accounts-manager';
import {
  SETTINGS_OPTIONS,
  SettingsSelectorComponent,
} from '#/tui/components/dialogs/picker/settings-selector';
import type { ProviderOAuthRef } from '@superliora/oauth';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

const SAMPLE_REFS: readonly ProviderOAuthRef[] = [
  { storage: 'file', key: 'xai-grok', label: 'work' },
  { storage: 'file', key: 'xai-grok-account-abc' },
];

/** Filter the searchable settings picker until `needle` shows in the rendered lines. */
function pageThrough(
  settings: SettingsSelectorComponent,
  needle: string,
  maxSteps = 60,
): string[] {
  let out = settings.render(120).map(strip);
  // Searchable picker: type the needle so grid pagination cannot hide it.
  for (const ch of needle.toLowerCase()) {
    if (out.some((line) => line.includes(needle))) break;
    settings.handleInput(ch);
    out = settings.render(120).map(strip);
  }
  for (let step = 0; step < maxSteps && !out.some((line) => line.includes(needle)); step++) {
    settings.handleInput('\u001B[6~');
    out = settings.render(120).map(strip);
  }
  return out;
}

describe('accounts-manager dialogs', () => {
  it('builds PREMIUM rows with label · role · fingerprint', () => {
    const rows = buildOAuthAccountPoolRows(SAMPLE_REFS);
    expect(rows).toHaveLength(2);
    expect(oauthAccountRole(0)).toBe('primary');
    expect(oauthAccountRole(1)).toBe('fallback');
    expect(rows[0]!.displayLabel).toBe('work');
    // Unlabeled accounts never show the raw storage key — fingerprint short tag only.
    expect(rows[1]!.displayLabel).toMatch(/^account [a-f0-9]{6}$/);
    expect(rows[1]!.displayLabel).not.toContain('xai-grok-account-abc');
    expect(rows[0]!.line).toBe(
      formatOAuthAccountRowLine({
        displayLabel: 'work',
        role: 'primary',
        fingerprint: rows[0]!.fingerprint,
      }),
    );
    expect(rows[0]!.line).toMatch(/work · primary · [a-f0-9]{12}/);
    expect(rows[1]!.line).toMatch(/account [a-f0-9]{6} · fallback · [a-f0-9]{12}/);
    expect(rows[0]!.line).not.toContain('xai-grok');
    expect(rows[1]!.line).not.toContain('xai-grok-account-abc');
  });

  it('renders the account list with primary CURRENT_MARK and role lines', () => {
    const rows = buildOAuthAccountPoolRows(SAMPLE_REFS);
    const picker = new AccountsListPickerComponent({
      providerId: 'xai-grok',
      rows,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const out = picker.render(120).map(strip);
    expect(out.some((line) => line.includes('Accounts · xai-grok'))).toBe(true);
    expect(out.some((line) => line.includes('Proactive refresh'))).toBe(true);
    expect(out.some((line) => line.includes('401/quota'))).toBe(true);
    expect(out.some((line) => line.includes('work · primary'))).toBe(true);
    expect(out.some((line) => line.includes('fallback'))).toBe(true);
    expect(out.some((line) => line.includes(ACCOUNTS_PRIMARY_MARK))).toBe(true);
  });

  it('renders danger remove confirm and action options', () => {
    const rows = buildOAuthAccountPoolRows(SAMPLE_REFS);
    const row = rows[1]!;
    const actions = new AccountActionPickerComponent({
      providerId: 'xai-grok',
      row,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const actionOut = actions.render(120).map(strip);
    expect(actionOut.some((line) => line.includes('Promote to primary'))).toBe(true);
    expect(actionOut.some((line) => line.includes('Remove from pool'))).toBe(true);

    const confirm = new AccountRemoveConfirmComponent({
      providerId: 'xai-grok',
      row,
      isLast: false,
      onDone: vi.fn(),
    });
    const confirmOut = confirm.render(120).map(strip);
    expect(confirmOut.some((line) => line.includes('Remove account'))).toBe(true);
    expect(confirmOut.some((line) => line.includes('Cancel'))).toBe(true);
  });

  it('exposes Accounts in Settings options', () => {
    const settings = new SettingsSelectorComponent({
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const out = pageThrough(settings, 'Accounts');
    expect(out.some((line) => line.includes('Accounts'))).toBe(true);
    // Grid shows only the selected cell's description; verify the catalog link instead.
    const accounts = SETTINGS_OPTIONS.find((opt) => opt.value === 'accounts');
    expect(accounts?.description).toMatch(/OAuth pools/);
  });

  it('exposes Eyes readiness in Settings options', () => {
    const settings = new SettingsSelectorComponent({
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const out = pageThrough(settings, 'Eyes readiness');
    expect(out.some((line) => line.includes('Eyes readiness'))).toBe(true);
    const eyes = SETTINGS_OPTIONS.find((opt) => opt.value === 'eyes');
    expect(eyes?.description).toMatch(/browser-use|computer-use/);
  });
});
