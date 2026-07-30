export type { SessionOptions } from '#/session-core';

import { SessionPluginsMixin } from '#/session-plugins';

/** SDK session handle — delegates RPC calls for one interactive agent session. */
export class Session extends SessionPluginsMixin {}
