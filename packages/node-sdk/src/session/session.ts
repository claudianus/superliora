export type { SessionOptions } from '#/session/session-core';

import { SessionJobsMixin } from '#/session/session-jobs';

/** SDK session handle — delegates RPC calls for one interactive agent session. */
export class Session extends SessionJobsMixin {}
