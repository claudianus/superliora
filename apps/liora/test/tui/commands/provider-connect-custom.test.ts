import { describe, expect, it, vi } from 'vitest';

vi.mock('#/utils/catalog-cache', () => ({
  loadCatalog: vi.fn(async () => undefined),
}));

const { connectCustomEndpoint } = await import(
  '#/tui/commands/provider-connect/custom'
);

function typeText(target: { handleInput(data: string): void }, text: string): void {
  for (const ch of text) target.handleInput(ch);
}

interface CapturedDialog {
  handleInput(data: string): void;
}

function makeHost() {
  const config = { providers: {}, models: {} };
  const dialogBox: { dialog?: CapturedDialog } = {};
  const host = {
    harness: {
      getConfig: vi.fn(async () => config),
      setConfig: vi.fn(async (patch: unknown) => patch),
    },
    authFlow: { refreshConfigAfterLogin: vi.fn(async () => {}) },
    track: vi.fn(),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
    showProgressSpinner: vi.fn(() => ({ stop: vi.fn(), setLabel: vi.fn() })),
    restoreEditor: vi.fn(),
    mountEditorReplacement: vi.fn((dialog: CapturedDialog) => {
      dialogBox.dialog = dialog;
    }),
  };
  return { host, config, dialogBox };
}

/** Drive the real endpoint dialog to submit. */
function submitDialog(
  dialogBox: { dialog?: CapturedDialog },
  fields: { provider: string; url: string; model: string; key?: string },
): void {
  const dialog = dialogBox.dialog;
  if (dialog === undefined) throw new Error('dialog was not mounted');
  typeText(dialog, fields.provider);
  dialog.handleInput('\r');
  typeText(dialog, fields.url);
  dialog.handleInput('\r');
  dialog.handleInput('\r'); // keep default wire type (openai)
  typeText(dialog, fields.model);
  dialog.handleInput('\r');
  if (fields.key !== undefined) typeText(dialog, fields.key);
  dialog.handleInput('\r'); // key -> context
  dialog.handleInput('\r'); // keep default context
  dialog.handleInput('\r'); // leave max output empty
  dialog.handleInput('\r'); // leave headers empty
  dialog.handleInput('\r'); // keep thinking No, submit
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Wait for the model picker (2nd mount) with a bounded poll — never hang 30s. */
async function waitForPicker(
  host: { mountEditorReplacement: unknown },
  timeoutMs = 2000,
): Promise<CapturedDialog> {
  const mounts = host.mountEditorReplacement as ReturnType<typeof vi.fn>;
  const started = Date.now();
  while (mounts.mock.calls.length < 2) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for the model picker mount');
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
  const picker = mounts.mock.calls[1]?.[0] as CapturedDialog | undefined;
  if (picker === undefined) throw new Error('model picker mount captured nothing');
  return picker;
}

describe('connectCustomEndpoint verify-before-save', () => {
  it('blocks the save when the endpoint rejects the key (401)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'invalid key' }, 401)),
    );
    try {
      const { host, dialogBox } = makeHost();
      const pending = connectCustomEndpoint(host as never);
      submitDialog(dialogBox, {
        provider: 't',
        url: 'https://x.test/v1',
        model: 'm',
        key: 'bad-key',
      });
      await expect(pending).resolves.toBe(false);
      expect(host.harness.setConfig).not.toHaveBeenCalled();
      expect(host.showError).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('saves with verified thinking when /models lists the model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ data: [{ id: 'o1-mini', reasoning: true }] }),
      ),
    );
    try {
      const { host, config, dialogBox } = makeHost();
      const pending = connectCustomEndpoint(host as never);
      submitDialog(dialogBox, {
        provider: 't',
        url: 'https://x.test/v1',
        model: 'o1-mini',
        key: 'good-key',
      });
      await expect(pending).resolves.toBe(true);
      expect(host.harness.setConfig).toHaveBeenCalledOnce();
      const models = (config.models ?? {}) as Record<string, { capabilities?: string[] }>;
      expect(models['t/o1-mini']?.capabilities).toContain('thinking');
      expect(host.showStatus).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('saves with a warning when the endpoint is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    try {
      const { host, dialogBox } = makeHost();
      const pending = connectCustomEndpoint(host as never);
      submitDialog(dialogBox, {
        provider: 't',
        url: 'https://down.test/v1',
        model: 'm',
      });
      await expect(pending).resolves.toBe(true);
      expect(host.harness.setConfig).toHaveBeenCalledOnce();
      expect(host.showNotice).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('offers the advertised models when the typed id is not listed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [{ id: 'o1-mini', reasoning: true }, { id: 'o2' }] })),
    );
    try {
      const { host, config, dialogBox } = makeHost();
      const pending = connectCustomEndpoint(host as never);
      submitDialog(dialogBox, {
        provider: 't',
        url: 'https://x.test/v1',
        model: 'o1-mnii',
        key: 'good-key',
      });
      // Let the dialog submit flush, then pick the first advertised model.
      const picker = await waitForPicker(host);
      picker.handleInput('\r');
      await expect(pending).resolves.toBe(true);
      const models = (config.models ?? {}) as Record<string, { capabilities?: string[] }>;
      expect(models['t/o1-mini']?.capabilities).toContain('thinking');
      expect(models['t/o1-mnii']).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the typed id when the model picker is cancelled', async () => {
    const ESC = String.fromCodePoint(27);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [{ id: 'o1-mini' }] })),
    );
    try {
      const { host, config, dialogBox } = makeHost();
      const pending = connectCustomEndpoint(host as never);
      submitDialog(dialogBox, {
        provider: 't',
        url: 'https://x.test/v1',
        model: 'o1-mnii',
        key: 'good-key',
      });
      const picker = await waitForPicker(host);
      picker.handleInput(ESC);
      await expect(pending).resolves.toBe(true);
      const models = (config.models ?? {}) as Record<string, { capabilities?: string[] }>;
      expect(models['t/o1-mnii']).toBeDefined();
      expect(host.showNotice).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
