import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import { formatCurrentTimeSnapshot } from '../../../utils/current-time';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './current-time.md?raw';

export const GetCurrentTimeToolInputSchema = z.object({}).strict();
export type GetCurrentTimeToolInput = z.infer<typeof GetCurrentTimeToolInputSchema>;

export class GetCurrentTimeTool implements BuiltinTool<GetCurrentTimeToolInput> {
  readonly name = 'GetCurrentTime' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(GetCurrentTimeToolInputSchema);

  resolveExecution(_args: GetCurrentTimeToolInput): ToolExecution {
    return {
      description: 'Reading the current date and time',
      approvalRule: this.name,
      execute: async () => {
        const snapshot = formatCurrentTimeSnapshot();
        return { output: JSON.stringify(snapshot, null, 2) };
      },
    };
  }
}
