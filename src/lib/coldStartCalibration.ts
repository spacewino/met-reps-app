import { ExerciseEntry, WeightUnit } from '../types';
import { getRTSMultiplier } from './rpeMath';
import { roundToNearest25 } from './weightMath';
import { getFatiguePrior, FatiguePriorProfile } from './setDistribution';
import { deriveCanonicalPrescriptionShape, resolveEffectiveAlgorithm } from './objectiveMath';
import { CommittedLiveEvidence } from './liveAdjustmentMath';
import { PrescribedTargetSnapshotMap } from './liveAdjustmentSession';
import { getExerciseClassification } from './exerciseClassification';

export interface ColdStartCapacities {
  plannedCapacityE1RM: number | null;
  observedCapacityE1RM: number | null;
  readinessRatio: number | null;
}

/**
 * Derives planned session capacity (e1RM) from a user-selected provisional positive load
 * combined with canonical prescription-shape reps and target RPE.
 */
export function deriveColdStartPlannedCapacityE1RM(
  provisionalWeight: number,
  canonicalReps: number,
  canonicalRPE: number
): number | null {
  if (
    typeof provisionalWeight !== 'number' ||
    !Number.isFinite(provisionalWeight) ||
    provisionalWeight <= 0 ||
    typeof canonicalReps !== 'number' ||
    canonicalReps <= 0 ||
    typeof canonicalRPE !== 'number' ||
    canonicalRPE < 6.0 ||
    canonicalRPE > 10.0
  ) {
    return null;
  }

  const plannedMultiplier = getRTSMultiplier(canonicalReps, canonicalRPE);
  if (!plannedMultiplier || plannedMultiplier <= 0) {
    return null;
  }

  return provisionalWeight / plannedMultiplier;
}

/**
 * Derives observed session capacity (e1RM) from explicitly committed performance evidence
 * (actual positive weight, actual reps, actual committed RPE).
 */
export function deriveColdStartObservedCapacityE1RM(
  actualWeight: number,
  actualReps: number,
  actualRPE: number
): number | null {
  if (
    typeof actualWeight !== 'number' ||
    !Number.isFinite(actualWeight) ||
    actualWeight <= 0 ||
    typeof actualReps !== 'number' ||
    actualReps <= 0 ||
    typeof actualRPE !== 'number' ||
    actualRPE < 6.0 ||
    actualRPE > 10.0
  ) {
    return null;
  }

  const actualMultiplier = getRTSMultiplier(actualReps, actualRPE);
  if (!actualMultiplier || actualMultiplier <= 0) {
    return null;
  }

  return actualWeight / actualMultiplier;
}

/**
 * Derives the canonical target shape (reps, RPE, form) for a given ordinal (1..6)
 * based on objective, algorithmId, weekNum, programDuration, and exercise properties.
 */
export function deriveColdStartOrdinalShape(params: {
  objective: 'Hypertrophy' | 'Strength';
  algorithmId?: string;
  exercise: ExerciseEntry;
  weekNum: number;
  programDuration?: number;
  ordinal: number;
  algorithmPhaseOffset?: number;
}): { reps: number; rpe: number; form: 'standard' | 'strict' | 'loose'; profileType: FatiguePriorProfile } | null {
  const { objective, algorithmId, exercise, weekNum, programDuration = 8, ordinal, algorithmPhaseOffset } = params;

  if (ordinal < 1 || ordinal > 6) {
    return null;
  }

  const effectiveAlgorithmId = resolveEffectiveAlgorithm(objective, algorithmId);
  if (!effectiveAlgorithmId) {
    return null;
  }

  const shape = deriveCanonicalPrescriptionShape({
    objective,
    effectiveAlgorithmId,
    exercise,
    weekNum,
    programDuration,
    algorithmPhaseOffset,
  });

  if (!shape) {
    return null;
  }

  const { anchorReps, anchorRPE, profileType } = shape;

  if (profileType === 'hypertrophy') {
    const classification = getExerciseClassification(exercise);
    const isIsolation = classification.category === 'isolation';
    const rpeCeiling = isIsolation ? 9.5 : 9.0;
    const targetRPE = Math.min(anchorRPE + 0.5 * (ordinal - 1), rpeCeiling);
    return {
      reps: anchorReps,
      rpe: targetRPE,
      form: 'standard',
      profileType,
    };
  }

  if (profileType === 'strength_post_test') {
    if (ordinal === 1) {
      return {
        reps: 1,
        rpe: anchorRPE,
        form: 'standard',
        profileType,
      };
    }
    const backoffRPESchedule = [7.5, 8.0, 8.0, 8.5, 8.5];
    return {
      reps: 3,
      rpe: backoffRPESchedule[ordinal - 2] ?? 8.5,
      form: 'standard',
      profileType,
    };
  }

  // strength_normal
  if (ordinal === 1) {
    return {
      reps: anchorReps,
      rpe: anchorRPE,
      form: 'standard',
      profileType,
    };
  }

  const backoffBaseRPE = Math.max(6.0, Math.min(8.0, anchorRPE - 1.0));
  const targetRPE_i = Math.min(anchorRPE, 8.5, backoffBaseRPE + 0.5 * (ordinal - 2));

  return {
    reps: anchorReps,
    rpe: targetRPE_i,
    form: 'standard',
    profileType,
  };
}

/**
 * Resolves planned prescribed targets (ordinals 1..workingSetCount) calibrated from
 * a positive planned session capacity.
 */
export function deriveColdStartCalibratedPlannedTargets(params: {
  objective: 'Hypertrophy' | 'Strength';
  algorithmId?: string;
  exercise: ExerciseEntry;
  weekNum: number;
  programDuration?: number;
  plannedCapacityE1RM: number;
  workingSetCount: number;
  algorithmPhaseOffset?: number;
}): Array<{ workingSetOrdinal: number; weight: number; reps: number; rpe: number }> | null {
  const {
    objective,
    algorithmId,
    exercise,
    weekNum,
    programDuration = 8,
    plannedCapacityE1RM,
    workingSetCount,
    algorithmPhaseOffset = 0,
  } = params;

  if (plannedCapacityE1RM <= 0 || !Number.isFinite(plannedCapacityE1RM)) {
    return null;
  }

  const shape1 = deriveColdStartOrdinalShape({
    objective,
    algorithmId,
    exercise,
    weekNum,
    programDuration,
    ordinal: 1,
    algorithmPhaseOffset,
  });

  if (!shape1) {
    return null;
  }

  const fatiguePriors = getFatiguePrior(shape1.profileType);
  const count = Math.min(6, Math.max(1, workingSetCount));
  const targets: Array<{ workingSetOrdinal: number; weight: number; reps: number; rpe: number }> = [];

  for (let ord = 1; ord <= count; ord++) {
    const ordShape = deriveColdStartOrdinalShape({
      objective,
      algorithmId,
      exercise,
      weekNum,
      programDuration,
      ordinal: ord,
      algorithmPhaseOffset,
    });
    if (!ordShape) continue;

    const fatigueFactor = fatiguePriors[ord - 1] ?? 1.0;
    const mult = getRTSMultiplier(ordShape.reps, ordShape.rpe);
    if (!mult || mult <= 0) continue;

    const unroundedWeight = plannedCapacityE1RM * fatigueFactor * mult;
    const roundedWeight = roundToNearest25(unroundedWeight);

    targets.push({
      workingSetOrdinal: ord,
      weight: roundedWeight,
      reps: ordShape.reps,
      rpe: ordShape.rpe,
    });
  }

  return targets;
}
