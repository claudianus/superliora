export type RendererToolActivityPhase = 'running' | 'succeeded' | 'failed' | 'truncated';

export interface RendererToolActivityPhaseOptions {
  readonly finished?: boolean;
  readonly error?: boolean;
  readonly truncated?: boolean;
}

export interface RendererToolActivityHeaderOptions {
  readonly marker?: string;
  readonly action?: string;
  readonly label: string;
  readonly detail?: string;
  readonly chip?: string;
  readonly actionSeparator?: string;
}

export interface RendererToolHeaderChipOptions {
  readonly text: string;
  readonly separator?: string;
}

export function projectRendererToolActivityPhase(
  options: RendererToolActivityPhaseOptions,
): RendererToolActivityPhase {
  if (options.finished === true) return options.error === true ? 'failed' : 'succeeded';
  if (options.truncated === true) return 'truncated';
  return 'running';
}

export function renderRendererToolActivityHeader(
  options: RendererToolActivityHeaderOptions,
): string {
  const marker = options.marker ?? '';
  const action = options.action === undefined || options.action.length === 0
    ? ''
    : `${options.action}${options.actionSeparator ?? ' '}`;
  const detail = options.detail ?? '';
  const chip = options.chip ?? '';
  return `${marker}${action}${options.label}${detail}${chip}`;
}

export function formatRendererToolHeaderChip(
  options: RendererToolHeaderChipOptions,
): string {
  if (options.text.length === 0) return '';
  return `${options.separator ?? ' · '}${options.text}`;
}
