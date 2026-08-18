/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExerciseEntry, SetEntry, WeightUnit, BodyweightSnapshot } from '../types';
import { roundToNearest25 } from './objectiveMath';
import { generateAssistedWarmupTargets } from './assistedLoadMath';
import { validateBodyweightSnapshot, generateBodyweightWarmupTargets } from './bodyweightSessionMath';

export type AutoWarmupBypassReason =
  | 'unsupported_modality'
  | 'missing_weight_and_reps'
  | 'missing_weight'
  | 'invalid_working_reps'
  | 'insufficient_repetition_resolution'
  | 'missing_assistance_and_reps'
  | 'missing_assistance'
  | 'missing_bodyweight'
  | 'invalid_bodyweight'
  | 'missing_bodyweight_unit'
  | 'negative_assistance'
  | 'zero_effective_load'
  | 'assistance_exceeds_bodyweight'
  | 'insufficient_assistance_resolution'
  | 'no_working_set'
  | 'unknown';

export interface AutoWarmupTargetSet {
  setNumber: number;
  weight: number;
  reps: number;
  rpe: number;
  form: 'standard';
  isWarmup: true;
}

export type AutoWarmupValidationResult =
  | {
      status: 'valid';
      modality: 'weighted' | 'bodyweight' | 'assisted';
      warmupTargets: AutoWarmupTargetSet[];
      resolvedWorkingTarget: {
        weight?: number;
        reps: number;
      };
    }
  | {
      status: 'bypassed';
      bypassReason: AutoWarmupBypassReason;
      message: string;
      warmupTargets: null;
    };

export interface AutoWarmupValidationInput {
  exercise: ExerciseEntry;
  selectedSetIdx?: number | null;
  bodyweightSnapshot?: BodyweightSnapshot | null;
  activeUnit?: WeightUnit;
}

export const AUTO_WARMUP_TOAST_DURATION_MS = 4000;

// Exact UI feedback messages matching specification
export const AUTO_WARMUP_MESSAGES = {
  // Unsupported modalities
  UNSUPPORTED_MODALITY: 'Auto Warmup is not available for this exercise type.',

  // Weighted modality
  WEIGHTED_MISSING_WEIGHT_AND_REPS: 'Enter a working weight and reps before generating warm-ups.',
  WEIGHTED_MISSING_WEIGHT_ONLY: 'Enter a working weight before generating warm-ups.',
  WEIGHTED_MISSING_REPS_ONLY: 'Enter working reps before generating warm-ups.',

  // Bodyweight modality
  BODYWEIGHT_MISSING_OR_INVALID_REPS: 'Enter working reps before generating bodyweight warm-ups.',
  BODYWEIGHT_ONE_REP_RESOLUTION: 'Use an assisted or easier variation to warm up for a one-rep bodyweight target.',

  // Assisted modality
  ASSISTED_MISSING_ASSISTANCE_AND_REPS: 'Enter working assistance and reps before generating warm-ups.',
  ASSISTED_MISSING_ASSISTANCE_ONLY: 'Enter working assistance before generating warm-ups.',
  ASSISTED_MISSING_REPS_ONLY: 'Enter working reps before generating assisted warm-ups.',
  ASSISTED_MISSING_BODYWEIGHT_SNAPSHOT: 'Set or confirm your bodyweight in Settings to calculate assisted warm-ups.',
  ASSISTED_NEGATIVE_ASSISTANCE: 'Assistance cannot be negative.',
  ASSISTED_EXCEEDS_OR_EQUALS_BW: 'Working assistance must be less than bodyweight to calculate warm-ups.',
  ASSISTED_INSUFFICIENT_RESOLUTION: 'The working load is too close to bodyweight to generate safe 2.5-unit assisted warm-ups.',
  ASSISTED_CANNOT_CALCULATE_DEFAULT: 'Cannot calculate assisted warm-ups.',
} as const;

/**
 * Validates candidate working target parameters and generates calibrated warm-up sets.
 *
 * Rules:
 * 1. Modality Inspection:
 *    - `timed`, `distance`, `distance_loaded` -> bypass with UNSUPPORTED_MODALITY.
 * 2. Row Selection:
 *    - Prioritizes selected non-warm-up, non-skipped working row when valid.
 *    - Otherwise uses first valid non-warm-up, non-skipped working row in the exercise.
 *    - If no valid working target exists, inspects the selected or first working set to provide precise feedback.
 * 3. Zero Fallback Removal:
 *    - Completely eliminates arbitrary defaults like `|| 60` or `|| 10`.
 * 4. Zero Mutation:
 *    - Pure calculation; does not mutate inputs or session state.
 */
export function validateAndGenerateAutoWarmup(
  input: AutoWarmupValidationInput
): AutoWarmupValidationResult {
  const { exercise, selectedSetIdx, bodyweightSnapshot, activeUnit = 'kg' } = input;

  if (!exercise || !exercise.sets || exercise.sets.length === 0) {
    return {
      status: 'bypassed',
      bypassReason: 'no_working_set',
      message: AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_WEIGHT_AND_REPS,
      warmupTargets: null,
    };
  }

  const modality = exercise.modality || 'weighted';

  // 1. Unsupported modalities
  if (modality === 'timed' || modality === 'distance' || modality === 'distance_loaded') {
    return {
      status: 'bypassed',
      bypassReason: 'unsupported_modality',
      message: AUTO_WARMUP_MESSAGES.UNSUPPORTED_MODALITY,
      warmupTargets: null,
    };
  }

  // Helper to extract selected set if within bounds
  const selectedSet: SetEntry | null =
    typeof selectedSetIdx === 'number' &&
    selectedSetIdx >= 0 &&
    selectedSetIdx < exercise.sets.length
      ? exercise.sets[selectedSetIdx]
      : null;

  // Helper to find candidate set for inspection when bypass occurs
  const getInspectedCandidateSet = (): SetEntry | null => {
    if (selectedSet && !selectedSet.isWarmup && !selectedSet.isSkipped) {
      return selectedSet;
    }
    return exercise.sets.find(s => !s.isWarmup && !s.isSkipped) || null;
  };

  // 2. Bodyweight modality
  if (modality === 'bodyweight') {
    const isValidBodyweightReps = (reps: number | null | undefined): reps is number => {
      return typeof reps === 'number' && Number.isFinite(reps) && Number.isInteger(reps) && reps > 0;
    };

    let resolvedReps: number | null = null;

    if (
      selectedSet &&
      !selectedSet.isWarmup &&
      !selectedSet.isSkipped &&
      isValidBodyweightReps(selectedSet.reps)
    ) {
      resolvedReps = selectedSet.reps;
    } else {
      const firstValidWorkingSet = exercise.sets.find(
        s => !s.isWarmup && !s.isSkipped && isValidBodyweightReps(s.reps)
      );
      if (firstValidWorkingSet && isValidBodyweightReps(firstValidWorkingSet.reps)) {
        resolvedReps = firstValidWorkingSet.reps;
      }
    }

    if (resolvedReps === null) {
      const inspected = getInspectedCandidateSet();
      const inspectedReps = inspected?.reps;

      if (inspectedReps === 1) {
        return {
          status: 'bypassed',
          bypassReason: 'insufficient_repetition_resolution',
          message: AUTO_WARMUP_MESSAGES.BODYWEIGHT_ONE_REP_RESOLUTION,
          warmupTargets: null,
        };
      }

      return {
        status: 'bypassed',
        bypassReason: 'invalid_working_reps',
        message: AUTO_WARMUP_MESSAGES.BODYWEIGHT_MISSING_OR_INVALID_REPS,
        warmupTargets: null,
      };
    }

    // Call pure generator
    const bwResult = generateBodyweightWarmupTargets(resolvedReps);

    if (bwResult.status === 'bypassed' || !bwResult.warmupTargets) {
      if (bwResult.bypassReason === 'insufficient_repetition_resolution') {
        return {
          status: 'bypassed',
          bypassReason: 'insufficient_repetition_resolution',
          message: AUTO_WARMUP_MESSAGES.BODYWEIGHT_ONE_REP_RESOLUTION,
          warmupTargets: null,
        };
      }

      return {
        status: 'bypassed',
        bypassReason: 'invalid_working_reps',
        message: AUTO_WARMUP_MESSAGES.BODYWEIGHT_MISSING_OR_INVALID_REPS,
        warmupTargets: null,
      };
    }

    const warmupTargets: AutoWarmupTargetSet[] = bwResult.warmupTargets.map((t, idx) => ({
      setNumber: idx + 1,
      weight: 0,
      reps: t.reps,
      rpe: t.rpe,
      form: 'standard',
      isWarmup: true,
    }));

    return {
      status: 'valid',
      modality: 'bodyweight',
      warmupTargets,
      resolvedWorkingTarget: {
        weight: 0,
        reps: resolvedReps,
      },
    };
  }

  // 3. Assisted modality
  if (modality === 'assisted') {
    const isValidAssistanceWeight = (w: number | null | undefined): w is number => {
      return typeof w === 'number' && Number.isFinite(w) && w >= 0;
    };

    const isValidAssistedReps = (r: number | null | undefined): r is number => {
      return typeof r === 'number' && Number.isFinite(r) && Number.isInteger(r) && r > 0;
    };

    let resolvedAssistance: number | null = null;
    let resolvedReps: number | null = null;

    if (
      selectedSet &&
      !selectedSet.isWarmup &&
      !selectedSet.isSkipped &&
      isValidAssistanceWeight(selectedSet.weight) &&
      isValidAssistedReps(selectedSet.reps)
    ) {
      resolvedAssistance = selectedSet.weight;
      resolvedReps = selectedSet.reps;
    } else {
      const firstValidWorkingSet = exercise.sets.find(
        s =>
          !s.isWarmup &&
          !s.isSkipped &&
          isValidAssistanceWeight(s.weight) &&
          isValidAssistedReps(s.reps)
      );
      if (firstValidWorkingSet) {
        resolvedAssistance = firstValidWorkingSet.weight!;
        resolvedReps = firstValidWorkingSet.reps!;
      }
    }

    if (resolvedAssistance === null || resolvedReps === null) {
      const inspected = getInspectedCandidateSet();
      const hasValidAssistance = isValidAssistanceWeight(inspected?.weight);
      const hasValidReps = isValidAssistedReps(inspected?.reps);

      if (!hasValidAssistance && !hasValidReps) {
        return {
          status: 'bypassed',
          bypassReason: 'missing_assistance_and_reps',
          message: AUTO_WARMUP_MESSAGES.ASSISTED_MISSING_ASSISTANCE_AND_REPS,
          warmupTargets: null,
        };
      }

      if (!hasValidAssistance) {
        return {
          status: 'bypassed',
          bypassReason: 'missing_assistance',
          message: AUTO_WARMUP_MESSAGES.ASSISTED_MISSING_ASSISTANCE_ONLY,
          warmupTargets: null,
        };
      }

      return {
        status: 'bypassed',
        bypassReason: 'invalid_working_reps',
        message: AUTO_WARMUP_MESSAGES.ASSISTED_MISSING_REPS_ONLY,
        warmupTargets: null,
      };
    }

    const validSnapshot = bodyweightSnapshot
      ? validateBodyweightSnapshot(bodyweightSnapshot)
      : null;

    if (!validSnapshot) {
      return {
        status: 'bypassed',
        bypassReason: 'missing_bodyweight',
        message: AUTO_WARMUP_MESSAGES.ASSISTED_MISSING_BODYWEIGHT_SNAPSHOT,
        warmupTargets: null,
      };
    }

    const assistedResult = generateAssistedWarmupTargets({
      workingAssistance: resolvedAssistance,
      assistanceUnit: activeUnit,
      bodyweight: validSnapshot.value,
      bodyweightUnit: validSnapshot.unit,
      workingReps: resolvedReps,
    });

    if (assistedResult.status === 'bypassed' || !assistedResult.warmupTargets) {
      let msg: string = AUTO_WARMUP_MESSAGES.ASSISTED_CANNOT_CALCULATE_DEFAULT;
      const reason = (assistedResult.bypassReason as AutoWarmupBypassReason) || 'unknown';

      switch (assistedResult.bypassReason) {
        case 'missing_bodyweight':
        case 'invalid_bodyweight':
        case 'missing_bodyweight_unit':
          msg = AUTO_WARMUP_MESSAGES.ASSISTED_MISSING_BODYWEIGHT_SNAPSHOT;
          break;
        case 'missing_assistance':
        case 'invalid_assistance':
          msg = AUTO_WARMUP_MESSAGES.ASSISTED_MISSING_ASSISTANCE_ONLY;
          break;
        case 'negative_assistance':
          msg = AUTO_WARMUP_MESSAGES.ASSISTED_NEGATIVE_ASSISTANCE;
          break;
        case 'zero_effective_load':
        case 'assistance_exceeds_bodyweight':
          msg = AUTO_WARMUP_MESSAGES.ASSISTED_EXCEEDS_OR_EQUALS_BW;
          break;
        case 'invalid_working_reps':
          msg = AUTO_WARMUP_MESSAGES.ASSISTED_MISSING_REPS_ONLY;
          break;
        case 'insufficient_assistance_resolution':
          msg = AUTO_WARMUP_MESSAGES.ASSISTED_INSUFFICIENT_RESOLUTION;
          break;
      }

      return {
        status: 'bypassed',
        bypassReason: reason,
        message: msg,
        warmupTargets: null,
      };
    }

    const warmupTargets: AutoWarmupTargetSet[] = assistedResult.warmupTargets.map((t, idx) => ({
      setNumber: idx + 1,
      weight: t.assistance,
      reps: t.reps,
      rpe: t.rpe,
      form: 'standard',
      isWarmup: true,
    }));

    return {
      status: 'valid',
      modality: 'assisted',
      warmupTargets,
      resolvedWorkingTarget: {
        weight: resolvedAssistance,
        reps: resolvedReps,
      },
    };
  }

  // 4. Weighted modality (or legacy undefined)
  const isValidWeightedWeight = (w: number | null | undefined): w is number => {
    return typeof w === 'number' && Number.isFinite(w) && w > 0;
  };

  const isValidWeightedReps = (r: number | null | undefined): r is number => {
    return typeof r === 'number' && Number.isFinite(r) && Number.isInteger(r) && r > 0;
  };

  let resolvedWeight: number | null = null;
  let resolvedReps: number | null = null;

  if (
    selectedSet &&
    !selectedSet.isWarmup &&
    !selectedSet.isSkipped &&
    isValidWeightedWeight(selectedSet.weight) &&
    isValidWeightedReps(selectedSet.reps)
  ) {
    resolvedWeight = selectedSet.weight;
    resolvedReps = selectedSet.reps;
  } else {
    const firstValidWorkingSet = exercise.sets.find(
      s =>
        !s.isWarmup &&
        !s.isSkipped &&
        isValidWeightedWeight(s.weight) &&
        isValidWeightedReps(s.reps)
    );
    if (firstValidWorkingSet) {
      resolvedWeight = firstValidWorkingSet.weight!;
      resolvedReps = firstValidWorkingSet.reps!;
    }
  }

  if (resolvedWeight === null || resolvedReps === null) {
    const inspected = getInspectedCandidateSet();
    const hasValidWeight = isValidWeightedWeight(inspected?.weight);
    const hasValidReps = isValidWeightedReps(inspected?.reps);

    if (!hasValidWeight && !hasValidReps) {
      return {
        status: 'bypassed',
        bypassReason: 'missing_weight_and_reps',
        message: AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_WEIGHT_AND_REPS,
        warmupTargets: null,
      };
    }

    if (!hasValidWeight) {
      return {
        status: 'bypassed',
        bypassReason: 'missing_weight',
        message: AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_WEIGHT_ONLY,
        warmupTargets: null,
      };
    }

    return {
      status: 'bypassed',
      bypassReason: 'invalid_working_reps',
      message: AUTO_WARMUP_MESSAGES.WEIGHTED_MISSING_REPS_ONLY,
      warmupTargets: null,
    };
  }

  // Generate 3 exercise science warmup sets:
  // Set 1: 50% weight x 100% working reps @ RPE 4.0
  // Set 2: 70% weight x ~70% working reps @ RPE 6.0 (min 5 reps)
  // Set 3: 85% weight x ~35% working reps @ RPE 7.0 (min 3 reps)
  const w1Weight = roundToNearest25(resolvedWeight * 0.50);
  const w1Reps = resolvedReps;

  const w2Weight = roundToNearest25(resolvedWeight * 0.70);
  const w2Reps = Math.max(5, Math.round(resolvedReps * 0.70));

  const w3Weight = roundToNearest25(resolvedWeight * 0.85);
  const w3Reps = Math.max(3, Math.round(resolvedReps * 0.35));

  const warmupTargets: AutoWarmupTargetSet[] = [
    {
      setNumber: 1,
      weight: w1Weight,
      reps: w1Reps,
      rpe: 4.0,
      form: 'standard',
      isWarmup: true,
    },
    {
      setNumber: 2,
      weight: w2Weight,
      reps: w2Reps,
      rpe: 6.0,
      form: 'standard',
      isWarmup: true,
    },
    {
      setNumber: 3,
      weight: w3Weight,
      reps: w3Reps,
      rpe: 7.0,
      form: 'standard',
      isWarmup: true,
    },
  ];

  return {
    status: 'valid',
    modality: 'weighted',
    warmupTargets,
    resolvedWorkingTarget: {
      weight: resolvedWeight,
      reps: resolvedReps,
    },
  };
}
