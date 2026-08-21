/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExerciseEntry, SetEntry, BodyweightSnapshot, WeightUnit } from '../types';
import { isValidRPE, roundRPEToHalfStep, calculateE1RMForSet } from './rpeMath';
import { convertWeightUnit } from './assistedLoadMath';
import { resolveSetEffectiveLoad, EffectiveLoadReason } from './effectiveLoad';

export type PerformanceEvidenceBypassReason =
  | 'skipped_exercise'
  | 'skipped_set'
  | 'warmup_set'
  | 'drop_set'
  | 'loose_form'
  | 'invalid_reps'
  | 'uncompleted_historical_set'
  | 'missing_live_rpe'
  | 'invalid_explicit_rpe'
  | 'unsupported_modality'
  | 'missing_bodyweight_snapshot'
  | 'invalid_bodyweight_snapshot'
  | 'missing_weight'
  | 'invalid_weight'
  | 'missing_assistance'
  | 'invalid_assistance'
  | 'negative_assistance'
  | 'assistance_equals_or_exceeds_bodyweight'
  | 'zero_or_negative_effective_load'
  | 'e1rm_calculation_failed';

export interface SetPerformanceEvidenceSuccess {
  status: 'valid';
  effectiveLoad: number;
  targetUnit: WeightUnit;
  reps: number;
  rpe: number | null; // explicit RPE or null for historical Epley fallback
  e1RM: number;
}

export interface SetPerformanceEvidenceBypass {
  status: 'bypassed';
  bypassReason: PerformanceEvidenceBypassReason;
}

export type SetPerformanceEvidenceResult =
  | SetPerformanceEvidenceSuccess
  | SetPerformanceEvidenceBypass;

export interface SetPerformanceEvidenceInput {
  context: 'historical' | 'live';
  modality?: ExerciseEntry['modality'];
  set: SetEntry;
  bodyweightSnapshot?: BodyweightSnapshot | null;
  targetUnit: WeightUnit;
  exerciseIsSkipped?: boolean | null;
  sourceUnit?: WeightUnit;
}

/**
 * Pure canonical evidence adapter that extracts performance evidence (effective load, reps, RPE, e1RM)
 * from a single set entry across weighted, bodyweight, and assisted modalities.
 *
 * Rules:
 * - Deterministic, idempotent, and input-immutable.
 * - Never reads localStorage, Settings, React state, or global singletons.
 * - Distinguishes between 'historical' and 'live' contexts:
 *     - Historical: requires set.isCompleted !== false; allows missing RPE (null/undefined/0) via Epley fallback.
 *     - Live: requires explicit valid RPE (6.0..10.0 in 0.5 increments); allows uncompleted set.isCompleted.
 * - Universal exclusions: skipped exercise, skipped set, warmup set, drop sets, loose form, invalid reps, unsupported modalities.
 * - Weighted modality: uses set.weight (converted from sourceUnit to targetUnit if different).
 * - Bodyweight modality: uses converted bodyweightSnapshot; ignores set.weight (never double-counts).
 * - Assisted modality: uses converted (bodyweightSnapshot - assistance); validates 0 <= assistance < bodyweight.
 */
export function extractSetPerformanceEvidence(
  input: SetPerformanceEvidenceInput
): SetPerformanceEvidenceResult {
  const {
    context,
    modality = 'weighted',
    set,
    bodyweightSnapshot,
    targetUnit,
    exerciseIsSkipped,
    sourceUnit = targetUnit,
  } = input;

  // 1. Universal exclusions: Skipped exercise / set
  if (exerciseIsSkipped === true) {
    return { status: 'bypassed', bypassReason: 'skipped_exercise' };
  }
  if (set.isSkipped === true) {
    return { status: 'bypassed', bypassReason: 'skipped_set' };
  }

  // 2. Universal exclusions: Warm-up sets
  if (set.isWarmup === true) {
    return { status: 'bypassed', bypassReason: 'warmup_set' };
  }

  // 3. Universal exclusions: Drop sets (parent or dropSubSets)
  if (set.isDropSet === true || (Array.isArray(set.dropSubSets) && set.dropSubSets.length > 0)) {
    return { status: 'bypassed', bypassReason: 'drop_set' };
  }

  // 4. Universal exclusions: Loose form
  if (set.form === 'loose') {
    return { status: 'bypassed', bypassReason: 'loose_form' };
  }

  // 5. Universal exclusions: Repetitions must be a positive integer >= 1
  if (
    typeof set.reps !== 'number' ||
    !Number.isFinite(set.reps) ||
    !Number.isInteger(set.reps) ||
    set.reps < 1
  ) {
    return { status: 'bypassed', bypassReason: 'invalid_reps' };
  }
  const reps = set.reps;

  // 6. Modality validation: Supported modalities are 'weighted', 'bodyweight', 'assisted'
  if (
    modality === 'distance' ||
    modality === 'timed' ||
    modality === 'distance_loaded' ||
    (modality !== 'weighted' && modality !== 'bodyweight' && modality !== 'assisted')
  ) {
    return { status: 'bypassed', bypassReason: 'unsupported_modality' };
  }

  // 7. Context-specific completion checks
  if (context === 'historical') {
    // Explicitly uncompleted historical sets are excluded; legacy undefined is allowed
    if (set.isCompleted === false) {
      return { status: 'bypassed', bypassReason: 'uncompleted_historical_set' };
    }
  }

  // 8. RPE validation and commitment rules
  let resolvedRPE: number | null = null;
  const rawRPE = set.rpe;

  if (context === 'live') {
    // Live evidence requires an explicitly committed valid RPE
    if (rawRPE === null || rawRPE === undefined || rawRPE === 0) {
      return { status: 'bypassed', bypassReason: 'missing_live_rpe' };
    }
    if (!isValidRPE(rawRPE) || Math.abs(roundRPEToHalfStep(rawRPE) - rawRPE) > 1e-6) {
      return { status: 'bypassed', bypassReason: 'invalid_explicit_rpe' };
    }
    resolvedRPE = roundRPEToHalfStep(rawRPE);
  } else {
    // Historical evidence: missing RPE (null/undefined/0) falls back to Epley; invalid explicit RPE is rejected
    if (rawRPE === null || rawRPE === undefined || rawRPE === 0) {
      resolvedRPE = null; // Reps-only Epley fallback
    } else if (isValidRPE(rawRPE) && Math.abs(roundRPEToHalfStep(rawRPE) - rawRPE) <= 1e-6) {
      resolvedRPE = roundRPEToHalfStep(rawRPE);
    } else {
      return { status: 'bypassed', bypassReason: 'invalid_explicit_rpe' };
    }
  }

  // 9. Modality-specific effective load calculation via canonical resolveSetEffectiveLoad
  const loadRes = resolveSetEffectiveLoad(set.weight, modality, sourceUnit, bodyweightSnapshot);

  if (loadRes.status !== 'valid' || loadRes.effectiveLoadKg === null) {
    let bypassReason: PerformanceEvidenceBypassReason = 'zero_or_negative_effective_load';
    const reason = loadRes.reason;

    if (reason === 'missing_snapshot') {
      bypassReason = 'missing_bodyweight_snapshot';
    } else if (reason === 'invalid_snapshot') {
      bypassReason = 'invalid_bodyweight_snapshot';
    } else if (reason === 'missing_weight') {
      bypassReason = modality === 'assisted' ? 'missing_assistance' : 'missing_weight';
    } else if (reason === 'invalid_weight') {
      bypassReason = modality === 'assisted' ? 'invalid_assistance' : 'invalid_weight';
    } else if (reason === 'negative_assistance') {
      bypassReason = 'negative_assistance';
    } else if (reason === 'assistance_exceeds_bodyweight' || reason === 'zero_effective_load') {
      bypassReason = 'assistance_equals_or_exceeds_bodyweight';
    } else if (reason === 'non_mass_modality') {
      bypassReason = 'unsupported_modality';
    }

    return { status: 'bypassed', bypassReason };
  }

  // Convert normalized effectiveLoadKg to requested targetUnit
  const effectiveLoad = convertWeightUnit(loadRes.effectiveLoadKg, 'kg', targetUnit);

  // 10. Effective load sanity check
  if (!Number.isFinite(effectiveLoad) || effectiveLoad <= 0) {
    return { status: 'bypassed', bypassReason: 'zero_or_negative_effective_load' };
  }

  // 11. Calculate e1RM via canonical calculateE1RMForSet helper
  const calculatedE1RM = calculateE1RMForSet(effectiveLoad, reps, resolvedRPE);

  if (calculatedE1RM === null || !Number.isFinite(calculatedE1RM) || calculatedE1RM <= 0) {
    return { status: 'bypassed', bypassReason: 'e1rm_calculation_failed' };
  }

  return {
    status: 'valid',
    effectiveLoad,
    targetUnit,
    reps,
    rpe: resolvedRPE,
    e1RM: calculatedE1RM,
  };
}
