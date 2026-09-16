/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  WeightUnit,
  ExerciseModality,
  ExerciseProgressionRole,
  ProgressionNudgeType,
  GuidedCoachingReasonCode,
  PrescriptionSnapshot,
} from '../types';
import {
  CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
  CURRENT_PROGRESSION_POLICY_VERSION,
  CURRENT_ALGORITHM_VERSION,
  isValidSnapshotStepMetadata,
} from './programProgressionMode';
import {
  ComparableGuidedExposure,
  ComparableGuidedSetDetail,
} from './guidedHistoryCollector';
import { LOAD_EQUALITY_EPSILON } from './guidedOutcomeClassifier';
import { convertWeightUnit } from './assistedLoadMath';
import { resolveGuidedComparisonLoad } from './adaptiveProgressionMath';
import {
  reduceGuidedAdherenceState,
  ReduceGuidedAdherenceStateResult,
  GuidedAdherenceTimelineEntry,
} from './guidedAdherenceTracker';

export interface ReplayGuidedLaneStateInput {
  exposures: readonly ComparableGuidedExposure[];
  isPartialLineage: boolean;
  broadAdherence?:
    | ReduceGuidedAdherenceStateResult
    | readonly ComparableGuidedExposure[]
    | { usableExposures: readonly ComparableGuidedExposure[]; isPartialLineage?: boolean };
}

export type GuidedLaneTrustStatus =
  | 'empty'
  | 'trusted'
  | 'degraded_requalification';

export type GuidedLaneNextAction =
  | 'establish_baseline'
  | 'build_success_credit'
  | 'eligible_for_nudge'
  | 'repeat_stable_target'
  | 'retry_pending_nudge'
  | 'present_rollback'
  | 'degraded_requalification';

export interface GuidedReplayPrescriptionSet {
  workingSetOrdinal: number;
  weight: number;
  reps: number;
  rpe: number;
  comparisonLoadKg: number | null;
  weightUnit: WeightUnit;
}

export interface GuidedPendingNudge {
  nudgeType: ProgressionNudgeType;
  nudgedWorkingSetOrdinal: number;
  confirmedStepIndexBefore: number;
  presentedStepIndex: number;
  coachingReasonCode: GuidedCoachingReasonCode;
  presentedPrescription: GuidedReplayPrescriptionSet[];
  rollbackPrescription: GuidedReplayPrescriptionSet[];
}

export interface ReplayTransitionDiagnostic {
  exposureIndex?: number;
  workoutLogId?: string;
  workoutDate?: string;
  kind: 'info' | 'warning' | 'anomaly' | 'invalid_input';
  code: string;
  message: string;
}

export interface ReplayGuidedLaneSuccessResult {
  status: 'success';
  trustStatus: GuidedLaneTrustStatus;
  successCredit: number; // 0 | 1 | 2
  gateReady: boolean;
  historyNudgeEligible: boolean;
  confirmedStepIndex: number;
  confirmedNudgeCount: number;
  stablePrescription: GuidedReplayPrescriptionSet[] | null;
  lastDemonstratedPrescription: GuidedReplayPrescriptionSet[] | null;
  pendingNudge: GuidedPendingNudge | null;
  marginalHoldActive: boolean;
  rollbackRequired: boolean;
  rollbackReason: GuidedCoachingReasonCode | null;
  rollbackPrescription: GuidedReplayPrescriptionSet[] | null;
  nextAction: GuidedLaneNextAction;
  processedExposureCount: number;
  neutralExposureCount: number;
  overperformanceExposureCount: number;
  diagnostics: ReplayTransitionDiagnostic[];
}

export interface ReplayGuidedLaneInvalidInputResult {
  status: 'invalid_input';
  error: string;
  errorMessage: string;
  trustStatus?: 'empty';
  successCredit?: 0;
  gateReady?: false;
  historyNudgeEligible?: false;
  diagnostics: ReplayTransitionDiagnostic[];
}

export type ReplayGuidedLaneStateResult =
  | ReplayGuidedLaneSuccessResult
  | ReplayGuidedLaneInvalidInputResult;

export function isReplaySuccess(
  result: ReplayGuidedLaneStateResult
): result is ReplayGuidedLaneSuccessResult {
  return result.status === 'success';
}

/**
 * Checks equality between two individual prescription sets.
 * Uses exact integer equality for reps/ordinal, exact canonical equality for RPE,
 * compatible nullability and LOAD_EQUALITY_EPSILON (1e-6) for comparisonLoadKg,
 * and canonical unit conversion (via convertWeightUnit) when weightUnit differs.
 */
export function arePrescriptionSetsEqual(
  a: GuidedReplayPrescriptionSet,
  b: GuidedReplayPrescriptionSet
): boolean {
  if (a.workingSetOrdinal !== b.workingSetOrdinal) return false;
  if (a.reps !== b.reps) return false;
  if (a.rpe !== b.rpe) return false;

  // Comparison load: nullability and numerical equivalence
  if ((a.comparisonLoadKg === null) !== (b.comparisonLoadKg === null)) {
    return false;
  }
  if (a.comparisonLoadKg !== null && b.comparisonLoadKg !== null) {
    if (Math.abs(a.comparisonLoadKg - b.comparisonLoadKg) > LOAD_EQUALITY_EPSILON) {
      return false;
    }
  }

  // Displayed load: identical units compare raw numbers within 1e-5;
  // divergent units compare canonical kilograms within 1e-4.
  if (a.weightUnit === b.weightUnit) {
    if (Math.abs(a.weight - b.weight) > 1e-5) {
      return false;
    }
  } else {
    const aKg = convertWeightUnit(a.weight, a.weightUnit, 'kg');
    const bKg = convertWeightUnit(b.weight, b.weightUnit, 'kg');
    if (Math.abs(aKg - bKg) > 1e-4) {
      return false;
    }
  }

  return true;
}

/**
 * Checks equality between two multi-set prescriptions.
 */
export function arePrescriptionsEqual(
  a: readonly GuidedReplayPrescriptionSet[] | null | undefined,
  b: readonly GuidedReplayPrescriptionSet[] | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!arePrescriptionSetsEqual(a[i], b[i])) return false;
  }
  return true;
}

/**
 * Clones a multi-set prescription array safely.
 */
function clonePrescription(
  p: readonly GuidedReplayPrescriptionSet[] | null
): GuidedReplayPrescriptionSet[] | null {
  if (!p) return null;
  return p.map(s => ({ ...s }));
}

/**
 * Extracts the full presented multi-set prescription from an exposure.
 */
export function extractPresentedPrescription(
  exposure: ComparableGuidedExposure
): GuidedReplayPrescriptionSet[] {
  const sorted = [...exposure.sets].sort((x, y) => x.workingSetOrdinal - y.workingSetOrdinal);
  return sorted.map(s => ({
    workingSetOrdinal: s.workingSetOrdinal,
    weight: s.snapshot.presentedWeight,
    reps: s.snapshot.presentedReps,
    rpe: s.snapshot.presentedRpe,
    comparisonLoadKg: s.snapshot.comparisonLoadKg,
    weightUnit: s.snapshot.weightUnit,
  }));
}

/**
 * Independently reconstructs the expected base prescription set for a snapshot.
 * Expected weight comes from snapshot.baseWeight.
 * Expected repetitions come from snapshot.baseReps.
 * Expected RPE comes from snapshot.baseRpe.
 * Expected comparison load is recomputed through resolveGuidedComparisonLoad using
 * baseWeight, modality, bodyweightSnapshot, and the enclosing snapshot's weightUnit.
 * Validates the resolved load basis against snapshot.loadBasis.
 * Neither rollbackTarget's supplied comparison load nor presented comparisonLoadKg is the authority.
 */
export function reconstructIndependentBasePrescriptionSet(
  snapshot: PrescriptionSnapshot
): GuidedReplayPrescriptionSet {
  const loadResult = resolveGuidedComparisonLoad(
    snapshot.modality,
    snapshot.baseWeight,
    snapshot.bodyweightSnapshot,
    snapshot.weightUnit
  );

  const isValidLoadBasis =
    loadResult.eligible &&
    loadResult.comparisonLoadKg !== undefined &&
    (!snapshot.loadBasis || !loadResult.loadBasis || snapshot.loadBasis === loadResult.loadBasis);

  const comparisonLoadKg = isValidLoadBasis
    ? loadResult.comparisonLoadKg
    : snapshot.baseWeight;

  return {
    workingSetOrdinal: snapshot.workingSetOrdinal,
    weight: snapshot.baseWeight,
    reps: snapshot.baseReps,
    rpe: snapshot.baseRpe,
    comparisonLoadKg,
    weightUnit: snapshot.weightUnit,
  };
}

/**
 * Extracts the full per-set rollback prescription from an exposure.
 * If rollbackTarget is supplied on a set snapshot, extracts its parameters;
 * otherwise defaults to the independently reconstructed base.
 */
export function extractRollbackPrescription(
  exposure: ComparableGuidedExposure
): GuidedReplayPrescriptionSet[] {
  const sorted = [...exposure.sets].sort((x, y) => x.workingSetOrdinal - y.workingSetOrdinal);
  return sorted.map(s => {
    const snap = s.snapshot;
    const rb = snap.rollbackTarget;
    if (rb) {
      return {
        workingSetOrdinal: s.workingSetOrdinal,
        weight: rb.weight,
        reps: rb.reps,
        rpe: rb.rpe,
        comparisonLoadKg: rb.comparisonLoadKg,
        weightUnit: snap.weightUnit,
      };
    }
    return reconstructIndependentBasePrescriptionSet(snap);
  });
}

/**
 * Extracts the full per-set base prescription from an exposure through independent reconstruction.
 * Represents the unmodified algorithm base prescription for the session.
 */
export function extractBasePrescription(
  exposure: ComparableGuidedExposure
): GuidedReplayPrescriptionSet[] {
  const sorted = [...exposure.sets].sort((x, y) => x.workingSetOrdinal - y.workingSetOrdinal);
  return sorted.map(s => reconstructIndependentBasePrescriptionSet(s.snapshot));
}

/**
 * Helper to identify planned current-session hold reasons.
 */
function isPlannedHoldReason(code: GuidedCoachingReasonCode): boolean {
  return (
    code === 'STEP_OUT_BASE_ONLY' ||
    code === 'HIGH_EXERTION_HOLD' ||
    code === 'CHALLENGE_CAP_HOLD' ||
    code === 'BODYWEIGHT_CEILING_HOLD' ||
    code === 'BODYWEIGHT_MAIN_LOAD_HOLD' ||
    code === 'MINIMUM_ASSISTANCE_REACHED' ||
    code === 'MISSING_BODYWEIGHT_HOLD' ||
    code === 'INVALID_ASSISTANCE_HOLD' ||
    code === 'ZERO_NET_LOAD_HOLD'
  );
}

/**
 * Pure, deterministic reducer reconstructing the Guided lane coaching state from immutable exposures.
 */
export function replayGuidedLaneState(
  input: ReplayGuidedLaneStateInput
): ReplayGuidedLaneStateResult {
  // 1. Validate root input structure
  if (!input || typeof input !== 'object' || !Array.isArray(input.exposures)) {
    return {
      status: 'invalid_input',
      error: 'MALFORMED_INPUT',
      errorMessage: 'Input must be an object with an exposures array.',
      diagnostics: [
        {
          kind: 'invalid_input',
          code: 'MALFORMED_INPUT',
          message: 'Input must be an object with an exposures array.',
        },
      ],
    };
  }

  const { exposures, isPartialLineage } = input;

  let broadAdherenceResult: ReduceGuidedAdherenceStateResult | null = null;
  if (input.broadAdherence) {
    if ('status' in input.broadAdherence) {
      broadAdherenceResult = input.broadAdherence;
    } else {
      broadAdherenceResult = reduceGuidedAdherenceState(input.broadAdherence);
    }
    if (broadAdherenceResult.status !== 'success') {
      return {
        status: 'invalid_input',
        error: 'INVALID_BROAD_ADHERENCE',
        errorMessage: `Broad adherence resolution failed: ${broadAdherenceResult.errorMessage}`,
        diagnostics: [
          {
            kind: 'invalid_input',
            code: 'INVALID_BROAD_ADHERENCE',
            message: broadAdherenceResult.errorMessage,
          },
        ],
      };
    }
  }

  // 2. Empty history handling
  if (exposures.length === 0) {
    let emptyTrustStatus: GuidedLaneTrustStatus = isPartialLineage
      ? 'degraded_requalification'
      : 'empty';
    let emptySuccessCredit = 0;
    let emptyGateReady = false;
    let emptyHistoryNudgeEligible = false;
    let emptyNextAction: GuidedLaneNextAction = isPartialLineage
      ? 'degraded_requalification'
      : 'establish_baseline';

    if (broadAdherenceResult && broadAdherenceResult.adherenceGateOpen && !isPartialLineage) {
      emptyTrustStatus = 'trusted';
      emptySuccessCredit = broadAdherenceResult.successCredit;
      emptyGateReady = broadAdherenceResult.gateReady;
      emptyHistoryNudgeEligible = true;
      emptyNextAction = 'eligible_for_nudge';
    }

    return {
      status: 'success',
      trustStatus: emptyTrustStatus,
      successCredit: emptySuccessCredit,
      gateReady: emptyGateReady,
      historyNudgeEligible: emptyHistoryNudgeEligible,
      confirmedStepIndex: 0,
      confirmedNudgeCount: 0,
      stablePrescription: null,
      lastDemonstratedPrescription: null,
      pendingNudge: null,
      marginalHoldActive: false,
      rollbackRequired: false,
      rollbackReason: null,
      rollbackPrescription: null,
      nextAction: emptyNextAction,
      processedExposureCount: 0,
      neutralExposureCount: 0,
      overperformanceExposureCount: 0,
      diagnostics: [],
    };
  }

  // 3. Fail closed on structurally invalid direct input
  const seenLogIds = new Set<string>();
  const laneTemplate = exposures[0];

  for (let i = 0; i < exposures.length; i++) {
    const exp = exposures[i];

    if (!exp || typeof exp !== 'object') {
      return {
        status: 'invalid_input',
        error: 'MALFORMED_EXPOSURE',
        errorMessage: `Exposure at index ${i} is not a valid object.`,
        diagnostics: [
          {
            exposureIndex: i,
            kind: 'invalid_input',
            code: 'MALFORMED_EXPOSURE',
            message: `Exposure at index ${i} is not a valid object.`,
          },
        ],
      };
    }

    // Duplicate workout exposure ID
    if (!exp.workoutLogId || typeof exp.workoutLogId !== 'string') {
      return {
        status: 'invalid_input',
        error: 'MALFORMED_EXPOSURE',
        errorMessage: `Exposure at index ${i} has invalid workoutLogId.`,
        diagnostics: [
          {
            exposureIndex: i,
            kind: 'invalid_input',
            code: 'MALFORMED_EXPOSURE',
            message: `Exposure at index ${i} has invalid workoutLogId.`,
          },
        ],
      };
    }

    if (seenLogIds.has(exp.workoutLogId)) {
      return {
        status: 'invalid_input',
        error: 'DUPLICATE_WORKOUT_EXPOSURE_ID',
        errorMessage: `Duplicate workout exposure ID: ${exp.workoutLogId}`,
        diagnostics: [
          {
            exposureIndex: i,
            workoutLogId: exp.workoutLogId,
            kind: 'invalid_input',
            code: 'DUPLICATE_WORKOUT_EXPOSURE_ID',
            message: `Duplicate workout exposure ID encountered: ${exp.workoutLogId}`,
          },
        ],
      };
    }
    seenLogIds.add(exp.workoutLogId);

    // Chronology check
    if (i > 0) {
      const prev = exposures[i - 1];
      if (exp.workoutDate < prev.workoutDate) {
        return {
          status: 'invalid_input',
          error: 'NON_CHRONOLOGICAL_EXPOSURES',
          errorMessage: `Exposures are not chronological: ${prev.workoutDate} followed by ${exp.workoutDate}`,
          diagnostics: [
            {
              exposureIndex: i,
              workoutLogId: exp.workoutLogId,
              workoutDate: exp.workoutDate,
              kind: 'invalid_input',
              code: 'NON_CHRONOLOGICAL_EXPOSURES',
              message: `Date regression: ${prev.workoutDate} followed by ${exp.workoutDate}`,
            },
          ],
        };
      }
      if (exp.workoutDate === prev.workoutDate) {
        if (
          prev.workoutTimestampMs === null ||
          exp.workoutTimestampMs === null ||
          exp.workoutTimestampMs <= prev.workoutTimestampMs
        ) {
          return {
            status: 'invalid_input',
            error: 'NON_CHRONOLOGICAL_EXPOSURES',
            errorMessage: `Same-day exposures lack strictly ascending timestamps: ${prev.workoutLogId} vs ${exp.workoutLogId}`,
            diagnostics: [
              {
                exposureIndex: i,
                workoutLogId: exp.workoutLogId,
                workoutDate: exp.workoutDate,
                kind: 'invalid_input',
                code: 'NON_CHRONOLOGICAL_EXPOSURES',
                message: `Same-day exposures lack strictly ascending timestamps: prev=${prev.workoutTimestampMs}, curr=${exp.workoutTimestampMs}`,
              },
            ],
          };
        }
      }
    }

    // Lane identity consistency
    if (
      exp.exerciseKey !== laneTemplate.exerciseKey ||
      exp.exerciseRole !== laneTemplate.exerciseRole ||
      exp.modality !== laneTemplate.modality ||
      exp.comparableLaneKey !== laneTemplate.comparableLaneKey
    ) {
      return {
        status: 'invalid_input',
        error: 'MIXED_LANE_IDENTITY',
        errorMessage: `Exposure at index ${i} has divergent lane identity.`,
        diagnostics: [
          {
            exposureIndex: i,
            workoutLogId: exp.workoutLogId,
            kind: 'invalid_input',
            code: 'MIXED_LANE_IDENTITY',
            message: `Mixed lane identity detected: expected ${laneTemplate.comparableLaneKey}, got ${exp.comparableLaneKey}`,
          },
        ],
      };
    }

    // Set count consistency
    if (exp.prescribedWorkingSetCount !== laneTemplate.prescribedWorkingSetCount) {
      return {
        status: 'invalid_input',
        error: 'MIXED_WORKING_SET_COUNT',
        errorMessage: `Exposure at index ${i} has divergent prescribedWorkingSetCount: ${exp.prescribedWorkingSetCount} vs ${laneTemplate.prescribedWorkingSetCount}`,
        diagnostics: [
          {
            exposureIndex: i,
            workoutLogId: exp.workoutLogId,
            kind: 'invalid_input',
            code: 'MIXED_WORKING_SET_COUNT',
            message: `Prescribed set count mismatch: expected ${laneTemplate.prescribedWorkingSetCount}, got ${exp.prescribedWorkingSetCount}`,
          },
        ],
      };
    }

    // Ineligible classification check
    if (!exp.classification || exp.classification.outcome === 'ineligible') {
      return {
        status: 'invalid_input',
        error: 'INELIGIBLE_EXERCISE_CLASSIFICATION',
        errorMessage: `Ineligible exercise classification in exposures: ${exp.workoutLogId}`,
        diagnostics: [
          {
            exposureIndex: i,
            workoutLogId: exp.workoutLogId,
            kind: 'invalid_input',
            code: 'INELIGIBLE_EXERCISE_CLASSIFICATION',
            message: `Ineligible exercise classification passed into replay: ${exp.classification?.reason}`,
          },
        ],
      };
    }

    // Set details & snapshot validation
    if (!Array.isArray(exp.sets) || exp.sets.length !== exp.prescribedWorkingSetCount) {
      return {
        status: 'invalid_input',
        error: 'MALFORMED_EXPOSURE_STRUCTURE',
        errorMessage: `Exposure at index ${i} has set count mismatch with prescribedWorkingSetCount.`,
        diagnostics: [
          {
            exposureIndex: i,
            workoutLogId: exp.workoutLogId,
            kind: 'invalid_input',
            code: 'MALFORMED_EXPOSURE_STRUCTURE',
            message: `Set count mismatch: sets.length=${exp.sets?.length}, prescribedWorkingSetCount=${exp.prescribedWorkingSetCount}`,
          },
        ],
      };
    }

    for (let sIdx = 0; sIdx < exp.sets.length; sIdx++) {
      const setDetail = exp.sets[sIdx];
      const snapshot = setDetail?.snapshot;

      if (!snapshot) {
        return {
          status: 'invalid_input',
          error: 'INVALID_SNAPSHOT',
          errorMessage: `Set at ordinal ${setDetail?.workingSetOrdinal} lacks prescription snapshot.`,
          diagnostics: [
            {
              exposureIndex: i,
              workoutLogId: exp.workoutLogId,
              kind: 'invalid_input',
              code: 'INVALID_SNAPSHOT',
              message: 'Missing prescription snapshot.',
            },
          ],
        };
      }

      if (
        snapshot.snapshotVersion !== CURRENT_PRESCRIPTION_SNAPSHOT_VERSION ||
        snapshot.progressionPolicyVersion !== CURRENT_PROGRESSION_POLICY_VERSION ||
        snapshot.algorithmVersion !== CURRENT_ALGORITHM_VERSION
      ) {
        return {
          status: 'invalid_input',
          error: 'INVALID_SNAPSHOT_VERSION',
          errorMessage: `Snapshot version mismatch on exposure ${exp.workoutLogId}: version=${snapshot.snapshotVersion}`,
          diagnostics: [
            {
              exposureIndex: i,
              workoutLogId: exp.workoutLogId,
              kind: 'invalid_input',
              code: 'INVALID_SNAPSHOT_VERSION',
              message: `Unsupported snapshot version: ${snapshot.snapshotVersion}`,
            },
          ],
        };
      }

      const templateSnapshot = laneTemplate.sets[0]?.snapshot;

      if (templateSnapshot && snapshot.loadBasis !== templateSnapshot.loadBasis) {
        return {
          status: 'invalid_input',
          error: 'LOAD_BASIS_MISMATCH',
          errorMessage: `Load basis mismatch on exposure ${exp.workoutLogId}: expected ${templateSnapshot.loadBasis}, got ${snapshot.loadBasis}`,
          diagnostics: [
            {
              exposureIndex: i,
              workoutLogId: exp.workoutLogId,
              kind: 'invalid_input',
              code: 'LOAD_BASIS_MISMATCH',
              message: `Load basis mismatch: expected ${templateSnapshot.loadBasis}, got ${snapshot.loadBasis}`,
            },
          ],
        };
      }

      if (templateSnapshot && snapshot.algorithmId !== templateSnapshot.algorithmId) {
        return {
          status: 'invalid_input',
          error: 'MIXED_LANE_IDENTITY',
          errorMessage: `Algorithm ID mismatch on exposure ${exp.workoutLogId}: expected ${templateSnapshot.algorithmId}, got ${snapshot.algorithmId}`,
          diagnostics: [
            {
              exposureIndex: i,
              workoutLogId: exp.workoutLogId,
              kind: 'invalid_input',
              code: 'MIXED_LANE_IDENTITY',
              message: `Algorithm ID mismatch: expected ${templateSnapshot.algorithmId}, got ${snapshot.algorithmId}`,
            },
          ],
        };
      }

      if (
        snapshot.progressionMode !== 'metreps_guided' ||
        (templateSnapshot && snapshot.progressionMode !== templateSnapshot.progressionMode)
      ) {
        return {
          status: 'invalid_input',
          error: 'INVALID_SNAPSHOT',
          errorMessage: `Progression mode mismatch on exposure ${exp.workoutLogId}: ${snapshot.progressionMode}`,
          diagnostics: [
            {
              exposureIndex: i,
              workoutLogId: exp.workoutLogId,
              kind: 'invalid_input',
              code: 'INVALID_SNAPSHOT',
              message: `Invalid or mixed progression mode: ${snapshot.progressionMode}`,
            },
          ],
        };
      }

      if (!isValidSnapshotStepMetadata(snapshot)) {
        return {
          status: 'invalid_input',
          error: 'INVALID_SNAPSHOT_METADATA',
          errorMessage: `Invalid snapshot step metadata on exposure ${exp.workoutLogId}.`,
          diagnostics: [
            {
              exposureIndex: i,
              workoutLogId: exp.workoutLogId,
              kind: 'invalid_input',
              code: 'INVALID_SNAPSHOT_METADATA',
              message: 'Snapshot failed isValidSnapshotStepMetadata contract.',
            },
          ],
        };
      }
    }
  }

  // 4. State variables initialized for replay
  let trustStatus: GuidedLaneTrustStatus = isPartialLineage
    ? 'degraded_requalification'
    : 'empty';
  let successCredit = 0;
  let confirmedStepIndex = 0;
  let confirmedNudgeCount = 0;
  let stablePrescription: GuidedReplayPrescriptionSet[] | null = null;
  let lastDemonstratedPrescription: GuidedReplayPrescriptionSet[] | null = null;
  let pendingNudge: GuidedPendingNudge | null = null;
  let marginalHoldActive = false;
  let rollbackRequired = false;
  let rollbackReason: GuidedCoachingReasonCode | null = null;
  let rollbackPrescription: GuidedReplayPrescriptionSet[] | null = null;
  let processedExposureCount = 0;
  let neutralExposureCount = 0;
  let overperformanceExposureCount = 0;
  let lastBroadTimelineIndex = -1;
  const diagnostics: ReplayTransitionDiagnostic[] = [];

  // 5. Sequential exposure reduction
  for (let idx = 0; idx < exposures.length; idx++) {
    const exp = exposures[idx];
    processedExposureCount++;

    // Timeline correspondence and chronological verification when broad adherence is provided
    let matchingTimelineEntry: GuidedAdherenceTimelineEntry | null = null;
    let isTimelineMatchValid = false;

    if (broadAdherenceResult !== null) {
      const matchedIdx = broadAdherenceResult.timeline.findIndex(
        e => e.workoutLogId === exp.workoutLogId
      );

      if (matchedIdx === -1) {
        diagnostics.push({
          exposureIndex: idx,
          workoutLogId: exp.workoutLogId,
          workoutDate: exp.workoutDate,
          kind: 'anomaly',
          code: 'BROAD_ADHERENCE_TIMELINE_MISMATCH',
          message: `Exposure ${exp.workoutLogId} not found in broad adherence timeline.`,
        });
      } else if (matchedIdx < lastBroadTimelineIndex) {
        diagnostics.push({
          exposureIndex: idx,
          workoutLogId: exp.workoutLogId,
          workoutDate: exp.workoutDate,
          kind: 'anomaly',
          code: 'BROAD_ADHERENCE_ORDERING_MISMATCH',
          message: `Exposure ${exp.workoutLogId} matched timeline index ${matchedIdx} which precedes previous index ${lastBroadTimelineIndex}.`,
        });
      } else {
        const candidate = broadAdherenceResult.timeline[matchedIdx];
        if (candidate.workoutDate !== exp.workoutDate) {
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: exp.workoutLogId,
            workoutDate: exp.workoutDate,
            kind: 'anomaly',
            code: 'BROAD_ADHERENCE_DATE_MISMATCH',
            message: `Exposure date ${exp.workoutDate} does not match timeline date ${candidate.workoutDate}.`,
          });
        } else if (candidate.exerciseKey !== exp.exerciseKey) {
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: exp.workoutLogId,
            workoutDate: exp.workoutDate,
            kind: 'anomaly',
            code: 'BROAD_ADHERENCE_EXERCISE_MISMATCH',
            message: `Exposure exercise ${exp.exerciseKey} does not match timeline exercise ${candidate.exerciseKey}.`,
          });
        } else {
          lastBroadTimelineIndex = matchedIdx;
          matchingTimelineEntry = candidate;
          isTimelineMatchValid = true;
        }
      }
    }

    const broadStateBefore = isTimelineMatchValid && matchingTimelineEntry ? matchingTimelineEntry.stateBefore : null;

    // Check qualification from broad adherence (using stateBefore) or intra-lane state:
    const hasBroadQualification =
      broadStateBefore !== null &&
      broadStateBefore.adherenceGateOpen &&
      broadStateBefore.successCredit >= 2 &&
      !broadStateBefore.marginalHoldActive;

    const hasQualification =
      broadAdherenceResult !== null
        ? hasBroadQualification
        : (successCredit === 2 && !marginalHoldActive);

    // Broad qualification from earlier compatible phases can authorize an otherwise valid
    // first advancement in a new narrow lane:
    if (trustStatus === 'empty' && hasQualification && broadAdherenceResult !== null) {
      trustStatus = 'trusted';
      successCredit = 2;
    }

    const presentedPrescription = extractPresentedPrescription(exp);
    const exposureRollbackPrescription = extractRollbackPrescription(exp);
    const exposureBasePrescription = extractBasePrescription(exp);

    const firstSnapshot = exp.sets[0].snapshot;
    const coachingReason = firstSnapshot.coachingReasonCode;

    // Detect if this exposure represents an advanced target presentation
    const activeMarkerSet = exp.sets.find(
      (s: ComparableGuidedSetDetail) =>
        s.snapshot.nudgeType === 'rep_nudge' || s.snapshot.nudgeType === 'load_nudge'
    );
    const isAdvancedReason =
      coachingReason === 'REP_NUDGE' ||
      coachingReason === 'LOAD_NUDGE_MAIN_MOVEMENT' ||
      coachingReason === 'LOAD_PROMOTION_CEILING_REACHED' ||
      coachingReason === 'NUDGE_NEUTRAL_RETRY';
    const isAdvancedPresentation = activeMarkerSet !== undefined || isAdvancedReason;

    const outcome = exp.classification.outcome;

    // ------------------------------------------------------------------------
    // CASE 1: Neutral outcome (skipped exercise, skipped set, missing set)
    // ------------------------------------------------------------------------
    if (outcome === 'neutral') {
      neutralExposureCount++;

      // Check if this was an authorized nudge exposure that yielded neutral
      const isAuthorizedNeutralNudge =
        isAdvancedPresentation &&
        trustStatus === 'trusted' &&
        hasQualification &&
        !marginalHoldActive &&
        !rollbackRequired &&
        firstSnapshot.confirmedStepIndexBefore === confirmedStepIndex &&
        firstSnapshot.presentedStepIndex === confirmedStepIndex + 1 &&
        arePrescriptionsEqual(exposureRollbackPrescription, exposureBasePrescription) &&
        activeMarkerSet !== undefined &&
        (pendingNudge === null ||
          (pendingNudge.nudgeType === activeMarkerSet.snapshot.nudgeType &&
            pendingNudge.nudgedWorkingSetOrdinal === exp.nudgedWorkingSetOrdinal &&
            pendingNudge.confirmedStepIndexBefore === firstSnapshot.confirmedStepIndexBefore &&
            pendingNudge.presentedStepIndex === firstSnapshot.presentedStepIndex &&
            arePrescriptionsEqual(presentedPrescription, pendingNudge.presentedPrescription)));

      if (isAuthorizedNeutralNudge) {
        pendingNudge = {
          nudgeType: activeMarkerSet.snapshot.nudgeType,
          nudgedWorkingSetOrdinal: exp.nudgedWorkingSetOrdinal!,
          confirmedStepIndexBefore: firstSnapshot.confirmedStepIndexBefore,
          presentedStepIndex: firstSnapshot.presentedStepIndex,
          coachingReasonCode: coachingReason,
          presentedPrescription: clonePrescription(presentedPrescription)!,
          rollbackPrescription: clonePrescription(exposureRollbackPrescription)!,
        };
        diagnostics.push({
          exposureIndex: idx,
          workoutLogId: exp.workoutLogId,
          workoutDate: exp.workoutDate,
          kind: 'info',
          code: 'NUDGE_NEUTRAL_PENDING',
          message: 'Authorized nudge yielded neutral outcome; stored as pending retry.',
        });
      } else if (isAdvancedPresentation && trustStatus === 'degraded_requalification') {
        // Unproven advanced target neutral: do not adopt advanced; use base as conservative anchor
        if (stablePrescription === null) {
          stablePrescription = clonePrescription(exposureBasePrescription);
        }
      }

      // Neutral preserves all other state (step, credit, rollback, etc.)
      continue;
    }

    // ------------------------------------------------------------------------
    // CASE 2: Active Rollback Presentation Awaiting Resolution
    // ------------------------------------------------------------------------
    if (rollbackRequired) {
      const matchesRollback = arePrescriptionsEqual(presentedPrescription, rollbackPrescription);

      if (matchesRollback) {
        if (outcome === 'success') {
          rollbackRequired = false;
          rollbackReason = null;
          rollbackPrescription = null;
          successCredit = 1; // Fresh credit begins at one
          stablePrescription = clonePrescription(presentedPrescription);
          lastDemonstratedPrescription = clonePrescription(presentedPrescription);
          marginalHoldActive = false;
          if (exp.classification.reason === 'TARGET_ACHIEVED_OVERPERFORMANCE') {
            overperformanceExposureCount++;
          }
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: exp.workoutLogId,
            workoutDate: exp.workoutDate,
            kind: 'info',
            code: 'ROLLBACK_SUCCESS_RESOLVED',
            message: 'Rollback target successfully achieved; fresh success credit starts at 1.',
          });
        } else if (outcome === 'marginal_miss') {
          rollbackRequired = false;
          rollbackReason = null;
          rollbackPrescription = null;
          marginalHoldActive = true;
          stablePrescription = clonePrescription(presentedPrescription);
          successCredit = 0;
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: exp.workoutLogId,
            workoutDate: exp.workoutDate,
            kind: 'warning',
            code: 'ROLLBACK_MARGINAL_MISS',
            message: 'Rollback target had marginal miss; stable target must be repeated.',
          });
        } else if (outcome === 'substantial_miss') {
          rollbackRequired = false;
          rollbackReason = null;
          rollbackPrescription = null;
          marginalHoldActive = false;
          stablePrescription = clonePrescription(presentedPrescription);
          successCredit = 0;
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: exp.workoutLogId,
            workoutDate: exp.workoutDate,
            kind: 'warning',
            code: 'ROLLBACK_SUBSTANTIAL_MISS',
            message: 'Rollback target had substantial miss; credit reset to 0.',
          });
        }
      } else {
        // Mismatched rollback presentation
        diagnostics.push({
          exposureIndex: idx,
          workoutLogId: exp.workoutLogId,
          workoutDate: exp.workoutDate,
          kind: 'anomaly',
          code: 'MISMATCHED_ROLLBACK_PRESENTATION',
          message: 'Presented target does not match required rollback prescription; entering degraded requalification.',
        });
        trustStatus = 'degraded_requalification';
        rollbackRequired = false;
        rollbackReason = null;
        rollbackPrescription = null;

        if (outcome === 'success') {
          stablePrescription = clonePrescription(presentedPrescription);
          lastDemonstratedPrescription = clonePrescription(presentedPrescription);
          successCredit = 1;
          confirmedStepIndex = Math.max(confirmedStepIndex, firstSnapshot.presentedStepIndex);
          if (exp.classification.reason === 'TARGET_ACHIEVED_OVERPERFORMANCE') {
            overperformanceExposureCount++;
          }
        } else {
          successCredit = 0;
        }
      }
      continue;
    }

    // ------------------------------------------------------------------------
    // CASE 3: Advanced Presentation (Nudge Attempt or Retry)
    // ------------------------------------------------------------------------
    if (isAdvancedPresentation) {
      // Check if pending retry matches
      let isMatchingPendingRetry = false;
      if (pendingNudge !== null) {
        const matchesNudgeType = activeMarkerSet?.snapshot.nudgeType === pendingNudge.nudgeType;
        const matchesOrdinal = exp.nudgedWorkingSetOrdinal === pendingNudge.nudgedWorkingSetOrdinal;
        const matchesStepBefore = firstSnapshot.confirmedStepIndexBefore === pendingNudge.confirmedStepIndexBefore;
        const matchesPresentedStep = firstSnapshot.presentedStepIndex === pendingNudge.presentedStepIndex;
        const matchesPrescription = arePrescriptionsEqual(presentedPrescription, pendingNudge.presentedPrescription);
        const matchesRollbackTarget = arePrescriptionsEqual(exposureRollbackPrescription, pendingNudge.rollbackPrescription);

        if (
          matchesNudgeType &&
          matchesOrdinal &&
          matchesStepBefore &&
          matchesPresentedStep &&
          matchesPrescription &&
          matchesRollbackTarget
        ) {
          isMatchingPendingRetry = true;
        } else {
          // Retry anomaly: retry with changed target, ordinal, or prescription degrades
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: exp.workoutLogId,
            workoutDate: exp.workoutDate,
            kind: 'anomaly',
            code: 'PENDING_RETRY_MISMATCH',
            message: 'Nudge retry does not match pending nudge specification; entering degraded requalification.',
          });
          trustStatus = 'degraded_requalification';
          pendingNudge = null;
        }
      }

      // Check 11 Authorized Nudge Requirements:
      const isAuthorizedNudge =
        trustStatus === 'trusted' &&
        hasQualification &&
        !marginalHoldActive &&
        !rollbackRequired &&
        firstSnapshot.confirmedStepIndexBefore === confirmedStepIndex &&
        firstSnapshot.presentedStepIndex === confirmedStepIndex + 1 &&
        arePrescriptionsEqual(exposureRollbackPrescription, exposureBasePrescription) &&
        activeMarkerSet !== undefined &&
        (pendingNudge === null || isMatchingPendingRetry);

      if (isAuthorizedNudge) {
        if (outcome === 'success' && exp.nudgedSetAchieved === true) {
          // Authorized Nudge Confirmed!
          confirmedStepIndex = firstSnapshot.presentedStepIndex;
          confirmedNudgeCount += 1;
          stablePrescription = clonePrescription(presentedPrescription);
          lastDemonstratedPrescription = clonePrescription(presentedPrescription);
          pendingNudge = null;
          rollbackRequired = false;
          rollbackReason = null;
          rollbackPrescription = null;
          marginalHoldActive = false;
          successCredit = 2; // Gate remains open

          if (exp.classification.reason === 'TARGET_ACHIEVED_OVERPERFORMANCE') {
            overperformanceExposureCount++;
          }
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: exp.workoutLogId,
            workoutDate: exp.workoutDate,
            kind: 'info',
            code: 'NUDGE_CONFIRMED',
            message: `Nudge confirmed to step ${confirmedStepIndex}.`,
          });
        } else {
          // Authorized Nudge Failure -> Rollback
          rollbackRequired = true;
          rollbackReason =
            outcome === 'marginal_miss'
              ? 'NUDGE_MARGINAL_FAILURE_ROLLBACK'
              : 'NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK';
          rollbackPrescription = clonePrescription(exposureRollbackPrescription);
          confirmedStepIndex = firstSnapshot.confirmedStepIndexBefore;
          pendingNudge = null;
          successCredit = 0;
          marginalHoldActive = false;

          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: exp.workoutLogId,
            workoutDate: exp.workoutDate,
            kind: 'warning',
            code: rollbackReason,
            message: `Authorized nudge failed (${outcome}, nudgedSetAchieved=${exp.nudgedSetAchieved}); rollback required.`,
          });
        }
      } else {
        // Unauthorized Nudge / Anomaly / Partial Lineage Unproven Nudge
        if (marginalHoldActive || (broadStateBefore?.marginalHoldActive)) {
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: exp.workoutLogId,
            workoutDate: exp.workoutDate,
            kind: 'anomaly',
            code: 'NUDGE_DURING_MARGINAL_HOLD',
            message: 'Nudge presented while marginal hold active; entering degraded requalification.',
          });
          marginalHoldActive = false;
        }

        if ((!hasQualification || successCredit < 2) && (trustStatus === 'trusted' || trustStatus === 'empty')) {
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: exp.workoutLogId,
            workoutDate: exp.workoutDate,
            kind: 'anomaly',
            code: 'NUDGE_BEFORE_TWO_SUCCESSES',
            message: 'Nudge presented before two qualifying successes; entering degraded requalification.',
          });
        }

        if (firstSnapshot.presentedStepIndex > confirmedStepIndex + 1) {
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: exp.workoutLogId,
            workoutDate: exp.workoutDate,
            kind: 'anomaly',
            code: 'STEP_JUMP_ANOMALY',
            message: `Step jump of ${firstSnapshot.presentedStepIndex - confirmedStepIndex} steps; entering degraded requalification.`,
          });
        }

        if (!arePrescriptionsEqual(exposureRollbackPrescription, exposureBasePrescription)) {
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: exp.workoutLogId,
            workoutDate: exp.workoutDate,
            kind: 'anomaly',
            code: 'ROLLBACK_TARGET_MISMATCH',
            message: 'Rollback target does not match independently reconstructed current base; entering degraded requalification.',
          });
        }

        trustStatus = 'degraded_requalification';
        pendingNudge = null;

        if (outcome === 'success') {
          // Adopt successfully demonstrated target conservatively
          stablePrescription = clonePrescription(presentedPrescription);
          lastDemonstratedPrescription = clonePrescription(presentedPrescription);
          successCredit = 1;

          if (exp.classification.reason === 'TARGET_ACHIEVED_OVERPERFORMANCE') {
            overperformanceExposureCount++;
          }
        } else if (outcome === 'marginal_miss') {
          stablePrescription = clonePrescription(exposureBasePrescription);
          successCredit = 0;
        } else if (outcome === 'substantial_miss') {
          stablePrescription = clonePrescription(exposureBasePrescription);
          successCredit = 0;
        }
      }
      continue;
    }

    // ------------------------------------------------------------------------
    // CASE 4: Stable / Hold Presentation (Non-Nudge)
    // ------------------------------------------------------------------------
    // If pending nudge exists and an unexpected unmarked base prescription appears:
    if (pendingNudge !== null) {
      if (isPlannedHoldReason(coachingReason)) {
        // Planned hold pauses pending nudge; leaves pending nudge available for later retry
        diagnostics.push({
          exposureIndex: idx,
          workoutLogId: exp.workoutLogId,
          workoutDate: exp.workoutDate,
          kind: 'info',
          code: 'PENDING_NUDGE_PAUSED_BY_HOLD',
          message: `Pending nudge paused by current-session guard: ${coachingReason}.`,
        });
      } else {
        // Normal unmarked base prescription unexpectedly replacing pending nudge
        diagnostics.push({
          exposureIndex: idx,
          workoutLogId: exp.workoutLogId,
          workoutDate: exp.workoutDate,
          kind: 'anomaly',
          code: 'PENDING_NUDGE_REPLACED_BY_BASE',
          message: 'Pending nudge unexpectedly replaced by base prescription; entering degraded requalification.',
        });
        trustStatus = 'degraded_requalification';
        pendingNudge = null;
      }
    }

    if (outcome === 'success') {
      if (coachingReason !== 'STEP_OUT_BASE_ONLY') {
        lastDemonstratedPrescription = clonePrescription(presentedPrescription);
        if (
          stablePrescription === null ||
          trustStatus === 'degraded_requalification' ||
          firstSnapshot.presentedStepIndex >= confirmedStepIndex
        ) {
          stablePrescription = clonePrescription(presentedPrescription);
        }
      }

      if (exp.classification.reason === 'TARGET_ACHIEVED_OVERPERFORMANCE') {
        overperformanceExposureCount++;
      }

      // Check step regression
      if (firstSnapshot.presentedStepIndex < confirmedStepIndex) {
        diagnostics.push({
          exposureIndex: idx,
          workoutLogId: exp.workoutLogId,
          workoutDate: exp.workoutDate,
          kind: 'anomaly',
          code: 'STEP_REGRESSION_ANOMALY',
          message: `Presented step ${firstSnapshot.presentedStepIndex} is lower than confirmed step ${confirmedStepIndex}; regression ignored.`,
        });
      }

      if (firstSnapshot.successCreditEligible) {
        successCredit = Math.min(2, successCredit + 1);

        if (trustStatus === 'degraded_requalification' && successCredit === 2) {
          trustStatus = 'trusted';
        }
        if (trustStatus === 'empty') {
          trustStatus = 'trusted';
        }
      }

      // Clear marginal hold on stable success (except STEP_OUT_BASE_ONLY)
      if (marginalHoldActive && coachingReason !== 'STEP_OUT_BASE_ONLY') {
        marginalHoldActive = false;
      }
    } else if (outcome === 'marginal_miss') {
      if (coachingReason === 'STEP_OUT_BASE_ONLY') {
        // Transparent to coaching gate
      } else {
        const isMultipleMarginal =
          exp.classification?.reason === 'MULTIPLE_MARGINAL_MISSES' ||
          (exp.classification?.marginalMissCount ?? 0) >= 2;
        if (isMultipleMarginal) {
          successCredit = 0;
          marginalHoldActive = false;
        } else if (successCredit === 2) {
          marginalHoldActive = true;
        }
      }
    } else if (outcome === 'substantial_miss') {
      if (coachingReason === 'STEP_OUT_BASE_ONLY') {
        // Transparent to coaching gate
      } else {
        successCredit = 0;
        marginalHoldActive = false;
      }
    }
  }

  // 6. Derive final readouts
  const gateReady = successCredit === 2;
  const historyNudgeEligible =
    trustStatus === 'trusted' &&
    successCredit === 2 &&
    pendingNudge === null &&
    !rollbackRequired &&
    !marginalHoldActive;

  // Next-Action Precedence:
  // 1. Pending nudge -> retry_pending_nudge
  // 2. Rollback required -> present_rollback
  // 3. Degraded state -> degraded_requalification
  // 4. Marginal hold -> repeat_stable_target
  // 5. No stable prescription -> establish_baseline
  // 6. History gate ready -> eligible_for_nudge
  // 7. Otherwise -> build_success_credit
  let nextAction: GuidedLaneNextAction;
  if (pendingNudge !== null) {
    nextAction = 'retry_pending_nudge';
  } else if (rollbackRequired) {
    nextAction = 'present_rollback';
  } else if (trustStatus === 'degraded_requalification') {
    nextAction = 'degraded_requalification';
  } else if (marginalHoldActive) {
    nextAction = 'repeat_stable_target';
  } else if (stablePrescription === null) {
    nextAction = 'establish_baseline';
  } else if (gateReady) {
    nextAction = 'eligible_for_nudge';
  } else {
    nextAction = 'build_success_credit';
  }

  return {
    status: 'success',
    trustStatus,
    successCredit,
    gateReady,
    historyNudgeEligible,
    confirmedStepIndex,
    confirmedNudgeCount,
    stablePrescription: clonePrescription(stablePrescription),
    lastDemonstratedPrescription: clonePrescription(lastDemonstratedPrescription),
    pendingNudge: pendingNudge
      ? {
          ...pendingNudge,
          presentedPrescription: clonePrescription(pendingNudge.presentedPrescription)!,
          rollbackPrescription: clonePrescription(pendingNudge.rollbackPrescription)!,
        }
      : null,
    marginalHoldActive,
    rollbackRequired,
    rollbackReason,
    rollbackPrescription: clonePrescription(rollbackPrescription),
    nextAction,
    processedExposureCount,
    neutralExposureCount,
    overperformanceExposureCount,
    diagnostics,
  };
}
