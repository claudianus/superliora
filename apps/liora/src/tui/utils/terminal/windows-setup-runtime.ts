/**
 * Compat re-exports. Prefer `#/tui/utils/terminal/host-setup-runtime`.
 */

export {
  formatHostSetupApply as formatWindowsSetupApply,
  formatHostSetupStatus as formatWindowsSetupStatus,
  loadHostSetupModule as loadTerminalModule,
  runHostSetupApply as runWindowsSetupApply,
  type EnsureHostSetupResult as EnsureTerminalResult,
  type HostSetupModule as TerminalInstallModule,
} from './host-setup-runtime';
