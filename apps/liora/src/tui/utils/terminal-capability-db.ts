import type {
  ColorDepth,
  FeatureTier,
  ImageProtocol,
  KeyboardProtocol,
  TerminalFeatureFlags,
} from './terminal-capability-profile';

export interface TerminalDbEntry {
  readonly tier: FeatureTier;
  readonly colorDepth: ColorDepth;
  readonly imageProtocol: ImageProtocol;
  readonly keyboardProtocol: KeyboardProtocol;
  readonly features: Partial<TerminalFeatureFlags>;
}

export const TERMINAL_DB: Record<string, TerminalDbEntry> = {
  kitty: {
    tier: 'premium',
    colorDepth: 'truecolor',
    imageProtocol: 'kitty',
    keyboardProtocol: 'kitty-enhanced',
    features: {
      trueColor: true, kittyKeyboard: true, kittyGraphics: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, osc52Clipboard: true, osc99Notify: true,
      styledUnderlines: true, hyperlinks: true, unicodeWide: true,
      extendedAttributes: true, cursorShape: true, pointerShapes: true, cursorColor: true,
      windowTitle: true, alternateScreen: true,
    },
  },
  ghostty: {
    tier: 'premium',
    colorDepth: 'truecolor',
    imageProtocol: 'kitty',
    keyboardProtocol: 'kitty-enhanced',
    features: {
      trueColor: true, kittyKeyboard: true, kittyGraphics: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, osc52Clipboard: true,
      styledUnderlines: true, hyperlinks: true, unicodeWide: true,
      extendedAttributes: true, cursorShape: true, pointerShapes: true, cursorColor: true,
      windowTitle: true, alternateScreen: true,
    },
  },
  wezterm: {
    tier: 'premium',
    colorDepth: 'truecolor',
    imageProtocol: 'iterm2',
    keyboardProtocol: 'kitty-enhanced',
    features: {
      trueColor: true, kittyKeyboard: true, iterm2Images: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, osc52Clipboard: true,
      styledUnderlines: true, hyperlinks: true, unicodeWide: true,
      extendedAttributes: true, cursorShape: true, pointerShapes: true, cursorColor: true,
      windowTitle: true, alternateScreen: true,
    },
  },
  iterm2: {
    tier: 'enhanced',
    colorDepth: 'truecolor',
    imageProtocol: 'iterm2',
    keyboardProtocol: 'modify-other-keys',
    features: {
      trueColor: true, iterm2Images: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, osc52Clipboard: true,
      hyperlinks: true, unicodeWide: true,
      cursorShape: true, cursorColor: true,
      windowTitle: true, alternateScreen: true,
    },
  },
  alacritty: {
    tier: 'enhanced',
    colorDepth: 'truecolor',
    imageProtocol: 'none',
    keyboardProtocol: 'modify-other-keys',
    features: {
      trueColor: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, osc52Clipboard: true,
      styledUnderlines: true, hyperlinks: true, unicodeWide: true,
      cursorShape: true, cursorColor: true,
      windowTitle: true, alternateScreen: true,
    },
  },
  foot: {
    tier: 'enhanced',
    colorDepth: 'truecolor',
    imageProtocol: 'sixel',
    keyboardProtocol: 'modify-other-keys',
    features: {
      trueColor: true, sixel: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, osc52Clipboard: true,
      hyperlinks: true, unicodeWide: true,
      cursorShape: true, windowTitle: true, alternateScreen: true,
    },
  },
  rio: {
    tier: 'premium',
    colorDepth: 'truecolor',
    imageProtocol: 'kitty',
    keyboardProtocol: 'kitty-enhanced',
    features: {
      trueColor: true, kittyKeyboard: true, kittyGraphics: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, hyperlinks: true, unicodeWide: true,
      cursorShape: true, cursorColor: true,
      windowTitle: true, alternateScreen: true,
    },
  },
  vscode: {
    tier: 'enhanced',
    colorDepth: 'truecolor',
    imageProtocol: 'none',
    keyboardProtocol: 'legacy',
    features: {
      trueColor: true,
      mouseTracking: true, bracketedPaste: true,
      hyperlinks: true, unicodeWide: true,
      cursorShape: true, windowTitle: true, alternateScreen: true,
    },
  },
};

export const DEFAULT_FEATURES: TerminalFeatureFlags = {
  trueColor: false, kittyKeyboard: false, kittyGraphics: false,
  iterm2Images: false, sixel: false, synchronizedOutput: false,
  mouseTracking: false, focusEvents: false, bracketedPaste: false,
  osc52Clipboard: false, osc99Notify: false, styledUnderlines: false,
  hyperlinks: false, unicodeWide: false, extendedAttributes: false,
  cursorShape: true, pointerShapes: false, cursorColor: false, windowTitle: true,
  alternateScreen: true,
};
