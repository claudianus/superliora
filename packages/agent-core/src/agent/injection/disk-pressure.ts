import { DynamicInjector } from './injector';
import {
  consumeRecoveredInjection,
  getDiskPressureSnapshot,
  renderDiskPressureInjection,
  renderDiskPressureRecoveredInjection,
} from '#/runtime/disk-pressure';

export const DISK_PRESSURE_VARIANT = 'disk_pressure';

export class DiskPressureInjector extends DynamicInjector {
  protected override readonly injectionVariant = DISK_PRESSURE_VARIANT;

  protected override getInjection(): string | undefined {
    const current = getDiskPressureSnapshot();
    if (current.level === 'ok') {
      if (!consumeRecoveredInjection()) return undefined;
      return renderDiskPressureRecoveredInjection();
    }
    return renderDiskPressureInjection(current);
  }
}
