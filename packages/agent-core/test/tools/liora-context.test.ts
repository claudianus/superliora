import type { Kaos } from '@superliora/kaos';
import { describe, expect, it, vi } from 'vitest';

import {
  LioraContextInputSchema,
  LioraContextTool,
} from '../../src/tools/builtin/context/liora-context';
import type { WorkspaceConfig } from '../../src/tools/support/workspace';
import { createFakeKaos, toolContentString } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;
const workspace: WorkspaceConfig = { workspaceDir: '/workspace', additionalDirs: [] };

function context<Input>(args: Input, toolCallId = 'call_1') {
  return { turnId: '0', toolCallId, args, signal };
}

function makeKaos(files: Readonly<Record<string, string>>): Kaos {
  const paths = Object.keys(files);
  return createFakeKaos({
    iterdir: vi.fn<Kaos['iterdir']>().mockImplementation(async function* iterdir(dir) {
      for (const entry of immediateChildren(paths, dir)) {
        yield entry;
      }
    }),
    stat: vi.fn<Kaos['stat']>().mockImplementation(async (path) => ({
      stMode: directoryExists(paths, path) ? 0o040_755 : 0o100_644,
      stIno: 1,
      stDev: 1,
      stNlink: 1,
      stUid: 1000,
      stGid: 1000,
      stSize: Buffer.byteLength(files[path] ?? '', 'utf8'),
      stAtime: 0,
      stMtime: 0,
      stCtime: 0,
    })),
    readText: vi.fn<Kaos['readText']>().mockImplementation(async (path) => files[path] ?? ''),
  });
}

function immediateChildren(paths: readonly string[], dir: string): string[] {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  const children = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const [child] = path.slice(prefix.length).split('/');
    if (child !== undefined && child.length > 0) children.add(child);
  }
  return [...children].toSorted((a, b) => a.localeCompare(b));
}

function directoryExists(paths: readonly string[], dir: string): boolean {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return paths.some((path) => path.startsWith(prefix));
}

describe('LioraContextTool', () => {
  it('builds a compact evidence packet instead of dumping whole files', async () => {
    const file = [
      'import { parseGoalCommand } from "./goal";',
      '',
      'export function buildUltraworkPrompt(objective: string): string {',
      '  const escapedObjective = objective.replaceAll("<", "&lt;");',
      '  return [',
      '    "<ultrawork_flow>",',
      '    "Kimi Lean Context keeps code exploration compact.",',
      '    escapedObjective,',
      '  ].join("\\n");',
      '}',
      ...Array.from({ length: 80 }, (_, index) => `const unrelated${index} = ${index};`),
    ].join('\n');
    const tool = new LioraContextTool(
      makeKaos({ '/workspace/apps/liora/src/tui/commands/ultrawork-contract.ts': file }),
      workspace,
    );

    expect(LioraContextInputSchema.safeParse({ query: 'Kimi Lean Context' }).success).toBe(true);

    const result = await executeTool(
      tool,
      context({ query: 'Kimi Lean Context', max_files: 3, max_symbols_per_file: 5 }),
    );
    const output = toolContentString(result);

    expect(result.isError).toBeFalsy();
    expect(output).toContain('<liora_context_packet');
    expect(output).toContain('strategy: lean-codegraph');
    expect(output).toContain('knowledge_map: compact-project-map');
    expect(output).toContain('relationship_confidence: EXTRACTED | INFERRED | AMBIGUOUS');
    expect(output).toContain('path_affected_questions: files -> symbols -> tests -> tools -> UX surfaces');
    expect(output).toContain('apps/liora/src/tui/commands/ultrawork-contract.ts');
    expect(output).toContain('buildUltraworkPrompt');
    expect(output).toContain('relationships:');
    expect(output).toContain('import ./goal [EXTRACTED]');
    expect(output).toContain('export buildUltraworkPrompt [EXTRACTED]');
    expect(output).toContain('test_hints:');
    expect(output).toContain('INFERRED apps/liora/src/tui/commands/ultrawork-contract.test.ts');
    expect(output).toContain('Kimi Lean Context keeps code exploration compact');
    expect(output).toContain('estimated_saved_percent:');
    expect(output).not.toContain('objective.replaceAll');
    expect(output.length).toBeLessThan(file.length);
  });

  it('rejects scans that would read sensitive explicit files', async () => {
    const tool = new LioraContextTool(makeKaos({ '/workspace/.env': 'SECRET=1\n' }), workspace);

    const result = await executeTool(tool, context({ paths: ['.env'] }));

    expect(result).toMatchObject({ isError: true });
    expect(toolContentString(result)).toContain('sensitive-file pattern');
  });

  it('skips sensitive files during automatic workspace scans', async () => {
    const files: Record<string, string> = {
      '/workspace/.env.local.ts': 'SECRET=1\n',
      '/workspace/src/visible.ts': 'export function visibleNeedle() { return "needle"; }\n',
    };
    const paths = Object.keys(files);
    const readText = vi.fn<Kaos['readText']>().mockImplementation(async (path) => {
      return files[path] ?? '';
    });
    const tool = new LioraContextTool(
      createFakeKaos({
        iterdir: vi.fn<Kaos['iterdir']>().mockImplementation(async function* iterdir(dir) {
          for (const entry of immediateChildren(paths, dir)) {
            yield entry;
          }
        }),
        stat: vi.fn<Kaos['stat']>().mockImplementation(async (path) => ({
          stMode: directoryExists(paths, path) ? 0o040_755 : 0o100_644,
          stIno: 1,
          stDev: 1,
          stNlink: 1,
          stUid: 1000,
          stGid: 1000,
          stSize: Buffer.byteLength(files[path] ?? '', 'utf8'),
          stAtime: 0,
          stMtime: 0,
          stCtime: 0,
        })),
        readText,
      }),
      workspace,
    );

    const result = await executeTool(tool, context({ query: 'needle' }));
    const output = toolContentString(result);

    expect(result.isError).toBeFalsy();
    expect(output).toContain('src/visible.ts');
    expect(output).not.toContain('.env.local.ts');
    expect(readText).not.toHaveBeenCalledWith('/workspace/.env.local.ts', expect.anything());
  });

  it('keeps automatic query scans focused on source instead of workflow artifacts', async () => {
    const tool = new LioraContextTool(
      makeKaos({
        '/workspace/.super-kimi/evidence/task-8-tool-real-surface.ts': [
          'export function LioraContextEvidence() {',
          '  return "LioraContext LioraContext LioraContext LioraContext";',
          '}',
        ].join('\n'),
        '/workspace/.changeset/ultrawork-flow.md': 'LioraContext release note\n',
        '/workspace/packages/agent-core/src/tools/builtin/context/liora-context.ts': [
          'export class LioraContextTool {',
          '  readonly name = "LioraContext";',
          '}',
        ].join('\n'),
      }),
      workspace,
    );

    const result = await executeTool(tool, context({ query: 'LioraContext', max_files: 1 }));
    const output = toolContentString(result);

    expect(result.isError).toBeFalsy();
    expect(output).toContain('packages/agent-core/src/tools/builtin/context/liora-context.ts');
    expect(output).not.toContain('.super-kimi/evidence');
    expect(output).not.toContain('.changeset');
  });
});
