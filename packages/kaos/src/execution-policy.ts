import type { Kaos } from './kaos';

/** Install an independently owned execution policy, never a shared mutable view. */
export function forkKaosExecutionPolicy(kaos: Kaos): Kaos {
  if (kaos.forkExecutionPolicy !== undefined) return kaos.forkExecutionPolicy();
  if (typeof (kaos as { setProcessSandbox?: unknown }).setProcessSandbox === 'function') {
    throw new TypeError('Execution host cannot isolate sandbox policy between Agent installations.');
  }
  // Hosts without mutable process confinement have no policy to share. Explicit
  // process requests still fail closed when applying confinement later.
  return kaos;
}
