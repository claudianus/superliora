// ---------------------------------------------------------------------------
// Plan / Config commands — barrel re-exports
// ---------------------------------------------------------------------------

export { handleModelCommand, showLoopModelRoutingPicker, applyLoopModelRoutingChoice, resetLoopModelRoutingChoice, showModelFallbackPicker, showModelPicker } from './config-model';
export { handleContextCommand, showContextWorkingSetPicker } from './config-context';
export { handleThinkingCommand } from './config-thinking';
export { handleAppearanceCommand } from './config-appearance';

export { handlePlanCommand, handleCompactCommand } from './config-plan';
export {
  handleYoloCommand,
  handleAutoCommand,
  handlePermissionCommand,
  showPermissionPicker,
} from './config-permission';
export { handleEditorCommand, handleThemeCommand } from './config-editor-theme';
export { showMediaFallbackPicker } from './config-media';
export { showExperimentsPanel, applyExperimentalFeatureChanges } from './config-experiments';
export { showUpdatePreferencePicker, applyUpdatePreferenceChoice } from './config-update-preference';
export { showSettingsSelector, showHarnessPanel } from './config-settings';
export { showToolsInventory, showHarnessEyesReadiness } from './config-harness-tools';
