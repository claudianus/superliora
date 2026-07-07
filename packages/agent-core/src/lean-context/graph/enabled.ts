import { flags } from '../../flags';

export function isLeanCodegraphV2Enabled(): boolean {
  return flags.enabled('lean_codegraph_v2');
}
