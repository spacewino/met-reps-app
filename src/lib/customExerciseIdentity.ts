/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExerciseItem } from '../components/ExerciseSelectorModal';

/**
 * Validates whether a value is a valid custom exercise key.
 * Must be a non-empty string starting with 'custom_' with non-empty suffix.
 */
export function isCustomExerciseKey(key: unknown): key is string {
  if (typeof key !== 'string') {
    return false;
  }
  const trimmed = key.trim();
  return trimmed.startsWith('custom_') && trimmed.length > 'custom_'.length;
}

/**
 * Generates a custom exercise key in the format `custom_<uuid>`.
 */
export function generateCustomExerciseKey(
  uuidGenerator: () => string = () => crypto.randomUUID()
): string {
  return `custom_${uuidGenerator()}`;
}

/**
 * Generates a collision-free custom exercise key against an existing collection of keys/items.
 */
export function generateUniqueCustomExerciseKey(
  existingKeys: Iterable<string> | Set<string> | Array<{ exerciseKey?: string } | string>,
  uuidGenerator: () => string = () => crypto.randomUUID()
): string {
  const keySet = new Set<string>();

  if (Array.isArray(existingKeys)) {
    for (const item of existingKeys) {
      if (typeof item === 'string') {
        if (item.trim()) keySet.add(item.trim());
      } else if (item && typeof item.exerciseKey === 'string') {
        if (item.exerciseKey.trim()) keySet.add(item.exerciseKey.trim());
      }
    }
  } else if (existingKeys instanceof Set) {
    for (const k of existingKeys) {
      if (typeof k === 'string' && k.trim()) keySet.add(k.trim());
    }
  } else if (existingKeys && typeof (existingKeys as any)[Symbol.iterator] === 'function') {
    for (const k of existingKeys as Iterable<string>) {
      if (typeof k === 'string' && k.trim()) keySet.add(k.trim());
    }
  }

  let newKey = generateCustomExerciseKey(uuidGenerator);
  while (keySet.has(newKey)) {
    newKey = generateCustomExerciseKey(uuidGenerator);
  }
  return newKey;
}

/**
 * Pure preparation of a migrated custom exercise catalog.
 * 
 * Rules:
 * 1. Preserves catalog ordering and all existing metadata.
 * 2. Preserves valid, unique `custom_` keys verbatim.
 * 3. Assigns a new collision-free UUID key to entries whose key is missing, blank, malformed, non-custom, or duplicated.
 * 4. Accepts an injectable uuidGenerator for deterministic testing.
 */
export function prepareMigratedCustomCatalog<T extends { exerciseKey?: string; [key: string]: any }>(
  rawCatalog: T[],
  uuidGenerator: () => string = () => crypto.randomUUID()
): { migratedCatalog: (T & { exerciseKey: string })[]; hasChanges: boolean } {
  if (!Array.isArray(rawCatalog)) {
    return { migratedCatalog: [], hasChanges: false };
  }

  const usedKeys = new Set<string>();
  let hasChanges = false;

  const migratedCatalog = rawCatalog.map(item => {
    const rawKey = typeof item.exerciseKey === 'string' ? item.exerciseKey.trim() : '';

    if (rawKey && isCustomExerciseKey(rawKey) && !usedKeys.has(rawKey)) {
      usedKeys.add(rawKey);
      return {
        ...item,
        exerciseKey: rawKey,
      };
    }

    // Key is missing, malformed, non-custom, or duplicate: repair with new UUID
    hasChanges = true;
    const newKey = generateUniqueCustomExerciseKey(usedKeys, uuidGenerator);
    usedKeys.add(newKey);
    return {
      ...item,
      exerciseKey: newKey,
    };
  });

  return { migratedCatalog, hasChanges };
}

/**
 * Loads custom exercises from storage and atomically repairs any legacy/unkeyed entries.
 * 
 * Atomic persistence guarantee:
 * - If upgrades are needed, writes the complete upgraded array back via storage.setItem.
 * - Only exposes newly generated keys if the write succeeds.
 * - If persistence throws or fails, returns the original legacy catalog without exposing ephemeral keys.
 */
export function loadAndRepairCustomExercises(
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  uuidGenerator: () => string = () => crypto.randomUUID()
): ExerciseItem[] {
  try {
    const raw = storage.getItem('metreps_custom_exercises');
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const { migratedCatalog, hasChanges } = prepareMigratedCustomCatalog<ExerciseItem>(parsed, uuidGenerator);

    if (!hasChanges) {
      return migratedCatalog;
    }

    // Persist upgraded catalog atomically before exposing keys to memory
    try {
      storage.setItem('metreps_custom_exercises', JSON.stringify(migratedCatalog));
      return migratedCatalog;
    } catch (persistErr) {
      console.error('Failed to persist upgraded custom exercise catalog:', persistErr);
      // Return original legacy catalog without exposing unpersisted keys
      return parsed;
    }
  } catch (err) {
    console.error('Failed to load custom exercises from storage:', err);
    return [];
  }
}
