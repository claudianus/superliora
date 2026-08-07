import { describe, expect, it } from 'vitest';

import {
  createVerificationSensorLedger,
  observeVerificationToolResult,
} from '../../src/sensors/verification-sensor-ledger';

describe('VerifySurface visual sensor verdict', () => {
  it('records passed when VerifySurface returns pass=true', () => {
    const ledger = createVerificationSensorLedger();
    observeVerificationToolResult(ledger, 'VerifySurface', {}, {
      isError: false,
      output: JSON.stringify({ pass: true, consoleErrors: [], notes: [] }),
    });
    expect(ledger.visualVerdict).toBe('passed');
    expect(ledger.failures).toHaveLength(0);
  });

  it('records failed when VerifySurface returns pass=false', () => {
    const ledger = createVerificationSensorLedger();
    observeVerificationToolResult(ledger, 'VerifySurface', {}, {
      isError: true,
      output: JSON.stringify({
        pass: false,
        consoleErrors: [],
        notes: ['Browser-use runtime is not available'],
      }),
    });
    expect(ledger.visualVerdict).toBe('failed');
    expect(ledger.failures.some((entry) => entry.toolName === 'VerifySurface')).toBe(true);
  });

  it('reads pass from multipart text+image VerifySurface output', () => {
    const ledger = createVerificationSensorLedger();
    observeVerificationToolResult(ledger, 'VerifySurface', {}, {
      isError: false,
      output: [
        {
          type: 'text',
          text: JSON.stringify({ pass: true, consoleErrors: [], notes: [] }),
        },
        {
          type: 'image_url',
          imageUrl: { url: 'data:image/png;base64,aa' },
        },
      ],
    });
    expect(ledger.visualVerdict).toBe('passed');
  });
});
