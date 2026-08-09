import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';
import { SETTINGS_SEARCH_KEYWORDS } from '../../../commands/config/settings-keywords';
import {
  resolveSettingsOption,
  type SettingsOptionDef,
} from '../../../utils/settings/resolve-settings-option';
import { ttui } from '../../../utils/tui-i18n';

export type SettingsSelection =
  | 'model'
  | 'model-routing'
  | 'model-fallback'
  | 'model-reset'
  | 'theme'
  | 'appearance'
  | 'footer'
  | 'persona'
  | 'editor'
  | 'permission'
  | 'providers-api'
  | 'security'
  | 'accounts'
  | 'keybindings'
  | 'context'
  | 'compaction'
  | 'media'
  | 'harness'
  | 'tools'
  | 'eyes'
  | 'premium'
  | 'mcp'
  | 'extensions'
  | 'hooks'
  | 'skills'
  | 'search'
  | 'provider-extras'
  | 'index'
  | 'host'
  | 'cache'
  | 'never-halt'
  | 'telemetry'
  | 'network'
  | 'storage'
  | 'experiments'
  | 'upgrade'
  | 'usage'
  | 'memory'
  | 'locale';

/** Exported for Settings → Harness → Settings inventory (SSOT §9 audit). */
export const SETTINGS_OPTIONS_BASE: readonly (SettingsOptionDef & {
  readonly value: SettingsSelection;
})[] = [
  {
    value: 'model',
    sectionKey: 'tui.settings.section.models',
    labelKey: 'tui.settings.model.label',
    descriptionKey: 'tui.settings.model.desc',
  },
  {
    value: 'model-routing',
    sectionKey: 'tui.settings.section.models',
    labelKey: 'tui.settings.modelRouting.label',
    descriptionKey: 'tui.settings.modelRouting.desc',
  },
  {
    value: 'model-fallback',
    sectionKey: 'tui.settings.section.models',
    labelKey: 'tui.settings.modelFallback.label',
    descriptionKey: 'tui.settings.modelFallback.desc',
  },
  {
    value: 'model-reset',
    sectionKey: 'tui.settings.section.models',
    labelKey: 'tui.settings.modelReset.label',
    descriptionKey: 'tui.settings.modelReset.desc',
  },
  {
    value: 'permission',
    sectionKey: 'tui.settings.section.safety',
    labelKey: 'tui.settings.permission.label',
    descriptionKey: 'tui.settings.permission.desc',
  },
  {
    value: 'security',
    sectionKey: 'tui.settings.section.safety',
    labelKey: 'tui.settings.security.label',
    descriptionKey: 'tui.settings.security.desc',
  },
  {
    value: 'theme',
    sectionKey: 'tui.settings.section.lookAndFeel',
    labelKey: 'tui.settings.theme.label',
    descriptionKey: 'tui.settings.theme.desc',
  },
  {
    value: 'appearance',
    sectionKey: 'tui.settings.section.lookAndFeel',
    labelKey: 'tui.settings.appearance.label',
    descriptionKey: 'tui.settings.appearance.desc',
  },
  {
    value: 'footer',
    sectionKey: 'tui.settings.section.lookAndFeel',
    labelKey: 'tui.settings.footer.label',
    descriptionKey: 'tui.settings.footer.desc',
  },
  {
    value: 'premium',
    sectionKey: 'tui.settings.section.lookAndFeel',
    labelKey: 'tui.settings.premium.label',
    descriptionKey: 'tui.settings.premium.desc',
  },
  {
    value: 'persona',
    sectionKey: 'tui.settings.section.lookAndFeel',
    labelKey: 'tui.settings.persona.label',
    descriptionKey: 'tui.settings.persona.desc',
  },
  {
    value: 'editor',
    sectionKey: 'tui.settings.section.lookAndFeel',
    labelKey: 'tui.settings.editor.label',
    descriptionKey: 'tui.settings.editor.desc',
  },
  {
    value: 'keybindings',
    sectionKey: 'tui.settings.section.lookAndFeel',
    labelKey: 'tui.settings.keybindings.label',
    descriptionKey: 'tui.settings.keybindings.desc',
  },
  {
    value: 'locale',
    sectionKey: 'tui.settings.section.lookAndFeel',
    labelKey: 'tui.settings.locale.label',
    descriptionKey: 'tui.settings.locale.desc',
  },
  {
    value: 'context',
    sectionKey: 'tui.settings.section.agent',
    labelKey: 'tui.settings.context.label',
    descriptionKey: 'tui.settings.context.desc',
  },
  {
    value: 'compaction',
    sectionKey: 'tui.settings.section.agent',
    labelKey: 'tui.settings.compaction.label',
    descriptionKey: 'tui.settings.compaction.desc',
  },
  {
    value: 'never-halt',
    sectionKey: 'tui.settings.section.agent',
    labelKey: 'tui.settings.neverHalt.label',
    descriptionKey: 'tui.settings.neverHalt.desc',
  },
  {
    value: 'extensions',
    sectionKey: 'tui.settings.section.integrations',
    labelKey: 'tui.settings.extensions.label',
    descriptionKey: 'tui.settings.extensions.desc',
  },
  {
    value: 'mcp',
    sectionKey: 'tui.settings.section.integrations',
    labelKey: 'tui.settings.mcp.label',
    descriptionKey: 'tui.settings.mcp.desc',
  },
  {
    value: 'skills',
    sectionKey: 'tui.settings.section.integrations',
    labelKey: 'tui.settings.skills.label',
    descriptionKey: 'tui.settings.skills.desc',
  },
  {
    value: 'hooks',
    sectionKey: 'tui.settings.section.integrations',
    labelKey: 'tui.settings.hooks.label',
    descriptionKey: 'tui.settings.hooks.desc',
  },
  {
    value: 'tools',
    sectionKey: 'tui.settings.section.integrations',
    labelKey: 'tui.settings.tools.label',
    descriptionKey: 'tui.settings.tools.desc',
  },
  {
    value: 'media',
    sectionKey: 'tui.settings.section.integrations',
    labelKey: 'tui.settings.media.label',
    descriptionKey: 'tui.settings.media.desc',
  },
  {
    value: 'search',
    sectionKey: 'tui.settings.section.integrations',
    labelKey: 'tui.settings.search.label',
    descriptionKey: 'tui.settings.search.desc',
  },
  {
    value: 'provider-extras',
    sectionKey: 'tui.settings.section.integrations',
    labelKey: 'tui.settings.providerExtras.label',
    descriptionKey: 'tui.settings.providerExtras.desc',
  },
  {
    value: 'index',
    sectionKey: 'tui.settings.section.integrations',
    labelKey: 'tui.settings.index.label',
    descriptionKey: 'tui.settings.index.desc',
  },
  {
    value: 'cache',
    sectionKey: 'tui.settings.section.integrations',
    labelKey: 'tui.settings.cache.label',
    descriptionKey: 'tui.settings.cache.desc',
  },
  {
    value: 'eyes',
    sectionKey: 'tui.settings.section.integrations',
    labelKey: 'tui.settings.eyes.label',
    descriptionKey: 'tui.settings.eyes.desc',
  },
  {
    value: 'memory',
    sectionKey: 'tui.settings.section.integrations',
    labelKey: 'tui.settings.memory.label',
    descriptionKey: 'tui.settings.memory.desc',
  },
  {
    value: 'providers-api',
    sectionKey: 'tui.settings.section.account',
    labelKey: 'tui.settings.providersApi.label',
    descriptionKey: 'tui.settings.providersApi.desc',
  },
  {
    value: 'accounts',
    sectionKey: 'tui.settings.section.account',
    labelKey: 'tui.settings.accounts.label',
    descriptionKey: 'tui.settings.accounts.desc',
  },
  {
    value: 'usage',
    sectionKey: 'tui.settings.section.account',
    labelKey: 'tui.settings.usage.label',
    descriptionKey: 'tui.settings.usage.desc',
  },
  {
    value: 'upgrade',
    sectionKey: 'tui.settings.section.account',
    labelKey: 'tui.settings.upgrade.label',
    descriptionKey: 'tui.settings.upgrade.desc',
  },
  {
    value: 'host',
    sectionKey: 'tui.settings.section.system',
    labelKey: 'tui.settings.host.label',
    descriptionKey: 'tui.settings.host.desc',
  },
  {
    value: 'network',
    sectionKey: 'tui.settings.section.system',
    labelKey: 'tui.settings.network.label',
    descriptionKey: 'tui.settings.network.desc',
  },
  {
    value: 'storage',
    sectionKey: 'tui.settings.section.system',
    labelKey: 'tui.settings.storage.label',
    descriptionKey: 'tui.settings.storage.desc',
  },
  {
    value: 'telemetry',
    sectionKey: 'tui.settings.section.system',
    labelKey: 'tui.settings.telemetry.label',
    descriptionKey: 'tui.settings.telemetry.desc',
  },
  {
    value: 'experiments',
    sectionKey: 'tui.settings.section.system',
    labelKey: 'tui.settings.experiments.label',
    descriptionKey: 'tui.settings.experiments.desc',
  },
  {
    value: 'harness',
    sectionKey: 'tui.settings.section.system',
    labelKey: 'tui.settings.harness.label',
    descriptionKey: 'tui.settings.harness.desc',
  },
];

function withSettingsKeywords(
  option: SettingsOptionDef & { readonly value: SettingsSelection },
): ChoiceOption {
  const keywords = SETTINGS_SEARCH_KEYWORDS[option.value];
  return resolveSettingsOption({
    ...option,
    keywords: keywords !== undefined ? [...keywords] : [],
  });
}

/** Resolved at call time so locale switches apply when reopening Settings. */
export function getSettingsOptions(): readonly ChoiceOption[] {
  return SETTINGS_OPTIONS_BASE.map(withSettingsKeywords);
}

/** @deprecated Use {@link getSettingsOptions} for locale-aware resolution. */
export const SETTINGS_OPTIONS: readonly ChoiceOption[] = getSettingsOptions();

const SETTINGS_SELECTION_SET = new Set<string>(
  SETTINGS_OPTIONS_BASE.map((option) => option.value),
);

export function isSettingsSelection(value: string): value is SettingsSelection {
  return SETTINGS_SELECTION_SET.has(value);
}

/** Settings always pinned in Command Hub (not search-only). Everyday + search path. */
export const HUB_PINNED_SETTINGS: readonly SettingsSelection[] = [
  'model',
  'permission',
  'theme',
  'appearance',
  'footer',
  'persona',
  'locale',
  'context',
  'extensions',
  'search',
  'media',
  'accounts',
  'usage',
  'upgrade',
  'security',
];

export interface SettingsSelectorOptions {
  readonly onSelect: (value: SettingsSelection) => void;
  readonly onCancel: () => void;
}

export class SettingsSelectorComponent extends ChoicePickerComponent {
  constructor(opts: SettingsSelectorOptions) {
    super({
      title: ttui('tui.settings.title'),
      searchable: true,
      pageSize: 30,
      layout: 'grid',
      options: [...getSettingsOptions()],
      onSelect: (value) => {
        if (isSettingsSelection(value)) opts.onSelect(value);
      },
      onCancel: opts.onCancel,
    });
  }
}
