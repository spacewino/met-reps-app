/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ExerciseOriginProvenance,
  ExerciseStructuralMutationReason,
  SessionEvaluationState,
} from './guidedWorkoutOrchestrator';

/**
 * Unique opaque instance identifier distinguishing an exercise occurrence
 * during a single mounted workout session.
 * Monotonically allocated per registry lifecycle; never reused upon deletion.
 */
export type SessionExerciseInstanceId = `session_ex_${number}`;

/**
 * Ephemeral session metadata sidecar for a single exercise occurrence.
 */
export interface SessionExerciseRegistryEntry {
  readonly instanceId: SessionExerciseInstanceId;
  readonly originProvenance: ExerciseOriginProvenance;
  readonly evaluationState: SessionEvaluationState;
  readonly structuralMutationReason?: ExerciseStructuralMutationReason;
}

/**
 * Immutable session-exercise registry containing an ordered list of entries
 * matching the workout session's exercises array, and a monotonic counter authority.
 */
export interface SessionExerciseRegistry {
  readonly entries: readonly SessionExerciseRegistryEntry[];
  readonly nextInstanceId: number;
}

/**
 * Closed result of an immutable registry mutation operation.
 */
export type SessionExerciseRegistryOperationResult =
  | { readonly applied: true; readonly registry: SessionExerciseRegistry }
  | { readonly applied: false; readonly registry: SessionExerciseRegistry };

/**
 * Helper to validate integer non-negative index within bounds.
 */
function isValidIndex(index: number, length: number): boolean {
  return (
    typeof index === 'number' &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < length
  );
}

/**
 * Helper to construct a typed SessionExerciseInstanceId.
 */
function makeInstanceId(num: number): SessionExerciseInstanceId {
  return `session_ex_${num}`;
}

/**
 * Creates a fresh immutable SessionExerciseRegistry from an initial sequence
 * of ExerciseOriginProvenance values.
 *
 * Each entry is allocated a unique monotonic instanceId and an initial
 * evaluationState of `{ status: 'not_evaluated' }`.
 */
export function createSessionExerciseRegistry(
  provenances: readonly ExerciseOriginProvenance[]
): SessionExerciseRegistry {
  let counter = 1;
  const entries: SessionExerciseRegistryEntry[] = [];

  for (let i = 0; i < provenances.length; i++) {
    entries.push({
      instanceId: makeInstanceId(counter),
      originProvenance: provenances[i],
      evaluationState: { status: 'not_evaluated' },
    });
    counter++;
  }

  return {
    entries: Object.freeze(entries),
    nextInstanceId: counter,
  };
}

/**
 * Appends a new exercise entry to the end of the registry with a fresh monotonic instanceId.
 */
export function appendSessionExerciseRegistryEntry(
  registry: SessionExerciseRegistry,
  originProvenance: ExerciseOriginProvenance
): SessionExerciseRegistryOperationResult {
  const newEntry: SessionExerciseRegistryEntry = {
    instanceId: makeInstanceId(registry.nextInstanceId),
    originProvenance,
    evaluationState: { status: 'not_evaluated' },
  };

  const nextEntries = [...registry.entries, newEntry];

  return {
    applied: true,
    registry: {
      entries: Object.freeze(nextEntries),
      nextInstanceId: registry.nextInstanceId + 1,
    },
  };
}

/**
 * Replaces an existing registry entry at `index` with a new entry.
 * Allocates a fresh monotonic instanceId, sets the new provenance, resets
 * evaluationState to `{ status: 'not_evaluated' }`, and clears any structural mutation reason.
 *
 * Returns `{ applied: false, registry }` if `index` is invalid.
 */
export function replaceSessionExerciseRegistryEntry(
  registry: SessionExerciseRegistry,
  index: number,
  originProvenance: ExerciseOriginProvenance
): SessionExerciseRegistryOperationResult {
  if (!isValidIndex(index, registry.entries.length)) {
    return { applied: false, registry };
  }

  const newEntry: SessionExerciseRegistryEntry = {
    instanceId: makeInstanceId(registry.nextInstanceId),
    originProvenance,
    evaluationState: { status: 'not_evaluated' },
  };

  const nextEntries = [...registry.entries];
  nextEntries[index] = newEntry;

  return {
    applied: true,
    registry: {
      entries: Object.freeze(nextEntries),
      nextInstanceId: registry.nextInstanceId + 1,
    },
  };
}

/**
 * Removes the registry entry at `index`.
 * Preserves the instance IDs and states of all remaining entries without renumbering.
 *
 * Returns `{ applied: false, registry }` if `index` is invalid.
 */
export function removeSessionExerciseRegistryEntry(
  registry: SessionExerciseRegistry,
  index: number
): SessionExerciseRegistryOperationResult {
  if (!isValidIndex(index, registry.entries.length)) {
    return { applied: false, registry };
  }

  const nextEntries = registry.entries.filter((_, i) => i !== index);

  return {
    applied: true,
    registry: {
      entries: Object.freeze(nextEntries),
      nextInstanceId: registry.nextInstanceId,
    },
  };
}

/**
 * Moves or swaps an exercise entry from `fromIndex` to `toIndex`.
 * Matches WorkoutLogger's exact `handleMoveExercise` adjacent swap semantics:
 *
 * The entry and all its associated metadata (instanceId, provenance, evaluationState,
 * structuralMutationReason) travel with that position.
 *
 * If `fromIndex === toIndex`, returns `{ applied: false, registry }` with the original registry unchanged.
 * If either index is invalid, returns `{ applied: false, registry }`.
 */
export function moveSessionExerciseRegistryEntry(
  registry: SessionExerciseRegistry,
  fromIndex: number,
  toIndex: number
): SessionExerciseRegistryOperationResult {
  if (!isValidIndex(fromIndex, registry.entries.length)) {
    return { applied: false, registry };
  }
  if (!isValidIndex(toIndex, registry.entries.length)) {
    return { applied: false, registry };
  }
  if (fromIndex === toIndex) {
    return { applied: false, registry };
  }

  const nextEntries = [...registry.entries];
  const temp = nextEntries[fromIndex];
  nextEntries[fromIndex] = nextEntries[toIndex];
  nextEntries[toIndex] = temp;

  return {
    applied: true,
    registry: {
      entries: Object.freeze(nextEntries),
      nextInstanceId: registry.nextInstanceId,
    },
  };
}

/**
 * Updates the `SessionEvaluationState` of the entry at `index`.
 * Preserves instanceId, originProvenance, and any existing structuralMutationReason.
 *
 * Returns `{ applied: false, registry }` if `index` is invalid.
 */
export function updateSessionExerciseEvaluationState(
  registry: SessionExerciseRegistry,
  index: number,
  evaluationState: SessionEvaluationState
): SessionExerciseRegistryOperationResult {
  if (!isValidIndex(index, registry.entries.length)) {
    return { applied: false, registry };
  }

  const currentEntry = registry.entries[index];
  const updatedEntry: SessionExerciseRegistryEntry = {
    ...currentEntry,
    evaluationState,
  };

  const nextEntries = [...registry.entries];
  nextEntries[index] = updatedEntry;

  return {
    applied: true,
    registry: {
      entries: Object.freeze(nextEntries),
      nextInstanceId: registry.nextInstanceId,
    },
  };
}

/**
 * Marks an `ExerciseStructuralMutationReason` on the entry at `index`.
 * Preserves instanceId, originProvenance, and evaluationState.
 *
 * Returns `{ applied: false, registry }` if `index` is invalid.
 */
export function markSessionExerciseStructuralMutation(
  registry: SessionExerciseRegistry,
  index: number,
  reason: ExerciseStructuralMutationReason
): SessionExerciseRegistryOperationResult {
  if (!isValidIndex(index, registry.entries.length)) {
    return { applied: false, registry };
  }

  const currentEntry = registry.entries[index];
  const updatedEntry: SessionExerciseRegistryEntry = {
    ...currentEntry,
    structuralMutationReason: reason,
  };

  const nextEntries = [...registry.entries];
  nextEntries[index] = updatedEntry;

  return {
    applied: true,
    registry: {
      entries: Object.freeze(nextEntries),
      nextInstanceId: registry.nextInstanceId,
    },
  };
}

/**
 * Clears the registry, returning a fresh empty registry with `nextInstanceId` reset to 1.
 * Does not mutate the input registry.
 */
export function clearSessionExerciseRegistry(): SessionExerciseRegistry {
  return {
    entries: Object.freeze([]),
    nextInstanceId: 1,
  };
}
