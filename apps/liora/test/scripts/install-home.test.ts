import { describe, expect, it } from 'vitest';

import {
  joinDriveRoot,
  LIORA_HOME_COMFORT_FREE_BYTES,
  pickDataHome,
} from '../../../../scripts/install/home.mjs';

const GB = 1024 * 1024 * 1024;

function vol(root: string, freeGb: number, totalGb = freeGb + 50) {
  return { root, path: root, freeBytes: freeGb * GB, totalBytes: totalGb * GB };
}

describe('pickDataHome', () => {
  it('keeps ~/.superliora when the profile volume has 100 GB free', () => {
    const osHome = 'C:\\Users\\dev';
    const plan = pickDataHome({
      osHome,
      platform: 'win32',
      defaultPopulated: false,
      volumes: [vol('C:\\', 200), vol('D:\\', 400)],
    });
    expect(plan.relocated).toBe(false);
    expect(plan.reason).toBe('default-ok');
    expect(plan.home.replaceAll('/', '\\').toLowerCase()).toBe(
      'C:\\Users\\dev\\.superliora'.toLowerCase(),
    );
  });

  it('moves to D:\\SuperLiora when C: has 5 GB and D: has 180 GB', () => {
    const plan = pickDataHome({
      osHome: 'C:\\Users\\dev',
      platform: 'win32',
      defaultPopulated: false,
      volumes: [vol('C:\\', 5), vol('D:\\', 180)],
    });
    expect(plan.relocated).toBe(true);
    expect(plan.home.replaceAll('/', '\\')).toBe('D:\\SuperLiora');
    expect(plan.reason).toBe('roomier-drive');
  });

  it('prefers the workspace drive when it has 100 GB free', () => {
    const plan = pickDataHome({
      osHome: 'C:\\Users\\dev',
      platform: 'win32',
      cwd: 'D:\\superliora',
      defaultPopulated: false,
      volumes: [vol('C:\\', 5), vol('D:\\', 120), vol('E:\\', 400)],
    });
    expect(plan.home.replaceAll('/', '\\')).toBe('D:\\SuperLiora');
  });

  it('does not auto-move an already populated home', () => {
    const plan = pickDataHome({
      osHome: 'C:\\Users\\dev',
      platform: 'win32',
      defaultPopulated: true,
      volumes: [vol('C:\\', 5), vol('D:\\', 180)],
    });
    expect(plan.relocated).toBe(false);
    expect(plan.tight).toBe(true);
    expect(plan.reason).toBe('existing-tight');
  });

  it('honors SUPERLIORA_HOME / explicit home', () => {
    const plan = pickDataHome({
      explicitHome: 'E:\\code\\liora-home',
      osHome: 'C:\\Users\\dev',
      platform: 'win32',
      volumes: [vol('C:\\', 5), vol('E:\\', 200)],
    });
    expect(plan.home).toBe('E:\\code\\liora-home');
    expect(plan.reason).toBe('explicit');
    expect(plan.relocated).toBe(true);
  });

  it('does not auto-pick another mount on POSIX', () => {
    const plan = pickDataHome({
      osHome: '/home/dev',
      platform: 'linux',
      defaultPopulated: false,
      volumes: [vol('/home/dev', 4), vol('/mnt/data', 200)],
    });
    expect(plan.relocated).toBe(false);
    expect(plan.tight).toBe(true);
    expect(plan.home.replaceAll('\\', '/')).toBe('/home/dev/.superliora');
  });
});

describe('joinDriveRoot', () => {
  it('places SuperLiora at the drive root', () => {
    expect(joinDriveRoot('D:\\', 'SuperLiora').replaceAll('/', '\\')).toBe('D:\\SuperLiora');
    expect(joinDriveRoot('D:', 'SuperLiora').replaceAll('/', '\\')).toBe('D:\\SuperLiora');
  });
});

describe('comfort floor', () => {
  it('is 100 GB', () => {
    expect(LIORA_HOME_COMFORT_FREE_BYTES).toBe(100 * GB);
  });
});
