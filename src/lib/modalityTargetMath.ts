/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WeightUnit } from '../types';
import { isValidRPE, roundRPEToHalfStep, getRTSMultiplier } from './rpeMath';
import { roundToNearestIncrement } from './weightMath';

export type ModalityTargetStatus = 'exact' | 'quantized' | 'constrained' | 'bypassed';

export type ModalityConstraintReason =
  | 'bodyweight_min_reps_exceeded'
  | 'bodyweight_max_reps_exceeded'
  | 'assisted_negative_assistance'
  | 'assisted_zero_or_negative_load'
  | 'assisted_grid_resolution_limit'
  | 'deload_reps_floor_reached';

export interface AssistedTargetResult {
  status: ModalityTargetStatus;
  assistanceWeight: number;
  reps: number;
  rpe: number;
  unit: WeightUnit;
  targetEffectiveLoad: number;
  achievedEffectiveLoad: number;
  constraintReason?: ModalityConstraintReason;
}

export interface ProjectAssistedTargetParams {
  targetEffectiveLoad: number;
  sessionBodyweight: number;
  targetReps: number;
  targetRPE: number;
  unit: WeightUnit;
  increment?: number;
}

/**
 * Pure projector for assisted exercises that translates a target physical effective load
 * into machine pin assistance on a discrete equipment grid.
 *
 * Rules:
 * - Unrounded assistance = sessionBodyweight - targetEffectiveLoad.
 * - Quantized assistance = roundToNearestIncrement(unrounded assistance, increment).
 * - Achieved effective load = sessionBodyweight - quantized assistance.
 * - Every valid assistance output must satisfy: 0 <= assistance < sessionBodyweight.
 * - Exact: |achievedEffectiveLoad - targetEffectiveLoad| <= 0.0001.
 * - Quantized: in-range pin value returned, but |achievedEffectiveLoad - targetEffectiveLoad| > 0.0001.
 * - Constrained: boundary clamp (e.g. negative assistance clamped to 0, or zero/negative target load clamped).
 * - Bypassed: non-finite or invalid inputs.
 */
export function projectAssistedTarget(
  params: ProjectAssistedTargetParams
): AssistedTargetResult {
  const {
    targetEffectiveLoad,
    sessionBodyweight,
    targetReps,
    targetRPE,
    unit,
    increment = 2.5,
  } = params;

  // Validate inputs
  if (
    !Number.isFinite(targetEffectiveLoad) ||
    !Number.isFinite(sessionBodyweight) ||
    sessionBodyweight <= 0 ||
    !Number.isFinite(targetReps) ||
    !Number.isInteger(targetReps) ||
    targetReps < 1 ||
    !isValidRPE(targetRPE) ||
    Math.abs(roundRPEToHalfStep(targetRPE) - targetRPE) > 1e-6 ||
    !Number.isFinite(increment) ||
    increment <= 0 ||
    (unit !== 'kg' && unit !== 'lb')
  ) {
    return {
      status: 'bypassed',
      assistanceWeight: 0,
      reps: typeof targetReps === 'number' && targetReps >= 1 ? targetReps : 0,
      rpe: typeof targetRPE === 'number' ? targetRPE : 0,
      unit: unit === 'lb' ? 'lb' : 'kg',
      targetEffectiveLoad: Number.isFinite(targetEffectiveLoad) ? targetEffectiveLoad : 0,
      achievedEffectiveLoad: 0,
    };
  }

  const roundedRPE = roundRPEToHalfStep(targetRPE);

  // Boundary: Target effective load <= 0 cannot generate assistance >= bodyweight as a normal target
  if (targetEffectiveLoad <= 0) {
    // Clamp assistance to the highest grid increment strictly less than sessionBodyweight
    const maxAssistanceOnGrid = Math.floor((sessionBodyweight - 1e-6) / increment) * increment;
    const clampedAssistance = Math.max(0, maxAssistanceOnGrid);
    const achievedLoad = sessionBodyweight - clampedAssistance;

    return {
      status: 'constrained',
      assistanceWeight: clampedAssistance,
      reps: targetReps,
      rpe: roundedRPE,
      unit,
      targetEffectiveLoad,
      achievedEffectiveLoad: achievedLoad,
      constraintReason: 'assisted_zero_or_negative_load',
    };
  }

  // Boundary: Target effective load >= sessionBodyweight requires 0 or negative assistance
  if (targetEffectiveLoad >= sessionBodyweight) {
    const unroundedAssistance = sessionBodyweight - targetEffectiveLoad;
    if (unroundedAssistance < 0) {
      // Clamps to 0 assistance (user capacity exceeds bodyweight; needs weighted mode)
      return {
        status: 'constrained',
        assistanceWeight: 0,
        reps: targetReps,
        rpe: roundedRPE,
        unit,
        targetEffectiveLoad,
        achievedEffectiveLoad: sessionBodyweight,
        constraintReason: 'assisted_negative_assistance',
      };
    }

    // unroundedAssistance === 0: exact zero-assistance boundary
    return {
      status: 'exact',
      assistanceWeight: 0,
      reps: targetReps,
      rpe: roundedRPE,
      unit,
      targetEffectiveLoad,
      achievedEffectiveLoad: sessionBodyweight,
    };
  }

  // Standard range: 0 < targetEffectiveLoad < sessionBodyweight
  const unroundedAssistance = sessionBodyweight - targetEffectiveLoad;
  let quantizedAssistance = roundToNearestIncrement(unroundedAssistance, increment);

  // Ensure quantized assistance is strictly less than sessionBodyweight
  if (quantizedAssistance >= sessionBodyweight) {
    const maxAssistanceOnGrid = Math.floor((sessionBodyweight - 1e-6) / increment) * increment;
    if (maxAssistanceOnGrid < 0) {
      return {
        status: 'constrained',
        assistanceWeight: 0,
        reps: targetReps,
        rpe: roundedRPE,
        unit,
        targetEffectiveLoad,
        achievedEffectiveLoad: sessionBodyweight,
        constraintReason: 'assisted_grid_resolution_limit',
      };
    }
    quantizedAssistance = maxAssistanceOnGrid;
    const achievedEffectiveLoad = sessionBodyweight - quantizedAssistance;
    return {
      status: 'constrained',
      assistanceWeight: quantizedAssistance,
      reps: targetReps,
      rpe: roundedRPE,
      unit,
      targetEffectiveLoad,
      achievedEffectiveLoad,
      constraintReason: 'assisted_grid_resolution_limit',
    };
  }

  // Ensure quantized assistance is >= 0
  if (quantizedAssistance < 0) {
    quantizedAssistance = 0;
    return {
      status: 'constrained',
      assistanceWeight: 0,
      reps: targetReps,
      rpe: roundedRPE,
      unit,
      targetEffectiveLoad,
      achievedEffectiveLoad: sessionBodyweight,
      constraintReason: 'assisted_negative_assistance',
    };
  }

  const achievedEffectiveLoad = sessionBodyweight - quantizedAssistance;
  const isExact = Math.abs(achievedEffectiveLoad - targetEffectiveLoad) <= 1e-4;

  return {
    status: isExact ? 'exact' : 'quantized',
    assistanceWeight: quantizedAssistance,
    reps: targetReps,
    rpe: roundedRPE,
    unit,
    targetEffectiveLoad,
    achievedEffectiveLoad,
  };
}

export interface BodyweightTargetResult {
  status: ModalityTargetStatus;
  displayWeight: 0;
  reps: number;
  rpe: number;
  unit: WeightUnit;
  sessionEffectiveLoad: number;
  targetE1RM: number;
  achievedE1RM: number;
  constraintReason?: ModalityConstraintReason;
}

export interface SolveBodyweightRepParams {
  targetE1RM: number;
  sessionBodyweight: number;
  targetRPE: number;
  anchorReps: number;
  minReps: number;
  maxReps: number;
  unit: WeightUnit;
}

/**
 * Pure solver for bodyweight exercises that translates a desired target e1RM capacity
 * into discrete integer repetitions at fixed session bodyweight and target RPE.
 *
 * Rules:
 * - Candidate evaluation across [minReps, maxReps]:
 *     achievedE1RM = sessionBodyweight / getRTSMultiplier(candidateReps, targetRPE)
 *     error = abs(achievedE1RM - targetE1RM)
 * - Optimal candidate minimizes error.
 * - Tie-breaking:
 *     1. Closest to anchorReps.
 *     2. Lower repetition count (conservative volume).
 * - Exact: |achievedE1RM - targetE1RM| <= 0.0001.
 * - Quantized: selected integer reps in-range, but |achievedE1RM - targetE1RM| > 0.0001.
 * - Constrained: target lies outside permitted repetition range and selected reps is a boundary.
 * - Bypassed: invalid inputs or snapshot.
 * - Displayed weight is strictly 0.
 */
export function solveBodyweightRepTarget(
  params: SolveBodyweightRepParams
): BodyweightTargetResult {
  const {
    targetE1RM,
    sessionBodyweight,
    targetRPE,
    anchorReps,
    minReps,
    maxReps,
    unit,
  } = params;

  // Validate inputs
  if (
    !Number.isFinite(targetE1RM) ||
    targetE1RM <= 0 ||
    !Number.isFinite(sessionBodyweight) ||
    sessionBodyweight <= 0 ||
    !isValidRPE(targetRPE) ||
    Math.abs(roundRPEToHalfStep(targetRPE) - targetRPE) > 1e-6 ||
    !Number.isFinite(minReps) ||
    !Number.isInteger(minReps) ||
    minReps < 1 ||
    !Number.isFinite(maxReps) ||
    !Number.isInteger(maxReps) ||
    maxReps < minReps ||
    !Number.isFinite(anchorReps) ||
    !Number.isInteger(anchorReps) ||
    anchorReps < minReps ||
    anchorReps > maxReps ||
    (unit !== 'kg' && unit !== 'lb')
  ) {
    return {
      status: 'bypassed',
      displayWeight: 0,
      reps: typeof anchorReps === 'number' && anchorReps >= 1 ? anchorReps : 0,
      rpe: typeof targetRPE === 'number' ? targetRPE : 0,
      unit: unit === 'lb' ? 'lb' : 'kg',
      sessionEffectiveLoad: Number.isFinite(sessionBodyweight) ? sessionBodyweight : 0,
      targetE1RM: Number.isFinite(targetE1RM) ? targetE1RM : 0,
      achievedE1RM: 0,
    };
  }

  const roundedRPE = roundRPEToHalfStep(targetRPE);

  let bestReps = minReps;
  let bestAchievedE1RM = 0;
  let bestError = Number.POSITIVE_INFINITY;

  for (let r = minReps; r <= maxReps; r++) {
    const multiplier = getRTSMultiplier(r, roundedRPE);
    if (multiplier === null || multiplier <= 0) continue;

    const achieved = sessionBodyweight / multiplier;
    const error = Math.abs(achieved - targetE1RM);

    if (error < bestError - 1e-6) {
      bestReps = r;
      bestAchievedE1RM = achieved;
      bestError = error;
    } else if (Math.abs(error - bestError) <= 1e-6) {
      // Tie-break 1: Closest to anchorReps
      const distCurrent = Math.abs(r - anchorReps);
      const distBest = Math.abs(bestReps - anchorReps);
      if (distCurrent < distBest) {
        bestReps = r;
        bestAchievedE1RM = achieved;
        bestError = error;
      } else if (distCurrent === distBest) {
        // Tie-break 2: Lower repetition count (conservative volume)
        if (r < bestReps) {
          bestReps = r;
          bestAchievedE1RM = achieved;
          bestError = error;
        }
      }
    }
  }

  // Determine status
  const minMult = getRTSMultiplier(minReps, roundedRPE) ?? 1;
  const maxMult = getRTSMultiplier(maxReps, roundedRPE) ?? 1;
  const minPossibleE1RM = sessionBodyweight / minMult;
  const maxPossibleE1RM = sessionBodyweight / maxMult;

  let status: ModalityTargetStatus = 'quantized';
  let constraintReason: ModalityConstraintReason | undefined;

  if (targetE1RM < minPossibleE1RM - 1e-4 && bestReps === minReps) {
    status = 'constrained';
    constraintReason = 'bodyweight_min_reps_exceeded';
  } else if (targetE1RM > maxPossibleE1RM + 1e-4 && bestReps === maxReps) {
    status = 'constrained';
    constraintReason = 'bodyweight_max_reps_exceeded';
  } else if (Math.abs(bestAchievedE1RM - targetE1RM) <= 1e-4) {
    status = 'exact';
  } else {
    status = 'quantized';
  }

  return {
    status,
    displayWeight: 0,
    reps: bestReps,
    rpe: roundedRPE,
    unit,
    sessionEffectiveLoad: sessionBodyweight,
    targetE1RM,
    achievedE1RM: bestAchievedE1RM,
    ...(constraintReason ? { constraintReason } : {}),
  };
}
