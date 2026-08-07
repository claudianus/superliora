/**
 * Identifies how a mode (Goal, Plan) was activated. Currently the user always
 * invokes the mode directly; the type stays so call sites keep a stable shape.
 */
export type ModeActivationSource = 'standalone';

export const DEFAULT_MODE_ACTIVATION_SOURCE: ModeActivationSource = 'standalone';
