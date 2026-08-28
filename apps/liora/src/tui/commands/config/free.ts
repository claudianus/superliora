import { SMART_AUTO_SESSION_ALIAS } from '@superliora/sdk';
import { getStaleFreeAliasDeletePaths } from '../../../utils/migrate-stale-free-models';
import { loadCatalog } from '../../../utils/catalog-cache';
import { formatErrorMessage } from '../../utils/event-payload';
import { ttui } from '../../utils/tui-i18n';
import type { SlashCommandHost } from '../hub/dispatch';

export async function handleFreeCommand(host: SlashCommandHost, args: string): Promise<void> {
  const raw = args.trim().toLowerCase();
  if (raw === 'status' || raw.length === 0) {
    try {
      const config = await host.harness.getConfig({ reload: true });
      const enabled = Boolean((config as { freeMode?: boolean }).freeMode);
      host.showStatus(
        enabled ? ttui('tui.free.statusOn') : ttui('tui.free.statusOff'),
        enabled ? 'success' : 'info',
      );
      if (enabled) {
        host.showNotice(ttui('tui.free.statusOnTitle'), ttui('tui.free.statusOnDetail'));
      }
    } catch (error) {
      host.showError(formatErrorMessage(error));
    }
    return;
  }

  let desired: boolean | undefined;
  if (['on', 'enable', 'enabled', 'true', '1', 'yes', 'free'].includes(raw)) desired = true;
  else if (['off', 'disable', 'disabled', 'false', '0', 'no'].includes(raw)) desired = false;
  else {
    host.showError(ttui('tui.free.usage'));
    return;
  }

  try {
    const config = await host.harness.getConfig({ reload: true });
    const current = Boolean((config as { freeMode?: boolean }).freeMode);
    if (current === desired) {
      host.showStatus(desired ? ttui('tui.free.alreadyOn') : ttui('tui.free.alreadyOff'), 'info');
      return;
    }
    await host.harness.setConfig({ freeMode: desired } as Record<string, unknown>);
    // On toggle, clear stale in-memory route cooldowns so the next turn does
    // not inherit a previous `all free failed probe` state from the other mode.
    try {
      await host.session?.resetProviderRouteStatus();
    } catch {
      // best-effort
    }
    if (desired) {
      // Prune stale free aliases that are no longer in the live catalog (best-effort)
      try {
        const catalog = await loadCatalog().catch(() => undefined);
        if (catalog !== undefined) {
          const afterForPrune = await host.harness.getConfig({ reload: true });
          const pruned = getStaleFreeAliasDeletePaths(afterForPrune, catalog);
          if (pruned !== undefined && pruned.deletePaths.length > 0) {
            await host.harness.deleteConfigFields([...pruned.deletePaths]);
            // Also ensure session model is not pointing at a deleted alias.
            if (pruned.clearDefaultModel && host.state.appState.model !== SMART_AUTO_SESSION_ALIAS) {
              try { await host.session?.setModel(SMART_AUTO_SESSION_ALIAS); } catch {}
            }
          }
        }
      } catch {
        // best-effort
      }
      // Ensure main session also routes to free models: if default is a concrete paid alias, switch to Smart Auto
      try {
        const after = (await host.harness.getConfig({ reload: true })) as {
          defaultModel?: string;
          freeMode?: boolean;
          models?: Record<string, { provider: string; model: string; cost?: { input?: number } }>;
          providers?: Record<string, { apiKey?: string; oauth?: unknown; apiKeys?: string[] }>;
        };
        const def = after.defaultModel?.trim();
        const isPaidConcrete =
          def !== undefined &&
          def.length > 0 &&
          def.toLowerCase() !== SMART_AUTO_SESSION_ALIAS &&
          (() => {
            const entry = after.models?.[def];
            if (entry === undefined) return true; // unknown alias -> treat as paid (needs auto)
            const id = entry.model?.toLowerCase() ?? '';
            const alias = def.toLowerCase();
            const isFree = alias.includes('-free') || id.includes('-free') || (entry.cost?.input ?? -1) === 0;
            return !isFree;
          })();
        if (isPaidConcrete) {
          await host.harness.setConfig({ defaultModel: SMART_AUTO_SESSION_ALIAS } as Record<string, unknown>);
          // Also set session model if live
          if (host.state.appState.model !== SMART_AUTO_SESSION_ALIAS) {
            try {
              await host.session?.setModel(SMART_AUTO_SESSION_ALIAS);
            } catch {
              // ignore session error - config already flipped
            }
          }
          host.showNotice(ttui('tui.free.enabledTitle'), `${ttui('tui.free.enabledDetail')} (default_model → auto for free routing)`);
        }
        // Immediate validation: no free alias at all -> warn before the next message errors
        const hasFreeAlias = Object.entries(after.models ?? {}).some(([alias, m]) => {
          const a = alias.toLowerCase();
          const id = (m.model ?? '').toLowerCase();
          return a.includes('-free') || id.includes('-free') || (m.cost?.input ?? -1) === 0;
        });
        if (!hasFreeAlias) {
          host.showNotice(ttui('tui.free.noFreeModelsTitle'), ttui('tui.free.noFreeModelsDetail'));
        } else {
          // Also check healthy free (provider has credential)
          const hasHealthyFree = Object.entries(after.models ?? {}).some(([alias, m]) => {
            const a = alias.toLowerCase();
            const id = (m.model ?? '').toLowerCase();
            const isFree = a.includes('-free') || id.includes('-free') || (m.cost?.input ?? -1) === 0;
            if (!isFree) return false;
            const prov = after.providers?.[m.provider];
            if (prov === undefined) return false;
            const hasKey = typeof prov.apiKey === 'string' && prov.apiKey.trim().length > 0;
            const hasKeys = Array.isArray(prov.apiKeys) && prov.apiKeys.length > 0;
            const hasOauth = prov.oauth !== undefined;
            return hasKey || hasKeys || hasOauth;
          });
          if (!hasHealthyFree) {
            host.showNotice(ttui('tui.free.noFreeModelsTitle'), ttui('tui.free.noFreeModelsDetail'));
          }
        }
      } catch {
        // ignore
      }
      host.showStatus(ttui('tui.free.enabled'), 'success');
      host.showNotice(ttui('tui.free.enabledTitle'), ttui('tui.free.enabledDetail'));
    } else {
      host.showStatus(ttui('tui.free.disabled'), 'success');
      host.showNotice(ttui('tui.free.disabledTitle'), ttui('tui.free.disabledDetail'));
    }
  } catch (error) {
    host.showError(ttui('tui.free.setFailed', { message: formatErrorMessage(error) }));
  }
}
