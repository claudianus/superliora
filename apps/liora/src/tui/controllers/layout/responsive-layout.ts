export type ResponsiveLayoutProfile = 'tiny' | 'compact' | 'standard' | 'wide' | 'ultrawide';

export interface ResponsiveLayoutInput {
  readonly width: number;
  readonly height?: number;
}

export function resolveResponsiveLayout(input: ResponsiveLayoutInput): ResponsiveLayoutProfile {
  const width = Math.max(0, input.width);
  const height = input.height;
  if (width < 60 || (height !== undefined && height < 16)) return 'tiny';
  if (width < 90) return 'compact';
  if (width < 120) return 'standard';
  if (width < 160) return 'wide';
  return 'ultrawide';
}

export function responsiveDensity(
  profile: ResponsiveLayoutProfile,
): 'compact' | 'comfortable' | 'spacious' {
  if (profile === 'tiny' || profile === 'compact') return 'compact';
  if (profile === 'wide' || profile === 'ultrawide') return 'spacious';
  return 'comfortable';
}
