import { z } from 'zod';

/**
 * Mission / Goals operator prefs (Sovereign Reform §7.3 / §9.2).
 * autoStart never invents an objective — it only records opt-in intent.
 */
export const MissionConfigSchema = z.object({
  /**
   * Opt-in: operator allows Mission to resume/start without a fresh prompt.
   * Default false — Mission still requires `/mission <objective>` (or resume) to run.
   */
  autoStart: z.boolean().optional(),
});

export type MissionConfig = z.infer<typeof MissionConfigSchema>;
