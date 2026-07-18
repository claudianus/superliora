/**
 * `/accounts` — manage non-Kimi OAuth account pools (list / promote / label / remove).
 *
 * Config mutations use pure helpers from `@superliora/oauth` so CLI and TUI share
 * the same `oauth` + `oauths[]` rewrite rules.
 */

import {
  isValidProviderOAuthCredentialLabel,
  labelProviderOAuthRef,
  listProviderOAuthRefs,
  promoteProviderOAuthRef,
  removeProviderOAuthRef,
  type ProviderOAuthRef,
} from '@superliora/oauth';

import {
  AccountActionPickerComponent,
  AccountLabelInputComponent,
  AccountRemoveConfirmComponent,
  AccountsListPickerComponent,
  AccountsProviderPickerComponent,
  buildOAuthAccountPoolRows,
  formatOAuthAccountDisplayLabel,
  type AccountAction,
  type AccountPoolRow,
} from '../components/dialogs/accounts-manager';
import type { SlashCommandHost } from './dispatch';

interface OAuthProviderPool {
  readonly providerId: string;
  readonly provider: Record<string, unknown>;
  readonly refs: readonly ProviderOAuthRef[];
}

async function loadOAuthProviderPools(host: SlashCommandHost): Promise<OAuthProviderPool[]> {
  const config = await host.harness.getConfig({ reload: true });
  const pools: OAuthProviderPool[] = [];
  for (const [providerId, raw] of Object.entries(config.providers ?? {})) {
    const provider = raw as Record<string, unknown>;
    const refs = listProviderOAuthRefs(provider);
    if (refs.length === 0) continue;
    pools.push({ providerId, provider, refs });
  }
  pools.sort((left, right) => left.providerId.localeCompare(right.providerId));
  return pools;
}

async function refreshHostProviders(host: SlashCommandHost): Promise<void> {
  const updated = await host.harness.getConfig({ reload: true });
  host.setAppState({
    availableModels: updated.models ?? {},
    availableProviders: updated.providers ?? {},
  });
}

async function persistProvider(
  host: SlashCommandHost,
  providerId: string,
  nextProvider: Record<string, unknown>,
): Promise<void> {
  const config = await host.harness.getConfig();
  await host.harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: nextProvider,
    },
  });
  await refreshHostProviders(host);
}

function currentModelProviderId(host: SlashCommandHost): string | undefined {
  const model = host.state.appState.model.trim();
  if (model.length === 0) return undefined;
  return host.state.appState.availableModels[model]?.provider;
}

/**
 * `/accounts` entry — also used by Settings → Accounts.
 */
export async function handleAccountsCommand(host: SlashCommandHost): Promise<void> {
  const pools = await loadOAuthProviderPools(host);
  if (pools.length === 0) {
    host.showStatus('No OAuth accounts configured. Use /login to connect a provider.');
    return;
  }

  if (pools.length === 1) {
    showAccountsList(host, pools[0]!.providerId);
    return;
  }

  const currentProvider = currentModelProviderId(host);
  host.mountEditorReplacement(
    new AccountsProviderPickerComponent({
      providers: pools.map((pool) => ({
        id: pool.providerId,
        accountCount: pool.refs.length,
        primaryLabel: formatOAuthAccountDisplayLabel(pool.refs[0]!),
      })),
      currentProviderId:
        currentProvider !== undefined && pools.some((pool) => pool.providerId === currentProvider)
          ? currentProvider
          : undefined,
      onSelect: (providerId) => {
        host.restoreEditor();
        showAccountsList(host, providerId);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

function showAccountsList(host: SlashCommandHost, providerId: string): void {
  void (async () => {
    const pools = await loadOAuthProviderPools(host);
    const pool = pools.find((entry) => entry.providerId === providerId);
    if (pool === undefined || pool.refs.length === 0) {
      host.showStatus(`No OAuth accounts for ${providerId}. Use /login to add one.`);
      return;
    }

    const rows = buildOAuthAccountPoolRows(pool.refs);
    host.mountEditorReplacement(
      new AccountsListPickerComponent({
        providerId,
        rows,
        onSelect: (index) => {
          host.restoreEditor();
          const row = rows[index];
          if (row === undefined) return;
          showAccountActions(host, providerId, row, pool.refs.length);
        },
        onCancel: () => {
          host.restoreEditor();
        },
      }),
    );
  })();
}

function showAccountActions(
  host: SlashCommandHost,
  providerId: string,
  row: AccountPoolRow,
  poolSize: number,
): void {
  host.mountEditorReplacement(
    new AccountActionPickerComponent({
      providerId,
      row,
      onSelect: (action) => {
        host.restoreEditor();
        void runAccountAction(host, providerId, row, poolSize, action);
      },
      onCancel: () => {
        host.restoreEditor();
        showAccountsList(host, providerId);
      },
    }),
  );
}

async function runAccountAction(
  host: SlashCommandHost,
  providerId: string,
  row: AccountPoolRow,
  poolSize: number,
  action: AccountAction,
): Promise<void> {
  switch (action) {
    case 'back':
      showAccountsList(host, providerId);
      return;
    case 'promote':
      await promoteAccount(host, providerId, row);
      return;
    case 'unlabel':
      await unlabelAccount(host, providerId, row);
      return;
    case 'label':
      promptLabel(host, providerId, row);
      return;
    case 'remove':
      confirmRemove(host, providerId, row, poolSize <= 1);
      return;
  }
}

async function promoteAccount(
  host: SlashCommandHost,
  providerId: string,
  row: AccountPoolRow,
): Promise<void> {
  const config = await host.harness.getConfig({ reload: true });
  const provider = config.providers[providerId] as Record<string, unknown> | undefined;
  const result = promoteProviderOAuthRef(provider, row.index);
  if (!result.ok) {
    host.showStatus(
      result.reason === 'empty'
        ? `No OAuth accounts for ${providerId}.`
        : `Account index out of range for ${providerId}.`,
    );
    showAccountsList(host, providerId);
    return;
  }
  if (result.alreadyPrimary) {
    host.showStatus(`${row.displayLabel} is already primary for ${providerId}.`);
    showAccountsList(host, providerId);
    return;
  }
  await persistProvider(host, providerId, result.provider);
  host.showStatus(`Promoted ${row.displayLabel} to primary for ${providerId}.`, 'success');
  showAccountsList(host, providerId);
}

async function unlabelAccount(
  host: SlashCommandHost,
  providerId: string,
  row: AccountPoolRow,
): Promise<void> {
  const config = await host.harness.getConfig({ reload: true });
  const provider = config.providers[providerId] as Record<string, unknown> | undefined;
  const result = labelProviderOAuthRef(provider, row.index, undefined);
  if (!result.ok) {
    host.showStatus(`Could not clear label on ${row.displayLabel}.`);
    showAccountsList(host, providerId);
    return;
  }
  await persistProvider(host, providerId, result.provider);
  host.showStatus(`Cleared label on account for ${providerId}.`, 'success');
  showAccountsList(host, providerId);
}

function promptLabel(host: SlashCommandHost, providerId: string, row: AccountPoolRow): void {
  host.mountEditorReplacement(
    new AccountLabelInputComponent({
      providerId,
      row,
      initialValue: row.ref.label,
      onDone: (result) => {
        host.restoreEditor();
        if (result.kind === 'cancel') {
          showAccountActions(host, providerId, row, row.index + 1);
          return;
        }
        void applyLabel(host, providerId, row, result.value);
      },
    }),
  );
}

async function applyLabel(
  host: SlashCommandHost,
  providerId: string,
  row: AccountPoolRow,
  label: string,
): Promise<void> {
  if (!isValidProviderOAuthCredentialLabel(label)) {
    host.showError('Invalid label. Use letters, digits, _ . - (1–64 chars).');
    promptLabel(host, providerId, row);
    return;
  }
  const config = await host.harness.getConfig({ reload: true });
  const provider = config.providers[providerId] as Record<string, unknown> | undefined;
  const result = labelProviderOAuthRef(provider, row.index, label);
  if (!result.ok) {
    const message =
      result.reason === 'duplicate_label'
        ? `Label “${label}” is already used on this provider.`
        : result.reason === 'invalid_label'
          ? 'Invalid label. Use letters, digits, _ . - (1–64 chars).'
          : `Could not label account for ${providerId}.`;
    host.showError(message);
    showAccountsList(host, providerId);
    return;
  }
  await persistProvider(host, providerId, result.provider);
  host.showStatus(`Labeled account as “${label}” on ${providerId}.`, 'success');
  showAccountsList(host, providerId);
}

function confirmRemove(
  host: SlashCommandHost,
  providerId: string,
  row: AccountPoolRow,
  isLast: boolean,
): void {
  host.mountEditorReplacement(
    new AccountRemoveConfirmComponent({
      providerId,
      row,
      isLast,
      onDone: (result) => {
        host.restoreEditor();
        if (result !== 'confirm') {
          showAccountActions(host, providerId, row, isLast ? 1 : 2);
          return;
        }
        void removeAccount(host, providerId, row);
      },
    }),
  );
}

async function removeAccount(
  host: SlashCommandHost,
  providerId: string,
  row: AccountPoolRow,
): Promise<void> {
  const config = await host.harness.getConfig({ reload: true });
  const provider = config.providers[providerId] as Record<string, unknown> | undefined;
  const result = removeProviderOAuthRef(provider, row.index);
  if (!result.ok) {
    host.showStatus(`Could not remove account for ${providerId}.`);
    showAccountsList(host, providerId);
    return;
  }
  await persistProvider(host, providerId, result.provider);
  if (result.remaining === 0) {
    host.showStatus(`Removed last OAuth account for ${providerId}. Pool is empty.`, 'warning');
    return;
  }
  host.showStatus(`Removed ${row.displayLabel} from ${providerId}.`, 'success');
  showAccountsList(host, providerId);
}

/** Settings → Accounts uses the same entry as `/accounts`. */
export function openAccountsManager(host: SlashCommandHost): void {
  void handleAccountsCommand(host);
}
