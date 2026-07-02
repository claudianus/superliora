import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CuaComputerRuntime } from '../src/computer/cua-computer';

const tempDirs: string[] = [];
const require = createRequire(import.meta.url);
const mcpServerIndexUrl = pathToFileURL(
  require.resolve('@modelcontextprotocol/sdk/server/index.js'),
).href;
const mcpServerStdioUrl = pathToFileURL(
  require.resolve('@modelcontextprotocol/sdk/server/stdio.js'),
).href;
const mcpTypesUrl = pathToFileURL(
  require.resolve('@modelcontextprotocol/sdk/types.js'),
).href;

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('CuaComputerRuntime', () => {
  it('connects to cua-driver MCP and maps health, capture, and action results', async () => {
    const driverCmd = await createFakeCuaDriver();
    const runtime = new CuaComputerRuntime({ driverCmd });
    try {
      const status = await runtime.status();
      expect(status).toMatchObject({
        installed: true,
        ready: true,
        version: 'cua-driver 9.9.9',
        health: { overall: 'ok' },
      });

      const capture = await runtime.capture({ mode: 'som', maxElements: 10 });
      expect(capture).toMatchObject({
        ok: true,
        app: 'FakeApp',
        windowTitle: 'Main',
        elements: [
          {
            index: 1,
            role: 'button',
            name: 'Open',
            bounds: { x: 10, y: 20, width: 30, height: 40 },
          },
        ],
      });
      expect(capture.image?.mimeType).toBe('image/png');

      const act = await runtime.act({ actions: [{ type: 'click_element', element: 1 }] });
      expect(act).toMatchObject({
        ok: true,
        actions: [{ ok: true, action: 'click_element' }],
      });
    } finally {
      await runtime.close();
    }
  });

  it('auto-installs cua-driver on first use when the default driver is missing', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.tmp-cua-driver-bin-'));
    tempDirs.push(dir);
    const oldPath = process.env['PATH'];
    const delimiter = process.platform === 'win32' ? ';' : ':';
    process.env['PATH'] = `${dir}${delimiter}${dirname(process.execPath)}`;
    const install = vi.fn(async () => {
      await writeFakeCuaDriver(join(dir, process.platform === 'win32' ? 'cua-driver.cmd' : 'cua-driver'));
      return { ok: true, code: 0, stdout: '', stderr: '', command: ['install'] };
    });
    const runtime = new CuaComputerRuntime({ install });

    try {
      const status = await runtime.status();

      expect(status).toMatchObject({
        installed: true,
        ready: true,
        version: 'cua-driver 9.9.9',
      });
      expect(install).toHaveBeenCalledTimes(1);
    } finally {
      process.env['PATH'] = oldPath;
      await runtime.close();
    }
  });
});

async function createFakeCuaDriver(): Promise<string> {
  const dir = await mkdtemp(join(process.cwd(), '.tmp-cua-driver-'));
  tempDirs.push(dir);
  const driverPath = join(dir, 'fake-cua-driver.mjs');
  await writeFakeCuaDriver(driverPath);
  return driverPath;
}

async function writeFakeCuaDriver(driverPath: string): Promise<void> {
  if (process.platform === 'win32' && driverPath.endsWith('.cmd')) {
    const scriptPath = driverPath.replace(/\.cmd$/i, '.mjs');
    await writeFile(scriptPath, fakeDriverSource(), 'utf8');
    await writeFile(driverPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8');
    return;
  }
  await writeFile(driverPath, fakeDriverSource(), 'utf8');
  await chmod(driverPath, 0o755);
}

function fakeDriverSource(): string {
  return `#!/usr/bin/env node
const png = 'iVBORw0KGgo=';
const arg = process.argv[2];
if (arg === '--version') {
  console.log('cua-driver 9.9.9');
  process.exit(0);
}
if (arg === 'manifest') {
  console.log(JSON.stringify({ mcp_invocation: { command: process.execPath, args: [process.argv[1], 'mcp'] } }));
  process.exit(0);
}
if (arg !== 'mcp') {
  console.error('unsupported fake cua-driver command');
  process.exit(1);
}

const { Server } = await import(${JSON.stringify(mcpServerIndexUrl)});
const { StdioServerTransport } = await import(${JSON.stringify(mcpServerStdioUrl)});
const { CallToolRequestSchema, ListToolsRequestSchema } = await import(${JSON.stringify(mcpTypesUrl)});

const tools = [
  'health_report',
  'list_windows',
  'get_window_state',
  'click',
].map((name) => ({ name, description: name, inputSchema: { type: 'object', additionalProperties: true } }));

const server = new Server({ name: 'fake-cua-driver', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  if (name === 'health_report') {
    return { content: [{ type: 'text', text: 'ok' }], structuredContent: { overall: 'ok' } };
  }
  if (name === 'list_windows') {
    return {
      content: [{ type: 'text', text: 'windows' }],
      structuredContent: {
        windows: [{
          pid: 123,
          window_id: 456,
          app_name: 'FakeApp',
          title: 'Main',
          z_index: 99,
          is_on_screen: true,
          on_current_space: true
        }]
      }
    };
  }
  if (name === 'get_window_state') {
    return {
      content: [
        { type: 'text', text: 'AXWindow "Main"\\n[1] AXButton id=Open' },
        { type: 'image', data: png, mimeType: 'image/png' }
      ],
      structuredContent: {
        elements: [{
          element_index: 1,
          role: 'button',
          label: 'Open',
          frame: { x: 10, y: 20, w: 30, h: 40 }
        }]
      }
    };
  }
  if (name === 'click') {
    return { content: [{ type: 'text', text: 'clicked' }], structuredContent: { clicked: true } };
  }
  return { content: [{ type: 'text', text: 'unknown tool' }], isError: true };
});
await server.connect(new StdioServerTransport());
process.stdin.resume();
await new Promise((resolve) => process.stdin.on('close', resolve));
`;
}
