import { ttui } from '#/tui/utils/tui-i18n';

import {ChoicePickerComponent} from '../picker/choice-picker';
import {mutedHintLine} from './plugins-selector-shared';

const REMOVE_CONFIRM_CANCEL = 'cancel';
const REMOVE_CONFIRM_REMOVE = 'remove';
const INSTALL_TRUST_EXIT = 'exit';
const INSTALL_TRUST_TRUST = 'trust';

export type PluginRemoveConfirmResult =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'cancel' };

export interface PluginRemoveConfirmOptions {
  readonly id: string;
  readonly displayName: string;
  readonly onDone: (result: PluginRemoveConfirmResult) => void;
}

export class PluginRemoveConfirmComponent extends ChoicePickerComponent {
  constructor(opts: PluginRemoveConfirmOptions) {
    super({
      title: ttui('tui.dialog.plugins.remove.title', {
        displayName: opts.displayName,
        id: opts.id,
      }),
      hint: ttui('tui.dialog.plugins.remove.hint'),
      formatHint: mutedHintLine,
      options: [
        {
          value: REMOVE_CONFIRM_CANCEL,
          label: ttui('tui.dialog.plugins.remove.cancel'),
          description: ttui('tui.dialog.plugins.remove.cancelDesc'),
        },
        {
          value: REMOVE_CONFIRM_REMOVE,
          label: ttui('tui.dialog.plugins.remove.confirm'),
          tone: 'danger',
          description: ttui('tui.dialog.plugins.remove.confirmDesc'),
        },
      ],
      onSelect: (value) => {
        opts.onDone(value === REMOVE_CONFIRM_REMOVE ? { kind: 'confirm' } : { kind: 'cancel' });
      },
      onCancel: () => {
        opts.onDone({ kind: 'cancel' });
      },
    });
  }
}

export type PluginInstallTrustConfirmResult =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'cancel' };

export interface PluginInstallTrustConfirmOptions {
  /** Plugin display name or source, shown in the title for identification. */
  readonly label: string;
  readonly onDone: (result: PluginInstallTrustConfirmResult) => void;
}

/**
 * Confirmation shown before installing a third-party (unofficial) plugin.
 * Defaults to "Exit" so the user must explicitly switch to "Trust and install"
 * to proceed with a plugin that SuperLiora has not reviewed.
 */
export class PluginInstallTrustConfirmComponent extends ChoicePickerComponent {
  constructor(opts: PluginInstallTrustConfirmOptions) {
    super({
      title: ttui('tui.dialog.plugins.trust.title', { label: opts.label }),
      hint: ttui('tui.dialog.plugins.trust.hint'),
      formatHint: mutedHintLine,
      notice: ttui('tui.dialog.plugins.trust.notice'),
      noticeTone: 'warning',
      options: [
        {
          value: INSTALL_TRUST_EXIT,
          label: ttui('tui.dialog.plugins.trust.exit'),
          description: ttui('tui.dialog.plugins.trust.exitDesc'),
        },
        {
          value: INSTALL_TRUST_TRUST,
          label: ttui('tui.dialog.plugins.trust.confirm'),
          tone: 'danger',
          description: ttui('tui.dialog.plugins.trust.confirmDesc'),
        },
      ],
      onSelect: (value) => {
        opts.onDone(value === INSTALL_TRUST_TRUST ? { kind: 'confirm' } : { kind: 'cancel' });
      },
      onCancel: () => {
        opts.onDone({ kind: 'cancel' });
      },
    });
  }
}
