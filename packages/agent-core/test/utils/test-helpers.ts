/**
 * Test helpers for reducing friction with TypeScript strict null checks.
 * Instead of `arr[0]!.foo` (fragile, sed-unfriendly), use:
 *   import { expectNotEmpty, expectFirst } from '../utils/test-helpers';
 *   const items = expectNotEmpty(result);
 *   assert.equal(expectFirst(items).name, 'expected');
 */

import { strict as assert } from 'node:assert';

/**
 * Assert that an array is non-empty and return it typed as non-empty.
 * Throws with a descriptive message if the array is empty.
 */
export function expectNotEmpty<T>(arr: readonly T[], msg?: string): readonly T[] {
  assert.ok(arr.length > 0, msg ?? `Expected non-empty array but got ${String(arr.length)} items`);
  return arr;
}

/**
 * Get the first element of a non-empty array without non-null assertion.
 * Throws if the array is empty.
 */
export function expectFirst<T>(arr: readonly T[], msg?: string): T {
  assert.ok(arr.length > 0, msg ?? 'Expected at least one element');
  return arr[0] as T;
}

/**
 * Get an element at a specific index without non-null assertion.
 * Throws if the index is out of bounds.
 */
export function expectAt<T>(arr: readonly T[], index: number, msg?: string): T {
  assert.ok(index >= 0 && index < arr.length, msg ?? `Index ${String(index)} out of bounds (len=${String(arr.length)})`);
  return arr[index] as T;
}

/**
 * Assert that a value is defined (not undefined/null) and return it typed.
 */
export function expectDefined<T>(value: T | undefined | null, msg?: string): T {
  assert.ok(value !== undefined && value !== null, msg ?? 'Expected defined value but got undefined/null');
  return value as T;
}