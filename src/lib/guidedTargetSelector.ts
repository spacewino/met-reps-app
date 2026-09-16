/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ClosedPeriodisationLaneContext,
  ExerciseEntry,
  ExerciseModality,
  ExerciseProgressionRole,
  GuidedCoachingReasonCode,
  GuidedRollbackTarget,
  PrescriptionSnapshot,
  Program,
  ProgressionLoadBasis,
  ProgressionNudgeType,
  TargetProgressionMode,
  WeightUnit,
  WorkoutLog,
} from '../types';
import {
  CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
  CURRENT_PROGRESSION_POLICY_VERSION,
  CURRENT_ALGORITHM_VERSION,
  resolveProgramProgressionMode,
  isValidRollbackTarget,
  isValidSnapshotStepMetadata,
  isValidCoachingReasonMetadata,
} from './programProgressionMode';
import { isValidRPE, getRTSMultiplier } from './rpeMath';
import {
  resolveGuidedComparisonLoad,
  resolveGuidedBodyweightKg,
} from './adaptiveProgressionMath';
import {
  collectComparableGuidedHistory,
  collectGuidedAdherenceHistory,
  isValidTargetSnapshot,
  GuidedHistoryBoundary,
} from './guidedHistoryCollector';
import {
  reduceGuidedAdherenceState,
} from './guidedAdherenceTracker';
import {
  replayGuidedLaneState,
  extractRollbackPrescription,
  reconstructIndependentBasePrescriptionSet,
  arePrescriptionsEqual,
  arePrescriptionSetsEqual,
  GuidedReplayPrescriptionSet,
} from './guidedLaneReplay';
import {
  evaluateGuidedCandidateComparison,
  CandidateSetTarget,
  EvaluateGuidedCandidateComparisonResult,
  OrdinalComparisonResult,
  COMPARISON_LOAD_EQUALITY_EPSILON,
} from './guidedCandidateComparison';
import { convertWeightUnit } from './assistedLoadMath';
import { SessionAnchor, distributeMultiSetTargets, GeneratedWorkingSetTarget } from './setDistribution';
import { getPermittedRepetitionBounds } from './objectiveMath';
import { projectAssistedTarget, solveBodyweightRepTarget } from './modalityTargetMath';
import { roundToNearest25, getTargetLoadRoundingIncrement } from './weightMath';

export const COMPARISON_LOAD_EPSILON = COMPARISON_LOAD_EQUALITY_EPSILON;

export interface ValidateDistributedTargetsResult {
  readonly valid: boolean;
  readonly error?: string;
  readonly targets?: readonly GeneratedWorkingSetTarget[];
}

/**
 * Production distribution-output validator.
 * Validates array structure, exact count, unique contiguous ordinals 1..N,
 * positive finite weights, valid reps, and valid RPEs.
 */
export function validateDistributedTargets(
  targets: unknown,
  expectedSetCount: number,
  baseSets?: readonly BasePrescriptionSet[]
): ValidateDistributedTargetsResult {
  if (!Array.isArray(targets)) {
    return { valid: false, error: 'Targets must be an array.' };
  }
  if (targets.length !== expectedSetCount) {
    return {
      valid: false,
      error: `Target count ${targets.length} does not match expected set count ${expectedSetCount}.`,
    };
  }

  const seenOrdinals = new Set<number>();
  const validatedTargets: GeneratedWorkingSetTarget[] = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t || typeof t !== 'object') {
      return { valid: false, error: `Target at index ${i} is not a valid object.` };
    }

    const { workingSetOrdinal, weight, reps, rpe } = t as Partial<GeneratedWorkingSetTarget>;

    if (
      typeof workingSetOrdinal !== 'number' ||
      !Number.isInteger(workingSetOrdinal) ||
      workingSetOrdinal < 1 ||
      workingSetOrdinal > expectedSetCount
    ) {
      return {
        valid: false,
        error: `Target at index ${i} has invalid ordinal: ${workingSetOrdinal}`,
      };
    }

    const expectedOrdinal = i + 1;
    if (workingSetOrdinal !== expectedOrdinal) {
      return {
        valid: false,
        error: `Target at index ${i} ordinal ${workingSetOrdinal} is not contiguous (expected ${expectedOrdinal}).`,
      };
    }

    if (seenOrdinals.has(workingSetOrdinal)) {
      return {
        valid: false,
        error: `Duplicate ordinal ${workingSetOrdinal} in distribution targets.`,
      };
    }
    seenOrdinals.add(workingSetOrdinal);

    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
      return {
        valid: false,
        error: `Target ordinal ${workingSetOrdinal} has non-positive or non-finite weight: ${weight}`,
      };
    }

    if (typeof reps !== 'number' || !Number.isInteger(reps) || reps < 1) {
      return {
        valid: false,
        error: `Target ordinal ${workingSetOrdinal} has invalid reps: ${reps}`,
      };
    }

    if (typeof rpe !== 'number' || !isValidRPE(rpe)) {
      return {
        valid: false,
        error: `Target ordinal ${workingSetOrdinal} has invalid RPE: ${rpe}`,
      };
    }

    if (baseSets && baseSets[i] && baseSets[i].workingSetOrdinal !== workingSetOrdinal) {
      return {
        valid: false,
        error: `Target ordinal ${workingSetOrdinal} does not map to base ordinal ${baseSets[i].workingSetOrdinal}.`,
      };
    }

    validatedTargets.push({
      workingSetOrdinal,
      weight,
      reps,
      rpe,
    });
  }

  if (seenOrdinals.size !== expectedSetCount) {
    return {
      valid: false,
      error: `Missing ordinals: expected ${expectedSetCount}, found ${seenOrdinals.size}.`,
    };
  }

  return { valid: true, targets: validatedTargets };
}

export interface IdentifyResistanceChangedOrdinalsInput {
  readonly modality: ExerciseModality;
  readonly unit: WeightUnit;
  readonly bodyweight: number | null;
  readonly basePrescriptionSets: readonly BasePrescriptionSet[];
  readonly candidatePrescription: readonly BasePrescriptionSet[];
}

export type IdentifyResistanceChangedOrdinalsResult =
  | { readonly success: true; readonly changedOrdinals: readonly number[] }
  | { readonly success: false; readonly error: string };

/**
 * Identifies ordinals whose physical resistance has changed between base and candidate sets.
 *
 * Semantics:
 * - Matches candidate and base sets by workingSetOrdinal.
 * - Resolves each ordinal's base and candidate physical comparison load using canonical
 *   resolveGuidedComparisonLoad authority with the given modality, unit, and bodyweight.
 * - Fails closed if comparison load resolution fails or is ineligible (structural candidate invalidity).
 * - Compares canonically normalized physical comparison loads (in kg) using the exported
 *   canonical COMPARISON_LOAD_EQUALITY_EPSILON.
 * - Math.abs operates strictly on canonically normalized comparison loads (kg), not raw displayed values;
 *   this is NOT a selector-local tolerance.
 * - Reps or RPE differences are ignored for resistance-change detection.
 * - Returns every and only ordinal whose resolved physical resistance changed.
 */
export function identifyResistanceChangedOrdinals(
  input: IdentifyResistanceChangedOrdinalsInput
): IdentifyResistanceChangedOrdinalsResult {
  const { modality, unit, bodyweight, basePrescriptionSets, candidatePrescription } = input;

  if (basePrescriptionSets.length !== candidatePrescription.length) {
    return {
      success: false,
      error: `Base set count (${basePrescriptionSets.length}) does not match candidate set count (${candidatePrescription.length}).`,
    };
  }

  const changedOrdinals: number[] = [];

  for (let i = 0; i < basePrescriptionSets.length; i++) {
    const base = basePrescriptionSets[i];
    const cand = candidatePrescription[i];

    if (base.workingSetOrdinal !== cand.workingSetOrdinal) {
      return {
        success: false,
        error: `Ordinal mismatch at index ${i}: base ${base.workingSetOrdinal} vs candidate ${cand.workingSetOrdinal}.`,
      };
    }

    const baseComp = resolveGuidedComparisonLoad({
      modality,
      weight: base.weight,
      bodyweight,
      unit,
    });
    if (!baseComp.eligible || baseComp.comparisonLoadKg === null || !Number.isFinite(baseComp.comparisonLoadKg)) {
      return {
        success: false,
        error: `Failed to resolve base comparison load for ordinal ${base.workingSetOrdinal}.`,
      };
    }

    const candComp = resolveGuidedComparisonLoad({
      modality,
      weight: cand.weight,
      bodyweight,
      unit,
    });
    if (!candComp.eligible || candComp.comparisonLoadKg === null || !Number.isFinite(candComp.comparisonLoadKg)) {
      return {
        success: false,
        error: `Failed to resolve candidate comparison load for ordinal ${cand.workingSetOrdinal}.`,
      };
    }

    // Compare canonical normalized comparison loads in kg using canonical epsilon.
    // Operating strictly on canonically normalized kg comparison loads ensures:
    // 1) Physically equivalent kg/lb values evaluate as equal resistance.
    // 2) Identical raw displayed numbers in different units evaluate as different resistance.
    // 3) Epsilon tolerance operates exclusively on normalized comparison load space.
    const loadDiff = Math.abs(candComp.comparisonLoadKg - baseComp.comparisonLoadKg);
    if (loadDiff > COMPARISON_LOAD_EQUALITY_EPSILON) {
      changedOrdinals.push(base.workingSetOrdinal);
    }
  }

  return {
    success: true,
    changedOrdinals,
  };
}

export interface DistributionDispatchContext {
  readonly basePrescriptionSets: readonly BasePrescriptionSet[];
  readonly confirmedStepIndex: number;
  readonly activeUnit: WeightUnit;
  readonly modality: ExerciseModality;
  readonly bodyweightSnapshot: number | null;
  readonly exerciseKey: string;
  readonly exerciseRole: ExerciseProgressionRole;
  readonly algorithmId: string;
  readonly comparableLaneKey: string;
  readonly loadBasis: ProgressionLoadBasis;
  readonly loadIncrement: number;
}

export function buildDistributionBypassGuidedResult(
  bypassReason: string,
  context: DistributionDispatchContext
): SelectGuidedPrescriptionGuidedResult {
  const presentedStepIndex = context.confirmedStepIndex;
  const snapshots: PrescriptionSnapshot[] = context.basePrescriptionSets.map(p => {
    const compLoad = resolveGuidedComparisonLoad({
      modality: context.modality,
      weight: p.weight,
      bodyweight: context.bodyweightSnapshot,
      unit: context.activeUnit,
    });
    return {
      snapshotVersion: 2,
      progressionPolicyVersion: 1,
      algorithmVersion: 1,
      progressionMode: 'metreps_guided',
      algorithmId: context.algorithmId,
      exerciseKey: context.exerciseKey,
      exerciseRole: context.exerciseRole,
      modality: context.modality,
      comparableLaneKey: context.comparableLaneKey,
      workingSetOrdinal: p.workingSetOrdinal,
      prescribedWorkingSetCount: context.basePrescriptionSets.length,
      baseWeight: p.weight,
      baseReps: p.reps,
      baseRpe: p.rpe,
      presentedWeight: p.weight,
      presentedReps: p.reps,
      presentedRpe: p.rpe,
      bodyweightSnapshot: context.bodyweightSnapshot,
      weightUnit: context.activeUnit,
      comparisonLoadKg: compLoad.eligible ? compLoad.comparisonLoadKg : null,
      loadBasis: context.loadBasis,
      loadIncrement: context.loadIncrement,
      nudgeType: 'none',
      coachingReasonCode: 'BASE_PRESCRIPTION',
      confirmedStepIndexBefore: context.confirmedStepIndex,
      presentedStepIndex,
      successCreditEligible: true,
      rollbackTarget: null,
    };
  });

  return {
    status: 'guided',
    coachingReasonCode: 'BASE_PRESCRIPTION',
    presentedPrescription: context.basePrescriptionSets.map(p => ({ ...p })),
    snapshots,
    diagnostics: {
      comparableLaneKey: context.comparableLaneKey,
      narrowHistoryStatus: 'success',
      broadHistoryStatus: 'success',
      adherenceGateOpen: true,
      gateReady: true,
      successCredit: 0,
      laneReplayTrustStatus: 'trusted',
      laneReplayNextAction: 'advance',
      candidateComparisonInvoked: false,
      candidateComparisonStatus: null,
      evaluatedOrdinals: [],
      activeNudgeOrdinal: null,
      challengeCapExempt: false,
      candidateAdvancementProhibited: true,
      distributionBypassReason: bypassReason,
      details: `Distribution bypassed: ${bypassReason}`,
    },
  };
}

export function buildDistributionMalformedGuidedResult(
  error: string,
  context: DistributionDispatchContext
): SelectGuidedPrescriptionGuidedResult {
  const presentedStepIndex = context.confirmedStepIndex;
  const snapshots: PrescriptionSnapshot[] = context.basePrescriptionSets.map(p => {
    const compLoad = resolveGuidedComparisonLoad({
      modality: context.modality,
      weight: p.weight,
      bodyweight: context.bodyweightSnapshot,
      unit: context.activeUnit,
    });
    return {
      snapshotVersion: 2,
      progressionPolicyVersion: 1,
      algorithmVersion: 1,
      progressionMode: 'metreps_guided',
      algorithmId: context.algorithmId,
      exerciseKey: context.exerciseKey,
      exerciseRole: context.exerciseRole,
      modality: context.modality,
      comparableLaneKey: context.comparableLaneKey,
      workingSetOrdinal: p.workingSetOrdinal,
      prescribedWorkingSetCount: context.basePrescriptionSets.length,
      baseWeight: p.weight,
      baseReps: p.reps,
      baseRpe: p.rpe,
      presentedWeight: p.weight,
      presentedReps: p.reps,
      presentedRpe: p.rpe,
      bodyweightSnapshot: context.bodyweightSnapshot,
      weightUnit: context.activeUnit,
      comparisonLoadKg: compLoad.eligible ? compLoad.comparisonLoadKg : null,
      loadBasis: context.loadBasis,
      loadIncrement: context.loadIncrement,
      nudgeType: 'none',
      coachingReasonCode: 'INCONSISTENT_HISTORY_HOLD',
      confirmedStepIndexBefore: context.confirmedStepIndex,
      presentedStepIndex,
      successCreditEligible: false,
      rollbackTarget: null,
    };
  });

  return {
    status: 'guided',
    coachingReasonCode: 'INCONSISTENT_HISTORY_HOLD',
    presentedPrescription: context.basePrescriptionSets.map(p => ({ ...p })),
    snapshots,
    diagnostics: {
      comparableLaneKey: context.comparableLaneKey,
      narrowHistoryStatus: 'success',
      broadHistoryStatus: 'success',
      adherenceGateOpen: true,
      gateReady: true,
      successCredit: 0,
      laneReplayTrustStatus: 'trusted',
      laneReplayNextAction: 'advance',
      candidateComparisonInvoked: false,
      candidateComparisonStatus: null,
      evaluatedOrdinals: [],
      activeNudgeOrdinal: null,
      challengeCapExempt: false,
      candidateAdvancementProhibited: true,
      distributionValidationDiagnostic: error,
      details: `Distribution validation failed: ${error}`,
    },
  };
}

export interface EvaluateGuidedCandidateAcceptanceInput {
  readonly comparisonResult: EvaluateGuidedCandidateComparisonResult;
  readonly expectedAffectedOrdinals: readonly number[];
  readonly canExemptOrdinal?: (ordRes: OrdinalComparisonResult, ordinal: number) => boolean;
}

export interface GuidedCandidateAcceptanceResult {
  readonly success: boolean;
  readonly missingFactualOrdinal: number | null;
  readonly structurallyInvalid: boolean;
  readonly anyExempt: boolean;
}

/**
 * Pure evaluator determining candidate proposal acceptance based on candidate comparison results.
 *
 * Enforces:
 * - Fail-closed: missing factual reference (`status: 'unavailable'`) strictly prohibits candidate advancement.
 * - Records the exact missing affected ordinal.
 * - Distinguishes missing factual evidence from structural corruption (`invalid_input` / malformed shapes).
 */
export function evaluateGuidedCandidateAcceptance(
  input: EvaluateGuidedCandidateAcceptanceInput
): GuidedCandidateAcceptanceResult {
  const { comparisonResult, expectedAffectedOrdinals, canExemptOrdinal } = input;
  if (
    !comparisonResult ||
    typeof comparisonResult !== 'object' ||
    comparisonResult.status === 'invalid_input' ||
    !Array.isArray(comparisonResult.ordinalResults) ||
    (expectedAffectedOrdinals.length > 0 && comparisonResult.ordinalResults.length === 0)
  ) {
    return {
      success: false,
      missingFactualOrdinal: null,
      structurallyInvalid: true,
      anyExempt: false,
    };
  }

  const expectedOrdinals = new Set(expectedAffectedOrdinals);
  const seenOrdinals = new Set<number>();

  let failed = false;
  let exempt = false;
  let missingOrdinal: number | null = null;
  let structurallyInvalid = false;

  for (const ordRes of comparisonResult.ordinalResults) {
    if (!ordRes || typeof ordRes !== 'object' || typeof ordRes.workingSetOrdinal !== 'number') {
      structurallyInvalid = true;
      break;
    }

    const ord = ordRes.workingSetOrdinal;
    if (!expectedOrdinals.has(ord) || seenOrdinals.has(ord)) {
      structurallyInvalid = true;
      break;
    }
    seenOrdinals.add(ord);

    switch (ordRes.status) {
      case 'pass':
        break;

      case 'unavailable':
        if (missingOrdinal === null) {
          missingOrdinal = ord;
        }
        break;

      case 'fail': {
        const passesExemption = canExemptOrdinal ? canExemptOrdinal(ordRes, ord) : false;
        if (passesExemption) {
          exempt = true;
        } else {
          failed = true;
        }
        break;
      }

      case 'invalid_candidate':
        structurallyInvalid = true;
        break;

      default:
        structurallyInvalid = true;
        break;
    }

    if (structurallyInvalid) {
      break;
    }
  }

  if (!structurallyInvalid && seenOrdinals.size !== expectedOrdinals.size) {
    structurallyInvalid = true;
  }

  if (structurallyInvalid) {
    return {
      success: false,
      missingFactualOrdinal: null,
      structurallyInvalid: true,
      anyExempt: false,
    };
  }

  const success = !failed && missingOrdinal === null;
  return {
    success,
    missingFactualOrdinal: missingOrdinal,
    structurallyInvalid: false,
    anyExempt: exempt,
  };
}

export interface BasePrescriptionSet {
  readonly workingSetOrdinal: number;
  readonly weight: number;
  readonly reps: number;
  readonly rpe: number;
}

export type GuidedSessionKind =
  | {
      readonly type: 'active_program_session';
      readonly scheduledDate?: string;
      readonly weekNum: number;
    }
  | { readonly type: 'one_off' }
  | { readonly type: 'redo'; readonly originalWorkoutLogId: string }
  | { readonly type: 'deload' }
  | { readonly type: 'off_day' };

export type { ClosedPeriodisationLaneContext };

export interface SharedGuidedSelectorContext {
  readonly exercise: ExerciseEntry;
  readonly program: Program;
  readonly programs: readonly Program[];
  readonly historicalLogs: readonly WorkoutLog[];
  readonly boundary: GuidedHistoryBoundary;
  readonly sessionKind: GuidedSessionKind;
  readonly basePrescriptionSets: readonly BasePrescriptionSet[];
  readonly activeUnit: WeightUnit;
  readonly canonicalIncrement: number;
  readonly periodisationLane: ClosedPeriodisationLaneContext;
}

export interface WeightedConstructionContext {
  readonly kind: 'weighted';
  readonly sessionAnchor?: SessionAnchor | null;
  readonly bodyweightSnapshot?: number | null;
}

export interface AssistedConstructionContext {
  readonly kind: 'assisted';
  readonly sessionBodyweight?: number | null;
}

export interface BodyweightConstructionContext {
  readonly kind: 'bodyweight';
  readonly sessionBodyweight?: number | null;
}

export interface UnsupportedModalityConstructionContext {
  readonly kind: 'unsupported';
}

export type GuidedConstructionContext =
  | WeightedConstructionContext
  | AssistedConstructionContext
  | BodyweightConstructionContext
  | UnsupportedModalityConstructionContext;

export type SelectGuidedPrescriptionInput =
  SharedGuidedSelectorContext & {
    readonly construction: GuidedConstructionContext;
  };

export interface GenerateComparableLaneKeyInput {
  readonly exerciseKey: string;
  readonly modality: ExerciseModality;
  readonly exerciseRole: ExerciseProgressionRole;
  readonly prescribedWorkingSetCount: number;
  readonly periodisationLane: ClosedPeriodisationLaneContext;
}

export type GenerateComparableLaneKeyResult =
  | { readonly status: 'success'; readonly laneKey: string }
  | { readonly status: 'invalid_input'; readonly error: string };

export type GuidedBypassReason =
  | 'NON_GUIDED_PROGRESSION_MODE'
  | 'ONE_OFF_SESSION'
  | 'REDO_SESSION'
  | 'DELOAD_SESSION'
  | 'OFF_DAY_SESSION'
  | 'UNSUPPORTED_MODALITY'
  | 'NON_GUIDED_OBJECTIVE';

export interface SelectGuidedPrescriptionInvalidInputResult {
  readonly status: 'invalid_input';
  readonly error: string;
  readonly errorMessage: string;
  readonly diagnostics?: readonly string[];
}

export interface SelectGuidedPrescriptionBypassResult {
  readonly status: 'bypass';
  readonly bypassReason: GuidedBypassReason;
  readonly presentedPrescription: readonly BasePrescriptionSet[];
  readonly snapshots: readonly [];
}

export interface GuidedSelectorDiagnostics {
  readonly comparableLaneKey: string;
  readonly narrowHistoryStatus: 'success' | 'fatal_error';
  readonly broadHistoryStatus: 'success' | 'fatal_error';
  readonly adherenceGateOpen: boolean;
  readonly gateReady: boolean;
  readonly successCredit: number;
  readonly laneReplayTrustStatus: string;
  readonly laneReplayNextAction: string;
  readonly candidateComparisonInvoked: boolean;
  readonly candidateComparisonStatus: string | null;
  readonly evaluatedOrdinals: readonly number[];
  readonly activeNudgeOrdinal: number | null;
  readonly challengeCapExempt: boolean;
  readonly pendingNudgeReplacedByBase?: boolean;
  readonly missingFactualEvidenceOrdinal?: number;
  readonly candidateAdvancementProhibited?: boolean;
  readonly noHypotheticalOrCompanionSubstituted?: boolean;
  readonly distributionBypassReason?: string;
  readonly distributionValidationDiagnostic?: string;
  readonly details?: string;
}

export interface SelectGuidedPrescriptionGuidedResult {
  readonly status: 'guided';
  readonly presentedPrescription: readonly BasePrescriptionSet[];
  readonly snapshots: readonly PrescriptionSnapshot[];
  readonly coachingReasonCode: GuidedCoachingReasonCode;
  readonly diagnostics: GuidedSelectorDiagnostics;
}

export type SelectGuidedPrescriptionResult =
  | SelectGuidedPrescriptionInvalidInputResult
  | SelectGuidedPrescriptionBypassResult
  | SelectGuidedPrescriptionGuidedResult;

/**
 * Generates the deterministic 11-dimension comparable lane key.
 * Fail-closed: returns status: 'invalid_input' for any out-of-contract parameters.
 */
export function generateComparableLaneKey(
  input: GenerateComparableLaneKeyInput
): GenerateComparableLaneKeyResult {
  if (!input || typeof input !== 'object') {
    return { status: 'invalid_input', error: 'Input must be a valid object.' };
  }

  const { exerciseKey, modality, exerciseRole, prescribedWorkingSetCount, periodisationLane } = input;

  if (typeof exerciseKey !== 'string' || exerciseKey.trim() === '') {
    return { status: 'invalid_input', error: 'exerciseKey must be a non-empty string.' };
  }

  if (modality !== 'weighted' && modality !== 'bodyweight' && modality !== 'assisted') {
    return { status: 'invalid_input', error: `Unsupported modality: ${modality}` };
  }

  if (exerciseRole !== 'main_movement' && exerciseRole !== 'accessory') {
    return { status: 'invalid_input', error: `Invalid exerciseRole: ${exerciseRole}` };
  }

  if (
    typeof prescribedWorkingSetCount !== 'number' ||
    !Number.isInteger(prescribedWorkingSetCount) ||
    prescribedWorkingSetCount < 1 ||
    prescribedWorkingSetCount > 6
  ) {
    return {
      status: 'invalid_input',
      error: `prescribedWorkingSetCount must be an integer between 1 and 6, got ${prescribedWorkingSetCount}`,
    };
  }

  if (!periodisationLane || typeof periodisationLane !== 'object') {
    return { status: 'invalid_input', error: 'periodisationLane must be a valid object.' };
  }

  let familySegment: string;
  switch (periodisationLane.algorithmId) {
    case 'hypertrophy_linear': {
      if (periodisationLane.waveType !== 'volume' && periodisationLane.waveType !== 'heavy') {
        return {
          status: 'invalid_input',
          error: `Invalid waveType for hypertrophy_linear: ${periodisationLane.waveType}`,
        };
      }
      familySegment = `hl:wave-${periodisationLane.waveType}`;
      break;
    }
    case 'hypertrophy_step': {
      const phase = periodisationLane.effectivePhase;
      if (typeof phase !== 'number' || !Number.isInteger(phase) || phase < 1 || phase > 12) {
        return {
          status: 'invalid_input',
          error: `effectivePhase for hypertrophy_step must be an integer between 1 and 12, got ${phase}`,
        };
      }
      familySegment = `hs:phase-${phase}`;
      break;
    }
    case 'strength_undulating': {
      const { anchorReps, anchorRpe } = periodisationLane;
      if (typeof anchorReps !== 'number' || !Number.isInteger(anchorReps) || anchorReps < 1 || anchorReps > 12) {
        return {
          status: 'invalid_input',
          error: `anchorReps for strength_undulating must be an integer between 1 and 12, got ${anchorReps}`,
        };
      }
      if (typeof anchorRpe !== 'number' || !isValidRPE(anchorRpe)) {
        return {
          status: 'invalid_input',
          error: `anchorRpe for strength_undulating must be a valid RPE, got ${anchorRpe}`,
        };
      }
      familySegment = `su:reps-${anchorReps}:rpe-${anchorRpe.toFixed(1)}`;
      break;
    }
    case 'strength_linear': {
      const { linearPhase, maxWeeks } = periodisationLane;
      if (
        typeof linearPhase !== 'number' ||
        !Number.isInteger(linearPhase) ||
        linearPhase < 1 ||
        typeof maxWeeks !== 'number' ||
        !Number.isInteger(maxWeeks) ||
        maxWeeks < 1 ||
        linearPhase > maxWeeks
      ) {
        return {
          status: 'invalid_input',
          error: `Invalid strength_linear context: phase ${linearPhase}, maxWeeks ${maxWeeks}`,
        };
      }
      familySegment = `sl:phase-${linearPhase}:max-${maxWeeks}`;
      break;
    }
    case 'none': {
      if (periodisationLane.familyToken !== 'standard_baseline') {
        return {
          status: 'invalid_input',
          error: `Invalid familyToken for algorithmId none: ${periodisationLane.familyToken}`,
        };
      }
      familySegment = 'none:standard_baseline';
      break;
    }
    default:
      return {
        status: 'invalid_input',
        error: `Unknown algorithmId: ${(periodisationLane as any).algorithmId}`,
      };
  }

  const laneKey = [
    exerciseKey.trim(),
    modality,
    exerciseRole,
    periodisationLane.algorithmId,
    `sets-${prescribedWorkingSetCount}`,
    familySegment,
  ].join(':');

  return { status: 'success', laneKey };
}

/**
 * Pure, deterministic MetReps-Guided Target Selector.
 */
function extractContextBodyweight(
  construction: GuidedConstructionContext,
  rawModality: ExerciseModality
): number | null {
  if (rawModality === 'bodyweight' || rawModality === 'assisted') {
    if (construction.kind === 'bodyweight' || construction.kind === 'assisted') {
      return construction.sessionBodyweight ?? null;
    }
  } else if (rawModality === 'weighted') {
    if (construction.kind === 'weighted') {
      return construction.bodyweightSnapshot ?? null;
    }
  }
  return null;
}

export function selectGuidedPrescription(
  input: SelectGuidedPrescriptionInput
): SelectGuidedPrescriptionResult {
  // 1. Structural Validation
  if (!input || typeof input !== 'object') {
    return {
      status: 'invalid_input',
      error: 'MALFORMED_INPUT',
      errorMessage: 'Selector input must be an object.',
    };
  }

  const {
    exercise,
    program,
    programs,
    historicalLogs,
    boundary,
    sessionKind,
    basePrescriptionSets,
    activeUnit,
    canonicalIncrement,
    periodisationLane,
    construction,
  } = input;

  if (!exercise || typeof exercise !== 'object') {
    return {
      status: 'invalid_input',
      error: 'MISSING_EXERCISE',
      errorMessage: 'exercise entry is required.',
    };
  }

  const exerciseKey = exercise.exerciseKey;
  if (typeof exerciseKey !== 'string' || exerciseKey.trim() === '') {
    return {
      status: 'invalid_input',
      error: 'INVALID_EXERCISE_KEY',
      errorMessage: 'exerciseKey must be a non-empty string.',
    };
  }

  const rawModality = exercise.modality;
  const isSupportedGuidedModality =
    rawModality === 'weighted' || rawModality === 'bodyweight' || rawModality === 'assisted';
  const isRecognizedUnsupportedModality =
    rawModality === 'timed' || rawModality === 'distance' || rawModality === 'distance_loaded';

  if (!isSupportedGuidedModality && !isRecognizedUnsupportedModality) {
    return {
      status: 'invalid_input',
      error: 'UNRECOGNIZED_MODALITY',
      errorMessage: `Exercise modality "${rawModality}" is not recognized.`,
    };
  }

  if (!construction || typeof construction !== 'object') {
    return {
      status: 'invalid_input',
      error: 'MISSING_CONSTRUCTION',
      errorMessage: 'construction context is required.',
    };
  }

  // Modality & Construction congruence
  if (
    (rawModality === 'weighted' && construction.kind !== 'weighted') ||
    (rawModality === 'bodyweight' && construction.kind !== 'bodyweight') ||
    (rawModality === 'assisted' && construction.kind !== 'assisted') ||
    (isRecognizedUnsupportedModality && construction.kind !== 'unsupported')
  ) {
    return {
      status: 'invalid_input',
      error: 'CONSTRUCTION_MODALITY_MISMATCH',
      errorMessage: `Construction kind "${construction.kind}" does not match exercise modality "${rawModality}".`,
    };
  }

  // Canonical increment validation
  if (
    typeof canonicalIncrement !== 'number' ||
    !Number.isFinite(canonicalIncrement) ||
    canonicalIncrement <= 0
  ) {
    return {
      status: 'invalid_input',
      error: 'INVALID_CANONICAL_INCREMENT',
      errorMessage: `canonicalIncrement must be a positive finite number, got ${canonicalIncrement}`,
    };
  }

  // Base sets validation
  if (!Array.isArray(basePrescriptionSets) || basePrescriptionSets.length < 1 || basePrescriptionSets.length > 6) {
    return {
      status: 'invalid_input',
      error: 'INVALID_BASE_SETS',
      errorMessage: `basePrescriptionSets must contain between 1 and 6 sets, got ${basePrescriptionSets?.length}`,
    };
  }

  for (let i = 0; i < basePrescriptionSets.length; i++) {
    const s = basePrescriptionSets[i];
    const expectedOrdinal = i + 1;
    if (!s || typeof s !== 'object') {
      return {
        status: 'invalid_input',
        error: 'INVALID_BASE_SET_ENTRY',
        errorMessage: `Base set at index ${i} is not a valid object.`,
      };
    }
    if (s.workingSetOrdinal !== expectedOrdinal) {
      return {
        status: 'invalid_input',
        error: 'NON_CONTIGUOUS_ORDINALS',
        errorMessage: `Base set ordinal at index ${i} is ${s.workingSetOrdinal}, expected ${expectedOrdinal}`,
      };
    }
    if (typeof s.reps !== 'number' || !Number.isInteger(s.reps) || s.reps <= 0) {
      return {
        status: 'invalid_input',
        error: 'INVALID_BASE_REPS',
        errorMessage: `Base set ordinal ${expectedOrdinal} has invalid reps: ${s.reps}`,
      };
    }
    if (typeof s.rpe !== 'number' || !isValidRPE(s.rpe)) {
      return {
        status: 'invalid_input',
        error: 'INVALID_BASE_RPE',
        errorMessage: `Base set ordinal ${expectedOrdinal} has invalid RPE: ${s.rpe}`,
      };
    }
    if (typeof s.weight !== 'number' || !Number.isFinite(s.weight)) {
      return {
        status: 'invalid_input',
        error: 'INVALID_BASE_WEIGHT',
        errorMessage: `Base set ordinal ${expectedOrdinal} has non-finite weight: ${s.weight}`,
      };
    }
    if (rawModality === 'weighted' && s.weight <= 0) {
      return {
        status: 'invalid_input',
        error: 'INVALID_WEIGHTED_LOAD',
        errorMessage: `Weighted exercise set ordinal ${expectedOrdinal} must have weight > 0, got ${s.weight}`,
      };
    }
    if (rawModality === 'bodyweight' && s.weight !== 0) {
      return {
        status: 'invalid_input',
        error: 'INVALID_BODYWEIGHT_LOAD',
        errorMessage: `Pure bodyweight set ordinal ${expectedOrdinal} must have external weight 0, got ${s.weight}`,
      };
    }
  }

  // Periodisation lane validation
  if (!periodisationLane || typeof periodisationLane !== 'object') {
    return {
      status: 'invalid_input',
      error: 'MISSING_PERIODISATION_LANE',
      errorMessage: 'periodisationLane context is required.',
    };
  }

  if (periodisationLane.algorithmId !== program.algorithmId) {
    return {
      status: 'invalid_input',
      error: 'PERIODISATION_ALGORITHM_MISMATCH',
      errorMessage: `periodisationLane algorithmId "${periodisationLane.algorithmId}" mismatches program algorithmId "${program.algorithmId}".`,
    };
  }

  // Weighted session anchor validation
  if (construction.kind === 'weighted') {
    const anchor = construction.sessionAnchor;
    if (anchor !== undefined && anchor !== null) {
      if (typeof anchor !== 'object') {
        return {
          status: 'invalid_input',
          error: 'INVALID_SESSION_ANCHOR',
          errorMessage: 'sessionAnchor must be a valid object.',
        };
      }
      if (anchor.algorithmId && anchor.algorithmId !== program.algorithmId) {
        return {
          status: 'invalid_input',
          error: 'ANCHOR_ALGORITHM_MISMATCH',
          errorMessage: `sessionAnchor algorithmId "${anchor.algorithmId}" mismatches program algorithmId "${program.algorithmId}".`,
        };
      }
      if (anchor.workingSetCount !== basePrescriptionSets.length) {
        return {
          status: 'invalid_input',
          error: 'ANCHOR_SET_COUNT_MISMATCH',
          errorMessage: `sessionAnchor set count ${anchor.workingSetCount} mismatches base sets ${basePrescriptionSets.length}.`,
        };
      }
      if (Math.abs(anchor.roundedAnchorWeight - basePrescriptionSets[0].weight) > COMPARISON_LOAD_EQUALITY_EPSILON) {
        return {
          status: 'invalid_input',
          error: 'ANCHOR_WEIGHT_MISMATCH',
          errorMessage: `sessionAnchor weight ${anchor.roundedAnchorWeight} mismatches base set 1 weight ${basePrescriptionSets[0].weight}.`,
        };
      }
      if (anchor.anchorReps !== basePrescriptionSets[0].reps) {
        return {
          status: 'invalid_input',
          error: 'ANCHOR_REPS_MISMATCH',
          errorMessage: `sessionAnchor reps ${anchor.anchorReps} mismatches base set 1 reps ${basePrescriptionSets[0].reps}.`,
        };
      }
      if (anchor.modality && anchor.modality !== exercise.modality) {
        return {
          status: 'invalid_input',
          error: 'ANCHOR_MODALITY_MISMATCH',
          errorMessage: `sessionAnchor modality "${anchor.modality}" mismatches exercise modality "${exercise.modality}".`,
        };
      }
      if (anchor.equipment && exercise.equipment && anchor.equipment !== exercise.equipment) {
        return {
          status: 'invalid_input',
          error: 'ANCHOR_EQUIPMENT_MISMATCH',
          errorMessage: `sessionAnchor equipment "${anchor.equipment}" mismatches exercise equipment "${exercise.equipment}".`,
        };
      }
    }
    if (construction.bodyweightSnapshot !== undefined && construction.bodyweightSnapshot !== null) {
      if (
        typeof construction.bodyweightSnapshot !== 'number' ||
        !Number.isFinite(construction.bodyweightSnapshot) ||
        Number.isNaN(construction.bodyweightSnapshot) ||
        construction.bodyweightSnapshot <= 0
      ) {
        return {
          status: 'invalid_input',
          error: 'INVALID_WEIGHTED_BODYWEIGHT_SNAPSHOT',
          errorMessage: `bodyweightSnapshot for weighted construction must be a finite positive number, null, or undefined, got ${construction.bodyweightSnapshot}`,
        };
      }
    }
  }

  // 2. Genuine Bypass Evaluation
  const progressionMode = resolveProgramProgressionMode(program);
  if (progressionMode !== 'metreps_guided') {
    return {
      status: 'bypass',
      bypassReason: 'NON_GUIDED_PROGRESSION_MODE',
      presentedPrescription: basePrescriptionSets.map(s => ({ ...s })),
      snapshots: [],
    };
  }

  if (sessionKind.type === 'one_off') {
    return {
      status: 'bypass',
      bypassReason: 'ONE_OFF_SESSION',
      presentedPrescription: basePrescriptionSets.map(s => ({ ...s })),
      snapshots: [],
    };
  }

  if (sessionKind.type === 'redo') {
    return {
      status: 'bypass',
      bypassReason: 'REDO_SESSION',
      presentedPrescription: basePrescriptionSets.map(s => ({ ...s })),
      snapshots: [],
    };
  }

  if (sessionKind.type === 'deload') {
    return {
      status: 'bypass',
      bypassReason: 'DELOAD_SESSION',
      presentedPrescription: basePrescriptionSets.map(s => ({ ...s })),
      snapshots: [],
    };
  }

  if (sessionKind.type === 'off_day') {
    if (program.objective !== 'Off') {
      return {
        status: 'invalid_input',
        error: 'OFF_DAY_OBJECTIVE_CONTRADICTION',
        errorMessage: `Session kind is off_day but program objective is "${program.objective}".`,
      };
    }
    return {
      status: 'bypass',
      bypassReason: 'OFF_DAY_SESSION',
      presentedPrescription: basePrescriptionSets.map(s => ({ ...s })),
      snapshots: [],
    };
  }

  if (sessionKind.type === 'active_program_session') {
    if (program.objective === 'Off') {
      return {
        status: 'invalid_input',
        error: 'ACTIVE_SESSION_OBJECTIVE_CONTRADICTION',
        errorMessage: 'Session kind is active_program_session but program objective is "Off".',
      };
    }
    if (program.objective !== 'Hypertrophy' && program.objective !== 'Strength') {
      return {
        status: 'bypass',
        bypassReason: 'NON_GUIDED_OBJECTIVE',
        presentedPrescription: basePrescriptionSets.map(s => ({ ...s })),
        snapshots: [],
      };
    }
  }

  if (isRecognizedUnsupportedModality || construction.kind === 'unsupported') {
    return {
      status: 'bypass',
      bypassReason: 'UNSUPPORTED_MODALITY',
      presentedPrescription: basePrescriptionSets.map(s => ({ ...s })),
      snapshots: [],
    };
  }

  // 3. Modality Safety Gate (Genuine Guided Holds)
  const exerciseRole: ExerciseProgressionRole =
    exercise.isMainMovement === true ? 'main_movement' : 'accessory';

  // Generate comparable lane key
  const laneKeyResult = generateComparableLaneKey({
    exerciseKey,
    modality: rawModality,
    exerciseRole,
    prescribedWorkingSetCount: basePrescriptionSets.length,
    periodisationLane,
  });

  if (laneKeyResult.status !== 'success') {
    return {
      status: 'invalid_input',
      error: 'INVALID_LANE_KEY_GENERATION',
      errorMessage: laneKeyResult.error,
    };
  }
  const comparableLaneKey = laneKeyResult.laneKey;

  const buildHoldResult = (
    reasonCode: GuidedCoachingReasonCode,
    successCredit: boolean,
    resolvedComparisonLoadKg: number | null,
    details?: string
  ): SelectGuidedPrescriptionGuidedResult => {
    const presentedPrescription = basePrescriptionSets.map(s => ({ ...s }));
    const loadBasis: ProgressionLoadBasis =
      rawModality === 'weighted'
        ? 'external_weight_v1'
        : rawModality === 'bodyweight'
        ? 'bodyweight_normalized_v1'
        : 'assisted_net_normalized_v1';

    const bodyweightSnapshot = extractContextBodyweight(construction, rawModality);

    const snapshots: PrescriptionSnapshot[] = basePrescriptionSets.map(s => ({
      snapshotVersion: CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
      progressionPolicyVersion: CURRENT_PROGRESSION_POLICY_VERSION,
      algorithmVersion: CURRENT_ALGORITHM_VERSION,
      progressionMode: 'metreps_guided',
      algorithmId: program.algorithmId ?? 'none',
      exerciseKey: exerciseKey.trim(),
      exerciseRole,
      modality: rawModality,
      comparableLaneKey,
      workingSetOrdinal: s.workingSetOrdinal,
      prescribedWorkingSetCount: basePrescriptionSets.length,
      baseWeight: s.weight,
      baseReps: s.reps,
      baseRpe: s.rpe,
      presentedWeight: s.weight,
      presentedReps: s.reps,
      presentedRpe: s.rpe,
      bodyweightSnapshot,
      weightUnit: activeUnit,
      comparisonLoadKg: resolvedComparisonLoadKg,
      loadBasis,
      loadIncrement: canonicalIncrement,
      nudgeType: reasonCode === 'BASE_PRESCRIPTION' ? 'none' : 'hold',
      coachingReasonCode: reasonCode,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 0,
      successCreditEligible: successCredit,
      rollbackTarget: null,
    }));

    return {
      status: 'guided',
      presentedPrescription,
      snapshots,
      coachingReasonCode: reasonCode,
      diagnostics: {
        comparableLaneKey,
        narrowHistoryStatus: 'success',
        broadHistoryStatus: 'success',
        adherenceGateOpen: false,
        gateReady: false,
        successCredit: 0,
        laneReplayTrustStatus: 'safety_hold',
        laneReplayNextAction: 'safety_hold',
        candidateComparisonInvoked: false,
        candidateComparisonStatus: null,
        evaluatedOrdinals: [],
        activeNudgeOrdinal: null,
        challengeCapExempt: false,
        details,
      },
    };
  };

  // Modality safety evaluations
  if (rawModality === 'bodyweight') {
    const bw = extractContextBodyweight(construction, rawModality);
    if (bw === null || bw === undefined || !Number.isFinite(bw) || bw <= 0) {
      return buildHoldResult('MISSING_BODYWEIGHT_HOLD', false, null, 'Bodyweight missing or invalid.');
    }
    if (program.objective === 'Strength' && exerciseRole === 'main_movement') {
      const bwKg = resolveGuidedBodyweightKg(bw, activeUnit);
      return buildHoldResult(
        'BODYWEIGHT_MAIN_LOAD_HOLD',
        false,
        bwKg,
        'Strength main movement with pure bodyweight cannot advance load.'
      );
    }
  }

  if (rawModality === 'assisted') {
    const bw = extractContextBodyweight(construction, rawModality);
    if (bw === null || bw === undefined || !Number.isFinite(bw) || bw <= 0) {
      return buildHoldResult('MISSING_BODYWEIGHT_HOLD', false, null, 'Bodyweight missing or invalid for assisted.');
    }
    const assistance = basePrescriptionSets[0].weight;
    if (!Number.isFinite(assistance) || assistance <= 0) {
      return buildHoldResult('INVALID_ASSISTANCE_HOLD', false, null, 'Assistance non-finite or non-positive.');
    }
    if (assistance > bw + COMPARISON_LOAD_EQUALITY_EPSILON) {
      return buildHoldResult('INVALID_ASSISTANCE_HOLD', false, null, 'Assistance exceeds bodyweight.');
    }
    if (Math.abs(assistance - bw) <= COMPARISON_LOAD_EQUALITY_EPSILON) {
      return buildHoldResult('ZERO_NET_LOAD_HOLD', false, null, 'Assistance exactly equals bodyweight.');
    }
    if (assistance - canonicalIncrement <= COMPARISON_LOAD_EQUALITY_EPSILON) {
      const compLoad = resolveGuidedComparisonLoad({
        modality: 'assisted',
        weight: assistance,
        bodyweight: bw,
        unit: activeUnit,
      });
      return buildHoldResult(
        'MINIMUM_ASSISTANCE_REACHED',
        false,
        compLoad.eligible ? compLoad.comparisonLoadKg : null,
        'Assistance cannot be reduced without reaching or crossing zero.'
      );
    }
  }

  // 4. Provisional Base Snapshot Construction & History Collection
  const initialComparisonLoad = resolveGuidedComparisonLoad({
    modality: rawModality,
    weight: basePrescriptionSets[0].weight,
    bodyweight: extractContextBodyweight(construction, rawModality),
    unit: activeUnit,
  });

  const loadBasis: ProgressionLoadBasis =
    (initialComparisonLoad.eligible && initialComparisonLoad.loadBasis) ||
    (rawModality === 'weighted'
      ? 'external_weight_v1'
      : rawModality === 'bodyweight'
      ? 'bodyweight_normalized_v1'
      : 'assisted_net_normalized_v1');

  const bodyweightSnapshot = extractContextBodyweight(construction, rawModality);

  const provisionalSnapshot: PrescriptionSnapshot = {
    snapshotVersion: CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
    progressionPolicyVersion: CURRENT_PROGRESSION_POLICY_VERSION,
    algorithmVersion: CURRENT_ALGORITHM_VERSION,
    progressionMode: 'metreps_guided',
    algorithmId: program.algorithmId ?? 'none',
    exerciseKey: exerciseKey.trim(),
    exerciseRole,
    modality: rawModality,
    comparableLaneKey,
    workingSetOrdinal: 1,
    prescribedWorkingSetCount: basePrescriptionSets.length,
    baseWeight: basePrescriptionSets[0].weight,
    baseReps: basePrescriptionSets[0].reps,
    baseRpe: basePrescriptionSets[0].rpe,
    presentedWeight: basePrescriptionSets[0].weight,
    presentedReps: basePrescriptionSets[0].reps,
    presentedRpe: basePrescriptionSets[0].rpe,
    bodyweightSnapshot,
    weightUnit: activeUnit,
    comparisonLoadKg: initialComparisonLoad.eligible ? initialComparisonLoad.comparisonLoadKg : null,
    loadBasis,
    loadIncrement: canonicalIncrement,
    nudgeType: 'none',
    coachingReasonCode: 'BASE_PRESCRIPTION',
    confirmedStepIndexBefore: 0,
    presentedStepIndex: 0,
    successCreditEligible: true,
    rollbackTarget: null,
  };

  if (!isValidTargetSnapshot(provisionalSnapshot)) {
    return {
      status: 'invalid_input',
      error: 'INVALID_PROVISIONAL_SNAPSHOT',
      errorMessage: 'Failed to construct a valid provisional snapshot for collection.',
    };
  }

  // Execute history collection
  const targetProgramId = program.id;
  const narrowHistoryResult = collectComparableGuidedHistory({
    targetProgramId,
    programs,
    logs: historicalLogs,
    targetSnapshot: provisionalSnapshot,
    boundary,
  });

  const broadHistoryResult = collectGuidedAdherenceHistory({
    targetProgramId,
    programs,
    logs: historicalLogs,
    targetSnapshot: provisionalSnapshot,
    boundary,
  });

  if (narrowHistoryResult.status === 'fatal_error' || broadHistoryResult.status === 'fatal_error') {
    const errorMsg =
      narrowHistoryResult.status === 'fatal_error'
        ? narrowHistoryResult.errorMessage
        : (broadHistoryResult as { status: 'fatal_error'; errorMessage: string }).errorMessage;
    return buildHoldResult(
      'INCONSISTENT_HISTORY_HOLD',
      true,
      initialComparisonLoad.eligible ? initialComparisonLoad.comparisonLoadKg : null,
      `Fatal error during history collection: ${errorMsg}`
    );
  }

  // Reduce broad adherence
  const broadAdherenceResult = reduceGuidedAdherenceState({
    exposures: broadHistoryResult.usableExposures,
    isPartialLineage: broadHistoryResult.isPartialLineage,
  });

  if (broadAdherenceResult.status === 'invalid_input') {
    return buildHoldResult(
      'INCONSISTENT_HISTORY_HOLD',
      true,
      initialComparisonLoad.eligible ? initialComparisonLoad.comparisonLoadKg : null,
      `Broad adherence reduction failed: ${broadAdherenceResult.errorMessage}`
    );
  }

  // Replay narrow lane state
  const replayResult = replayGuidedLaneState({
    exposures: narrowHistoryResult.usableExposures,
    isPartialLineage: narrowHistoryResult.isPartialLineage,
    broadAdherence: broadAdherenceResult,
  });

  if (replayResult.status === 'invalid_input') {
    return buildHoldResult(
      'INCONSISTENT_HISTORY_HOLD',
      true,
      initialComparisonLoad.eligible ? initialComparisonLoad.comparisonLoadKg : null,
      `Replay state failed: ${replayResult.errorMessage}`
    );
  }

  const confirmedStepIndex = replayResult.confirmedStepIndex;

  function validateGeneratedSnapshots(
    snapshots: readonly PrescriptionSnapshot[],
    expectedReasonCode: GuidedCoachingReasonCode,
    isAdvance: boolean,
    activeOrdinal?: number | null
  ): { valid: boolean; error?: string } {
    if (!snapshots || snapshots.length === 0) {
      return { valid: false, error: 'Empty snapshots array' };
    }

    let activeNudgeCount = 0;

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];

      if (!isValidTargetSnapshot(snap)) {
        return { valid: false, error: `Ordinal ${snap.workingSetOrdinal} failed isValidTargetSnapshot` };
      }
      if (!isValidSnapshotStepMetadata(snap)) {
        return { valid: false, error: `Ordinal ${snap.workingSetOrdinal} failed isValidSnapshotStepMetadata` };
      }
      if (!isValidCoachingReasonMetadata(snap)) {
        return { valid: false, error: `Ordinal ${snap.workingSetOrdinal} failed isValidCoachingReasonMetadata` };
      }

      if (snap.coachingReasonCode !== expectedReasonCode) {
        return {
          valid: false,
          error: `Ordinal ${snap.workingSetOrdinal} reason code ${snap.coachingReasonCode} !== expected ${expectedReasonCode}`,
        };
      }

      if (
        snap.snapshotVersion !== CURRENT_PRESCRIPTION_SNAPSHOT_VERSION ||
        snap.progressionPolicyVersion !== CURRENT_PROGRESSION_POLICY_VERSION ||
        snap.algorithmVersion !== CURRENT_ALGORITHM_VERSION
      ) {
        return { valid: false, error: `Ordinal ${snap.workingSetOrdinal} has invalid version metadata` };
      }

      if (isAdvance) {
        if (snap.nudgeType !== 'none') {
          activeNudgeCount++;
          if (activeOrdinal !== undefined && activeOrdinal !== null && snap.workingSetOrdinal !== activeOrdinal) {
            return { valid: false, error: `Ordinal ${snap.workingSetOrdinal} has unexpected active nudge type` };
          }
          if (snap.rollbackTarget === null || !isValidRollbackTarget(snap.rollbackTarget, snap.modality)) {
            return { valid: false, error: `Ordinal ${snap.workingSetOrdinal} missing valid rollbackTarget for advance` };
          }
          if (snap.presentedStepIndex !== snap.confirmedStepIndexBefore + 1) {
            return { valid: false, error: `Ordinal ${snap.workingSetOrdinal} step index progression invalid` };
          }
        } else {
          if (snap.rollbackTarget !== null) {
            return { valid: false, error: `Ordinal ${snap.workingSetOrdinal} has unexpected rollbackTarget on non-nudged set` };
          }
          if (snap.presentedStepIndex !== snap.confirmedStepIndexBefore) {
            return { valid: false, error: `Ordinal ${snap.workingSetOrdinal} presentedStepIndex !== confirmedStepIndexBefore for stable ordinal` };
          }
        }
      } else {
        if (snap.nudgeType !== 'none' && snap.nudgeType !== 'hold') {
          return { valid: false, error: `Ordinal ${snap.workingSetOrdinal} has unexpected nudgeType for hold` };
        }
        if (snap.rollbackTarget !== null) {
          return { valid: false, error: `Ordinal ${snap.workingSetOrdinal} has non-null rollbackTarget for hold` };
        }
        if (snap.presentedStepIndex !== snap.confirmedStepIndexBefore) {
          return { valid: false, error: `Ordinal ${snap.workingSetOrdinal} presentedStepIndex !== confirmedStepIndexBefore for hold` };
        }
      }
    }

    if (isAdvance && activeNudgeCount !== 1) {
      return { valid: false, error: `Advance snapshot set must have exactly one active nudge (found ${activeNudgeCount})` };
    }

    return { valid: true };
  }

  const buildEvaluationHoldResult = (
    reasonCode: GuidedCoachingReasonCode,
    successCredit: boolean,
    details?: string
  ): SelectGuidedPrescriptionGuidedResult => {
    const presentedPrescription = basePrescriptionSets.map(s => ({ ...s }));
    const snapshots: PrescriptionSnapshot[] = basePrescriptionSets.map(s => {
      const compLoad = resolveGuidedComparisonLoad({
        modality: rawModality,
        weight: s.weight,
        bodyweight: bodyweightSnapshot,
        unit: activeUnit,
      });
      return {
        snapshotVersion: CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
        progressionPolicyVersion: CURRENT_PROGRESSION_POLICY_VERSION,
        algorithmVersion: CURRENT_ALGORITHM_VERSION,
        progressionMode: 'metreps_guided',
        algorithmId: program.algorithmId ?? 'none',
        exerciseKey: exerciseKey.trim(),
        exerciseRole,
        modality: rawModality,
        comparableLaneKey,
        workingSetOrdinal: s.workingSetOrdinal,
        prescribedWorkingSetCount: basePrescriptionSets.length,
        baseWeight: s.weight,
        baseReps: s.reps,
        baseRpe: s.rpe,
        presentedWeight: s.weight,
        presentedReps: s.reps,
        presentedRpe: s.rpe,
        bodyweightSnapshot,
        weightUnit: activeUnit,
        comparisonLoadKg: compLoad.eligible ? compLoad.comparisonLoadKg : null,
        loadBasis,
        loadIncrement: canonicalIncrement,
        nudgeType: reasonCode === 'BASE_PRESCRIPTION' ? 'none' : 'hold',
        coachingReasonCode: reasonCode,
        confirmedStepIndexBefore: confirmedStepIndex,
        presentedStepIndex: confirmedStepIndex,
        successCreditEligible: successCredit,
        rollbackTarget: null,
      };
    });

    const validation = validateGeneratedSnapshots(snapshots, reasonCode, false);
    if (!validation.valid) {
      return {
        status: 'guided',
        presentedPrescription,
        snapshots: [],
        coachingReasonCode: 'INCONSISTENT_HISTORY_HOLD',
        diagnostics: {
          comparableLaneKey,
          narrowHistoryStatus: 'success',
          broadHistoryStatus: 'success',
          adherenceGateOpen: broadAdherenceResult.adherenceGateOpen,
          gateReady: broadAdherenceResult.gateReady,
          successCredit: broadAdherenceResult.successCredit,
          laneReplayTrustStatus: replayResult.trustStatus,
          laneReplayNextAction: replayResult.nextAction,
          candidateComparisonInvoked: false,
          candidateComparisonStatus: null,
          evaluatedOrdinals: [],
          activeNudgeOrdinal: null,
          challengeCapExempt: false,
          details: `Internal snapshot validation failed: ${validation.error}`,
        },
      };
    }

    return {
      status: 'guided',
      presentedPrescription,
      snapshots,
      coachingReasonCode: reasonCode,
      diagnostics: {
        comparableLaneKey,
        narrowHistoryStatus: 'success',
        broadHistoryStatus: 'success',
        adherenceGateOpen: broadAdherenceResult.adherenceGateOpen,
        gateReady: broadAdherenceResult.gateReady,
        successCredit: broadAdherenceResult.successCredit,
        laneReplayTrustStatus: replayResult.trustStatus,
        laneReplayNextAction: replayResult.nextAction,
        candidateComparisonInvoked: false,
        candidateComparisonStatus: null,
        evaluatedOrdinals: [],
        activeNudgeOrdinal: null,
        challengeCapExempt: false,
        details,
      },
    };
  };

  const getDistributionDispatchContext = (): DistributionDispatchContext => ({
    basePrescriptionSets,
    confirmedStepIndex,
    activeUnit,
    modality: rawModality,
    bodyweightSnapshot,
    exerciseKey,
    exerciseRole,
    algorithmId: program.algorithmId ?? 'none',
    comparableLaneKey,
    loadBasis,
    loadIncrement: canonicalIncrement,
  });

  const buildDistributionBypassResult = (bypassReason: string): SelectGuidedPrescriptionGuidedResult => {
    return buildDistributionBypassGuidedResult(bypassReason, getDistributionDispatchContext());
  };

  const buildDistributionMalformedResult = (error: string): SelectGuidedPrescriptionGuidedResult => {
    return buildDistributionMalformedGuidedResult(error, getDistributionDispatchContext());
  };

  // 5. Immutable Decision Precedence

  // Precedence 4: Scheduled Step Loading step-out
  if (
    periodisationLane.algorithmId === 'hypertrophy_step' &&
    periodisationLane.effectivePhase % 4 === 0
  ) {
    return buildEvaluationHoldResult(
      'STEP_OUT_BASE_ONLY',
      false,
      'Scheduled Step Loading step-out phase.'
    );
  }

  // Precedence 5: Current-session high exertion guard (RPE >= 9.5)
  if (basePrescriptionSets.some(s => s.rpe >= 9.5)) {
    return buildEvaluationHoldResult(
      'HIGH_EXERTION_HOLD',
      true,
      'Base prescription set contains high exertion (RPE >= 9.5).'
    );
  }

  // Precedence 6: Required lane rollback
  if (replayResult.rollbackRequired && replayResult.rollbackReason) {
    return buildEvaluationHoldResult(
      replayResult.rollbackReason,
      true,
      'Lane replay requested rollback after failed nudge.'
    );
  }

  // Precedence 7: Compatible pending-nudge retry or stale-pending replacement
  if (replayResult.pendingNudge) {
    const pending = replayResult.pendingNudge;

    const currentBaseReplaySets: GuidedReplayPrescriptionSet[] = basePrescriptionSets.map(b => {
      const compLoad = resolveGuidedComparisonLoad({
        modality: rawModality,
        weight: b.weight,
        bodyweight: bodyweightSnapshot,
        unit: activeUnit,
      });
      return {
        workingSetOrdinal: b.workingSetOrdinal,
        weight: b.weight,
        reps: b.reps,
        rpe: b.rpe,
        comparisonLoadKg: compLoad.eligible ? compLoad.comparisonLoadKg : null,
        weightUnit: activeUnit,
      };
    });

    const isCompatible = arePrescriptionsEqual(pending.rollbackPrescription, currentBaseReplaySets);

    if (isCompatible) {
      // Retry pending nudge
      const presentedPrescription: BasePrescriptionSet[] = pending.presentedPrescription.map(p => ({
        workingSetOrdinal: p.workingSetOrdinal,
        weight: p.weight,
        reps: p.reps,
        rpe: p.rpe,
      }));

      const presentedStepIndex = confirmedStepIndex + 1;
      const snapshots: PrescriptionSnapshot[] = presentedPrescription.map((p, idx) => {
        const baseSet = basePrescriptionSets[idx];
        const isNudgedOrdinal = p.workingSetOrdinal === pending.nudgedWorkingSetOrdinal;
        const compLoad = resolveGuidedComparisonLoad({
          modality: rawModality,
          weight: p.weight,
          bodyweight: bodyweightSnapshot,
          unit: activeUnit,
        });
        const rollbackCompLoad = resolveGuidedComparisonLoad({
          modality: rawModality,
          weight: baseSet.weight,
          bodyweight: bodyweightSnapshot,
          unit: activeUnit,
        });

        const rollbackTarget: GuidedRollbackTarget = {
          weight: baseSet.weight,
          reps: baseSet.reps,
          rpe: baseSet.rpe,
          comparisonLoadKg: rollbackCompLoad.eligible ? rollbackCompLoad.comparisonLoadKg : baseSet.weight,
        };

        return {
          snapshotVersion: CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
          progressionPolicyVersion: CURRENT_PROGRESSION_POLICY_VERSION,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          progressionMode: 'metreps_guided',
          algorithmId: program.algorithmId ?? 'none',
          exerciseKey: exerciseKey.trim(),
          exerciseRole,
          modality: rawModality,
          comparableLaneKey,
          workingSetOrdinal: p.workingSetOrdinal,
          prescribedWorkingSetCount: basePrescriptionSets.length,
          baseWeight: baseSet.weight,
          baseReps: baseSet.reps,
          baseRpe: baseSet.rpe,
          presentedWeight: p.weight,
          presentedReps: p.reps,
          presentedRpe: p.rpe,
          bodyweightSnapshot,
          weightUnit: activeUnit,
          comparisonLoadKg: compLoad.eligible ? compLoad.comparisonLoadKg : null,
          loadBasis,
          loadIncrement: canonicalIncrement,
          nudgeType: isNudgedOrdinal ? pending.nudgeType : 'none',
          coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
          confirmedStepIndexBefore: confirmedStepIndex,
          presentedStepIndex: isNudgedOrdinal ? presentedStepIndex : confirmedStepIndex,
          successCreditEligible: true,
          rollbackTarget: isNudgedOrdinal ? rollbackTarget : null,
        };
      });

      const validation = validateGeneratedSnapshots(
        snapshots,
        'NUDGE_NEUTRAL_RETRY',
        true,
        pending.nudgedWorkingSetOrdinal
      );
      if (!validation.valid) {
        return buildEvaluationHoldResult(
          'INCONSISTENT_HISTORY_HOLD',
          true,
          `Pending retry snapshot validation failed: ${validation.error}`
        );
      }

      return {
        status: 'guided',
        presentedPrescription,
        snapshots,
        coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
        diagnostics: {
          comparableLaneKey,
          narrowHistoryStatus: 'success',
          broadHistoryStatus: 'success',
          adherenceGateOpen: broadAdherenceResult.adherenceGateOpen,
          gateReady: broadAdherenceResult.gateReady,
          successCredit: broadAdherenceResult.successCredit,
          laneReplayTrustStatus: replayResult.trustStatus,
          laneReplayNextAction: replayResult.nextAction,
          candidateComparisonInvoked: false,
          candidateComparisonStatus: null,
          evaluatedOrdinals: [pending.nudgedWorkingSetOrdinal],
          activeNudgeOrdinal: pending.nudgedWorkingSetOrdinal,
          challengeCapExempt: false,
          details: 'Retried compatible pending nudge.',
        },
      };
    } else {
      // Incompatible pending nudge: replace with base prescription
      const res = buildEvaluationHoldResult(
        'BASE_PRESCRIPTION',
        true,
        'Incompatible pending nudge replaced by current base prescription.'
      );
      return {
        ...res,
        diagnostics: {
          ...res.diagnostics,
          pendingNudgeReplacedByBase: true,
        },
      };
    }
  }

  // Precedence 8: History-directed holds
  if (
    narrowHistoryResult.isPartialLineage ||
    replayResult.trustStatus === 'degraded_requalification' ||
    replayResult.nextAction === 'degraded_requalification'
  ) {
    return buildEvaluationHoldResult(
      'DEGRADED_HISTORY_HOLD',
      true,
      'Degraded history or partial lineage.'
    );
  }

  if (replayResult.marginalHoldActive) {
    return buildEvaluationHoldResult(
      'MARGINAL_MISS_TARGET_HELD',
      true,
      'Active marginal hold.'
    );
  }

  if (
    !replayResult.historyNudgeEligible ||
    !replayResult.gateReady ||
    replayResult.trustStatus === 'empty' ||
    replayResult.nextAction !== 'eligible_for_nudge'
  ) {
    return buildEvaluationHoldResult(
      'BASE_PRESCRIPTION',
      true,
      'History ineligible or gate not ready.'
    );
  }

  // 6. Candidate Generation and Evaluation
  type CandidateProposal = {
    coachingReasonCode: GuidedCoachingReasonCode;
    nudgeType: ProgressionNudgeType;
    activeNudgeOrdinal: number;
    affectedOrdinals: number[];
    candidatePrescription: BasePrescriptionSet[];
  };

  const objectiveForBounds: 'Hypertrophy' | 'Strength' | 'Deload' =
    program.objective === 'Strength' ? 'Strength' : 'Hypertrophy';

  const permittedBounds = getPermittedRepetitionBounds({
    objective: objectiveForBounds,
    algorithmId: program.algorithmId ?? 'none',
    isIsolation: exercise.movementCategory === 'isolation',
    isMachine: exercise.equipment === 'machine',
    anchorReps: basePrescriptionSets[0].reps,
  });

  const baseReps = basePrescriptionSets.map(s => s.reps);
  const effectiveReps = basePrescriptionSets.map((s, idx) => {
    const stableSet = replayResult.stablePrescription?.[idx];
    if (
      stableSet &&
      replayResult.stablePrescription?.length === basePrescriptionSets.length &&
      stableSet.reps >= s.reps
    ) {
      const stableWeightInActiveUnit =
        stableSet.weightUnit === activeUnit
          ? stableSet.weight
          : convertWeightUnit(stableSet.weight, stableSet.weightUnit, activeUnit);
      if (Math.abs(stableWeightInActiveUnit - s.weight) <= COMPARISON_LOAD_EQUALITY_EPSILON) {
        return stableSet.reps;
      }
    }
    return s.reps;
  });

  type LoadAdvancedPrescriptionResult =
    | { readonly kind: 'success'; readonly candidateSets: BasePrescriptionSet[] }
    | { readonly kind: 'distribution_bypassed'; readonly bypassReason: string }
    | { readonly kind: 'distribution_malformed'; readonly error: string }
    | { readonly kind: 'assisted_boundary_reached' }
    | { readonly kind: 'unsupported' };

  const generateLoadAdvancedPrescription = (
    repsVector: readonly number[]
  ): LoadAdvancedPrescriptionResult => {
    if (rawModality === 'bodyweight') {
      return { kind: 'unsupported' };
    }

    if (rawModality === 'assisted') {
      const targetLoadRoundingIncrement = getTargetLoadRoundingIncrement(activeUnit);
      const candidateSets: BasePrescriptionSet[] = [];
      for (let i = 0; i < basePrescriptionSets.length; i++) {
        const s = basePrescriptionSets[i];
        const targetReps = repsVector[i];
        const currentEffectiveLoad = (bodyweightSnapshot ?? 0) - s.weight;
        const targetEffectiveLoad = currentEffectiveLoad + canonicalIncrement;
        const proj = projectAssistedTarget({
          targetEffectiveLoad,
          sessionBodyweight: bodyweightSnapshot!,
          targetReps,
          targetRPE: s.rpe,
          unit: activeUnit,
          increment: targetLoadRoundingIncrement,
        });
        if (
          proj.status === 'bypassed' ||
          proj.assistanceWeight <= 0 ||
          proj.assistanceWeight >= (bodyweightSnapshot ?? 0)
        ) {
          return { kind: 'assisted_boundary_reached' };
        }
        candidateSets.push({
          workingSetOrdinal: s.workingSetOrdinal,
          weight: proj.assistanceWeight,
          reps: targetReps,
          rpe: s.rpe,
        });
      }
      return { kind: 'success', candidateSets };
    }

    // Weighted modality
    if (construction.kind === 'weighted') {
      // Isolated single-set branch
      if (basePrescriptionSets.length === 1) {
        const s = basePrescriptionSets[0];
        const newWeight = s.weight + canonicalIncrement;
        if (!Number.isFinite(newWeight) || newWeight <= 0) {
          return {
            kind: 'distribution_malformed',
            error: `Invalid single-set candidate weight: ${newWeight}`,
          };
        }
        return {
          kind: 'success',
          candidateSets: [
            {
              workingSetOrdinal: 1,
              weight: newWeight,
              reps: repsVector[0],
              rpe: s.rpe,
            },
          ],
        };
      }

      // Multi-set weighted advancement: MUST use canonical distributeMultiSetTargets
      const baseAnchor = construction.sessionAnchor;
      if (!baseAnchor) {
        return {
          kind: 'distribution_bypassed',
          bypassReason: 'missing_session_anchor',
        };
      }

      const targetReps = repsVector[0];
      const targetRpe = baseAnchor.anchorRPE;
      const multiplier =
        getRTSMultiplier(targetReps, targetRpe) ??
        (baseAnchor.rawAnchorWeight / baseAnchor.baselineE1RM);
      const newRawWeight = baseAnchor.rawAnchorWeight + canonicalIncrement;
      const newRoundedWeight = baseAnchor.roundedAnchorWeight + canonicalIncrement;
      const newBaselineE1RM =
        typeof baseAnchor.baselineE1RM !== 'number' ||
        !Number.isFinite(baseAnchor.baselineE1RM) ||
        baseAnchor.baselineE1RM <= 0
          ? baseAnchor.baselineE1RM
          : multiplier > 0
          ? newRawWeight / multiplier
          : baseAnchor.baselineE1RM * (newRoundedWeight / baseAnchor.roundedAnchorWeight);

      const promotedAnchor: SessionAnchor = {
        ...baseAnchor,
        rawAnchorWeight: newRawWeight,
        roundedAnchorWeight: newRoundedWeight,
        baselineE1RM: newBaselineE1RM,
        anchorReps: targetReps,
      };

      const targetLoadRoundingIncrement = getTargetLoadRoundingIncrement(activeUnit);
      const distResult = distributeMultiSetTargets(
        promotedAnchor,
        exercise.name ?? exerciseKey,
        historicalLogs as WorkoutLog[],
        targetLoadRoundingIncrement
      );

      if (distResult.isBypassed) {
        return {
          kind: 'distribution_bypassed',
          bypassReason: distResult.bypassReason ?? 'unknown_bypass',
        };
      }

      const val = validateDistributedTargets(
        distResult.targets,
        basePrescriptionSets.length,
        basePrescriptionSets
      );

      if (!val.valid || !val.targets) {
        return {
          kind: 'distribution_malformed',
          error: val.error ?? 'Malformed distribution targets.',
        };
      }

      const candidateSets: BasePrescriptionSet[] = val.targets.map((t, idx) => ({
        workingSetOrdinal: t.workingSetOrdinal,
        weight: t.weight,
        reps: repsVector[idx],
        rpe: t.rpe,
      }));

      return { kind: 'success', candidateSets };
    }

    return { kind: 'unsupported' };
  };

  let proposal: CandidateProposal | null = null;

  if (program.objective === 'Strength' && exerciseRole === 'main_movement') {
    if (rawModality === 'bodyweight') {
      return buildEvaluationHoldResult(
        'BODYWEIGHT_MAIN_LOAD_HOLD',
        false,
        'Bodyweight modality cannot advance load for Strength main movement.'
      );
    }

    const advResult = generateLoadAdvancedPrescription(baseReps);
    if (advResult.kind === 'distribution_bypassed') {
      return buildDistributionBypassResult(advResult.bypassReason);
    }
    if (advResult.kind === 'distribution_malformed') {
      return buildDistributionMalformedResult(advResult.error);
    }
    if (advResult.kind === 'assisted_boundary_reached' || advResult.kind === 'unsupported') {
      return buildEvaluationHoldResult(
        rawModality === 'assisted' ? 'MINIMUM_ASSISTANCE_REACHED' : 'CHALLENGE_CAP_HOLD',
        false,
        'Load advance generation failed or reached boundary.'
      );
    }

    const candidatePrescription = advResult.candidateSets;
    const changedRes = identifyResistanceChangedOrdinals({
      modality: rawModality,
      unit: activeUnit,
      bodyweight: bodyweightSnapshot,
      basePrescriptionSets,
      candidatePrescription,
    });
    if (!changedRes.success) {
      return buildDistributionMalformedResult(changedRes.error);
    }
    const changedOrdinals = changedRes.changedOrdinals;

    proposal = {
      coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
      nudgeType: 'load_nudge',
      activeNudgeOrdinal: 1,
      affectedOrdinals: changedOrdinals.length > 0 ? [...changedOrdinals] : [1],
      candidatePrescription,
    };
  } else {
    // Hypertrophy or Strength accessory: Left-to-right repetition waterfall
    if (effectiveReps[0] >= permittedBounds.maxReps) {
      if (rawModality === 'bodyweight') {
        return buildEvaluationHoldResult(
          'BODYWEIGHT_CEILING_HOLD',
          false,
          'Bodyweight repetition ceiling reached across all sets.'
        );
      }
      const promotedReps = basePrescriptionSets.map(s =>
        s.reps >= permittedBounds.maxReps ? permittedBounds.minReps : s.reps
      );
      const advResult = generateLoadAdvancedPrescription(promotedReps);
      if (advResult.kind === 'distribution_bypassed') {
        return buildDistributionBypassResult(advResult.bypassReason);
      }
      if (advResult.kind === 'distribution_malformed') {
        return buildDistributionMalformedResult(advResult.error);
      }
      if (advResult.kind === 'assisted_boundary_reached' || advResult.kind === 'unsupported') {
        return buildEvaluationHoldResult(
          rawModality === 'assisted' ? 'MINIMUM_ASSISTANCE_REACHED' : 'CHALLENGE_CAP_HOLD',
          false,
          'Load promotion generation failed.'
        );
      }

      const candidatePrescription = advResult.candidateSets;
      const changedRes = identifyResistanceChangedOrdinals({
        modality: rawModality,
        unit: activeUnit,
        bodyweight: bodyweightSnapshot,
        basePrescriptionSets,
        candidatePrescription,
      });
      if (!changedRes.success) {
        return buildDistributionMalformedResult(changedRes.error);
      }
      const changedOrdinals = changedRes.changedOrdinals;

      proposal = {
        coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED',
        nudgeType: 'load_nudge',
        activeNudgeOrdinal: 1,
        affectedOrdinals: changedOrdinals.length > 0 ? [...changedOrdinals] : [1],
        candidatePrescription,
      };
    } else {
      let targetOrdinal = -1;

      for (let i = 1; i < basePrescriptionSets.length; i++) {
        if (effectiveReps[i] < effectiveReps[0]) {
          targetOrdinal = i + 1;
          break;
        }
      }

    if (targetOrdinal !== -1) {
      // In the middle of a rep lap
      const nextReps = effectiveReps[targetOrdinal - 1] + 1;
      if (nextReps > permittedBounds.maxReps) {
        return buildEvaluationHoldResult(
          rawModality === 'bodyweight' ? 'BODYWEIGHT_CEILING_HOLD' : 'CHALLENGE_CAP_HOLD',
          false,
          'Canonical repetition ceiling reached.'
        );
      }

      if (rawModality === 'bodyweight') {
        const solved = solveBodyweightRepTarget({
          targetE1RM:
            (bodyweightSnapshot ?? 0) /
            (getRTSMultiplier(nextReps, basePrescriptionSets[targetOrdinal - 1].rpe) ?? 1),
          sessionBodyweight: bodyweightSnapshot!,
          targetRPE: basePrescriptionSets[targetOrdinal - 1].rpe,
          anchorReps: nextReps,
          minReps: permittedBounds.minReps,
          maxReps: permittedBounds.maxReps,
          unit: activeUnit,
        });
        if (solved.status === 'bypassed') {
          return buildEvaluationHoldResult(
            'BODYWEIGHT_CEILING_HOLD',
            false,
            'Bodyweight repetition solver bypassed.'
          );
        }
      }

      const candidatePrescription: BasePrescriptionSet[] = basePrescriptionSets.map(s => ({
        workingSetOrdinal: s.workingSetOrdinal,
        weight: s.weight,
        reps: s.workingSetOrdinal === targetOrdinal ? nextReps : effectiveReps[s.workingSetOrdinal - 1],
        rpe: s.rpe,
      }));

      proposal = {
        coachingReasonCode: 'REP_NUDGE',
        nudgeType: 'rep_nudge',
        activeNudgeOrdinal: targetOrdinal,
        affectedOrdinals: [targetOrdinal],
        candidatePrescription,
      };
    } else {
      // All sets have equal effective reps
      const lapCompleted =
        effectiveReps[0] > baseReps[0] ||
        (replayResult.confirmedStepIndex > 0 &&
          replayResult.confirmedStepIndex % basePrescriptionSets.length === 0);

      if (!lapCompleted) {
        // Start first lap at Set 1
        const nextReps = effectiveReps[0] + 1;
        if (nextReps <= permittedBounds.maxReps) {
          if (rawModality === 'bodyweight') {
            const solved = solveBodyweightRepTarget({
              targetE1RM:
                (bodyweightSnapshot ?? 0) /
                (getRTSMultiplier(nextReps, basePrescriptionSets[0].rpe) ?? 1),
              sessionBodyweight: bodyweightSnapshot!,
              targetRPE: basePrescriptionSets[0].rpe,
              anchorReps: nextReps,
              minReps: permittedBounds.minReps,
              maxReps: permittedBounds.maxReps,
              unit: activeUnit,
            });
            if (solved.status === 'bypassed') {
              return buildEvaluationHoldResult(
                'BODYWEIGHT_CEILING_HOLD',
                false,
                'Bodyweight repetition solver bypassed.'
              );
            }
          }

          proposal = {
            coachingReasonCode: 'REP_NUDGE',
            nudgeType: 'rep_nudge',
            activeNudgeOrdinal: 1,
            affectedOrdinals: [1],
            candidatePrescription: basePrescriptionSets.map(s => ({
              workingSetOrdinal: s.workingSetOrdinal,
              weight: s.weight,
              reps: s.workingSetOrdinal === 1 ? nextReps : effectiveReps[s.workingSetOrdinal - 1],
              rpe: s.rpe,
            })),
          };
        } else {
          // At max reps: evaluate load promotion or bodyweight hold
          if (rawModality === 'bodyweight') {
            return buildEvaluationHoldResult(
              'BODYWEIGHT_CEILING_HOLD',
              false,
              'Bodyweight repetition ceiling reached across all sets.'
            );
          }
          const promotedReps = basePrescriptionSets.map(s =>
            s.reps >= permittedBounds.maxReps ? permittedBounds.minReps : s.reps
          );
          const advResult = generateLoadAdvancedPrescription(promotedReps);
          if (advResult.kind === 'distribution_bypassed') {
            return buildDistributionBypassResult(advResult.bypassReason);
          }
          if (advResult.kind === 'distribution_malformed') {
            return buildDistributionMalformedResult(advResult.error);
          }
          if (advResult.kind === 'assisted_boundary_reached' || advResult.kind === 'unsupported') {
            return buildEvaluationHoldResult(
              rawModality === 'assisted' ? 'MINIMUM_ASSISTANCE_REACHED' : 'CHALLENGE_CAP_HOLD',
              false,
              'Load promotion generation failed.'
            );
          }

          const candidatePrescription = advResult.candidateSets;
          const changedRes = identifyResistanceChangedOrdinals({
            modality: rawModality,
            unit: activeUnit,
            bodyweight: bodyweightSnapshot,
            basePrescriptionSets,
            candidatePrescription,
          });
          if (!changedRes.success) {
            return buildDistributionMalformedResult(changedRes.error);
          }
          const changedOrdinals = changedRes.changedOrdinals;

          proposal = {
            coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED',
            nudgeType: 'load_nudge',
            activeNudgeOrdinal: 1,
            affectedOrdinals: changedOrdinals.length > 0 ? [...changedOrdinals] : [1],
            candidatePrescription,
          };
        }
      } else {
        // A +1 lap was completed across all sets!
        if (rawModality === 'bodyweight') {
          const nextReps = effectiveReps[0] + 1;
          if (nextReps <= permittedBounds.maxReps) {
            proposal = {
              coachingReasonCode: 'REP_NUDGE',
              nudgeType: 'rep_nudge',
              activeNudgeOrdinal: 1,
              affectedOrdinals: [1],
              candidatePrescription: basePrescriptionSets.map(s => ({
                workingSetOrdinal: s.workingSetOrdinal,
                weight: s.weight,
                reps: s.workingSetOrdinal === 1 ? nextReps : effectiveReps[s.workingSetOrdinal - 1],
                rpe: s.rpe,
              })),
            };
          } else {
            return buildEvaluationHoldResult(
              'BODYWEIGHT_CEILING_HOLD',
              false,
              'Bodyweight repetition ceiling reached across all sets.'
            );
          }
        } else {
          const nextReps = effectiveReps[0] + 1;
          if (nextReps <= permittedBounds.maxReps) {
            proposal = {
              coachingReasonCode: 'REP_NUDGE',
              nudgeType: 'rep_nudge',
              activeNudgeOrdinal: 1,
              affectedOrdinals: [1],
              candidatePrescription: basePrescriptionSets.map(s => ({
                workingSetOrdinal: s.workingSetOrdinal,
                weight: s.weight,
                reps: s.workingSetOrdinal === 1 ? nextReps : effectiveReps[s.workingSetOrdinal - 1],
                rpe: s.rpe,
              })),
            };
          } else {
            // Repetition ceiling reached across all sets: evaluate resistance promotion
            const promotedReps = basePrescriptionSets.map(s =>
              s.reps >= permittedBounds.maxReps ? permittedBounds.minReps : s.reps
            );
            const advResult = generateLoadAdvancedPrescription(promotedReps);
            if (advResult.kind === 'distribution_bypassed') {
              return buildDistributionBypassResult(advResult.bypassReason);
            }
            if (advResult.kind === 'distribution_malformed') {
              return buildDistributionMalformedResult(advResult.error);
            }
            if (advResult.kind === 'assisted_boundary_reached' || advResult.kind === 'unsupported') {
              return buildEvaluationHoldResult(
                'CHALLENGE_CAP_HOLD',
                false,
                'Load promotion unavailable and repetition ceiling reached.'
              );
            }

            const candidatePrescription = advResult.candidateSets;
            const changedRes = identifyResistanceChangedOrdinals({
              modality: rawModality,
              unit: activeUnit,
              bodyweight: bodyweightSnapshot,
              basePrescriptionSets,
              candidatePrescription,
            });
            if (!changedRes.success) {
              return buildDistributionMalformedResult(changedRes.error);
            }
            const changedOrdinals = changedRes.changedOrdinals;

            proposal = {
              coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED',
              nudgeType: 'load_nudge',
              activeNudgeOrdinal: 1,
              affectedOrdinals: changedOrdinals.length > 0 ? [...changedOrdinals] : [1],
              candidatePrescription,
            };
          }
        }
      }
    }
  }
  }

  // Helper to evaluate a candidate proposal with comparator
  const evaluateProposal = (
    prop: CandidateProposal
  ): {
    success: boolean;
    missingFactualOrdinal: number | null;
    structurallyInvalid: boolean;
    anyExempt: boolean;
    comparisonResult: ReturnType<typeof evaluateGuidedCandidateComparison>;
  } => {
    const candidateTargets: CandidateSetTarget[] = prop.affectedOrdinals.map(ord => {
      const targetSet = prop.candidatePrescription[ord - 1];
      const compLoad = resolveGuidedComparisonLoad({
        modality: rawModality,
        weight: targetSet.weight,
        bodyweight: bodyweightSnapshot,
        unit: activeUnit,
      });
      return {
        workingSetOrdinal: ord,
        weight: targetSet.weight,
        reps: targetSet.reps,
        rpe: targetSet.rpe,
        comparisonLoadKg: compLoad.eligible ? compLoad.comparisonLoadKg : null,
        modality: rawModality,
        bodyweight: bodyweightSnapshot,
        unit: activeUnit,
      };
    });

    const compResult = evaluateGuidedCandidateComparison({
      candidateTargets,
      history: broadHistoryResult.usableExposures,
      laneMetadata: {
        modality: rawModality,
        unit: activeUnit,
        currentBodyweight: bodyweightSnapshot,
        exerciseKey,
      },
    });

    const acceptance = evaluateGuidedCandidateAcceptance({
      comparisonResult: compResult,
      expectedAffectedOrdinals: prop.affectedOrdinals,
      canExemptOrdinal: (ordRes, ord) => {
        if (prop.nudgeType !== 'rep_nudge') return false;
        return (
          ordRes.candidateLoadEqualsReference === true &&
          ordRes.isPureRepetitionIncrement === true &&
          ordRes.pureRepetitionExemptionEligible === true &&
          prop.affectedOrdinals.length === 1 &&
          prop.candidatePrescription.reduce((sum, s) => sum + s.reps, 0) ===
            basePrescriptionSets.reduce((sum, s) => sum + s.reps, 0) + 1 &&
          prop.candidatePrescription[ord - 1].reps ===
            basePrescriptionSets[ord - 1].reps + 1 &&
          prop.candidatePrescription.every(
            (s, idx) => s.weight === basePrescriptionSets[idx].weight
          ) &&
          prop.candidatePrescription.every(
            (s, idx) => s.rpe === basePrescriptionSets[idx].rpe
          ) &&
          prop.candidatePrescription[ord - 1].reps <= permittedBounds.maxReps &&
          prop.candidatePrescription[ord - 1].reps >= permittedBounds.minReps &&
          (program.objective === 'Hypertrophy' || exerciseRole === 'accessory') &&
          broadAdherenceResult.adherenceGateOpen === true &&
          broadAdherenceResult.gateReady === true &&
          !replayResult.rollbackRequired &&
          !replayResult.marginalHoldActive &&
          replayResult.trustStatus === 'trusted' &&
          !narrowHistoryResult.isPartialLineage &&
          (rawModality !== 'bodyweight' && rawModality !== 'assisted'
            ? true
            : (() => {
                if (bodyweightSnapshot === null || !ordRes.referenceProvenance) return false;
                const curKg = resolveGuidedBodyweightKg(bodyweightSnapshot, activeUnit);
                const histKg = resolveGuidedBodyweightKg(
                  ordRes.referenceProvenance.historicalBodyweight,
                  ordRes.referenceProvenance.recordedUnit as WeightUnit
                );
                return (
                  curKg !== null &&
                  histKg !== null &&
                  Math.abs(curKg - histKg) <= COMPARISON_LOAD_EQUALITY_EPSILON
                );
              })())
        );
      },
    });

    return {
      ...acceptance,
      comparisonResult: compResult,
    };
  };

  if (!proposal) {
    return buildEvaluationHoldResult(
      'BASE_PRESCRIPTION',
      true,
      'No progression proposal generated.'
    );
  }

  let activeProposal: CandidateProposal = proposal;
  let evalResult = evaluateProposal(activeProposal);

  // If promotion proposal failed, check if another rep lap is permitted
  if (!evalResult.success && activeProposal.coachingReasonCode === 'LOAD_PROMOTION_CEILING_REACHED') {
    const nextReps = effectiveReps[0] + 1;
    if (nextReps <= permittedBounds.maxReps) {
      activeProposal = {
        coachingReasonCode: 'REP_NUDGE',
        nudgeType: 'rep_nudge',
        activeNudgeOrdinal: 1,
        affectedOrdinals: [1],
        candidatePrescription: basePrescriptionSets.map(s => ({
          workingSetOrdinal: s.workingSetOrdinal,
          weight: s.weight,
          reps: s.workingSetOrdinal === 1 ? nextReps : effectiveReps[s.workingSetOrdinal - 1],
          rpe: s.rpe,
        })),
      };
      evalResult = evaluateProposal(activeProposal);
    }
  }

  if (evalResult.structurallyInvalid) {
    return buildEvaluationHoldResult(
      'INCONSISTENT_HISTORY_HOLD',
      true,
      'Structural corruption or invalid comparison candidate output.'
    );
  }

  if (evalResult.missingFactualOrdinal !== null) {
    const res = buildEvaluationHoldResult(
      'BASE_PRESCRIPTION',
      true,
      `Candidate advancement prohibited: affected ordinal ${evalResult.missingFactualOrdinal} lacked factual completed reference in history. No hypothetical base, template, proposed target, or companion ordinal was substituted.`
    );
    return {
      ...res,
      diagnostics: {
        ...res.diagnostics,
        missingFactualEvidenceOrdinal: evalResult.missingFactualOrdinal,
        candidateAdvancementProhibited: true,
        noHypotheticalOrCompanionSubstituted: true,
      },
    };
  }

  if (!evalResult.success) {
    return buildEvaluationHoldResult(
      'CHALLENGE_CAP_HOLD',
      false,
      'Candidate target violates 5% challenge cap.'
    );
  }

  // If candidate is confirmed
  const presentedPrescription = activeProposal.candidatePrescription.map(s => ({ ...s }));
  const presentedStepIndex = confirmedStepIndex + 1;

  const snapshots: PrescriptionSnapshot[] = presentedPrescription.map((s, idx) => {
    const baseSet = basePrescriptionSets[idx];
    const isNudgedOrdinal = s.workingSetOrdinal === activeProposal.activeNudgeOrdinal;
    const compLoad = resolveGuidedComparisonLoad({
      modality: rawModality,
      weight: s.weight,
      bodyweight: bodyweightSnapshot,
      unit: activeUnit,
    });
    const rollbackCompLoad = resolveGuidedComparisonLoad({
      modality: rawModality,
      weight: baseSet.weight,
      bodyweight: bodyweightSnapshot,
      unit: activeUnit,
    });

    const rollbackTarget: GuidedRollbackTarget = {
      weight: baseSet.weight,
      reps: baseSet.reps,
      rpe: baseSet.rpe,
      comparisonLoadKg: rollbackCompLoad.eligible ? rollbackCompLoad.comparisonLoadKg : baseSet.weight,
    };

    return {
      snapshotVersion: CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
      progressionPolicyVersion: CURRENT_PROGRESSION_POLICY_VERSION,
      algorithmVersion: CURRENT_ALGORITHM_VERSION,
      progressionMode: 'metreps_guided',
      algorithmId: program.algorithmId ?? 'none',
      exerciseKey: exerciseKey.trim(),
      exerciseRole,
      modality: rawModality,
      comparableLaneKey,
      workingSetOrdinal: s.workingSetOrdinal,
      prescribedWorkingSetCount: basePrescriptionSets.length,
      baseWeight: baseSet.weight,
      baseReps: baseSet.reps,
      baseRpe: baseSet.rpe,
      presentedWeight: s.weight,
      presentedReps: s.reps,
      presentedRpe: s.rpe,
      bodyweightSnapshot,
      weightUnit: activeUnit,
      comparisonLoadKg: compLoad.eligible ? compLoad.comparisonLoadKg : null,
      loadBasis,
      loadIncrement: canonicalIncrement,
      nudgeType: isNudgedOrdinal ? activeProposal.nudgeType : 'none',
      coachingReasonCode: activeProposal.coachingReasonCode,
      confirmedStepIndexBefore: confirmedStepIndex,
      presentedStepIndex: isNudgedOrdinal ? presentedStepIndex : confirmedStepIndex,
      successCreditEligible: true,
      rollbackTarget: isNudgedOrdinal ? rollbackTarget : null,
    };
  });

  const validation = validateGeneratedSnapshots(
    snapshots,
    activeProposal.coachingReasonCode,
    true,
    activeProposal.activeNudgeOrdinal
  );
  if (!validation.valid) {
    return buildEvaluationHoldResult(
      'INCONSISTENT_HISTORY_HOLD',
      true,
      `Candidate snapshot validation failed: ${validation.error}`
    );
  }

  return {
    status: 'guided',
    presentedPrescription,
    snapshots,
    coachingReasonCode: activeProposal.coachingReasonCode,
    diagnostics: {
      comparableLaneKey,
      narrowHistoryStatus: 'success',
      broadHistoryStatus: 'success',
      adherenceGateOpen: broadAdherenceResult.adherenceGateOpen,
      gateReady: broadAdherenceResult.gateReady,
      successCredit: broadAdherenceResult.successCredit,
      laneReplayTrustStatus: replayResult.trustStatus,
      laneReplayNextAction: replayResult.nextAction,
      candidateComparisonInvoked: true,
      candidateComparisonStatus: evalResult.comparisonResult.status,
      evaluatedOrdinals: activeProposal.affectedOrdinals,
      activeNudgeOrdinal: activeProposal.activeNudgeOrdinal,
      challengeCapExempt: evalResult.anyExempt,
    },
  };
}
