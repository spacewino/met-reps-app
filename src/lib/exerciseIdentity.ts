/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExerciseEntry } from '../types';

/**
 * Deterministic exercise name normalizer.
 * 
 * Rules:
 * 1. Non-string values return null.
 * 2. Trims surrounding whitespace.
 * 3. Normalizes Unicode using NFKD.
 * 4. Removes combining diacritic marks.
 * 5. Converts to lowercase.
 * 6. Replaces consecutive non-alphanumeric characters with a single underscore.
 * 7. Removes leading and trailing underscores.
 * 8. An empty or invalid result returns null.
 */
export function canonicalizeExerciseName(name: unknown): string | null {
  if (typeof name !== 'string') {
    return null;
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = typeof trimmed.normalize === 'function' ? trimmed.normalize('NFKD') : trimmed;
  const withoutDiacritics = normalized.replace(/[\u0300-\u036f]/g, '');
  const lower = withoutDiacritics.toLowerCase();
  const withUnderscores = lower.replace(/[^a-z0-9]+/g, '_');
  const slug = withUnderscores.replace(/^_+|_+$/g, '');

  return slug.length > 0 ? slug : null;
}

/**
 * Resolves the authoritative exerciseKey for an exercise entry or legacy name.
 * 
 * Rules:
 * 1. A non-empty explicit exerciseKey is authoritative.
 * 2. Trims surrounding whitespace from an explicit key.
 * 3. Does not regenerate an explicit key from the current display name.
 * 4. Does not lowercase, re-slug, or otherwise mutate a valid explicit key.
 * 5. If no explicit key exists, returns the deterministic canonical name slug as legacy identity fallback.
 * 6. If neither a valid key nor valid name exists, returns null.
 */
export function resolveExerciseKey(
  exercise?: Pick<ExerciseEntry, 'exerciseKey' | 'name'> | null
): string | null {
  if (!exercise) {
    return null;
  }

  if (typeof exercise.exerciseKey === 'string') {
    const trimmedKey = exercise.exerciseKey.trim();
    if (trimmedKey.length > 0) {
      return trimmedKey;
    }
  }

  if (typeof exercise.name === 'string') {
    return canonicalizeExerciseName(exercise.name);
  }

  return null;
}

/**
 * Validates whether a value is a non-empty, usable exercise key.
 * Does not impose constraints that would reject future custom UUID keys.
 */
export function isUsableExerciseKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
