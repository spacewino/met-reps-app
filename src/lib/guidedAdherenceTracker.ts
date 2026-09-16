/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ComparableGuidedExposure } from './guidedHistoryCollector';
import { GuidedExerciseOutcome } from './guidedExerciseClassifier';

/**
 * Status of broad adherence qualification across historical sessions.
 */
export type GuidedAdherenceStatus =
  | 'unqualified'
  | 'qualified'
  | 'requalifying';

export interface GuidedAdherenceDiagnostic {
  exposureIndex: number;
  workoutLogId: string;
  workoutDate: string;
  kind: 'info' | 'warning' | 'anomaly';
  code: string;
  message: string;
}

/**
 * Qualification state immediately before or after an exposure in the timeline.
 */
export interface GuidedAdherenceTimelineState {
  successCredit: number; // 0 | 1 | 2
  marginalHoldActive: boolean;
  adherenceGateOpen: boolean;
  gateReady: boolean;
  adherenceStatus: GuidedAdherenceStatus;
}

/**
 * Per-exposure timeline entry recording chronological qualification states.
 */
export interface GuidedAdherenceTimelineEntry {
  exposureIndex: number;
  workoutLogId: string;
  workoutDate: string;
  workoutTimestampMs: number | null;
  exerciseKey: string;
  comparableLaneKey?: string;
  stateBefore: GuidedAdherenceTimelineState;
  outcome: GuidedExerciseOutcome;
  reason?: string;
  stateAfter: GuidedAdherenceTimelineState;
}

export interface GuidedAdherenceSuccessResult {
  status: 'success';
  adherenceGateOpen: boolean;
  gateReady: boolean;
  marginalHoldActive: boolean;
  adherenceStatus: GuidedAdherenceStatus;
  successCredit: number; // 0 | 1 | 2
  consecutiveSuccessCount: number;
  processedExposureCount: number;
  successfulExposureCount: number;
  failedExposureCount: number;
  neutralExposureCount: number;
  lastOutcome: GuidedExerciseOutcome | null;
  lastQualifyingWorkoutDate: string | null;
  lastQualifyingWorkoutLogId: string | null;
  isPartialLineage: boolean;
  timeline: GuidedAdherenceTimelineEntry[];
  diagnostics: GuidedAdherenceDiagnostic[];
}

export interface GuidedAdherenceInvalidInputResult {
  status: 'invalid_input';
  error: string;
  errorMessage: string;
  adherenceGateOpen: false;
  gateReady: false;
  marginalHoldActive: false;
  successCredit: 0;
  timeline: [];
  diagnostics: GuidedAdherenceDiagnostic[];
}

export type ReduceGuidedAdherenceStateResult =
  | GuidedAdherenceSuccessResult
  | GuidedAdherenceInvalidInputResult;

export interface ReduceGuidedAdherenceStateInputObject {
  exposures: readonly ComparableGuidedExposure[];
  isPartialLineage?: boolean;
}

export type ReduceGuidedAdherenceStateInput =
  | ReduceGuidedAdherenceStateInputObject
  | readonly ComparableGuidedExposure[]
  | { usableExposures: readonly ComparableGuidedExposure[]; isPartialLineage?: boolean };

/**
 * Pure, deterministic reducer evaluating broad exercise adherence qualification.
 *
 * Rules:
 * - Qualifying success: adds one credit, capped at two.
 * - Explicit overperformance: still adds only one qualification credit.
 * - Neutral/skipped exposure: preserves credit and existing hold state.
 * - Credit-ineligible exposures: follow freeze rules and earn no qualification credit.
 * - Single marginal miss: preserves existing credit.
 * - Single marginal miss at two credits: activates the marginal hold, preventing a fresh nudge despite retained credit.
 * - Subsequent qualifying success: clears that marginal hold and applies the normal capped success-credit update.
 * - Multiple marginal misses within one exercise exposure: resets credit to zero.
 * - Substantial miss: resets credit to zero.
 * - Produces per-exposure authorization timeline with stateBefore and stateAfter.
 */
export function reduceGuidedAdherenceState(
  input: ReduceGuidedAdherenceStateInput
): ReduceGuidedAdherenceStateResult {
  if (!input || (typeof input !== 'object' && !Array.isArray(input))) {
    return {
      status: 'invalid_input',
      error: 'MALFORMED_INPUT',
      errorMessage: 'Input must be an array of exposures or an object containing exposures.',
      adherenceGateOpen: false,
      gateReady: false,
      marginalHoldActive: false,
      successCredit: 0,
      timeline: [],
      diagnostics: [
        {
          exposureIndex: -1,
          workoutLogId: '',
          workoutDate: '',
          kind: 'anomaly',
          code: 'MALFORMED_INPUT',
          message: 'Input must be an array of exposures or an object containing exposures.',
        },
      ],
    };
  }

  let exposures: readonly ComparableGuidedExposure[];
  let isPartialLineage = false;

  if (Array.isArray(input)) {
    exposures = input;
  } else if ('usableExposures' in input && Array.isArray(input.usableExposures)) {
    exposures = input.usableExposures;
    isPartialLineage = Boolean(input.isPartialLineage);
  } else if ('exposures' in input && Array.isArray(input.exposures)) {
    exposures = input.exposures;
    isPartialLineage = Boolean(input.isPartialLineage);
  } else {
    return {
      status: 'invalid_input',
      error: 'MALFORMED_INPUT',
      errorMessage: 'Input object must contain an exposures or usableExposures array.',
      adherenceGateOpen: false,
      gateReady: false,
      marginalHoldActive: false,
      successCredit: 0,
      timeline: [],
      diagnostics: [
        {
          exposureIndex: -1,
          workoutLogId: '',
          workoutDate: '',
          kind: 'anomaly',
          code: 'MALFORMED_INPUT',
          message: 'Input object must contain an exposures or usableExposures array.',
        },
      ],
    };
  }

  if (exposures.length === 0) {
    return {
      status: 'success',
      adherenceGateOpen: false,
      gateReady: false,
      marginalHoldActive: false,
      adherenceStatus: isPartialLineage ? 'requalifying' : 'unqualified',
      successCredit: 0,
      consecutiveSuccessCount: 0,
      processedExposureCount: 0,
      successfulExposureCount: 0,
      failedExposureCount: 0,
      neutralExposureCount: 0,
      lastOutcome: null,
      lastQualifyingWorkoutDate: null,
      lastQualifyingWorkoutLogId: null,
      isPartialLineage,
      timeline: [],
      diagnostics: [],
    };
  }

  let successCredit = 0;
  let marginalHoldActive = false;
  let consecutiveSuccessCount = 0;
  let successfulExposureCount = 0;
  let failedExposureCount = 0;
  let neutralExposureCount = 0;
  let lastOutcome: GuidedExerciseOutcome | null = null;
  let lastQualifyingWorkoutDate: string | null = null;
  let lastQualifyingWorkoutLogId: string | null = null;
  let hasExperiencedFailure = isPartialLineage;
  const diagnostics: GuidedAdherenceDiagnostic[] = [];
  const timeline: GuidedAdherenceTimelineEntry[] = [];

  const deriveAdherenceStatus = (credit: number, hold: boolean): GuidedAdherenceStatus => {
    if (credit >= 2 && !hold) {
      return 'qualified';
    }
    if (hasExperiencedFailure || isPartialLineage) {
      return 'requalifying';
    }
    return 'unqualified';
  };

  for (let idx = 0; idx < exposures.length; idx++) {
    const exp = exposures[idx];
    if (!exp || typeof exp !== 'object') {
      return {
        status: 'invalid_input',
        error: 'INVALID_EXPOSURE',
        errorMessage: `Exposure at index ${idx} is null, undefined, or not an object.`,
        adherenceGateOpen: false,
        gateReady: false,
        marginalHoldActive: false,
        successCredit: 0,
        timeline: [],
        diagnostics: [
          {
            exposureIndex: idx,
            workoutLogId: '',
            workoutDate: '',
            kind: 'anomaly',
            code: 'INVALID_EXPOSURE',
            message: `Exposure at index ${idx} is invalid.`,
          },
        ],
      };
    }

    const outcome = exp.classification?.outcome;
    const logId = exp.workoutLogId || `idx-${idx}`;
    const logDate = exp.workoutDate || '';

    // Capture state immediately BEFORE this exposure:
    const gateReadyBefore = successCredit >= 2;
    const adherenceGateOpenBefore = successCredit >= 2 && !marginalHoldActive;
    const adherenceStatusBefore = deriveAdherenceStatus(successCredit, marginalHoldActive);

    const stateBefore: GuidedAdherenceTimelineState = {
      successCredit,
      marginalHoldActive,
      gateReady: gateReadyBefore,
      adherenceGateOpen: adherenceGateOpenBefore,
      adherenceStatus: adherenceStatusBefore,
    };

    // Check credit eligibility:
    // Credit-ineligible exposures follow freeze rules and earn no qualification credit
    const isCreditIneligible =
      outcome === 'ineligible' ||
      (exp.sets && exp.sets.length > 0 && exp.sets.every(s => s.snapshot && s.snapshot.successCreditEligible === false));

    if (isCreditIneligible) {
      neutralExposureCount++;
      lastOutcome = 'ineligible';
      diagnostics.push({
        exposureIndex: idx,
        workoutLogId: logId,
        workoutDate: logDate,
        kind: 'info',
        code: 'ADHERENCE_INELIGIBLE_FROZEN',
        message: 'Credit-ineligible exposure followed freeze rules; preserved credit and hold state.',
      });
    } else if (outcome === 'success') {
      successfulExposureCount++;
      consecutiveSuccessCount++;
      // Qualifying success clears marginal hold and adds one credit, capped at two
      marginalHoldActive = false;
      successCredit = Math.min(2, successCredit + 1);
      lastOutcome = 'success';
      lastQualifyingWorkoutDate = logDate;
      lastQualifyingWorkoutLogId = logId;

      if (successCredit === 2) {
        diagnostics.push({
          exposureIndex: idx,
          workoutLogId: logId,
          workoutDate: logDate,
          kind: 'info',
          code: 'ADHERENCE_GATE_OPENED',
          message: hasExperiencedFailure
            ? 'Requalification complete: qualifying success achieved; adherence gate open.'
            : 'Two qualifying successes achieved; adherence gate open.',
        });
      } else {
        diagnostics.push({
          exposureIndex: idx,
          workoutLogId: logId,
          workoutDate: logDate,
          kind: 'info',
          code: 'ADHERENCE_CREDIT_INCREMENTED',
          message: `Qualifying success recorded; adherence successCredit is now ${successCredit}.`,
        });
      }
    } else if (outcome === 'neutral') {
      neutralExposureCount++;
      lastOutcome = 'neutral';
      diagnostics.push({
        exposureIndex: idx,
        workoutLogId: logId,
        workoutDate: logDate,
        kind: 'info',
        code: 'ADHERENCE_NEUTRAL_PRESERVED',
        message: `Neutral session (${exp.classification?.reason || 'neutral'}); credit preserved at ${successCredit}.`,
      });
    } else if (outcome === 'marginal_miss') {
      failedExposureCount++;
      hasExperiencedFailure = true;
      consecutiveSuccessCount = 0;

      const isMultipleMarginalMiss =
        exp.classification?.reason === 'MULTIPLE_MARGINAL_MISSES' ||
        (exp.classification?.marginalMissCount ?? 0) >= 2;

      if (isMultipleMarginalMiss) {
        // Multiple marginal misses within one exercise exposure: resets credit to zero
        const priorCredit = successCredit;
        successCredit = 0;
        marginalHoldActive = false;
        lastOutcome = 'substantial_miss';
        diagnostics.push({
          exposureIndex: idx,
          workoutLogId: logId,
          workoutDate: logDate,
          kind: 'warning',
          code: 'ADHERENCE_MULTIPLE_MARGINAL_RESET',
          message: `Multiple marginal misses within one exercise exposure reset adherence credit from ${priorCredit} to 0.`,
        });
      } else {
        // Single marginal miss: preserves existing credit
        lastOutcome = 'marginal_miss';
        if (successCredit === 2) {
          // Single marginal miss at two credits: activates the marginal hold, preventing a fresh nudge despite retained credit
          marginalHoldActive = true;
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: logId,
            workoutDate: logDate,
            kind: 'warning',
            code: 'ADHERENCE_MARGINAL_HOLD_ACTIVATED',
            message: 'Single marginal miss at two credits preserved credit at 2 and activated marginal hold, preventing fresh nudge.',
          });
        } else {
          diagnostics.push({
            exposureIndex: idx,
            workoutLogId: logId,
            workoutDate: logDate,
            kind: 'info',
            code: 'ADHERENCE_MARGINAL_MISS_PRESERVED',
            message: `Single marginal miss preserved adherence credit at ${successCredit}.`,
          });
        }
      }
    } else if (outcome === 'substantial_miss') {
      // Substantial miss: resets credit to zero
      failedExposureCount++;
      hasExperiencedFailure = true;
      consecutiveSuccessCount = 0;
      const priorCredit = successCredit;
      successCredit = 0;
      marginalHoldActive = false;
      lastOutcome = 'substantial_miss';

      diagnostics.push({
        exposureIndex: idx,
        workoutLogId: logId,
        workoutDate: logDate,
        kind: 'warning',
        code: priorCredit >= 2 ? 'ADHERENCE_GATE_CLOSED' : 'ADHERENCE_CREDIT_RESET',
        message: `Exercise outcome was substantial_miss; adherence credit reset from ${priorCredit} to 0.`,
      });
    } else {
      // Unknown outcome: treat conservatively as neutral with a diagnostic
      neutralExposureCount++;
      diagnostics.push({
        exposureIndex: idx,
        workoutLogId: logId,
        workoutDate: logDate,
        kind: 'warning',
        code: 'INELIGIBLE_OR_UNKNOWN_EXPOSURE',
        message: `Exposure outcome "${outcome}" is not recognized; preserved credit at ${successCredit}.`,
      });
    }

    // Capture state immediately AFTER this exposure:
    const gateReadyAfter = successCredit >= 2;
    const adherenceGateOpenAfter = successCredit >= 2 && !marginalHoldActive;
    const adherenceStatusAfter = deriveAdherenceStatus(successCredit, marginalHoldActive);

    const stateAfter: GuidedAdherenceTimelineState = {
      successCredit,
      marginalHoldActive,
      gateReady: gateReadyAfter,
      adherenceGateOpen: adherenceGateOpenAfter,
      adherenceStatus: adherenceStatusAfter,
    };

    timeline.push({
      exposureIndex: idx,
      workoutLogId: logId,
      workoutDate: logDate,
      workoutTimestampMs: exp.workoutTimestampMs ?? null,
      exerciseKey: exp.exerciseKey,
      comparableLaneKey: exp.comparableLaneKey,
      stateBefore,
      outcome: outcome ?? 'ineligible',
      reason: exp.classification?.reason,
      stateAfter,
    });
  }

  const gateReady = successCredit >= 2;
  const adherenceGateOpen = successCredit >= 2 && !marginalHoldActive;
  const adherenceStatus: GuidedAdherenceStatus = deriveAdherenceStatus(successCredit, marginalHoldActive);

  return {
    status: 'success',
    adherenceGateOpen,
    gateReady,
    marginalHoldActive,
    adherenceStatus,
    successCredit,
    consecutiveSuccessCount,
    processedExposureCount: exposures.length,
    successfulExposureCount,
    failedExposureCount,
    neutralExposureCount,
    lastOutcome,
    lastQualifyingWorkoutDate,
    lastQualifyingWorkoutLogId,
    isPartialLineage,
    timeline,
    diagnostics,
  };
}

/**
 * Convenience helper returning whether the adherence gate is open.
 */
export function isAdherenceGateOpen(
  result: ReduceGuidedAdherenceStateResult
): boolean {
  return result.status === 'success' && result.adherenceGateOpen;
}
