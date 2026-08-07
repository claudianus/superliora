/**
 * Structured Job brief helpers — render/validate fields that used to live only
 * inside free-text `prompt` (Conductor harness brief contract).
 */

import type { JobDeliveryPhase, JobRecord } from './job-store-key';

function bulletBlock(label: string, items: readonly string[] | undefined): string | undefined {
  if (items === undefined || items.length === 0) return undefined;
  return `${label}:\n${items.map((item) => `- ${item}`).join('\n')}`;
}

/** Fixed sections rendered above free-text Brief in the worker prompt. */
export function renderStructuredBriefSections(job: JobRecord): string | undefined {
  const parts = [
    bulletBlock('Success criteria', job.successCriteria),
    bulletBlock('Must not touch', job.mustNotTouch),
    bulletBlock('Verification commands', job.verificationCommands),
    job.deliveryMode !== undefined ? `Delivery mode: ${job.deliveryMode}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

/** Phase contract for greenfield chain steps (not a separate JobKind). */
export function renderDeliveryPhaseContract(phase: JobDeliveryPhase | undefined): string | undefined {
  if (phase === 'skeleton') {
    return [
      'Greenfield phase: skeleton.',
      '- Create folders, entrypoints, types, and empty surfaces only.',
      '- Do not implement product logic, decorative UI, or speculative abstractions.',
      '- Stop when the skeleton is buildable / importable; leave fill work to the next Job.',
    ].join('\n');
  }
  if (phase === 'fill') {
    return [
      'Greenfield phase: fill.',
      '- Meet success criteria only; prefer the smallest diff.',
      '- Stay inside ownership paths; respect must-not-touch.',
      '- Do not add decorative layers or unused wrappers.',
    ].join('\n');
  }
  if (phase === 'delete_pass') {
    return [
      'Greenfield phase: delete-pass.',
      '- Delete unused wrappers, speculative abstractions, and decorative layers.',
      '- Do not break success criteria; re-run verification commands.',
      '- Prefer fewer files/lines when behavior still holds.',
    ].join('\n');
  }
  return undefined;
}

export function nonEmptyStringList(items: readonly string[] | undefined): string[] {
  if (items === undefined) return [];
  return items.map((s) => s.trim()).filter((s) => s.length > 0);
}
