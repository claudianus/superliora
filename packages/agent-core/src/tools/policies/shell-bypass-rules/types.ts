export type ShellDedicatedBypassHit = {
  readonly prefer: 'Read' | 'Write' | 'Edit' | 'Grep' | 'Glob';
  readonly pattern: string;
  readonly message: string;
};
