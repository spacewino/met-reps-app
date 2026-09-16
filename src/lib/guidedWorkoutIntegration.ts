/**
 * Pure Workout Integration Helper
 *
 * Orchestrates an ordered collection of per-exercise workout requests by assembling
 * the exact `OrchestrateGuidedExerciseInput` required by `orchestrateGuidedExercisePrescription`.
 *
 * Invariants:
 * - Pure and deterministic.
 * - No React, DOM, localStorage, random ID generation, or wall-clock dependencies.
 * - Preserves all input order, input immutability, and complete unflattened orchestrator results.
 * - Derives types directly from `src/lib/guidedWorkoutOrchestrator.ts`.
 */

import {
  orchestrateGuidedExercisePrescription,
  type OrchestrateGuidedExerciseInput,
  type ExerciseLifecycleEvidence,
  type OrchestratedExerciseResult,
} from './guidedWorkoutOrchestrator';
import type { ExerciseEntry } from '../types';

/**
 * Shared workout session context common across all exercises in a workout request.
 * Derived by omitting exercise-specific and lower-level execution fields from `OrchestrateGuidedExerciseInput`.
 */
export type GuidedWorkoutIntegrationContext = Readonly<
  Omit<
    OrchestrateGuidedExerciseInput,
    | 'exercise'
    | 'lifecycleEvidence'
    | 'templateExercise'
    | 'calculateBundleFn'
    | 'adaptPrescriptionFn'
  >
>;

/**
 * Per-exercise lifecycle evidence provided by the caller, excluding `exerciseIndex`.
 * The authoritative `exerciseIndex` is supplied on the item level and combined deterministically
 * by the integration helper to eliminate conflicting index declarations.
 */
export type GuidedWorkoutIntegrationLifecycleEvidence = Readonly<
  Omit<ExerciseLifecycleEvidence, 'exerciseIndex'>
>;

/**
 * Per-exercise request item submitted for guided workout orchestration.
 */
export interface GuidedWorkoutIntegrationItem {
  readonly exercise: ExerciseEntry;
  readonly exerciseIndex: number;
  readonly lifecycleEvidence: GuidedWorkoutIntegrationLifecycleEvidence;
  readonly templateExercise?: ExerciseEntry;
}

/**
 * Full input contract for `orchestrateGuidedWorkoutExercises`.
 */
export interface GuidedWorkoutIntegrationInput {
  readonly context: GuidedWorkoutIntegrationContext;
  readonly items: readonly GuidedWorkoutIntegrationItem[];
  /**
   * Optional injected orchestrator function solely for hermetic call-count
   * and input-assembly isolation tests. Defaults to `orchestrateGuidedExercisePrescription`.
   */
  readonly orchestrateExerciseFn?: typeof orchestrateGuidedExercisePrescription;
}

/**
 * Output entry preserving the corresponding exerciseIndex and full, unflattened OrchestratedExerciseResult.
 */
export interface GuidedWorkoutIntegrationEntryResult {
  readonly exerciseIndex: number;
  readonly result: OrchestratedExerciseResult;
}

/**
 * Orchestrates an ordered collection of exercise requests against the locked orchestrator authority.
 *
 * Returns an empty array if `items` is empty without invoking the orchestrator.
 * Preserves input order and honest `exerciseIndex` values (including invalid values for fail-closed handling).
 */
export function orchestrateGuidedWorkoutExercises(
  input: GuidedWorkoutIntegrationInput
): readonly GuidedWorkoutIntegrationEntryResult[] {
  const { context, items } = input;

  if (items.length === 0) {
    return [];
  }

  const orchestrateFn =
    input.orchestrateExerciseFn ?? orchestrateGuidedExercisePrescription;

  const results: GuidedWorkoutIntegrationEntryResult[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    const lifecycleEvidence: ExerciseLifecycleEvidence = {
      ...item.lifecycleEvidence,
      exerciseIndex: item.exerciseIndex,
    };

    const orchestratorInput: OrchestrateGuidedExerciseInput = {
      ...context,
      exercise: item.exercise,
      lifecycleEvidence,
      templateExercise: item.templateExercise,
    };

    const result = orchestrateFn(orchestratorInput);

    results.push({
      exerciseIndex: item.exerciseIndex,
      result,
    });
  }

  return results;
}
