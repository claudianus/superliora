import { afterEach, describe, expect, it } from 'vitest';

import { DiskPressureInjector } from '../../../src/agent/injection/disk-pressure';
import {
  configureDiskPressure,
  reportDiskPressure,
  resetDiskPressureForTests,
  RECOVERED_FREE_BYTES,
} from '../../../src/runtime/disk-pressure';

afterEach(() => {
  resetDiskPressureForTests();
});

describe('DiskPressureInjector', () => {
  it('is silent when pressure is ok', async () => {
    const injector = new DiskPressureInjector({} as never);
    expect(await injector.collectForBatch()).toBeUndefined();
  });

  it('injects critical then a one-shot recovered reminder', async () => {
    configureDiskPressure({
      homeDir: '/tmp/home',
      probe: async () => ({ path: 'C:', freeBytes: 0, totalBytes: RECOVERED_FREE_BYTES * 4 }),
      measure: async () => ({
        homeDir: '/tmp/home',
        homeBytes: 1,
        sessionsBytes: 0,
        cacheBytes: 0,
        logsBytes: 0,
      }),
      collect: async () => ({
        homeDir: '/tmp/home',
        dryRun: false,
        items: [],
        freedBytes: 0,
        compressed: 0,
        deleted: 0,
        skipped: 0,
      }),
    });
    await reportDiskPressure(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));
    const injector = new DiskPressureInjector({} as never);
    const critical = await injector.collectForBatch();
    expect(critical).toContain('<disk_pressure>');
    expect(critical).toContain('level=critical');

    configureDiskPressure({
      probe: async () => ({
        path: 'C:',
        freeBytes: RECOVERED_FREE_BYTES + 1,
        totalBytes: RECOVERED_FREE_BYTES * 4,
      }),
    });
    await reportDiskPressure();
    const recovered = await injector.collectForBatch();
    expect(recovered).toContain('level=recovered');
    expect(await injector.collectForBatch()).toBeUndefined();
  });
});
