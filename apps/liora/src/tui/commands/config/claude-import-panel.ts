/**
 * Extensions hub → Import from Claude Code (skills + MCP).
 */

import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import { formatErrorMessage } from '../../utils/event-payload';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/ui/mount-picker';
import {
  applyClaudeMcpImport,
  applyClaudeSkillsImport,
  CLAUDE_IMPORT_SYMLINK_GUIDANCE_KO,
  discoverClaudeImportApplyPlan,
  formatClaudeImportApplyPreviewKo,
} from '#/utils/claude/claude-import-apply';

import { extensionsReloadAppStatePatch } from '#/tui/components/chrome/footer/footer-badges';

import type { SlashCommandHost } from '../hub/dispatch';

type ImportMode = 'all' | 'skills' | 'mcp' | 'guidance';

export async function showClaudeImportPanel(host: SlashCommandHost): Promise<void> {
  let plan;
  try {
    plan = await discoverClaudeImportApplyPlan(host.requireSession().workDir);
  } catch (error) {
    host.showError(`Claude scan failed: ${formatErrorMessage(error)}`);
    return;
  }

  const preview = formatClaudeImportApplyPreviewKo(plan);
  const hasSkills = plan.skillSources.length > 0;
  const hasMcp = plan.mcpSource !== null && Object.keys(plan.mcpSource.servers).length > 0;

  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Import from Claude Code',
      hint: '↑↓ · Enter · Esc · ~/.claude if present',
      searchable: true,
      options: [
        ...(hasSkills || hasMcp
          ? [
              {
                value: 'all',
                label: 'Import skills + MCP',
                description: preview.split('\n')[1]?.trim() ?? 'Copy into ~/.superliora',
              },
            ]
          : []),
        ...(hasSkills
          ? [
              {
                value: 'skills',
                label: 'Import skills only',
                description: `${String(plan.skillSources.length)} from .claude/skills → ~/.superliora/skills`,
              },
            ]
          : []),
        ...(hasMcp
          ? [
              {
                value: 'mcp',
                label: 'Import MCP only',
                description: `Merge ${String(Object.keys(plan.mcpSource!.servers).length)} servers into ~/.superliora/mcp.json`,
              },
            ]
          : []),
        {
          value: 'guidance',
          label: 'Symlink / manual guidance',
          description: 'Soft link or manual setup without copying.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        void handleImportMode(host, value as ImportMode, plan);
      },
      onCancel: () =>{  dismissPickerDialog(host); },
    }),
    { label: 'Import Claude' },
  );

  for (const line of preview.split('\n')) {
    if (line.trim().length > 0) host.showStatus(line, 'textMuted');
  }
}

async function handleImportMode(
  host: SlashCommandHost,
  mode: ImportMode,
  plan: Awaited<ReturnType<typeof discoverClaudeImportApplyPlan>>,
): Promise<void> {
  if (mode === 'guidance') {
    for (const line of CLAUDE_IMPORT_SYMLINK_GUIDANCE_KO) {
      host.showStatus(line, 'textMuted');
    }
    return;
  }

  const workDir = host.requireSession().workDir;
  const parts: string[] = [];

  if (mode === 'all' || mode === 'skills') {
    if (plan.skillSources.length === 0) {
      host.showStatus('No Claude skills found under .claude/skills.');
    } else {
      try {
        const result = await applyClaudeSkillsImport(plan.skillSources, plan.existingSkillNames);
        if (result.copied.length > 0) {
          parts.push(`skills: ${result.copied.join(', ')}`);
        }
        for (const skip of result.skipped) {
          host.showStatus(`Skipped skill ${skip.name}: ${skip.reason}`, 'textMuted');
        }
      } catch (error) {
        host.showError(`Skills import failed: ${formatErrorMessage(error)}`);
        return;
      }
    }
  }

  if (mode === 'all' || mode === 'mcp') {
    if (plan.mcpSource === null || Object.keys(plan.mcpSource.servers).length === 0) {
      host.showStatus('No Claude MCP config found (~/.claude.json or ~/.claude/mcp.json).');
    } else {
      try {
        const result = await applyClaudeMcpImport(workDir, plan.mcpSource.servers);
        if (result.added.length > 0) {
          parts.push(`MCP: ${result.added.join(', ')} → ${result.destPath}`);
        }
        for (const skip of result.skipped) {
          host.showStatus(`Skipped MCP ${skip.name}: ${skip.reason}`, 'textMuted');
        }
      } catch (error) {
        host.showError(`MCP import failed: ${formatErrorMessage(error)}`);
        return;
      }
    }
  }

  if (parts.length === 0) {
    host.showStatus('Nothing new to import (all skipped or empty).');
    return;
  }

  try {
    await host.requireSession().reloadSession({ forcePluginSessionStartReminder: true });
    host.setAppState(extensionsReloadAppStatePatch());
    host.showStatus(`Claude import applied · ${parts.join(' · ')} · session reloaded.`);
    if (typeof host.refreshDynamicSlashCommands === 'function') {
      await host.refreshDynamicSlashCommands(host.requireSession());
    } else if (typeof host.refreshSkillCommands === 'function') {
      await host.refreshSkillCommands(host.requireSession());
    }
  } catch (error) {
    host.showStatus(
      `Import saved but reload failed: ${formatErrorMessage(error)} · restart or use MCP → Reload.`,
      'warning',
    );
  }
}
