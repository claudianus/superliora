import type {
  ContextComposition,
  SessionStatus,
  SessionUsage,
} from '@superliora/sdk';

import type { ManagedUsageReport } from '../../components/messages/usage-panel/index';
import { isManagedUsageProvider } from '../../constant/liora-tui';
import { formatErrorMessage } from '../../utils/event-payload';
import { type LoopModelRoutingConfig } from '#/tui/utils/model/loop-model-routing';
import type { SlashCommandHost } from '../hub/dispatch';
import { filterToolsForPrimaryHelp } from '#/tui/utils/tool/tool-help-filter';

export interface SessionUsageResult {
  readonly usage?: SessionUsage;
  readonly error?: string;
}

export interface RuntimeStatusResult {
  readonly status?: SessionStatus;
  readonly error?: string;
}

export interface ManagedUsageResult {
  readonly usage?: ManagedUsageReport;
  readonly error?: string;
}

export interface LoopModelRoutingResult {
  readonly config?: LoopModelRoutingConfig;
  readonly error?: string;
}

export async function loadSessionUsageReport(host: SlashCommandHost): Promise<SessionUsageResult> {
  try {
    return { usage: await host.requireSession().getUsage() };
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
}

export async function loadContextComposition(
  host: SlashCommandHost,
): Promise<ContextComposition | undefined> {
  try {
    const session = host.requireSession();
    if (typeof session.getContextComposition !== 'function') return undefined;
    return await session.getContextComposition();
  } catch {
    return undefined;
  }
}

export async function loadActiveToolNames(host: SlashCommandHost): Promise<readonly string[] | undefined> {
  const session = host.session;
  if (session === undefined || typeof session.getTools !== 'function') return undefined;
  try {
    const tools = await session.getTools();
    return filterToolsForPrimaryHelp(tools.filter((tool) => tool.active)).map((tool) => tool.name);
  } catch {
    return undefined;
  }
}

export async function loadRuntimeStatusReport(host: SlashCommandHost): Promise<RuntimeStatusResult> {
  try {
    return { status: await host.requireSession().getStatus() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadLoopModelRouting(host: SlashCommandHost): Promise<LoopModelRoutingResult> {
  try {
    return {
      config: (await host.harness.getConfig({ reload: true })) as LoopModelRoutingConfig,
    };
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
}

export async function loadManagedUsageReport(host: SlashCommandHost): Promise<ManagedUsageResult | undefined> {
  const alias = host.state.appState.model;
  const providerKey = host.state.appState.availableModels[alias]?.provider;
  if (!isManagedUsageProvider(providerKey)) return undefined;

  const auth = host.harness.auth as {
    getManagedUsageForAllAccounts?: (
      providerName?: string,
    ) => Promise<
      readonly {
        readonly accountKey: string;
        readonly label?: string;
        readonly isPrimary: boolean;
        readonly kind: 'ok' | 'error';
        readonly summary?: ManagedUsageReport['summary'];
        readonly limits?: ManagedUsageReport['limits'];
        readonly message?: string;
      }[]
    >;
    getManagedUsage: (providerName?: string) => Promise<{
      readonly kind: 'ok' | 'error';
      readonly summary?: ManagedUsageReport['summary'];
      readonly limits?: ManagedUsageReport['limits'];
      readonly message?: string;
    }>;
  };

  try {
    if (typeof auth.getManagedUsageForAllAccounts === 'function') {
      const accounts = await auth.getManagedUsageForAllAccounts(providerKey);
      if (accounts.length === 0) {
        return { usage: { summary: null, limits: [], accounts: [] } };
      }

      const mapped = accounts.map((account) => {
        if (account.kind === 'ok') {
          return {
            accountKey: account.accountKey,
            ...(account.label === undefined ? {} : { label: account.label }),
            isPrimary: account.isPrimary,
            summary: account.summary ?? null,
            limits: account.limits ?? [],
            status: 'ok' as const,
          };
        }
        return {
          accountKey: account.accountKey,
          ...(account.label === undefined ? {} : { label: account.label }),
          isPrimary: account.isPrimary,
          summary: null,
          limits: [],
          error: account.message ?? 'Failed to load usage.',
          status: 'error' as const,
        };
      });

      const primaryOk = mapped.find((account) => account.isPrimary && account.status === 'ok');
      const firstOk = mapped.find((account) => account.status === 'ok');
      const summarySource = primaryOk ?? firstOk;
      return {
        usage: {
          summary: summarySource?.summary ?? null,
          limits: summarySource?.limits ?? [],
          accounts: mapped,
        },
      };
    }

    const res = await auth.getManagedUsage(providerKey);
    if (res.kind === 'error') {
      return { error: res.message ?? 'Failed to load usage.' };
    }
    return {
      usage: {
        summary: res.summary ?? null,
        limits: res.limits ?? [],
      },
    };
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
}
