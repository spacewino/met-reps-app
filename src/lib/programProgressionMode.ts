/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ExerciseModality,
  GuidedCoachingReasonCode,
  GuidedRollbackTarget,
  PrescriptionSnapshot,
  Program,
  TargetProgressionMode,
  WeightUnit,
  ALL_GUIDED_COACHING_REASON_CODES,
  isGuidedCoachingReasonCode,
} from '../types';
import { isValidRPE } from './rpeMath';

export {
  type GuidedCoachingReasonCode,
  type GuidedRollbackTarget,
  ALL_GUIDED_COACHING_REASON_CODES,
  isGuidedCoachingReasonCode,
};

export const CURRENT_PRESCRIPTION_SNAPSHOT_VERSION = 2;
export const CURRENT_PROGRESSION_POLICY_VERSION = 1;
export const CURRENT_ALGORITHM_VERSION = 1;

/**
 * Validates a single rollback target according to modality rules and numeric integrity.
 */
export function isValidRollbackTarget(
  target: unknown,
  modality: ExerciseModality
): target is GuidedRollbackTarget {
  if (!target || typeof target !== 'object') return false;
  const t = target as Record<string, unknown>;

  if (
    typeof t.reps !== 'number' ||
    !Number.isInteger(t.reps) ||
    t.reps <= 0
  ) {
    return false;
  }

  if (typeof t.rpe !== 'number' || !isValidRPE(t.rpe)) {
    return false;
  }

  if (
    typeof t.comparisonLoadKg !== 'number' ||
    !Number.isFinite(t.comparisonLoadKg) ||
    t.comparisonLoadKg <= 0
  ) {
    return false;
  }

  if (typeof t.weight !== 'number' || !Number.isFinite(t.weight)) {
    return false;
  }

  if (modality === 'weighted') {
    if (t.weight <= 0) return false;
  } else if (modality === 'bodyweight') {
    if (t.weight !== 0) return false;
  } else if (modality === 'assisted') {
    if (t.weight <= 0) return false;
  } else {
    return false;
  }

  return true;
}

/**
 * Pure, fail-closed authority validating compatibility between coachingReasonCode,
 * nudgeType, step-index delta, successCreditEligible, and rollbackTarget nullability
 * according to the locked 19-reason matrix.
 */
export function isValidCoachingReasonMetadata(
  snapshot: PrescriptionSnapshot
): boolean {
  if (!snapshot || typeof snapshot !== 'object') {
    return false;
  }

  const reason = snapshot.coachingReasonCode;
  if (!isGuidedCoachingReasonCode(reason)) {
    return false;
  }

  if (
    typeof snapshot.confirmedStepIndexBefore !== 'number' ||
    !Number.isInteger(snapshot.confirmedStepIndexBefore) ||
    snapshot.confirmedStepIndexBefore < 0 ||
    typeof snapshot.presentedStepIndex !== 'number' ||
    !Number.isInteger(snapshot.presentedStepIndex) ||
    snapshot.presentedStepIndex < 0
  ) {
    return false;
  }

  const isStable = snapshot.presentedStepIndex === snapshot.confirmedStepIndexBefore;
  const isAdvance = snapshot.presentedStepIndex === snapshot.confirmedStepIndexBefore + 1;
  if (!isStable && !isAdvance) {
    return false;
  }

  if (typeof snapshot.successCreditEligible !== 'boolean') {
    return false;
  }

  const nudgeType = snapshot.nudgeType;
  const hasNullRollback = snapshot.rollbackTarget === null;
  const hasValidRollback =
    snapshot.rollbackTarget !== null &&
    isValidRollbackTarget(snapshot.rollbackTarget, snapshot.modality);

  switch (reason) {
    case 'BASE_PRESCRIPTION':
      return (
        nudgeType === 'none' &&
        isStable &&
        snapshot.successCreditEligible === true &&
        hasNullRollback
      );

    case 'REP_NUDGE':
      return (
        snapshot.successCreditEligible === true &&
        (nudgeType === 'rep_nudge'
          ? isAdvance && hasValidRollback
          : nudgeType === 'none'
          ? (isAdvance && hasValidRollback) || (isStable && hasNullRollback)
          : false)
      );

    case 'LOAD_NUDGE_MAIN_MOVEMENT':
    case 'LOAD_PROMOTION_CEILING_REACHED':
      return (
        snapshot.successCreditEligible === true &&
        (nudgeType === 'load_nudge'
          ? isAdvance && hasValidRollback
          : nudgeType === 'none'
          ? (isAdvance && hasValidRollback) || (isStable && hasNullRollback)
          : false)
      );

    case 'NUDGE_NEUTRAL_RETRY':
      return (
        snapshot.successCreditEligible === true &&
        (nudgeType === 'rep_nudge' || nudgeType === 'load_nudge'
          ? isAdvance && hasValidRollback
          : nudgeType === 'none'
          ? (isAdvance && hasValidRollback) || (isStable && hasNullRollback)
          : false)
      );

    // Stable holds with credit eligible = false
    case 'CHALLENGE_CAP_HOLD':
    case 'STEP_OUT_BASE_ONLY':
    case 'BODYWEIGHT_CEILING_HOLD':
    case 'BODYWEIGHT_MAIN_LOAD_HOLD':
    case 'MINIMUM_ASSISTANCE_REACHED':
    case 'MISSING_BODYWEIGHT_HOLD':
    case 'INVALID_ASSISTANCE_HOLD':
    case 'ZERO_NET_LOAD_HOLD':
      return (
        nudgeType === 'hold' &&
        isStable &&
        snapshot.successCreditEligible === false &&
        hasNullRollback
      );

    // Stable holds with credit eligible = true
    case 'HIGH_EXERTION_HOLD':
    case 'MARGINAL_MISS_TARGET_HELD':
    case 'NUDGE_MARGINAL_FAILURE_ROLLBACK':
    case 'NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK':
    case 'DEGRADED_HISTORY_HOLD':
    case 'INCONSISTENT_HISTORY_HOLD':
      return (
        nudgeType === 'hold' &&
        isStable &&
        snapshot.successCreditEligible === true &&
        hasNullRollback
      );

    default:
      return false;
  }
}

/**
 * Validates step indices, success credit eligibility, coaching reason code,
 * and rollback target contract for an individual PrescriptionSnapshot.
 */
export function isValidSnapshotStepMetadata(
  snapshot: PrescriptionSnapshot
): boolean {
  if (
    typeof snapshot.confirmedStepIndexBefore !== 'number' ||
    !Number.isInteger(snapshot.confirmedStepIndexBefore) ||
    snapshot.confirmedStepIndexBefore < 0
  ) {
    return false;
  }

  if (
    typeof snapshot.presentedStepIndex !== 'number' ||
    !Number.isInteger(snapshot.presentedStepIndex) ||
    snapshot.presentedStepIndex < 0
  ) {
    return false;
  }

  const isStable = snapshot.presentedStepIndex === snapshot.confirmedStepIndexBefore;
  const isAdvance = snapshot.presentedStepIndex === snapshot.confirmedStepIndexBefore + 1;

  if (!isStable && !isAdvance) {
    return false;
  }

  if (typeof snapshot.successCreditEligible !== 'boolean') {
    return false;
  }

  if (!isGuidedCoachingReasonCode(snapshot.coachingReasonCode)) {
    return false;
  }

  if (isStable) {
    if (snapshot.rollbackTarget !== null) {
      return false;
    }
  } else {
    if (!isValidRollbackTarget(snapshot.rollbackTarget, snapshot.modality)) {
      return false;
    }
  }

  if (!isValidCoachingReasonMetadata(snapshot)) {
    return false;
  }

  return true;
}

/**
 * Resolves the target progression mode of a program.
 * Exact 'metreps_guided' returns 'metreps_guided'.
 * Exact 'performance_led' returns 'performance_led'.
 * Missing, malformed, or unknown values return 'performance_led'.
 * Pure function with no storage reads.
 */
export function resolveProgramProgressionMode(
  program?: Partial<Program> | null
): TargetProgressionMode {
  if (program?.targetProgressionMode === 'metreps_guided') {
    return 'metreps_guided';
  }
  return 'performance_led';
}

/**
 * Resolves the progression policy version of a program.
 * Preserves finite, non-negative integers.
 * Missing, malformed, negative, fractional, NaN, or infinite values return 0 (legacy).
 */
export function resolveProgramProgressionPolicyVersion(
  program?: Partial<Program> | null
): number {
  const v = program?.progressionPolicyVersion;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
    return v;
  }
  return 0;
}

/**
 * Resolves the algorithm version of a program.
 * Preserves finite, non-negative integers.
 * Missing, malformed, negative, fractional, NaN, or infinite values return 0 (legacy).
 */
export function resolveProgramAlgorithmVersion(
  program?: Partial<Program> | null
): number {
  const v = program?.algorithmVersion;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
    return v;
  }
  return 0;
}

/**
 * Resolves the weight unit for a program.
 * Valid stored 'kg' or 'lb' returns that unit.
 * Otherwise returns the supplied fallback.
 * Pure function with no storage reads.
 */
export function resolveProgramUnit(
  program: Partial<Program> | null | undefined,
  legacyFallback: WeightUnit
): WeightUnit {
  const u = program?.unit;
  if (u === 'kg' || u === 'lb') {
    return u;
  }
  if ((u as unknown) === 'lbs') {
    return 'lb';
  }
  return legacyFallback;
}
