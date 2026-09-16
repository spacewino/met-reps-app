/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  WeightUnit,
  ExerciseModality,
  ProgressionLoadBasis,
} from '../types';
import { convertWeightUnit } from './assistedLoadMath';
import { getRpePercentage, isValidRPE } from './rpeMath';

export type ComparisonLoadIneligibleReason =
  | 'UNSUPPORTED_MODALITY'
  | 'INVALID_WEIGHT'
  | 'MISSING_BODYWEIGHT'
  | 'INVALID_EXTERNAL_WEIGHT'
  | 'INVALID_ASSISTANCE';

export type ComparisonLoadSuccess = {
  eligible: true;
  loadBasis: ProgressionLoadBasis;
  comparisonLoadKg: number;
};

export type ComparisonLoadFailure = {
  eligible: false;
  reason: ComparisonLoadIneligibleReason;
};

export type ComparisonLoadResult = ComparisonLoadSuccess | ComparisonLoadFailure;

export type BodyweightSnapshotInput =
  | number
  | { value: number | null | undefined; unit?: WeightUnit | string | null }
  | null
  | undefined;

export interface GuidedComparisonLoadInput {
  modality: ExerciseModality | string;
  weight?: number | null;
  bodyweight?: BodyweightSnapshotInput;
  unit?: WeightUnit | string | null;
}

/**
 * Normalized weight unit resolver for Guided operations.
 * Resolves 'lb' and legacy 'lbs' safely to 'lb', defaulting other units to 'kg'.
 */
export function normalizeGuidedUnit(unit: string | null | undefined): WeightUnit {
  if (unit === 'lb' || unit === 'lbs') {
    return 'lb';
  }
  return 'kg';
}

/**
 * Resolves bodyweight in kilograms from either a raw number or a BodyweightSnapshot.
 * Returns null if bodyweight is missing, non-finite, zero, or negative.
 * Does not provide any synthetic default fallback.
 */
export function resolveGuidedBodyweightKg(
  bodyweight: BodyweightSnapshotInput,
  fallbackUnit: WeightUnit = 'kg'
): number | null {
  if (bodyweight === null || bodyweight === undefined) {
    return null;
  }

  if (typeof bodyweight === 'number') {
    if (!Number.isFinite(bodyweight) || bodyweight <= 0) {
      return null;
    }
    return fallbackUnit === 'lb'
      ? convertWeightUnit(bodyweight, 'lb', 'kg')
      : bodyweight;
  }

  if (typeof bodyweight === 'object') {
    const val = bodyweight.value;
    if (val === null || val === undefined || !Number.isFinite(val) || val <= 0) {
      return null;
    }
    const unit = normalizeGuidedUnit(bodyweight.unit || fallbackUnit);
    return unit === 'lb'
      ? convertWeightUnit(val, 'lb', 'kg')
      : val;
  }

  return null;
}

/**
 * Resolves Guided comparison load from modality, presented/performed weight, bodyweight snapshot, and unit.
 *
 * Rules:
 * 1. Modality:
 *    - 'weighted': externalWeight in kg, loadBasis 'external_weight_v1'. Weight must be finite and > 0.
 *    - 'bodyweight': bodyweight in kg, loadBasis 'bodyweight_normalized_v1'. Displayed weight must be 0 (or omitted/null). Missing/invalid BW fails with MISSING_BODYWEIGHT.
 *    - 'assisted': (bodyweightKg - assistanceKg), loadBasis 'assisted_net_normalized_v1'. Assistance must be finite, > 0, and < bodyweightKg.
 *    - 'timed', 'distance', 'distance_loaded', or any unknown: fails with 'UNSUPPORTED_MODALITY'.
 * 2. Full floating-point precision is preserved.
 * 3. Never rounds to plate increments.
 */
export function resolveGuidedComparisonLoad(
  modalityOrInput: ExerciseModality | string | GuidedComparisonLoadInput,
  rawWeight?: number | null,
  rawBodyweight?: BodyweightSnapshotInput,
  rawUnit?: WeightUnit | string | null
): ComparisonLoadResult {
  let modality: string;
  let weight: number | null | undefined;
  let bodyweight: BodyweightSnapshotInput;
  let unitStr: string | null | undefined;

  if (typeof modalityOrInput === 'object' && modalityOrInput !== null) {
    modality = modalityOrInput.modality;
    weight = modalityOrInput.weight;
    bodyweight = modalityOrInput.bodyweight;
    unitStr = modalityOrInput.unit;
  } else {
    modality = modalityOrInput;
    weight = rawWeight;
    bodyweight = rawBodyweight;
    unitStr = rawUnit;
  }

  const activeUnit = normalizeGuidedUnit(unitStr);

  // 1. Check supported modalities in Guided v1
  if (modality !== 'weighted' && modality !== 'bodyweight' && modality !== 'assisted') {
    return {
      eligible: false,
      reason: 'UNSUPPORTED_MODALITY',
    };
  }

  // 2. Weighted exercises
  if (modality === 'weighted') {
    if (weight === null || weight === undefined || !Number.isFinite(weight) || weight <= 0) {
      return {
        eligible: false,
        reason: 'INVALID_WEIGHT',
      };
    }
    const comparisonLoadKg = activeUnit === 'lb'
      ? convertWeightUnit(weight, 'lb', 'kg')
      : weight;

    return {
      eligible: true,
      loadBasis: 'external_weight_v1',
      comparisonLoadKg,
    };
  }

  // 3. Pure bodyweight exercises
  if (modality === 'bodyweight') {
    // External weight must remain 0
    if (weight !== null && weight !== undefined && weight !== 0) {
      return {
        eligible: false,
        reason: 'INVALID_EXTERNAL_WEIGHT',
      };
    }

    const bwKg = resolveGuidedBodyweightKg(bodyweight, activeUnit);
    if (bwKg === null) {
      return {
        eligible: false,
        reason: 'MISSING_BODYWEIGHT',
      };
    }

    return {
      eligible: true,
      loadBasis: 'bodyweight_normalized_v1',
      comparisonLoadKg: bwKg,
    };
  }

  // 4. Assisted exercises
  if (modality === 'assisted') {
    const bwKg = resolveGuidedBodyweightKg(bodyweight, activeUnit);
    if (bwKg === null) {
      return {
        eligible: false,
        reason: 'MISSING_BODYWEIGHT',
      };
    }

    if (weight === null || weight === undefined || !Number.isFinite(weight) || weight <= 0) {
      return {
        eligible: false,
        reason: 'INVALID_ASSISTANCE',
      };
    }

    const assistanceKg = activeUnit === 'lb'
      ? convertWeightUnit(weight, 'lb', 'kg')
      : weight;

    // Assistance must be strictly less than bodyweight
    if (assistanceKg >= bwKg) {
      return {
        eligible: false,
        reason: 'INVALID_ASSISTANCE',
      };
    }

    const comparisonLoadKg = bwKg - assistanceKg;

    return {
      eligible: true,
      loadBasis: 'assisted_net_normalized_v1',
      comparisonLoadKg,
    };
  }

  return {
    eligible: false,
    reason: 'UNSUPPORTED_MODALITY',
  };
}

/**
 * Calculates the required capacity index:
 * requiredCapacityIndex = comparisonLoadKg / getRpePercentage(rpe, reps)
 *
 * Rules:
 * - Uses canonical production getRpePercentage(rpe, reps) authority.
 * - Reps must be finite positive integer.
 * - RPE must pass isValidRPE.
 * - Comparison load must be finite and > 0.
 * - Returns null on any invalid input.
 * - Does not round internally.
 */
export function calculateRequiredCapacityIndex(
  comparisonLoadKgOrParams: number | { comparisonLoadKg: number; reps: number; rpe: number },
  rawReps?: number,
  rawRpe?: number
): number | null {
  let comparisonLoadKg: number;
  let reps: number;
  let rpe: number;

  if (typeof comparisonLoadKgOrParams === 'object' && comparisonLoadKgOrParams !== null) {
    comparisonLoadKg = comparisonLoadKgOrParams.comparisonLoadKg;
    reps = comparisonLoadKgOrParams.reps;
    rpe = comparisonLoadKgOrParams.rpe;
  } else {
    comparisonLoadKg = comparisonLoadKgOrParams;
    reps = rawReps as number;
    rpe = rawRpe as number;
  }

  if (!Number.isFinite(comparisonLoadKg) || comparisonLoadKg <= 0) {
    return null;
  }
  if (!Number.isFinite(reps) || reps < 1 || !Number.isInteger(reps)) {
    return null;
  }
  if (!isValidRPE(rpe)) {
    return null;
  }

  const multiplier = getRpePercentage(rpe, reps);
  if (multiplier === null || multiplier <= 0) {
    return null;
  }

  return comparisonLoadKg / multiplier;
}

/**
 * Guided resistance-change cap defined as exactly 0.05 (5.0%).
 */
export const GUIDED_RESISTANCE_CHANGE_CAP = 0.05;

/**
 * Calculates pure relative challenge between candidate required capacity and baseline required capacity:
 * relativeChallenge = (candidateRequiredCapacity - baselineRequiredCapacity) / baselineRequiredCapacity
 *
 * Rules:
 * - Baseline capacity must be finite and > 0.
 * - Candidate capacity must be finite and > 0.
 * - Preserves negative challenge values.
 * - Returns null if either value is invalid.
 */
export function calculateRelativeChallenge(
  candidateCapacity: number,
  baselineCapacity: number
): number | null {
  if (!Number.isFinite(baselineCapacity) || baselineCapacity <= 0) {
    return null;
  }
  if (!Number.isFinite(candidateCapacity) || candidateCapacity <= 0) {
    return null;
  }
  return (candidateCapacity - baselineCapacity) / baselineCapacity;
}

/**
 * Assesses whether a relative challenge is within the Guided resistance-change cap (<= 0.05).
 * Exactly 0.05 (5.0%) returns true.
 * Greater than 0.05 returns false.
 * Any invalid / non-finite / null challenge returns false.
 */
export function isWithinResistanceChangeCap(
  relativeChallenge: number | null | undefined,
  cap: number = GUIDED_RESISTANCE_CHANGE_CAP
): boolean {
  if (relativeChallenge === null || relativeChallenge === undefined || !Number.isFinite(relativeChallenge)) {
    return false;
  }
  return relativeChallenge <= cap;
}

// Re-exports for consumers and test suites
export {
  getRpePercentage,
  isValidRPE,
  convertWeightUnit,
};
