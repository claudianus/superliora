declare const __SUPERLIORA_VERSION__: string | undefined;
declare const __SUPERLIORA_CHANNEL__: string | undefined;
declare const __SUPERLIORA_COMMIT__: string | undefined;
declare const __SUPERLIORA_BUILD_TARGET__: string | undefined;

export interface LioraBuildInfo {
  readonly version?: string;
  readonly channel?: string;
  readonly commit?: string;
  readonly buildTarget?: string;
}

function optionalBuildString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const LIORA_BUILD_INFO: LioraBuildInfo = {
  version:
    typeof __SUPERLIORA_VERSION__ === 'string'
      ? optionalBuildString(__SUPERLIORA_VERSION__)
      : undefined,
  channel:
    typeof __SUPERLIORA_CHANNEL__ === 'string'
      ? optionalBuildString(__SUPERLIORA_CHANNEL__)
      : undefined,
  commit:
    typeof __SUPERLIORA_COMMIT__ === 'string'
      ? optionalBuildString(__SUPERLIORA_COMMIT__)
      : undefined,
  buildTarget:
    typeof __SUPERLIORA_BUILD_TARGET__ === 'string'
      ? optionalBuildString(__SUPERLIORA_BUILD_TARGET__)
      : undefined,
};
