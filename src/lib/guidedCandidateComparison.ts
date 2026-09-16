/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  WeightUnit,
  ExerciseModality,
  PrescriptionSnapshot,
  SetEntry,
} from '../types';
import {
  resolveGuidedComparisonLoad,
  calculateRequiredCapacityIndex,
  calculateRelativeChallenge,
  isWithinResistanceChangeCap,
  GUIDED_RESISTANCE_CHANGE_CAP,
  BodyweightSnapshotInput,
} from './adaptiveProgressionMath';
import {
  isValidRPE,
} from './rpeMath';
import {
  ComparableGuidedExposure,
  ComparableGuidedSetDetail,
} from './guidedHistoryCollector';

/**
 * Small documented epsilon for floating-point load equality.
 */
export const COMPARISON_LOAD_EQUALITY_EPSILON = 1e-6;

/**
 * Candidate proposed set target to be evaluated against factual history.
 */
export interface CandidateSetTarget {
  workingSetOrdinal: number;
  weight?: number | null;
  reps: number;
  rpe: number;
  comparisonLoadKg?: number | null;
  modality?: ExerciseModality;
  bodyweight?: BodyweightSnapshotInput;
  unit?: WeightUnit | string | null;
}

/**
 * Provenance tracking the exact historical completed performance used as the factual reference.
 */
export interface FactualReferenceProvenance {
  workoutLogId: string;
  workoutDate: string;
  workoutTimestampMs: number | null;
  workingSetOrdinal: number;
  performedWeight: number | null | undefined;
  performedReps: number;
  effectiveRpe: number;
  rpeSource: 'explicit' | 'presented_target_imputation';
  modality: ExerciseModality;
  historicalBodyweight: number | BodyweightSnapshotInput | null;
  recordedUnit: WeightUnit | string;
  comparisonLoadKg: number;
  capacityIndex: number;
}

/**
 * Status of an individual ordinal evaluation.
 */
export type OrdinalComparisonStatus =
  | 'pass'
  | 'fail'
  | 'unavailable'
  | 'invalid_candidate';

/**
 * Per-ordinal comparison result between proposed candidate target and factual reference.
 */
export interface OrdinalComparisonResult {
  workingSetOrdinal: number;
  status: OrdinalComparisonStatus;

  // Factual reference details (if available)
  referenceProvenance: FactualReferenceProvenance | null;
  referenceComparisonLoadKg: number | null;
  referenceCapacityIndex: number | null;

  // Candidate proposed target details
  candidateComparisonLoadKg: number | null;
  candidateCapacityIndex: number | null;

  // Challenge metrics
  relativeChallenge: number | null;
  isWithinRawCap: boolean;

  // Pure-repetition exemption characteristics
  candidateLoadEqualsReference: boolean;
  isPureRepetitionIncrement: boolean;
  pureRepetitionExemptionEligible: boolean;

  // Diagnostic reason if unavailable or invalid
  diagnosticCode?: string;
  diagnosticMessage?: string;
}

/**
 * High-level evaluation status for the candidate comparison.
 */
export type CandidateComparisonStatus =
  | 'pass'
  | 'fail'
  | 'unavailable'
  | 'invalid_input';

/**
 * Diagnostic record emitted during candidate evaluation.
 */
export interface CandidateComparisonDiagnostic {
  ordinal?: number;
  code: string;
  message: string;
}

/**
 * Input contract for evaluating candidate targets against comparable history.
 */
export interface EvaluateGuidedCandidateComparisonInput {
  candidateTargets: readonly CandidateSetTarget[];
  history: readonly ComparableGuidedExposure[];
  laneMetadata?: {
    modality?: ExerciseModality;
    unit?: WeightUnit | string | null;
    currentBodyweight?: BodyweightSnapshotInput;
    exerciseKey?: string;
  };
}

/**
 * Output result contract for candidate comparison against factual history.
 */
export interface EvaluateGuidedCandidateComparisonResult {
  status: CandidateComparisonStatus;
  allComparisonsValid: boolean;
  rawAggregatePassed: boolean;
  hasExemptionEligibleOrdinals: boolean;
  ordinalResults: OrdinalComparisonResult[];
  diagnostics: CandidateComparisonDiagnostic[];
}

/**
 * Checks whether a historical set qualifies as usable completed performance.
 *
 * Excludes:
 * - Skipped exercises and skipped sets
 * - Warmup sets
 * - Drop sets
 * - Loose-form sets
 * - Incomplete sets (isCompleted !== true)
 * - Zero or invalid performed reps
 * - Invalid load / assistance
 * - Invalid RPE (when neither explicit nor valid snapshot imputation is available)
 */
export function extractUsableCompletedPerformance(
  exposure: ComparableGuidedExposure,
  setDetail: ComparableGuidedSetDetail
): FactualReferenceProvenance | null {
  const { setEntry, snapshot } = setDetail;
  if (!setEntry) {
    return null;
  }

  // 1. Skipped checks
  if (exposure.classification?.reason === 'EXERCISE_SKIPPED') {
    return null;
  }
  if ((exposure as unknown as { isSkipped?: boolean }).isSkipped === true) {
    return null;
  }
  if (setEntry.isSkipped === true) {
    return null;
  }
  if (setDetail.setResult?.reason === 'SKIPPED_SET') {
    return null;
  }

  // 2. Completion check - must be explicitly completed
  if (setEntry.isCompleted !== true) {
    return null;
  }

  // 3. Set-type exclusions
  if (setEntry.isWarmup === true) {
    return null;
  }
  if (setEntry.isDropSet === true || (Array.isArray(setEntry.dropSubSets) && setEntry.dropSubSets.length > 0)) {
    return null;
  }
  if (setEntry.form === 'loose') {
    return null;
  }

  // 4. Performed repetitions check
  if (
    typeof setEntry.reps !== 'number' ||
    !Number.isFinite(setEntry.reps) ||
    !Number.isInteger(setEntry.reps) ||
    setEntry.reps <= 0
  ) {
    return null;
  }

  // 5. Modality resolution
  const modality: ExerciseModality = snapshot?.modality ?? exposure.modality;
  if (modality !== 'weighted' && modality !== 'bodyweight' && modality !== 'assisted') {
    return null;
  }

  // 6. Actual load resolution using historical workout context
  const historicalBodyweight =
    snapshot?.bodyweightSnapshot ??
    (exposure as unknown as { bodyweightSnapshot?: BodyweightSnapshotInput }).bodyweightSnapshot ??
    null;
  const recordedUnit = snapshot?.weightUnit ?? exposure.weightUnit ?? 'kg';

  const loadResult = resolveGuidedComparisonLoad({
    modality,
    weight: setEntry.weight,
    bodyweight: historicalBodyweight,
    unit: recordedUnit,
  });
  if (!loadResult.eligible || !loadResult.comparisonLoadKg || loadResult.comparisonLoadKg <= 0) {
    return null;
  }
  const comparisonLoadKg = loadResult.comparisonLoadKg;

  // 7. RPE resolution and approved imputation
  let effectiveRpe: number;
  let rpeSource: 'explicit' | 'presented_target_imputation';

  if (typeof setEntry.rpe === 'number' && isValidRPE(setEntry.rpe)) {
    effectiveRpe = setEntry.rpe;
    rpeSource = 'explicit';
  } else if (setEntry.rpe === null || setEntry.rpe === undefined || setEntry.rpe === 0) {
    if (snapshot && typeof snapshot.presentedRpe === 'number' && isValidRPE(snapshot.presentedRpe)) {
      effectiveRpe = snapshot.presentedRpe;
      rpeSource = 'presented_target_imputation';
    } else {
      return null;
    }
  } else {
    return null;
  }

  // 8. Capacity index calculation
  const capacityIndex = calculateRequiredCapacityIndex(comparisonLoadKg, setEntry.reps, effectiveRpe);
  if (capacityIndex === null || capacityIndex <= 0) {
    return null;
  }

  return {
    workoutLogId: exposure.workoutLogId,
    workoutDate: exposure.workoutDate,
    workoutTimestampMs: exposure.workoutTimestampMs ?? null,
    workingSetOrdinal: setDetail.workingSetOrdinal,
    performedWeight: setEntry.weight,
    performedReps: setEntry.reps,
    effectiveRpe,
    rpeSource,
    modality,
    historicalBodyweight,
    recordedUnit,
    comparisonLoadKg,
    capacityIndex,
  };
}

/**
 * Searches supplied permitted history for the most recent usable completed performance
 * for a specific working-set ordinal.
 *
 * Traverses history chronologically descending (newest to oldest).
 */
export function findMostRecentCompletedPerformanceForOrdinal(
  history: readonly ComparableGuidedExposure[],
  workingSetOrdinal: number
): FactualReferenceProvenance | null {
  if (!history || history.length === 0) {
    return null;
  }

  // Sort chronologically descending: newest first
  const sorted = [...history].sort((a, b) => {
    if (a.workoutDate !== b.workoutDate) {
      return b.workoutDate.localeCompare(a.workoutDate);
    }
    return (b.workoutTimestampMs ?? 0) - (a.workoutTimestampMs ?? 0);
  });

  for (const exposure of sorted) {
    if (!exposure.sets || exposure.sets.length === 0) {
      continue;
    }
    const matchingSet = exposure.sets.find(
      s => s.workingSetOrdinal === workingSetOrdinal
    );
    if (!matchingSet) {
      continue;
    }

    const usable = extractUsableCompletedPerformance(exposure, matchingSet);
    if (usable !== null) {
      return usable;
    }
  }

  return null;
}

/**
 * Evaluates candidate targets against factual historical completed performance.
 *
 * Implements pure mathematical capacity comparison without:
 * - Selecting target progressions or snapshot generation.
 * - Mutating input objects or relying on ambient state.
 * - Imposing universal vetoes that extinguish the pure-repetition exemption.
 */
export function evaluateGuidedCandidateComparison(
  input: EvaluateGuidedCandidateComparisonInput
): EvaluateGuidedCandidateComparisonResult {
  const { candidateTargets, history, laneMetadata } = input;
  const diagnostics: CandidateComparisonDiagnostic[] = [];

  // 1. Validate candidate targets structure
  if (!candidateTargets || candidateTargets.length === 0) {
    diagnostics.push({
      code: 'EMPTY_CANDIDATE_TARGETS',
      message: 'No candidate targets provided for evaluation.',
    });
    return {
      status: 'invalid_input',
      allComparisonsValid: false,
      rawAggregatePassed: false,
      hasExemptionEligibleOrdinals: false,
      ordinalResults: [],
      diagnostics,
    };
  }

  const seenOrdinals = new Set<number>();
  for (const cand of candidateTargets) {
    if (
      typeof cand.workingSetOrdinal !== 'number' ||
      !Number.isInteger(cand.workingSetOrdinal) ||
      cand.workingSetOrdinal < 1
    ) {
      diagnostics.push({
        ordinal: cand.workingSetOrdinal,
        code: 'INVALID_CANDIDATE_ORDINAL',
        message: `Candidate ordinal ${cand.workingSetOrdinal} is not a valid positive integer.`,
      });
      return {
        status: 'invalid_input',
        allComparisonsValid: false,
        rawAggregatePassed: false,
        hasExemptionEligibleOrdinals: false,
        ordinalResults: [],
        diagnostics,
      };
    }

    if (seenOrdinals.has(cand.workingSetOrdinal)) {
      diagnostics.push({
        ordinal: cand.workingSetOrdinal,
        code: 'DUPLICATE_CANDIDATE_ORDINAL',
        message: `Candidate ordinal ${cand.workingSetOrdinal} is duplicated in target list.`,
      });
      return {
        status: 'invalid_input',
        allComparisonsValid: false,
        rawAggregatePassed: false,
        hasExemptionEligibleOrdinals: false,
        ordinalResults: [],
        diagnostics,
      };
    }
    seenOrdinals.add(cand.workingSetOrdinal);
  }

  // Sort candidate targets by ordinal ascending
  const sortedCandidates = [...candidateTargets].sort(
    (a, b) => a.workingSetOrdinal - b.workingSetOrdinal
  );

  const ordinalResults: OrdinalComparisonResult[] = [];
  let hasInvalidCandidate = false;
  let hasUnavailableReference = false;
  let hasCapFailure = false;
  let hasExemptionEligible = false;

  // 2. Evaluate each ordinal independently
  for (const cand of sortedCandidates) {
    const ordinal = cand.workingSetOrdinal;

    // Validate candidate reps
    if (
      typeof cand.reps !== 'number' ||
      !Number.isFinite(cand.reps) ||
      !Number.isInteger(cand.reps) ||
      cand.reps < 1
    ) {
      hasInvalidCandidate = true;
      diagnostics.push({
        ordinal,
        code: 'INVALID_CANDIDATE_REPS',
        message: `Candidate target ordinal ${ordinal} has invalid repetition target: ${cand.reps}`,
      });
      ordinalResults.push({
        workingSetOrdinal: ordinal,
        status: 'invalid_candidate',
        referenceProvenance: null,
        referenceComparisonLoadKg: null,
        referenceCapacityIndex: null,
        candidateComparisonLoadKg: null,
        candidateCapacityIndex: null,
        relativeChallenge: null,
        isWithinRawCap: false,
        candidateLoadEqualsReference: false,
        isPureRepetitionIncrement: false,
        pureRepetitionExemptionEligible: false,
        diagnosticCode: 'INVALID_CANDIDATE_REPS',
        diagnosticMessage: `Invalid candidate reps: ${cand.reps}`,
      });
      continue;
    }

    // Validate candidate RPE
    if (!isValidRPE(cand.rpe)) {
      hasInvalidCandidate = true;
      diagnostics.push({
        ordinal,
        code: 'INVALID_CANDIDATE_RPE',
        message: `Candidate target ordinal ${ordinal} has invalid RPE target: ${cand.rpe}`,
      });
      ordinalResults.push({
        workingSetOrdinal: ordinal,
        status: 'invalid_candidate',
        referenceProvenance: null,
        referenceComparisonLoadKg: null,
        referenceCapacityIndex: null,
        candidateComparisonLoadKg: null,
        candidateCapacityIndex: null,
        relativeChallenge: null,
        isWithinRawCap: false,
        candidateLoadEqualsReference: false,
        isPureRepetitionIncrement: false,
        pureRepetitionExemptionEligible: false,
        diagnosticCode: 'INVALID_CANDIDATE_RPE',
        diagnosticMessage: `Invalid candidate RPE: ${cand.rpe}`,
      });
      continue;
    }

    // Resolve candidate comparison load
    const candidateModality = cand.modality ?? laneMetadata?.modality ?? 'weighted';
    let candidateComparisonLoadKg: number | null = null;

    if (
      typeof cand.comparisonLoadKg === 'number' &&
      Number.isFinite(cand.comparisonLoadKg) &&
      cand.comparisonLoadKg > 0
    ) {
      candidateComparisonLoadKg = cand.comparisonLoadKg;
    } else {
      const candidateBw = cand.bodyweight ?? laneMetadata?.currentBodyweight;
      const candidateUnit = cand.unit ?? laneMetadata?.unit ?? 'kg';

      const loadRes = resolveGuidedComparisonLoad({
        modality: candidateModality,
        weight: cand.weight,
        bodyweight: candidateBw,
        unit: candidateUnit,
      });

      if (loadRes.eligible) {
        candidateComparisonLoadKg = loadRes.comparisonLoadKg;
      } else {
        const failureReason = loadRes.reason;
        hasInvalidCandidate = true;
        diagnostics.push({
          ordinal,
          code: 'INVALID_CANDIDATE_LOAD',
          message: `Candidate target ordinal ${ordinal} load resolution failed: ${failureReason}`,
        });
        ordinalResults.push({
          workingSetOrdinal: ordinal,
          status: 'invalid_candidate',
          referenceProvenance: null,
          referenceComparisonLoadKg: null,
          referenceCapacityIndex: null,
          candidateComparisonLoadKg: null,
          candidateCapacityIndex: null,
          relativeChallenge: null,
          isWithinRawCap: false,
          candidateLoadEqualsReference: false,
          isPureRepetitionIncrement: false,
          pureRepetitionExemptionEligible: false,
          diagnosticCode: 'INVALID_CANDIDATE_LOAD',
          diagnosticMessage: `Candidate load resolution failed: ${failureReason}`,
        });
        continue;
      }
    }

    // Calculate candidate capacity index
    const candidateCapacityIndex = calculateRequiredCapacityIndex(
      candidateComparisonLoadKg,
      cand.reps,
      cand.rpe
    );

    if (candidateCapacityIndex === null || candidateCapacityIndex <= 0) {
      hasInvalidCandidate = true;
      diagnostics.push({
        ordinal,
        code: 'INVALID_CANDIDATE_CAPACITY',
        message: `Candidate target ordinal ${ordinal} capacity calculation failed.`,
      });
      ordinalResults.push({
        workingSetOrdinal: ordinal,
        status: 'invalid_candidate',
        referenceProvenance: null,
        referenceComparisonLoadKg: null,
        referenceCapacityIndex: null,
        candidateComparisonLoadKg,
        candidateCapacityIndex: null,
        relativeChallenge: null,
        isWithinRawCap: false,
        candidateLoadEqualsReference: false,
        isPureRepetitionIncrement: false,
        pureRepetitionExemptionEligible: false,
        diagnosticCode: 'INVALID_CANDIDATE_CAPACITY',
        diagnosticMessage: 'Failed to compute candidate capacity index.',
      });
      continue;
    }

    // 3. Locate factual reference in history for this ordinal
    const factualRef = findMostRecentCompletedPerformanceForOrdinal(history, ordinal);

    if (!factualRef) {
      hasUnavailableReference = true;
      diagnostics.push({
        ordinal,
        code: 'NO_FACTUAL_REFERENCE_FOUND',
        message: `No usable completed performance found in history for ordinal ${ordinal}.`,
      });
      ordinalResults.push({
        workingSetOrdinal: ordinal,
        status: 'unavailable',
        referenceProvenance: null,
        referenceComparisonLoadKg: null,
        referenceCapacityIndex: null,
        candidateComparisonLoadKg,
        candidateCapacityIndex,
        relativeChallenge: null,
        isWithinRawCap: false,
        candidateLoadEqualsReference: false,
        isPureRepetitionIncrement: false,
        pureRepetitionExemptionEligible: false,
        diagnosticCode: 'NO_FACTUAL_REFERENCE_FOUND',
        diagnosticMessage: `No usable completed performance found for ordinal ${ordinal}.`,
      });
      continue;
    }

    // Modality compatibility check
    if (factualRef.modality !== candidateModality) {
      hasUnavailableReference = true;
      diagnostics.push({
        ordinal,
        code: 'MODALITY_MISMATCH',
        message: `Factual reference modality (${factualRef.modality}) does not match candidate modality (${candidateModality}) for ordinal ${ordinal}.`,
      });
      ordinalResults.push({
        workingSetOrdinal: ordinal,
        status: 'unavailable',
        referenceProvenance: factualRef,
        referenceComparisonLoadKg: factualRef.comparisonLoadKg,
        referenceCapacityIndex: factualRef.capacityIndex,
        candidateComparisonLoadKg,
        candidateCapacityIndex,
        relativeChallenge: null,
        isWithinRawCap: false,
        candidateLoadEqualsReference: false,
        isPureRepetitionIncrement: false,
        pureRepetitionExemptionEligible: false,
        diagnosticCode: 'MODALITY_MISMATCH',
        diagnosticMessage: `Modality mismatch: ${factualRef.modality} vs ${candidateModality}`,
      });
      continue;
    }

    // 4. Calculate relative challenge
    const relativeChallenge = calculateRelativeChallenge(
      candidateCapacityIndex,
      factualRef.capacityIndex
    );

    if (relativeChallenge === null) {
      hasUnavailableReference = true;
      diagnostics.push({
        ordinal,
        code: 'CHALLENGE_CALCULATION_FAILED',
        message: `Relative challenge calculation failed for ordinal ${ordinal}.`,
      });
      ordinalResults.push({
        workingSetOrdinal: ordinal,
        status: 'unavailable',
        referenceProvenance: factualRef,
        referenceComparisonLoadKg: factualRef.comparisonLoadKg,
        referenceCapacityIndex: factualRef.capacityIndex,
        candidateComparisonLoadKg,
        candidateCapacityIndex,
        relativeChallenge: null,
        isWithinRawCap: false,
        candidateLoadEqualsReference: false,
        isPureRepetitionIncrement: false,
        pureRepetitionExemptionEligible: false,
        diagnosticCode: 'CHALLENGE_CALCULATION_FAILED',
        diagnosticMessage: 'Challenge calculation failed.',
      });
      continue;
    }

    const isWithinRawCap = isWithinResistanceChangeCap(
      relativeChallenge,
      GUIDED_RESISTANCE_CHANGE_CAP
    );

    // Evaluate pure repetition increment conditions
    const loadDiff = Math.abs(candidateComparisonLoadKg - factualRef.comparisonLoadKg);
    const candidateLoadEqualsReference = loadDiff <= COMPARISON_LOAD_EQUALITY_EPSILON;
    const isPureRepetitionIncrement =
      candidateLoadEqualsReference &&
      cand.reps === factualRef.performedReps + 1 &&
      cand.rpe === factualRef.effectiveRpe;

    // Pure-repetition exemption applicability (selector will enforce session-level qualifications)
    const pureRepetitionExemptionEligible = isPureRepetitionIncrement;
    if (pureRepetitionExemptionEligible) {
      hasExemptionEligible = true;
    }

    const status: OrdinalComparisonStatus = isWithinRawCap ? 'pass' : 'fail';
    if (!isWithinRawCap) {
      hasCapFailure = true;
    }

    ordinalResults.push({
      workingSetOrdinal: ordinal,
      status,
      referenceProvenance: factualRef,
      referenceComparisonLoadKg: factualRef.comparisonLoadKg,
      referenceCapacityIndex: factualRef.capacityIndex,
      candidateComparisonLoadKg,
      candidateCapacityIndex,
      relativeChallenge,
      isWithinRawCap,
      candidateLoadEqualsReference,
      isPureRepetitionIncrement,
      pureRepetitionExemptionEligible,
    });
  }

  // 5. Determine overall evaluation status
  let overallStatus: CandidateComparisonStatus;
  if (hasInvalidCandidate) {
    overallStatus = 'invalid_input';
  } else if (hasUnavailableReference) {
    overallStatus = 'unavailable';
  } else if (hasCapFailure) {
    overallStatus = 'fail';
  } else {
    overallStatus = 'pass';
  }

  const allComparisonsValid = !hasInvalidCandidate && !hasUnavailableReference;
  const rawAggregatePassed = allComparisonsValid && !hasCapFailure;

  return {
    status: overallStatus,
    allComparisonsValid,
    rawAggregatePassed,
    hasExemptionEligibleOrdinals: hasExemptionEligible,
    ordinalResults,
    diagnostics,
  };
}
