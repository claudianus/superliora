import { HostSetupConfirmSheetComponent } from '../../components/dialogs/host-setup/host-setup-confirm';
import type { HostSetupPlan } from '../../components/dialogs/host-setup/host-setup-confirm';
import {
  dismissPickerDialog,
  mountPickerDialog,
  type PickerMountHost,
} from '../ui/mount-picker';

export type ConfirmHostSetupHost = PickerMountHost & {
  requestRender?(): void;
};

export function confirmHostSetup(
  host: ConfirmHostSetupHost,
  plan: HostSetupPlan,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      dismissPickerDialog(host);
      resolve(ok);
    };
    mountPickerDialog(
      host,
      new HostSetupConfirmSheetComponent({
        plan,
        onSelect: (choice) => {
          finish(choice === 'proceed');
        },
        onCancel: () => {
          finish(false);
        },
        requestRender: () => {
          host.requestRender?.();
        },
      }),
      { label: 'Host setup' },
    );
  });
}
