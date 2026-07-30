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
      title: `Remove ${opts.displayName} (${opts.id})?`,
      hint: '↑↓ navigate · Enter/Space select · ←/Esc cancel',
      formatHint: mutedHintLine,
      options: [
        {
          value: REMOVE_CONFIRM_CANCEL,
          label: 'Cancel',
          description: 'Keep this plugin installed.',
        },
        {
          value: REMOVE_CONFIRM_REMOVE,
          label: 'Remove plugin',
          tone: 'danger',
          description: 'Remove only the install record; plugin files are left in place.',
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
      title: `Install third-party plugin ${opts.label}?`,
      hint: '↑↓ navigate · Enter/Space select · ←/Esc cancel',
      formatHint: mutedHintLine,
      notice:
        '⚠️ This is a third-party plugin that SuperLiora has not reviewed. It can bundle MCP servers, ' +
        'skills, or files that run code and access your workspace. Install it only if you ' +
        'trust the source.',
      noticeTone: 'warning',
      options: [
        {
          value: INSTALL_TRUST_EXIT,
          label: 'Exit',
          description: 'Cancel the installation.',
        },
        {
          value: INSTALL_TRUST_TRUST,
          label: 'Trust and install',
          tone: 'danger',
          description: 'Install this third-party plugin anyway.',
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
