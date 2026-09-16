/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SetEntry,
  ExerciseEntry,
  WorkoutLog,
  PrescriptionSnapshot,
} from '../types';
import {
  CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
  CURRENT_PROGRESSION_POLICY_VERSION,
  CURRENT_ALGORITHM_VERSION,
  isValidSnapshotStepMetadata,
} from './programProgressionMode';
import { getRpePercentage, isValidRPE } from './rpeMath';
import {
  resolveGuidedComparisonLoad,
  calculateRequiredCapacityIndex,
} from './adaptiveProgressionMath';

export type GuidedSetOutcome =
  | 'success'
  | 'marginal_miss'
  | 'substantial_miss'
  | 'neutral'
  | 'ineligible';

export type GuidedSetOutcomeReason =
  // Neutral reasons
  | 'SKIPPED_EXERCISE'
  | 'SKIPPED_SET'
  // Ineligible exclusions & mismatches
  | 'WARMUP_SET_EXCLUDED'
  | 'DROP_SET_EXCLUDED'
  | 'LOOSE_FORM_EXCLUDED'
  | 'ONE_OFF_WORKOUT_EXCLUDED'
  | 'MISSING_SNAPSHOT'
  | 'NON_GUIDED_MODE'
  | 'SNAPSHOT_VERSION_MISMATCH'
  | 'POLICY_VERSION_MISMATCH'
  | 'ALGORITHM_VERSION_MISMATCH'
  | 'EXERCISE_KEY_MISMATCH'
  | 'UNSUPPORTED_MODALITY'
  | 'MODALITY_MISMATCH'
  | 'LOAD_BASIS_MISMATCH'
  | 'INVALID_SNAPSHOT_PRESCRIPTION'
  | 'INVALID_WORKING_SET_ORDINAL'
  | 'MISSING_COMPLETION_STATUS'
  | 'INVALID_PERFORMANCE_REPS'
  | 'INVALID_ACTUAL_RPE'
  | 'INVALID_ACTUAL_LOAD'
  // Success reasons
  | 'TARGET_ACHIEVED_WITHOUT_RPE'
  | 'TARGET_ACHIEVED_EXACT'
  | 'TARGET_ACHIEVED_OVERPERFORMANCE'
  | 'TARGET_ACHIEVED_TOLERATED_EXERTION'
  // Marginal miss reasons
  | 'MARGINAL_MISS_REPS'
  | 'MARGINAL_MISS_LOAD'
  | 'MARGINAL_MISS_EXERTION_OVERSHOOT'
  // Substantial miss reasons
  | 'SUBSTANTIAL_MISS_REPS'
  | 'SUBSTANTIAL_MISS_LOAD'
  | 'SUBSTANTIAL_MISS_MULTIPLE_FACTORS'
  | 'SUBSTANTIAL_MISS_SEVERE_EXERTION'
  | 'UNCOMPLETED_SET'
  | 'ZERO_REPS_PERFORMED'
  | 'SUBSTANTIAL_MISS_OTHER';

export interface ClassifyGuidedSetOutcomeInput {
  set: SetEntry;
  exercise: ExerciseEntry;
  workout: WorkoutLog;
}

export interface GuidedSetOutcomeResult {
  outcome: GuidedSetOutcome;
  reason: GuidedSetOutcomeReason;
  targetAchieved: boolean;
  extraCapacityCreditEligible: boolean;
  rpeSource: 'explicit' | 'presented_target_imputation' | null;
  actualComparisonLoadKg: number | null;
  presentedComparisonLoadKg: number | null;
  presentedCapacityIndex: number | null;
  actualCapacityIndex: number | null;
  relativePerformance: number | null;
}

/**
 * Small documented floating-point epsilon for normalized comparison-load equality.
 * Accounts for 64-bit IEEE 754 precision during kg/lb conversions and calculations.
 */
export const LOAD_EQUALITY_EPSILON = 1e-6;

/**
 * Small documented epsilon for required capacity index equality.
 */
export const CAPACITY_EQUALITY_EPSILON = 1e-6;

/**
 * Small documented epsilon for 5.0% load shortfall cap comparison.
 */
export const SHORTFALL_CAP_EPSILON = 1e-6;

function createNeutralResult(reason: GuidedSetOutcomeReason): GuidedSetOutcomeResult {
  return {
    outcome: 'neutral',
    reason,
    targetAchieved: false,
    extraCapacityCreditEligible: false,
    rpeSource: null,
    actualComparisonLoadKg: null,
    presentedComparisonLoadKg: null,
    presentedCapacityIndex: null,
    actualCapacityIndex: null,
    relativePerformance: null,
  };
}

function createIneligibleResult(reason: GuidedSetOutcomeReason): GuidedSetOutcomeResult {
  return {
    outcome: 'ineligible',
    reason,
    targetAchieved: false,
    extraCapacityCreditEligible: false,
    rpeSource: null,
    actualComparisonLoadKg: null,
    presentedComparisonLoadKg: null,
    presentedCapacityIndex: null,
    actualCapacityIndex: null,
    relativePerformance: null,
  };
}

/**
 * Pure, deterministic classifier comparing one completed Guided working set against its immutable PrescriptionSnapshot.
 *
 * Rules:
 * 1. Performs no storage reads or writes.
 * 2. Performs no DOM work.
 * 3. Mutates no inputs (deep immutability preserved).
 * 4. Returns identical results for identical inputs.
 * 5. Uses workout.unit as the authority for actual set weight.
 * 6. Uses snapshot.comparisonLoadKg for the presented target comparison load.
 * 7. Follows strict deterministic eligibility precedence.
 */
export function classifyGuidedSetOutcome(
  input: ClassifyGuidedSetOutcomeInput
): GuidedSetOutcomeResult {
  const { set, exercise, workout } = input;

  // 1. Intentional neutral outcomes (before requiring a valid snapshot)
  if (exercise?.isSkipped === true) {
    return createNeutralResult('SKIPPED_EXERCISE');
  }
  if (set?.isSkipped === true) {
    return createNeutralResult('SKIPPED_SET');
  }

  // 2. Set-type exclusions
  if (set?.isWarmup === true) {
    return createIneligibleResult('WARMUP_SET_EXCLUDED');
  }
  if (set?.isDropSet === true || (Array.isArray(set?.dropSubSets) && set.dropSubSets.length > 0)) {
    return createIneligibleResult('DROP_SET_EXCLUDED');
  }
  if (set?.form === 'loose') {
    return createIneligibleResult('LOOSE_FORM_EXCLUDED');
  }

  // 3. Workout context
  const programId = workout?.programId;
  const isOneOffOrRedo =
    !programId ||
    typeof programId !== 'string' ||
    programId.trim() === '' ||
    workout?.program === 'One Off' ||
    (typeof workout?.program === 'string' && workout.program.toLowerCase().includes('one off'));

  if (isOneOffOrRedo) {
    return createIneligibleResult('ONE_OFF_WORKOUT_EXCLUDED');
  }

  // 4. Snapshot existence and mode
  const snapshot = set?.prescriptionSnapshot;
  if (!snapshot) {
    return createIneligibleResult('MISSING_SNAPSHOT');
  }
  if (snapshot.progressionMode !== 'metreps_guided') {
    return createIneligibleResult('NON_GUIDED_MODE');
  }

  // 5. Snapshot integrity
  if (snapshot.snapshotVersion !== CURRENT_PRESCRIPTION_SNAPSHOT_VERSION) {
    return createIneligibleResult('SNAPSHOT_VERSION_MISMATCH');
  }
  if (snapshot.progressionPolicyVersion !== CURRENT_PROGRESSION_POLICY_VERSION) {
    return createIneligibleResult('POLICY_VERSION_MISMATCH');
  }
  if (snapshot.algorithmVersion !== CURRENT_ALGORITHM_VERSION) {
    return createIneligibleResult('ALGORITHM_VERSION_MISMATCH');
  }
  if (
    !snapshot.exerciseKey ||
    typeof snapshot.exerciseKey !== 'string' ||
    !exercise?.exerciseKey ||
    typeof exercise.exerciseKey !== 'string' ||
    snapshot.exerciseKey !== exercise.exerciseKey
  ) {
    return createIneligibleResult('EXERCISE_KEY_MISMATCH');
  }
  if (
    snapshot.modality !== 'weighted' &&
    snapshot.modality !== 'bodyweight' &&
    snapshot.modality !== 'assisted'
  ) {
    return createIneligibleResult('UNSUPPORTED_MODALITY');
  }
  if (snapshot.modality !== exercise.modality) {
    return createIneligibleResult('MODALITY_MISMATCH');
  }
  if (
    (snapshot.modality === 'weighted' && snapshot.loadBasis !== 'external_weight_v1') ||
    (snapshot.modality === 'bodyweight' && snapshot.loadBasis !== 'bodyweight_normalized_v1') ||
    (snapshot.modality === 'assisted' && snapshot.loadBasis !== 'assisted_net_normalized_v1')
  ) {
    return createIneligibleResult('LOAD_BASIS_MISMATCH');
  }
  if (
    typeof snapshot.presentedReps !== 'number' ||
    !Number.isFinite(snapshot.presentedReps) ||
    !Number.isInteger(snapshot.presentedReps) ||
    snapshot.presentedReps <= 0
  ) {
    return createIneligibleResult('INVALID_SNAPSHOT_PRESCRIPTION');
  }
  if (!isValidRPE(snapshot.presentedRpe)) {
    return createIneligibleResult('INVALID_SNAPSHOT_PRESCRIPTION');
  }
  if (
    typeof snapshot.comparisonLoadKg !== 'number' ||
    !Number.isFinite(snapshot.comparisonLoadKg) ||
    snapshot.comparisonLoadKg <= 0
  ) {
    return createIneligibleResult('INVALID_SNAPSHOT_PRESCRIPTION');
  }
  if (
    typeof snapshot.prescribedWorkingSetCount !== 'number' ||
    !Number.isFinite(snapshot.prescribedWorkingSetCount) ||
    !Number.isInteger(snapshot.prescribedWorkingSetCount) ||
    snapshot.prescribedWorkingSetCount < 1
  ) {
    return createIneligibleResult('INVALID_SNAPSHOT_PRESCRIPTION');
  }
  if (
    typeof snapshot.workingSetOrdinal !== 'number' ||
    !Number.isFinite(snapshot.workingSetOrdinal) ||
    !Number.isInteger(snapshot.workingSetOrdinal) ||
    snapshot.workingSetOrdinal < 1 ||
    snapshot.workingSetOrdinal > snapshot.prescribedWorkingSetCount
  ) {
    return createIneligibleResult('INVALID_WORKING_SET_ORDINAL');
  }
  if (!isValidSnapshotStepMetadata(snapshot)) {
    return createIneligibleResult('INVALID_SNAPSHOT_PRESCRIPTION');
  }

  // Presented baseline diagnostics
  const presentedComparisonLoadKg = snapshot.comparisonLoadKg;
  const presentedCapacityIndex = calculateRequiredCapacityIndex(
    presentedComparisonLoadKg,
    snapshot.presentedReps,
    snapshot.presentedRpe
  );

  // 6. Actual performance integrity
  if (set.isCompleted === undefined || set.isCompleted === null) {
    return createIneligibleResult('MISSING_COMPLETION_STATUS');
  }

  const isRpeMissing = set.rpe === null || set.rpe === undefined || set.rpe === 0;

  if (set.isCompleted === false) {
    return {
      outcome: 'substantial_miss',
      reason: 'UNCOMPLETED_SET',
      targetAchieved: false,
      extraCapacityCreditEligible: false,
      rpeSource: isRpeMissing
        ? 'presented_target_imputation'
        : (typeof set.rpe === 'number' && isValidRPE(set.rpe) ? 'explicit' : null),
      actualComparisonLoadKg: null,
      presentedComparisonLoadKg,
      presentedCapacityIndex,
      actualCapacityIndex: null,
      relativePerformance: null,
    };
  }

  // Performed reps check
  if (
    typeof set.reps !== 'number' ||
    !Number.isFinite(set.reps) ||
    !Number.isInteger(set.reps) ||
    set.reps < 0
  ) {
    return createIneligibleResult('INVALID_PERFORMANCE_REPS');
  }

  // Actual load resolution
  const actualLoadResult = resolveGuidedComparisonLoad({
    modality: snapshot.modality,
    weight: set.weight,
    bodyweight: workout?.bodyweightSnapshot,
    unit: workout?.unit,
  });

  if (!actualLoadResult.eligible) {
    return createIneligibleResult('INVALID_ACTUAL_LOAD');
  }
  const actualComparisonLoadKg = actualLoadResult.comparisonLoadKg;

  // Zero performed reps is a substantial miss
  if (set.reps === 0) {
    return {
      outcome: 'substantial_miss',
      reason: 'ZERO_REPS_PERFORMED',
      targetAchieved: false,
      extraCapacityCreditEligible: false,
      rpeSource: isRpeMissing
        ? 'presented_target_imputation'
        : (typeof set.rpe === 'number' && isValidRPE(set.rpe) ? 'explicit' : null),
      actualComparisonLoadKg,
      presentedComparisonLoadKg,
      presentedCapacityIndex,
      actualCapacityIndex: null,
      relativePerformance: null,
    };
  }

  // Canonical RPE check
  if (!isRpeMissing && (typeof set.rpe !== 'number' || !isValidRPE(set.rpe))) {
    return createIneligibleResult('INVALID_ACTUAL_RPE');
  }

  // Calculate actual capacity index and relative performance
  const effectiveRpe = isRpeMissing ? snapshot.presentedRpe : set.rpe!;
  const rpeSource: 'explicit' | 'presented_target_imputation' = isRpeMissing
    ? 'presented_target_imputation'
    : 'explicit';

  const actualCapacityIndex = calculateRequiredCapacityIndex(
    actualComparisonLoadKg,
    set.reps,
    effectiveRpe
  );

  const relativePerformance =
    actualCapacityIndex !== null && presentedCapacityIndex !== null && presentedCapacityIndex > 0
      ? (actualCapacityIndex - presentedCapacityIndex) / presentedCapacityIndex
      : null;

  // Outcome evaluations
  const meetsLoad = actualComparisonLoadKg >= presentedComparisonLoadKg - LOAD_EQUALITY_EPSILON;
  const isLoadBelow = actualComparisonLoadKg < presentedComparisonLoadKg - LOAD_EQUALITY_EPSILON;
  const loadShortfallRatio = isLoadBelow
    ? (presentedComparisonLoadKg - actualComparisonLoadKg) / presentedComparisonLoadKg
    : 0;

  const meetsReps = set.reps >= snapshot.presentedReps;
  const isRepsBelow = set.reps < snapshot.presentedReps;
  const repShortfall = isRepsBelow ? snapshot.presentedReps - set.reps : 0;

  const rpeDiff = effectiveRpe - snapshot.presentedRpe;

  // Helper constructor for outcome results
  const buildResult = (
    outcome: GuidedSetOutcome,
    reason: GuidedSetOutcomeReason,
    targetAchieved: boolean,
    extraCapacityCreditEligible: boolean
  ): GuidedSetOutcomeResult => ({
    outcome,
    reason,
    targetAchieved,
    extraCapacityCreditEligible,
    rpeSource,
    actualComparisonLoadKg,
    presentedComparisonLoadKg,
    presentedCapacityIndex,
    actualCapacityIndex,
    relativePerformance,
  });

  // --- Substantial Miss Conditions ---

  // 1. Both load and reps below target
  if (isLoadBelow && isRepsBelow) {
    return buildResult('substantial_miss', 'SUBSTANTIAL_MISS_MULTIPLE_FACTORS', false, false);
  }

  // 2. Severe exertion overshoot: RPE at least 1.5 above prescription
  if (rpeDiff >= 1.5) {
    return buildResult('substantial_miss', 'SUBSTANTIAL_MISS_SEVERE_EXERTION', false, false);
  }

  // 3. Two simultaneous marginal miss dimensions:
  // (e.g. 1 rep short + exertion overshoot, or small load shortfall + exertion overshoot)
  if ((repShortfall === 1 && rpeDiff === 1.0) || (isLoadBelow && rpeDiff === 1.0)) {
    return buildResult('substantial_miss', 'SUBSTANTIAL_MISS_MULTIPLE_FACTORS', false, false);
  }

  // 4. Repetition shortfall of 2 or more repetitions
  if (repShortfall >= 2) {
    return buildResult('substantial_miss', 'SUBSTANTIAL_MISS_REPS', false, false);
  }

  // 5. Comparison-load shortfall greater than 5.0%
  if (loadShortfallRatio > 0.05 + SHORTFALL_CAP_EPSILON) {
    return buildResult('substantial_miss', 'SUBSTANTIAL_MISS_LOAD', false, false);
  }

  // --- Marginal Miss Conditions ---

  // 1. Exactly one repetition shortfall (load meets target, RPE within tolerance)
  if (repShortfall === 1 && meetsLoad && rpeDiff <= 0.5) {
    return buildResult('marginal_miss', 'MARGINAL_MISS_REPS', false, false);
  }

  // 2. Small load shortfall (<= 5.0% shortfall, reps meet target, RPE within tolerance)
  if (isLoadBelow && loadShortfallRatio <= 0.05 + SHORTFALL_CAP_EPSILON && meetsReps && rpeDiff <= 0.5) {
    return buildResult('marginal_miss', 'MARGINAL_MISS_LOAD', false, false);
  }

  // 3. Exertion overshoot (load and reps meet target, RPE = presented RPE + 1.0)
  if (meetsLoad && meetsReps && rpeDiff === 1.0) {
    return buildResult('marginal_miss', 'MARGINAL_MISS_EXERTION_OVERSHOOT', false, false);
  }

  // --- Success Conditions ---

  if (meetsLoad && meetsReps && rpeDiff <= 0.5) {
    const hasExtraCapacity =
      !isRpeMissing &&
      actualCapacityIndex !== null &&
      presentedCapacityIndex !== null &&
      actualCapacityIndex > presentedCapacityIndex + CAPACITY_EQUALITY_EPSILON;

    let reason: GuidedSetOutcomeReason;
    if (isRpeMissing) {
      reason = 'TARGET_ACHIEVED_WITHOUT_RPE';
    } else if (hasExtraCapacity) {
      reason = 'TARGET_ACHIEVED_OVERPERFORMANCE';
    } else if (rpeDiff > 0 && rpeDiff <= 0.5) {
      reason = 'TARGET_ACHIEVED_TOLERATED_EXERTION';
    } else {
      reason = 'TARGET_ACHIEVED_EXACT';
    }

    return buildResult('success', reason, true, hasExtraCapacity);
  }

  // Fallback for any other failure
  return buildResult('substantial_miss', 'SUBSTANTIAL_MISS_OTHER', false, false);
}
