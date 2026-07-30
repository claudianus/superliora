import type {
  FeatureTier,
  ImageProtocol,
  TerminalCapabilityProfile,
  TerminalFeatureFlags,
} from './terminal-capability-profile';

export interface FeatureRecommendation {
  readonly feature: string;
  readonly enabled: boolean;
  readonly reason: string;
}

/**
 * Get recommendations for which visual features to enable based on profile.
 */
export function getFeatureRecommendations(profile: TerminalCapabilityProfile): FeatureRecommendation[] {
  const recs: FeatureRecommendation[] = [];
  const f = profile.features;

  recs.push({
    feature: 'animations',
    enabled: f.synchronizedOutput && profile.identity.interactive,
    reason: f.synchronizedOutput
      ? 'Sync output prevents tearing'
      : 'No sync output — animations may tear',
  });

  recs.push({
    feature: 'inline-images',
    enabled: profile.imageProtocol !== 'none',
    reason: profile.imageProtocol !== 'none'
      ? `${profile.imageProtocol} protocol available`
      : 'No image protocol detected',
  });

  recs.push({
    feature: 'mouse-interaction',
    enabled: f.mouseTracking,
    reason: f.mouseTracking ? 'SGR mouse tracking available' : 'Mouse not supported',
  });

  recs.push({
    feature: 'clipboard-integration',
    enabled: f.osc52Clipboard,
    reason: f.osc52Clipboard ? 'OSC 52 clipboard available' : 'No clipboard access',
  });

  recs.push({
    feature: 'desktop-notifications',
    enabled: f.osc99Notify,
    reason: f.osc99Notify ? 'OSC 99 notifications available' : 'No notification support',
  });

  recs.push({
    feature: 'styled-underlines',
    enabled: f.styledUnderlines,
    reason: f.styledUnderlines ? 'Undercurl/dotted/dashed available' : 'Basic underline only',
  });

  recs.push({
    feature: 'hyperlinks',
    enabled: f.hyperlinks,
    reason: f.hyperlinks ? 'OSC 8 hyperlinks available' : 'No hyperlink support',
  });

  recs.push({
    feature: 'high-fps-animation',
    enabled: profile.tier === 'premium' && f.synchronizedOutput,
    reason: profile.tier === 'premium'
      ? 'Premium terminal — 60fps viable'
      : 'Standard terminal — cap at 30fps',
  });

  recs.push({
    feature: 'unicode-emoji',
    enabled: f.unicodeWide && profile.unicodeVersion >= 12,
    reason: `Unicode ${String(profile.unicodeVersion)} detected`,
  });

  return recs;
}

/**
 * Check if a specific feature is available.
 */
export function hasFeature(profile: TerminalCapabilityProfile, feature: keyof TerminalFeatureFlags): boolean {
  return profile.features[feature];
}

/**
 * Get the maximum safe FPS for animations.
 */
export function getMaxSafeFps(profile: TerminalCapabilityProfile): number {
  if (!profile.identity.interactive) return 0;
  if (profile.tier === 'premium' && profile.features.synchronizedOutput) return 60;
  if (profile.tier === 'enhanced') return 30;
  return 15;
}

/**
 * Get the best available image rendering strategy.
 */
export function getImageStrategy(profile: TerminalCapabilityProfile): {
  protocol: ImageProtocol;
  maxInlineWidth: number;
  maxInlineHeight: number;
  supportsTransparency: boolean;
  supportsAnimation: boolean;
} {
  switch (profile.imageProtocol) {
    case 'kitty':
      return {
        protocol: 'kitty',
        maxInlineWidth: 4096,
        maxInlineHeight: 4096,
        supportsTransparency: true,
        supportsAnimation: true,
      };
    case 'iterm2':
      return {
        protocol: 'iterm2',
        maxInlineWidth: 2048,
        maxInlineHeight: 2048,
        supportsTransparency: true,
        supportsAnimation: false,
      };
    case 'sixel':
      return {
        protocol: 'sixel',
        maxInlineWidth: 1024,
        maxInlineHeight: 1024,
        supportsTransparency: true,
        supportsAnimation: false,
      };
    default:
      return {
        protocol: 'none',
        maxInlineWidth: 0,
        maxInlineHeight: 0,
        supportsTransparency: false,
        supportsAnimation: false,
      };
  }
}

/**
 * Get the optimal color encoding function selector.
 */
export function getColorEncoder(profile: TerminalCapabilityProfile): 'rgb' | 'palette256' | 'palette16' | 'none' {
  switch (profile.colorDepth) {
    case 'truecolor': return 'rgb';
    case 'ansi256': return 'palette256';
    case 'ansi16': return 'palette16';
    default: return 'none';
  }
}

export function calculateTier(features: TerminalFeatureFlags, colorDepth: TerminalCapabilityProfile['colorDepth']): FeatureTier {
  if (
    colorDepth === 'truecolor' &&
    features.kittyKeyboard &&
    (features.kittyGraphics || features.iterm2Images) &&
    features.synchronizedOutput
  ) {
    return 'premium';
  }
  if (colorDepth === 'truecolor' && features.mouseTracking && features.bracketedPaste) {
    return 'enhanced';
  }
  if (colorDepth === 'ansi256' && features.mouseTracking) {
    return 'enhanced';
  }
  return 'basic';
}

export function computeEffectiveDimensions(
  columns: number,
  rows: number,
  multiplexer: TerminalCapabilityProfile['identity']['multiplexer'],
): { effectiveColumns: number; effectiveRows: number } {
  let effectiveColumns = columns;
  let effectiveRows = rows;

  switch (multiplexer) {
    case 'tmux':
      effectiveRows -= 1;
      break;
    case 'zellij':
      effectiveRows -= 2;
      effectiveColumns -= 2;
      break;
    case 'screen':
      effectiveRows -= 1;
      break;
  }

  return {
    effectiveColumns: Math.max(20, effectiveColumns),
    effectiveRows: Math.max(5, effectiveRows),
  };
}

export function buildSummary(
  tier: FeatureTier,
  colorDepth: TerminalCapabilityProfile['colorDepth'],
  imageProtocol: ImageProtocol,
  keyboardProtocol: TerminalCapabilityProfile['keyboardProtocol'],
  identity: TerminalCapabilityProfile['identity'],
): string {
  const parts: string[] = [];
  parts.push(tier);
  parts.push(colorDepth);
  if (imageProtocol !== 'none') parts.push(`img:${imageProtocol}`);
  if (keyboardProtocol !== 'legacy') parts.push(`kb:${keyboardProtocol}`);
  if (identity.multiplexer) parts.push(`mux:${identity.multiplexer}`);
  if (identity.ssh) parts.push('ssh');
  return parts.join(' | ');
}
